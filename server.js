// Admin 后端 API 服务，监听 3001 端口
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import cors from 'cors'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, 'config.json')
const DEM_ANNOTATIONS_PATH = path.join(__dirname, 'dem_annotations.json')

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// ── LLM API Key ────────────────────────────────────────
const LLM_API_KEY = 'PLACEHOLDER_OPENROUTER_KEY'
const LLM_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const LLM_MODEL       = 'qwen/qwen3-max'          // 纯文本对话（OpenRouter）

// ── 视觉 API（阿里云百炼 DashScope，Qwen3.7-Plus） ──────
const VISION_API_KEY = process.env.VISION_API_KEY || ''
const VISION_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const VISION_MODEL   = 'qwen3.7-plus'             // 通义千问视觉版

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

// 读取全部配置
app.get('/api/config', (req, res) => {
  res.json(readConfig())
})

// 更新 WDP 配置
app.put('/api/config/wdp', (req, res) => {
  const cfg = readConfig()
  cfg.wdp = { ...cfg.wdp, ...req.body }
  writeConfig(cfg)
  res.json({ ok: true })
})

// 更新面板配置（左侧或右侧）
app.put('/api/config/panels', (req, res) => {
  const cfg = readConfig()
  cfg.panels = { ...cfg.panels, ...req.body }
  writeConfig(cfg)
  res.json({ ok: true })
})

// 获取自定义 API 列表
app.get('/api/config/apis', (req, res) => {
  res.json(readConfig().apis)
})

// 新增自定义 API
app.post('/api/config/apis', (req, res) => {
  const cfg = readConfig()
  cfg.apis.push(req.body)
  writeConfig(cfg)
  res.json({ ok: true })
})

// 删除自定义 API（按下标）
app.delete('/api/config/apis/:index', (req, res) => {
  const cfg = readConfig()
  cfg.apis.splice(Number(req.params.index), 1)
  writeConfig(cfg)
  res.json({ ok: true })
})

// ── DEM 高程标注 API ────────────────────────────────────

// 读取标注（含版本号，前端可据此判断是否需要重绘）
function _readAnnotations() {
  try {
    const raw = fs.readFileSync(DEM_ANNOTATIONS_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function _writeAnnotations(data) {
  fs.writeFileSync(DEM_ANNOTATIONS_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

// GET — 前端轮询，返回当前标注 + 版本号
app.get('/api/dem/annotations', (req, res) => {
  const data = _readAnnotations()
  if (!data) {
    return res.json({ version: 0, annotations: null })
  }
  res.json(data)
})

// POST — Claude / AI 推送标注数据
// Body: { type, markers, rectangles, flyTo, summary }
app.post('/api/dem/annotations', (req, res) => {
  const body = req.body
  if (!body || (!body.markers?.length && !body.rectangles?.length)) {
    return res.status(400).json({ ok: false, error: '缺少 markers 或 rectangles' })
  }

  const data = _readAnnotations()
  const newVersion = (data?.version || 0) + 1

  const annotations = {
    version: newVersion,
    timestamp: new Date().toISOString(),
    annotations: {
      type: body.type || 'both',
      markers: body.markers || [],
      rectangles: body.rectangles || [],
      flyTo: body.flyTo || null,
      summary: body.summary || '',
    }
  }

  _writeAnnotations(annotations)
  console.log(`[DEM] 标注已更新 v${newVersion}: ${body.summary || ''}`)
  res.json({ ok: true, version: newVersion })
})

// DELETE — 清除所有标注
app.delete('/api/dem/annotations', (req, res) => {
  try {
    if (fs.existsSync(DEM_ANNOTATIONS_PATH)) {
      fs.unlinkSync(DEM_ANNOTATIONS_PATH)
    }
    console.log('[DEM] 标注已清除')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── AI 聊天路由：Claude + DEM 工具调用 ─────────────────

const AI_SYSTEM_PROMPT = `你是「密云水库数字孪生大屏」的智能控制助手，帮助用户通过自然语言控制3D场景、修改前端面板数据和文字。

【场景背景】
- 数字孪生水库管理系统，场景位于北京密云水库
- 场景中心坐标：[116.965, 40.505]
- 标签页：首页 / 四全 / 四制 / 四预 / 四管

【DEM 高程分析能力】（你拥有以下地形分析工具，必须用工具而不是猜测数据）
你有工具可以分析密云水库周边 5 米分辨率 DEM 数据：
- 单点高程查询（point）
- 找最低/最高点（lowest/highest）
- 找低于某阈值的连通洼地区域并自动划片 ⭐（areas_below：输出矩形范围+最低点标注）
- 在指定位置附近查找低洼区域并自动划片（areas_below_near）
→ 当用户询问"低洼区域""淹没范围""洼地""有哪些区域"等划片类问题时，**必须使用 areas_below 或 areas_below_near**（不要用 lowest，lowest 只返回散点）！
→ 当用户只关心"最低点在哪""最高点在哪"等单点类问题时，使用 lowest/highest。
→ threshold（高程阈值）默认取 150m（水库正常蓄水位附近），用户指定则以用户为准。
→ 分析完成后，summary 字段包含带地名的区域描述（如"白河主坝 2294km²；潮河入库口 0.16km²"），请在回复中自然地复述区域名称和面积，不要原样输出 raw JSON。

【可执行操作】在回复末尾用 <actions>[...json...]</actions> 格式附加操作指令。多个操作放在同一数组中，按顺序执行：

── 场景控制 ──
{"cmd":"setWeather","type":"Sunny"}（Sunny/Cloudy/ModerateRain/ModerateSnow）
{"cmd":"setTime","hour":18}（0-24）
{"cmd":"flyTo","lng":116.965,"lat":40.505,"alt":0,"pitch":-60,"yaw":0,"distance":5000}
{"cmd":"cameraReset"}

── 地图可视化 ──
{"cmd":"showHeatmap"} / {"cmd":"hideHeatmap"}
{"cmd":"showMigration"} / {"cmd":"hideMigration"}
{"cmd":"showFloodHeatmap"} / {"cmd":"hideFloodHeatmap"}
{"cmd":"jumpToPeak"} / {"cmd":"jumpToStep","step":24} / {"cmd":"playFlood"} / {"cmd":"pauseFlood"}
{"cmd":"compareFlood","stepA":64,"stepB":96}

── 灾害预演 ──
{"cmd":"setRainfall","mm":80}（0-300 mm/24h）复位：{"cmd":"resetRainfall"}
{"cmd":"startFlood","scenario":"50yr"}（normal/20yr/50yr/100yr）停止：{"cmd":"stopFlood"} 复位：{"cmd":"resetFlood"}
{"cmd":"toggleGate","idx":0}（0~5）

── 设备控制 ──
{"cmd":"toggleDrone"}

── UI 外观 ──
{"cmd":"switchTheme","theme":"A"}（A=霓虹科技 B=自然绿洲 C=极简暗黑）
{"cmd":"collapsePanels"} / {"cmd":"expandPanels"}

── 标签页 ──
{"cmd":"switchTab","tab":"首页"}（首页/四全/四制/四预/四管）
{"cmd":"createTab","name":"新标签","template":"首页"}（template默认首页）
{"cmd":"removeTab","name":"标签名"}（仅自定义标签可删）

── 路演 ──
{"cmd":"setStage","stage":1}（1预警/2评估/3决策/4执行/5验证）
{"cmd":"nextStage"}

── 前端面板文字修改 ⭐重要！──────────────────────────
{"cmd":"setText","selector":"CSS选择器","value":"新内容"}
切换 Tab 会重置面板内容，修改仅在当前 Tab 有效。批量修改时可在数组中写多个 setText。

── 全局 ─────────────────────────────────────────────
"#js-main-title" → 顶部大标题

── 左面板1（基本信息/概况）───────────────────────────
"#panel-intro .intro-stats .stat-item:nth-child(1) .stat-label" → 统计项1标签
"#panel-intro .intro-stats .stat-item:nth-child(1) .stat-value" → 统计项1数值
"#panel-intro .intro-stats .stat-item:nth-child(2) .stat-label" → 统计项2标签
"#panel-intro .intro-stats .stat-item:nth-child(2) .stat-value" → 统计项2数值
"#panel-intro .intro-stats .stat-item:nth-child(3) .stat-label" → 统计项3标签
"#panel-intro .intro-stats .stat-item:nth-child(3) .stat-value" → 统计项3数值
"#panel-intro .intro-stats .stat-item:nth-child(4) .stat-label" → 统计项4标签
"#panel-intro .intro-stats .stat-item:nth-child(4) .stat-value" → 统计项4数值
"#panel-intro .intro-desc" → 介绍描述段落

── 左面板2下方统计 ──────────────────────────────────
"#p2-stats .gate-stat-item:nth-child(1) .val-cyan" → 统计值1
（以此类推 nth-child(2)~(4)）

── 左面板3元信息 ────────────────────────────────────
"#p3-meta" → 图表上方说明文字

── 右面板1—数值格（首页/四全）───────────────────────
".wq-item:nth-child(1) .wq-label" → 监测项1标签
".wq-item:nth-child(1) .wq-value" → 监测项1数值
（以此类推 nth-child(1)~(8) 的 label 和 value）
".quality-badge" → 水质徽章

── 右面板1—进度条（四制）───────────────────────────
".progress-item:nth-child(1) .progress-label" → 进度项1标签
".progress-item:nth-child(1) .progress-val" → 进度项1数值
（以此类推 nth-child(1)~(8)）

── 右面板1—状态标签（四预/四管）────────────────────
".status-tag-item:nth-child(1) .status-tag-label" → 状态项1标签
".status-tag-item:nth-child(1) .status-tag-val" → 状态项1状态

── 右面板2—安全监测综合评分 ⭐常用───────────────────
".score-num" → 评分数值（如"94.6"）
".score-label" → 评分标签
"#js-safety-metrics .safety-metric-item:nth-child(1) .sm-label" → 指标1标签
"#js-safety-metrics .safety-metric-item:nth-child(1) .sm-value" → 指标1数值
（以此类推 nth-child(2)~(4)）

── 右面板3—事件列表（首页/四全/四制/四管）─────────
"#js-invest-items .invest-item:nth-child(1) .invest-title" → 事件1标题
"#js-invest-items .invest-item:nth-child(1) .invest-val" → 事件1描述
"#js-invest-items .invest-item:nth-child(1) .invest-rate" → 事件1比率
（以此类推 nth-child(2)~(3)）

── 右面板3—预警列表（四预）─────────────────────────
"#js-invest-items .alert-item:nth-child(1) .alert-title" → 预警1标题
"#js-invest-items .alert-item:nth-child(1) .alert-desc" → 预警1描述
"#js-invest-items .alert-item:nth-child(1) .alert-level" → 预警1级别
（以此类推 nth-child(1)~(4)）

── DEM ──
{"cmd":"demClear"} — 仅当用户明确说"清除标注"/"清除DEM"时才使用，分析完成后不要主动调用

【回复规则】
1. 用简短的中文回复（1-2句），简洁直接
2. 地形分析必须用工具，不要编造高程数据
3. 用户要求修改面板文字/数据时，必须用 setText 命令
4. 如需操作，在末尾附加 <actions>[...]</actions>
5. 纯问答不需要附加 actions`

// DEM 工具定义（OpenAI function-calling 格式）
const DEM_TOOLS = [{
  type: 'function',
  function: {
    name: 'analyze_dem',
    description: '分析密云水库 DEM 高程数据。支持：单点查询、找最低/最高点、找低于阈值的连通区域、在指定位置附近搜索。必须用此工具获取真实高程数据，不要编造。',
    parameters: {
      type: 'object',
      properties: {
        query_type: {
          type: 'string',
          enum: ['point', 'lowest', 'highest', 'areas_below', 'areas_below_near'],
          description: '分析类型：point=单点查询, lowest=最低N个点, highest=最高N个点, areas_below=找低于阈值的区域, areas_below_near=指定位置附近低于阈值的区域'
        },
        lon: { type: 'number', description: '经度（WGS84），point 和 areas_below_near 时需要' },
        lat: { type: 'number', description: '纬度（WGS84），point 和 areas_below_near 时需要' },
        n: { type: 'integer', description: '返回的点数，lowest/highest 时使用，默认10' },
        threshold: { type: 'number', description: '高程阈值（米），areas_below 和 areas_below_near 时使用' },
        radius_km: { type: 'number', description: '搜索半径（公里），areas_below_near 时使用，默认5' },
        min_pixels: { type: 'integer', description: '最小区域像素数，过滤噪点，默认30' }
      },
      required: ['query_type']
    }
  }
}]

/** 执行 DEM 分析工具 */
function _execDemTool(args) {
  const python = process.platform === 'win32' ? 'py' : 'python3'
  const script = path.join(__dirname, 'query_elevation.py')
  let cmd

  switch (args.query_type) {
    case 'point':
      cmd = `${python} "${script}" ${args.lon} ${args.lat}`
      break
    case 'lowest':
      cmd = `${python} "${script}" --find-lowest ${args.n || 10}`
      break
    case 'highest':
      cmd = `${python} "${script}" --find-highest ${args.n || 10}`
      break
    case 'areas_below':
      cmd = `${python} "${script}" --annotate-areas-below ${args.threshold || 0} ${args.min_pixels || 30}`
      break
    case 'areas_below_near':
      cmd = `${python} "${script}" --annotate-areas-near ${args.lon} ${args.lat} ${args.radius_km || 5} ${args.threshold || 0}`
      break
    default:
      return { error: `未知 query_type: ${args.query_type}` }
  }

  try {
    console.log(`[DEM Tool] 执行: ${cmd}`)
    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
    const result = JSON.parse(stdout.trim())

    // 如果是标注类型（annotate_*），自动推送到 /api/dem/annotations
    if (args.query_type === 'areas_below' || args.query_type === 'areas_below_near') {
      _pushAnnotation(result)
    } else if (args.query_type === 'lowest') {
      // ── lowest：点标注 + 附带划片分析 ──
      const points = result
      const markers = points.map(p => ({
        lon: p.lon, lat: p.lat, elevation: p.elevation,
        label: `最低#${p.rank}: ${p.elevation}m`
      }))

      // 从最低点推算合理阈值（最低均值 + 10m 作为划片参考），附带运行 areas_below
      let rectangles = []
      let summary = `最低 ${points.length} 个点`
      try {
        const avgElev = points.reduce((s, p) => s + p.elevation, 0) / points.length
        const threshold = Math.ceil(avgElev + 10)  // 最低均值 + 10m
        console.log(`[DEM Tool] 最低点平均高程=${avgElev.toFixed(1)}m, 自动划片阈值=${threshold}m`)
        const areaCmd = `${python} "${script}" --annotate-areas-below ${threshold} ${args.min_pixels || 30}`
        const areaStdout = execSync(areaCmd, { encoding: 'utf-8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
        const areaResult = JSON.parse(areaStdout.trim())
        if (areaResult.rectangles?.length > 0) {
          rectangles = areaResult.rectangles
          summary += `；低洼划片(${areaResult.summary || ''})`
        }
      } catch (e) {
        console.warn('[DEM Tool] 附带划片分析失败:', e.message)
      }

      const annotation = {
        type: rectangles.length > 0 ? 'both' : 'markers',
        markers,
        rectangles,
        flyTo: points.length > 0 ? { lon: points[0].lon, lat: points[0].lat, alt: 0, distance: 3000 } : null,
        summary,
      }
      _pushAnnotation(annotation)
      result._annotated = true
    }

    return result
  } catch (e) {
    console.error(`[DEM Tool] 执行失败:`, e.message)
    return { error: `DEM 分析失败: ${e.message}` }
  }
}

/** 将标注数据推送到 annotations 端点 */
function _pushAnnotation(annotation) {
  const data = _readAnnotations()
  const newVersion = (data?.version || 0) + 1
  const annotations = {
    version: newVersion,
    timestamp: new Date().toISOString(),
    annotations: {
      type: annotation.type || 'both',
      markers: annotation.markers || [],
      rectangles: annotation.rectangles || [],
      flyTo: annotation.flyTo || null,
      summary: annotation.summary || '',
    }
  }
  _writeAnnotations(annotations)
  console.log(`[DEM] 自动标注 v${newVersion}: ${annotation.summary || ''}`)
}

// POST /api/chat — AI 聊天 SSE 端点（支持文本+图片消息）
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: '缺少 messages' })
  }

  // 检测消息中是否包含图片内容
  const hasImage = messages.some(msg => {
    if (Array.isArray(msg.content)) {
      return msg.content.some(c => c.type === 'image_url')
    }
    return false
  })

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const systemPrompt = hasImage ? AI_SYSTEM_PROMPT_VISION : AI_SYSTEM_PROMPT
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ]

    // 第一步：非流式调用（支持工具调用）
    let currentMessages = [...apiMessages]
    let toolRounds = 0
    const MAX_TOOL_ROUNDS = 3

    while (toolRounds < MAX_TOOL_ROUNDS) {
      const body = {
        model: hasImage ? VISION_MODEL : LLM_MODEL,
        messages: currentMessages,
        tools: hasImage ? undefined : DEM_TOOLS,  // 视觉消息不传 tools
        tool_choice: hasImage ? undefined : 'auto',
        stream: false,
        max_tokens: hasImage ? 1500 : 2000,
        temperature: hasImage ? 0.5 : 0.7,
      }
      // 清理 undefined 字段避免 OpenRouter 校验报错
      if (!body.tools) delete body.tools
      if (!body.tool_choice) delete body.tool_choice

      let llmResp
      const apiUrl = hasImage ? VISION_API_URL : LLM_API_URL
      const apiKey = hasImage ? VISION_API_KEY : LLM_API_KEY
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      }
      if (!hasImage) {
        headers['HTTP-Referer'] = 'http://localhost:5173'
        headers['X-Title'] = 'Miyun Reservoir Monitor'
      }
      try {
        llmResp = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      } catch (fetchErr) {
        console.error('[Chat] fetch 异常:', fetchErr.message)
        if (fetchErr.message === 'Failed to fetch' || fetchErr.code === 'ENOTFOUND' || fetchErr.code === 'ECONNREFUSED') {
          sendSSE({ choices: [{ delta: { content: '[网络错误] 无法连接到 OpenRouter AI 服务，请检查网络连接或代理设置。' } }] })
        } else if (fetchErr.message && fetchErr.message.includes('fetch is not defined')) {
          sendSSE({ choices: [{ delta: { content: '[环境错误] Node.js 版本过旧，请升级到 Node 18+ 以支持 fetch API。' } }] })
        } else {
          sendSSE({ choices: [{ delta: { content: `[网络错误] ${fetchErr.message}` } }] })
        }
        sendSSE({ done: true })
        res.end()
        return
      }

      if (!llmResp.ok) {
        const errText = await llmResp.text()
        console.error('[Chat] LLM 请求失败:', llmResp.status, errText)
        // 针对 401/403 给出明确提示
        if (llmResp.status === 401 || llmResp.status === 403) {
          sendSSE({ choices: [{ delta: { content: '[鉴权失败] OpenRouter API Key 无效或已过期，请检查 server.js 中的 LLM_API_KEY。' } }] })
        } else if (llmResp.status === 429) {
          sendSSE({ choices: [{ delta: { content: '[请求过于频繁] OpenRouter 限流，请稍后再试。' } }] })
        } else {
          sendSSE({ choices: [{ delta: { content: `[AI 服务异常 ${llmResp.status}] 请稍后重试。` } }] })
        }
        sendSSE({ done: true })
        res.end()
        return
      }

      const llmData = await llmResp.json()
      const choice = llmData.choices?.[0]
      const message = choice?.message

      // 检查是否有工具调用
      if (message?.tool_calls?.length > 0) {
        console.log(`[Chat] 工具调用轮次 ${toolRounds + 1}`)

        // 将 assistant 消息加入历史
        currentMessages.push({
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.tool_calls
        })

        // 执行每个工具调用
        for (const tc of message.tool_calls) {
          const args = JSON.parse(tc.function.arguments)
          console.log(`[Chat] 执行工具: ${tc.function.name}(${JSON.stringify(args)})`)
          const result = _execDemTool(args)

          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          })
        }

        toolRounds++
        continue
      }

      // 没有工具调用 — 有最终回复
      const content = message?.content || ''

      // 最后一步：流式回放这个回复（模拟 SSE 流，保持前端兼容）
      // 按字符块发送，模拟打字机效果
      const chunks = _splitContent(content)
      for (const chunk of chunks) {
        sendSSE({ choices: [{ delta: { content: chunk } }] })
        // 小延迟模拟流式效果
        await new Promise(r => setTimeout(r, 20))
      }

      sendSSE({ done: true })
      res.end()
      return
    }

    // 达到最大工具轮次仍未得到最终回复
    sendSSE({ choices: [{ delta: { content: '分析完成，请查看地图标注。' } }] })
    sendSSE({ done: true })
    res.end()

  } catch (err) {
    console.error('[Chat] 异常:', err)
    try { sendSSE({ choices: [{ delta: { content: `[错误] ${err.message}` } }] }) } catch (_) {}
    try { sendSSE({ done: true }) } catch (_) {}
    try { res.end() } catch (_) {}
  }
})

/** 将回复文本拆分为小段，模拟流式输出 */
function _splitContent(text) {
  // 保留 <actions> 块完整不拆分
  const parts = []
  const actionMatch = text.match(/<actions>[\s\S]*?<\/actions>/)
  const cleanText = text.replace(/<actions>[\s\S]*?<\/actions>/g, '').trimEnd()

  // 按字符小块发送正文
  let i = 0
  while (i < cleanText.length) {
    const size = Math.min(3 + Math.floor(Math.random() * 8), cleanText.length - i)
    parts.push(cleanText.slice(i, i + size))
    i += size
  }

  // 如果有 actions 块，最后整体发送
  if (actionMatch) {
    parts.push('\n' + actionMatch[0])
  }

  return parts
}

// ── 卫星图目标检测 API ──────────────────────────────────────────────

const DETECT_SYSTEM = `你是卫星遥感图像目标检测系统。输出严格JSON，description只用英文字母数字和空格，不用中文和特殊符号。`

const DETECT_TMPL = `Location: {geo_context}

Find ALL "{target}" in this satellite image.

Rules:
- Scan entire image, don't miss any visible target
- Each target = one detection, never merge
- Tight bounding boxes
- Coordinate: top-left(0,0), bottom-right(1000,1000), format [x1,y1,x2,y2]
- description: English only, short, no special chars

Output ONLY this JSON, nothing else:
{
  "detections": [
    {
      "box_2d": [x1, y1, x2, y2],
      "confidence": 0.85,
      "description": "short description"
    }
  ]
}`

app.post('/api/detect', async (req, res) => {
  const { image, target, bounds, region, nearby_pois, scene_type, image_type } = req.body
  if (!image || !target) {
    return res.status(400).json({ error: '缺少 image 或 target' })
  }

  const is3D   = scene_type === '3d'
  const mime   = image_type === 'jpeg' ? 'image/jpeg' : 'image/png'

  try {
    // 构建地理上下文
    let geo = ''
    if (bounds) {
      geo = `${region ? '【' + region + '】' : ''}北纬${bounds.south?.toFixed(4)}°~${bounds.north?.toFixed(4)}°，东经${bounds.west?.toFixed(4)}°~${bounds.east?.toFixed(4)}°`
    }

    const system = is3D
      ? `你是图像目标检测系统，专门分析三维场景渲染图。找出图中所有指定目标，输出边界框坐标（左上角为原点，右下角为1000,1000）。只输出严格JSON，不要输出其他内容。`
      : DETECT_SYSTEM

    const prompt = is3D
      ? `在这张三维场景图中找出所有"${target}"。\n\n规则：\n- 扫描整张图，不要遗漏\n- 每个目标单独一条\n- 边界框要紧贴目标\n- 坐标系：左上角(0,0)，右下角(1000,1000)，格式[x1,y1,x2,y2]\n- description：用中文简短描述（不超过8个字）\n\n只输出以下JSON，不要输出任何其他内容：\n{\n  "detections": [\n    {\n      "box_2d": [x1, y1, x2, y2],\n      "confidence": 0.85,\n      "description": "中文描述"\n    }\n  ]\n}`
      : DETECT_TMPL.replace('{target}', target).replace('{geo_context}', geo)

    const nearbyHint = nearby_pois ? `周边地名参考：${nearby_pois}\n` : ''

    const body = {
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: `${nearbyHint}${system}` },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 3000,
      temperature: 0.3,
      enable_thinking: false,
    }

    const ac = new AbortController()
    const _t = setTimeout(() => ac.abort(), 150000)
    const llmResp = await fetch(VISION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VISION_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    clearTimeout(_t)

    if (!llmResp.ok) {
      const errText = await llmResp.text()
      console.error('[Detect] LLM 请求失败:', llmResp.status, errText)
      return res.status(llmResp.status).json({ error: `AI 服务异常: ${llmResp.status}` })
    }

    const llmData = await llmResp.json()
    const rawContent = llmData.choices?.[0]?.message?.content || ''
    const finishReason = llmData.choices?.[0]?.finish_reason || ''
    if (finishReason === 'length') console.warn('[Detect] 输出被 max_tokens 截断！')

    // 剥离思维模型的 <think>...</think> 块
    const content = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    if (!content) {
      console.warn('[Detect] 模型仅输出思维内容，无结果')
      return res.json({ detections: [] })
    }
    console.log('[Detect] AI 原始回复:', content.substring(0, 300))

    // 解析 JSON（多层容错）
    let json = content
    // 优先匹配包含 detections 的 JSON 块
    const m = content.match(/\{[\s\S]*"detections"[\s\S]*\}/) || content.match(/\{[\s\S]*\}/)
    if (m) json = m[0]
    // 清理：尾逗号、非法控制字符、未转义引号
    json = json
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')  // 控制字符（保留 \n \t）→ 空格

    let result
    try { result = JSON.parse(json) }
    catch (e1) {
      console.warn('[Detect] JSON解析失败, 尝试修复:', e1.message.substring(0, 80))
      try {
        // 截断时补上 ]} 闭合数组和外层对象
        const idx = json.lastIndexOf('}')
        if (idx > 0) { result = JSON.parse(json.substring(0, idx + 1) + ']}') }
        else throw e1
      } catch (e2) {
        // 最后兜底：用正则提取所有完整的 detection 对象
        const matches = [...json.matchAll(/\{\s*"box_2d"\s*:\s*\[[\d,\s]+\]\s*,\s*"confidence"\s*:\s*[\d.]+\s*,\s*"description"\s*:\s*"[^"]*"\s*\}/g)]
        if (matches.length > 0) {
          console.warn('[Detect] 用正则兜底，提取到', matches.length, '个目标')
          result = { detections: matches.map(m => JSON.parse(m[0])) }
        } else {
          console.error('[Detect] JSON 修复失败，返回空结果')
          result = { detections: [] }
        }
      }
    }
    console.log(`[Detect] 检测到 ${result.detections?.length || 0} 个目标: ${target}`)
    res.json(result)
  } catch (err) {
    console.error('[Detect] 异常:', err)
    res.status(500).json({ error: `检测失败: ${err.message}` })
  }
})

// ── 地图视觉对话 API（合并到 /api/chat，自动检测是否有图片） ──────

// 增强 system prompt：追加地图视觉分析能力
const AI_SYSTEM_PROMPT_VISION = AI_SYSTEM_PROMPT + `

【地图视觉分析能力】
当用户消息中附带卫星地图截图时，你可以直接分析图像内容。
你擅长：识别建筑、道路、水体、植被、大坝、溢洪道等水利设施；评估空间布局；估算目标数量与分布。
当图像中附带【地理参考】信息时，请结合经纬度和周边地名给出更精确的分析。
如需在地图上标注检测结果，在 <actions> 中使用 detect 指令格式：
{"cmd":"detectResult","detections":[{"box_2d":[x1,y1,x2,y2],"confidence":0.9,"description":"溢洪道"}]}`

// ── 统一 chat 路由：支持纯文本和带图消息 ──────────────────────────
// 覆盖原有的 /api/chat，自动检测消息中是否包含 image_url

// 用新路由替换原 /api/chat 逻辑
const _originalChatHandler = app._router?.stack?.find(s => s.route?.path === '/api/chat' && s.route?.methods?.post)
// 由于 express 不支持直接替换已注册路由，这里采用中间件拦截方式：
// 在原有 /api/chat 之前添加一个中间件，如果是 vision 消息则走新逻辑
// 实际上简单方案：在路由回调开头检测 message 格式并分支处理

// 更简单的方案：修改 AI_SYSTEM_PROMPT 引用以支持 vision
// 已有的 /api/chat 路由中，将 AI_SYSTEM_PROMPT 替换为增强版
// 并在 messages 处理时检测 image_url 格式

// ── 淹没水深数据 API ──────────────────────────────────────
const FLOOD_DATA_DIR = path.join(__dirname, 'data', 'flood')

// 内存缓存（避免每次请求都读大文件）
let _floodCache = null

function _loadFloodData() {
  if (_floodCache) return _floodCache

  const cells = JSON.parse(fs.readFileSync(path.join(FLOOD_DATA_DIR, 'cells.json'), 'utf-8'))
  const stepsMeta = JSON.parse(fs.readFileSync(path.join(FLOOD_DATA_DIR, 'steps_meta.json'), 'utf-8'))
  const spatialIdx = JSON.parse(fs.readFileSync(path.join(FLOOD_DATA_DIR, 'spatial_index.json'), 'utf-8'))

  // 构建 cell ID → 索引映射
  const cellById = {}
  cells.forEach(function(c, i) {
    cellById[c.id] = { ...c, _idx: i }
  })

  _floodCache = { cells, cellById, stepsMeta, spatialIdx, GRID_SIZE: spatialIdx.gridSize }
  console.log('[Flood API] 数据已加载: ' + cells.length + ' 格点, ' + stepsMeta.steps.length + ' 步')
  return _floodCache
}

// 获取时间步列表
app.get('/api/flood/steps', function(req, res) {
  try {
    const data = _loadFloodData()
    res.json(data.stepsMeta)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 获取指定时间步的格点淹没数据
// GET /api/flood/grid/17  → 返回 step_17.json 内容
// GET /api/flood/grid/17?compact=1 → 精简格式 {cells:[[lng,lat,depth],...]}
app.get('/api/flood/grid/:step', function(req, res) {
  try {
    const step = parseInt(req.params.step, 10)
    const stepFile = path.join(FLOOD_DATA_DIR, 'step_' + step + '.json')

    if (!fs.existsSync(stepFile)) {
      return res.status(404).json({ error: 'Step ' + step + ' 不存在' })
    }

    const compact = req.query.compact === '1'
    const raw = JSON.parse(fs.readFileSync(stepFile, 'utf-8'))

    if (compact) {
      // 服务端压缩：只返回深度 >0 的格点（大幅减小响应体积）
      const filtered = raw.filter(function(c) { return c[2] > 0.001 })
      res.json({
        step: step,
        count: filtered.length,
        cells: filtered,
      })
    } else {
      res.json({ step: step, count: raw.length, cells: raw })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 根据经纬度查找最近的格点 + 完整时间序列
// GET /api/flood/cells/near?lat=40.50&lng=116.95
app.get('/api/flood/cells/near', function(req, res) {
  try {
    const lat = parseFloat(req.query.lat)
    const lng = parseFloat(req.query.lng)
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: '缺少 lat 或 lng 参数' })
    }

    const data = _loadFloodData()
    const key = Math.floor(lng / data.GRID_SIZE) + '_' + Math.floor(lat / data.GRID_SIZE)
    const candidates = data.spatialIdx.index[key] || []

    if (candidates.length === 0) {
      // 扩大搜索范围
      const offsets = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]
      for (const [dx, dy] of offsets) {
        const k = Math.floor(lng / data.GRID_SIZE + dx) + '_' + Math.floor(lat / data.GRID_SIZE + dy)
        const cells = data.spatialIdx.index[k]
        if (cells) candidates.push(...cells)
      }
    }

    if (candidates.length === 0) {
      return res.json({ found: false })
    }

    // 找最近的格点
    let bestId = candidates[0]
    let bestDist = Infinity
    candidates.forEach(function(id) {
      const cell = data.cellById[id]
      if (!cell) return
      const d = Math.sqrt((cell.lng - lng) ** 2 + (cell.lat - lat) ** 2)
      if (d < bestDist) { bestDist = d; bestId = id }
    })

    const cell = data.cellById[bestId]
    if (!cell) return res.json({ found: false })

    // 读取完整时间序列
    const tsFile = path.join(FLOOD_DATA_DIR, 'timeseries.json')
    const ts = JSON.parse(fs.readFileSync(tsFile, 'utf-8'))
    const series = ts.series[String(cell.id)] || []
    const maxDepth = series.length > 0 ? Math.max(...series).toFixed(3) : '0'

    res.json({
      found: true,
      cell: {
        id: cell.id,
        lng: cell.lng,
        lat: cell.lat,
        elevation: cell.elevation,
        maxDepth: parseFloat(maxDepth),
      },
      timeSeries: {
        steps: ts.steps,
        depths: series,
      },
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 对比两个时间步的淹没差异
// GET /api/flood/compare?stepA=17&stepB=48
app.get('/api/flood/compare', function(req, res) {
  try {
    const stepA = parseInt(req.query.stepA, 10)
    const stepB = parseInt(req.query.stepB, 10)
    if (isNaN(stepA) || isNaN(stepB)) {
      return res.status(400).json({ error: '缺少 stepA 或 stepB' })
    }

    const fileA = path.join(FLOOD_DATA_DIR, 'step_' + stepA + '.json')
    const fileB = path.join(FLOOD_DATA_DIR, 'step_' + stepB + '.json')

    if (!fs.existsSync(fileA)) return res.status(404).json({ error: 'Step ' + stepA + ' 不存在' })
    if (!fs.existsSync(fileB)) return res.status(404).json({ error: 'Step ' + stepB + ' 不存在' })

    const dataA = JSON.parse(fs.readFileSync(fileA, 'utf-8'))
    const dataB = JSON.parse(fs.readFileSync(fileB, 'utf-8'))

    // 构建 B 的 lng,lat → depth 快速查找表
    const bMap = {}
    dataB.forEach(function(c) {
      const key = c[0].toFixed(5) + '_' + c[1].toFixed(5)
      bMap[key] = c[2]
    })

    // 计算差异
    const deltas = []
    let totalDelta = 0
    let maxDrop = 0

    dataA.forEach(function(c) {
      const key = c[0].toFixed(5) + '_' + c[1].toFixed(5)
      const depthB = bMap[key] || 0
      const delta = c[2] - depthB
      if (Math.abs(delta) > 0.001) {
        deltas.push([c[0], c[1], delta])
        totalDelta += delta
        if (delta > maxDrop) maxDrop = delta
      }
    })

    const avgDrop = deltas.length > 0 ? totalDelta / deltas.length : 0

    res.json({
      stepA: stepA,
      stepB: stepB,
      summary: {
        comparedCells: deltas.length,
        avgDrop: Math.round(avgDrop * 1000) / 1000,
        maxDrop: Math.round(maxDrop * 1000) / 1000,
        direction: avgDrop > 0 ? 'stepA 更深（水位下降中）' : 'stepB 更深（水位上涨中）',
      },
      deltas: deltas,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 获取淹没统计摘要（用于 AI 对话上下文注入）
// GET /api/flood/summary
app.get('/api/flood/summary', function(req, res) {
  try {
    const data = _loadFloodData()

    // 第一轮：找真正峰值步（按最大水深）
    let truePeakStep = 0, truePeakMax = 0
    data.stepsMeta.steps.forEach(function(s) {
      const stepFile = path.join(FLOOD_DATA_DIR, 'step_' + s.step + '.json')
      if (!fs.existsSync(stepFile)) return
      try {
        const stepData = JSON.parse(fs.readFileSync(stepFile, 'utf-8'))
        if (!stepData.length) return
        const maxD = Math.max(...stepData.map(function(c) { return c[2] }))
        if (maxD > truePeakMax) { truePeakMax = maxD; truePeakStep = s.step }
        if (maxD > 0.35) console.log('[Flood] step ' + s.step + ' max=' + maxD.toFixed(3))
      } catch (_) {}
    })

    // 第二轮：读取真正的峰值步数据
    const peakFile = path.join(FLOOD_DATA_DIR, 'step_' + truePeakStep + '.json')
    const peakData = JSON.parse(fs.readFileSync(peakFile, 'utf-8'))
    const allDepths = peakData.map(function(c) { return c[2] })
    const truePeakCount = allDepths.length
    const truePeakAvg = allDepths.reduce(function(a, b) { return a + b }, 0) / truePeakCount

    res.json({
      totalCells: data.cells.length,
      totalSteps: data.stepsMeta.steps.length,
      peakStep: truePeakStep,
      peakCellCount: truePeakCount,
      maxDepth: Math.round(truePeakMax * 1000) / 1000,
      avgDepth: Math.round(truePeakAvg * 1000) / 1000,
      cellsBelow50cm: allDepths.filter(function(d) { return d > 0.05 }).length,
      cellsBelow10cm: allDepths.filter(function(d) { return d > 0.01 }).length,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── KML 导出 API ──────────────────────────────────────
app.get('/api/dem/kml', (req, res) => {
  try {
    const threshold = parseFloat(req.query.threshold) || 150
    const minPixels = parseInt(req.query.min_pixels) || 30
    const area = req.query.area || ''  // 地名筛选，如 ?area=白河主坝
    const python = process.platform === 'win32' ? 'py' : 'python3'
    const script = path.join(__dirname, 'query_elevation.py')
    const areaArg = area ? `"${area}"` : ''
    const cmd = `${python} "${script}" --export-kml ${threshold} ${minPixels} none ${areaArg}`
    console.log('[KML] 执行:', cmd)
    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
    const fname = area ? `miyun_${area}_${threshold}m.kml` : `miyun_low_areas_${threshold}m.kml`
    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"`)
    res.send(stdout)
  } catch (e) {
    res.status(500).json({ error: `KML 生成失败: ${e.message}` })
  }
})

app.listen(3001, () => {
  console.log('[Admin API] 运行在 http://localhost:3001')
  console.log('  - POST /api/chat       AI 对话 (支持文本+地图视觉)')
  console.log('  - POST /api/detect     卫星图目标检测')
  console.log('  - GET  /api/dem/annotations  DEM 标注')
})
