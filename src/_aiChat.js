// AI 自然语言控制模块 — 流式对话 → 场景/面板操作
import { getApp }                     from './_wdp.js'
import { setWeather, setTime }         from './_weather.js'
import { showHeatmap, destroyHeatmap } from './_heatmap.js'
import { showMigration, destroyMigration } from './_migration.js'
import { triggerTab, createCustomTab, removeCustomTab } from './_tabSwitch.js'
import { cameraReset }                 from './_camera.js'
import { toggleGate }                  from './_gate.js'
import { startRainfall, resetWaterLevel } from './_rainfall.js'
import { toggleDrone }                 from './_drone.js'
import { switchTheme }                 from './_theme.js'
import { startFlood, stopFlood, resetFlood } from './_flood.js'
import { showFloodHeatmap, hideFloodHeatmap, jumpToPeak, jumpToStep, playFlood, pauseFlood, getFloodState } from './_floodHeatmap.js'
import { setStage, nextStage } from './_demoBar.js'
import { clearDemAnnotations } from './_dem.js'
import { captureMapScreenshotResized } from './_mapScreenshot.js'
import { renderDetectionOnMap, syncDetectionTo3D } from './_mapDetect.js'

// AI 助手现在通过本地 Express 后端调用，由后端统一管理 API Key
const _API_URL = 'http://localhost:3001/api/chat'

// 对话历史（保留最近 10 条，避免 token 超限）
let _messages  = []
let _streaming = false

const _SYSTEM = `你是「水库数字孪生大屏」的智能控制助手，帮助用户通过自然语言控制3D场景和面板效果。

【场景背景】
- 数字孪生水库管理系统，场景位于密云水库
- 场景中心坐标：[116.965, 40.505]（密云水库）
- 标签页：首页 / 四全 / 四制 / 四预 / 四管

【可执行操作】在回复末尾用 <actions>[...json...]</actions> 格式附加操作指令：

天气控制：{"cmd":"setWeather","type":"Sunny"}
  天气类型：Sunny（晴）/ Cloudy（阴）/ ModerateRain（雨）/ ModerateSnow（雪）

时间控制：{"cmd":"setTime","hour":18}
  hour 取值 0-24

相机飞行：{"cmd":"flyTo","lng":113.437,"lat":23.305,"alt":0,"pitch":-60,"yaw":0,"distance":8000}
  pitch 俯仰角（-90 到 0），distance 单位米

相机复位：{"cmd":"cameraReset"}

切换标签：{"cmd":"switchTab","tab":"四管"}
  tab 取值：首页 / 四全 / 四制 / 四预 / 四管，或用户自定义标签名

创建自定义标签：{"cmd":"createTab","name":"新标签名","template":"首页"}
  name：新标签的显示名称；template：以哪个标签的数据为初始模板（首页/四全/四制/四预/四管），默认首页
  创建后自动跳转，面板数据可继续用 setText 修改

删除自定义标签：{"cmd":"removeTab","name":"标签名"}
  只能删除自定义标签，内置五个标签不可删除
热力图：{"cmd":"showHeatmap"} 或 {"cmd":"hideHeatmap"}
迁徙图：{"cmd":"showMigration"} 或 {"cmd":"hideMigration"}

闸门控制：{"cmd":"toggleGate","idx":0}
  idx 取值 0~5，对应第三溢洪道 01~06 号闸门

降雨模拟：{"cmd":"setRainfall","mm":80}
  mm 取值 0-300（24小时降雨量毫米数），自动切换天气、抬升水面
  复位水位：{"cmd":"resetRainfall"}

无人机巡检：{"cmd":"toggleDrone"}
  启动/停止无人机沿路径飞行

淹没预演：{"cmd":"startFlood","scenario":"50yr"}
  scenario 取值：normal（常规泄洪）/ 20yr（20年一遇）/ 50yr（50年一遇）/ 100yr（100年一遇）
  停止预演：{"cmd":"stopFlood"}
  复位淹没：{"cmd":"resetFlood"} — 清除淹没区域、恢复水面高度

淹没水深热力图：{"cmd":"showFloodHeatmap"}（基于DEM格点计算的96步时序淹没水深热力图）
  隐藏：{"cmd":"hideFloodHeatmap"}
  跳转峰值：{"cmd":"jumpToPeak"}
  跳转指定步：{"cmd":"jumpToStep","step":24}
  播放/暂停：{"cmd":"playFlood"} / {"cmd":"pauseFlood"}
  前后对比：{"cmd":"compareFlood","stepA":64,"stepB":96} — 对比两个时间步的淹没水深差异

UI布局：{"cmd":"collapsePanels"}（收折侧面板）/ {"cmd":"expandPanels"}（展开侧面板）
路演阶段：{"cmd":"setStage","stage":1}（1预警/2评估/3决策/4执行/5验证）
  下一步：{"cmd":"nextStage"}

主题切换：{"cmd":"switchTheme","theme":"C"}
  theme 取值 A / B / C，对应三种整体UI风格：
  A = 霓虹科技（纯黑底+霓虹青科幻HUD+等宽字体细线边框+扫描线动画）
  B = 自然绿洲（黛绿底+大地绿色+大圆角无边线+生态自然智慧水利展厅风）
  C = 极简暗黑（纯黑底+纯白主色+无边线卡片毛玻璃+企业级专业数据看板）

面板文字修改：{"cmd":"setText","selector":"CSS选择器","value":"新内容"}
  切换 Tab 会重置面板内容，修改仅在当前 Tab 有效。

  ── 全局 ─────────────────────────────────────────────────────
  "#js-main-title"                                             → 顶部大标题

  ── 左面板1（基本信息 / 概况）────────────────────────────────
  "#panel-intro .intro-stats .stat-item:nth-child(1) .stat-label"  → 统计项1标签（如"库区面积"）
  "#panel-intro .intro-stats .stat-item:nth-child(1) .stat-value"  → 统计项1数值（如"1200 km²"，含单位）
  "#panel-intro .intro-stats .stat-item:nth-child(2) .stat-label"  → 统计项2标签
  "#panel-intro .intro-stats .stat-item:nth-child(2) .stat-value"  → 统计项2数值
  "#panel-intro .intro-stats .stat-item:nth-child(3) .stat-label"  → 统计项3标签
  "#panel-intro .intro-stats .stat-item:nth-child(3) .stat-value"  → 统计项3数值
  "#panel-intro .intro-stats .stat-item:nth-child(4) .stat-label"  → 统计项4标签
  "#panel-intro .intro-stats .stat-item:nth-child(4) .stat-value"  → 统计项4数值
  "#panel-intro .intro-desc"                                   → 介绍描述段落

  ── 左面板2下方统计（首页/四全/四预 有效，四制/四管 无此区域）──
  "#p2-stats .gate-stat-item:nth-child(1) .val-cyan"          → 统计值1
  "#p2-stats .gate-stat-item:nth-child(2) .val-cyan"          → 统计值2
  "#p2-stats .gate-stat-item:nth-child(3) .val-cyan"          → 统计值3
  "#p2-stats .gate-stat-item:nth-child(4) .val-cyan"          → 统计值4

  ── 左面板3元信息 ────────────────────────────────────────────
  "#p3-meta"                                                   → 图表上方说明文字

  ── 右面板1—数值格（grid，首页/四全）──────────────────────────
  ".wq-item:nth-child(1) .wq-label"                           → 监测项1标签
  ".wq-item:nth-child(1) .wq-value"                           → 监测项1数值
  ".wq-item:nth-child(2) .wq-label"                           → 监测项2标签
  ".wq-item:nth-child(2) .wq-value"                           → 监测项2数值
  ".wq-item:nth-child(3) .wq-value"                           → 监测项3数值
  ".wq-item:nth-child(4) .wq-value"                           → 监测项4数值
  ".wq-item:nth-child(5) .wq-value"                           → 监测项5数值
  ".wq-item:nth-child(6) .wq-value"                           → 监测项6数值
  ".wq-item:nth-child(7) .wq-value"                           → 监测项7数值
  ".wq-item:nth-child(8) .wq-value"                           → 监测项8数值
  ".quality-badge"                                            → 底部徽章（如"水质: 优"）

  ── 右面板1—进度条（progress，四制）──────────────────────────
  ".progress-item:nth-child(1) .progress-label"               → 进度项1标签
  ".progress-item:nth-child(1) .progress-val"                 → 进度项1数值（如"100%"）
  ".progress-item:nth-child(2) .progress-label"               → 进度项2标签
  ".progress-item:nth-child(2) .progress-val"                 → 进度项2数值
  （以此类推 nth-child(3)~(8)）

  ── 右面板1—状态标签（status-tag，四预/四管）─────────────────
  ".status-tag-item:nth-child(1) .status-tag-label"           → 状态项1标签
  ".status-tag-item:nth-child(1) .status-tag-val"             → 状态项1状态（如"运行中"）
  ".status-tag-item:nth-child(2) .status-tag-label"           → 状态项2标签
  ".status-tag-item:nth-child(2) .status-tag-val"             → 状态项2状态
  （以此类推 nth-child(3)~(8)）

  ── 右面板2 — 综合评分 ───────────────────────────────────────
  ".score-num"                                                 → 评分数值（如"94.6"）
  ".score-label"                                              → 评分标签（如"安全综合分"）
  "#js-safety-metrics .safety-metric-item:nth-child(1) .sm-label"  → 指标1标签
  "#js-safety-metrics .safety-metric-item:nth-child(1) .sm-value"  → 指标1数值
  "#js-safety-metrics .safety-metric-item:nth-child(2) .sm-label"  → 指标2标签
  "#js-safety-metrics .safety-metric-item:nth-child(2) .sm-value"  → 指标2数值
  "#js-safety-metrics .safety-metric-item:nth-child(3) .sm-label"  → 指标3标签
  "#js-safety-metrics .safety-metric-item:nth-child(3) .sm-value"  → 指标3数值
  "#js-safety-metrics .safety-metric-item:nth-child(4) .sm-label"  → 指标4标签
  "#js-safety-metrics .safety-metric-item:nth-child(4) .sm-value"  → 指标4数值

  ── 右面板3 — 事件列表（event-list，首页/四全/四制/四管）──────
  "#js-invest-items .invest-item:nth-child(1) .invest-title"  → 事件1标题
  "#js-invest-items .invest-item:nth-child(1) .invest-val"    → 事件1描述
  "#js-invest-items .invest-item:nth-child(1) .invest-rate"   → 事件1比率
  "#js-invest-items .invest-item:nth-child(2) .invest-title"  → 事件2标题
  "#js-invest-items .invest-item:nth-child(2) .invest-val"    → 事件2描述
  "#js-invest-items .invest-item:nth-child(2) .invest-rate"   → 事件2比率
  "#js-invest-items .invest-item:nth-child(3) .invest-title"  → 事件3标题
  "#js-invest-items .invest-item:nth-child(3) .invest-val"    → 事件3描述
  "#js-invest-items .invest-item:nth-child(3) .invest-rate"   → 事件3比率

  ── 右面板3 — 预警列表（alert-list，四预）────────────────────
  "#js-invest-items .alert-item:nth-child(1) .alert-title"    → 预警1标题
  "#js-invest-items .alert-item:nth-child(1) .alert-desc"     → 预警1描述
  "#js-invest-items .alert-item:nth-child(1) .alert-level"    → 预警1级别（如"黄色"）
  "#js-invest-items .alert-item:nth-child(2) .alert-title"    → 预警2标题
  "#js-invest-items .alert-item:nth-child(2) .alert-desc"     → 预警2描述
  "#js-invest-items .alert-item:nth-child(2) .alert-level"    → 预警2级别
  "#js-invest-items .alert-item:nth-child(3) .alert-title"    → 预警3标题
  "#js-invest-items .alert-item:nth-child(3) .alert-desc"     → 预警3描述
  "#js-invest-items .alert-item:nth-child(3) .alert-level"    → 预警3级别
  "#js-invest-items .alert-item:nth-child(4) .alert-title"    → 预警4标题
  "#js-invest-items .alert-item:nth-child(4) .alert-desc"     → 预警4描述
  "#js-invest-items .alert-item:nth-child(4) .alert-level"    → 预警4级别

【回复规则】
1. 用简短的中文回复（1-2句），简洁直接
2. 如需操作，在末尾附加 <actions>[{"cmd":"..."}]</actions>
3. 多个操作放在同一数组中，按顺序执行；批量修改文字时可在数组中写多个 setText
4. 纯问答不需要附加 actions`

/**
 * 初始化 AI 助手模块
 */
export function initAiChat() {
  _createUI()
}

/**
 * 创建悬浮聊天 UI
 */
function _createUI() {
  const container = document.createElement('div')
  container.className = 'ai-chat'
  container.id = 'js-ai-chat'
  container.innerHTML = `
    <div class="ai-chat__window" id="js-ai-window">
      <div class="ai-chat__header">
        <span>✨ AI 智能助手</span>
        <div style="display:flex;align-items:center;gap:4px;">
          <button class="ai-chat__resize-btn" id="js-ai-resize" title="切换窗口大小">□</button>
          <button class="ai-chat__close" id="js-ai-close" title="关闭">×</button>
        </div>
      </div>
      <div class="ai-chat__messages" id="js-ai-messages">
        <div class="ai-chat__msg ai-chat__msg--assistant">你好！我可以帮你控制场景和切换主题。试试说：「切换为党政风格」或「换成华为极简主题」。</div>
      </div>
      <div class="ai-chat__input-row">
        <input
          class="ai-chat__input"
          id="js-ai-input"
          type="text"
          placeholder="输入指令，例如：黄昏时分，下小雨..."
          maxlength="200"
          autocomplete="off"
        />
        <button class="ai-chat__mic" id="js-ai-mic" title="语音输入">🎤</button>
        <button class="ai-chat__send" id="js-ai-send">发送</button>
      </div>
    </div>
    <button class="ai-chat__toggle" id="js-ai-toggle" title="AI 智能助手">
      <span class="ai-chat__toggle-icon">✨</span>
      <span>AI 助手</span>
    </button>
  `

  document.querySelector('.scene-container').appendChild(container)

  // 展开/收起
  document.getElementById('js-ai-toggle').addEventListener('click', _toggleWindow)
  document.getElementById('js-ai-close').addEventListener('click', _toggleWindow)

  // 窗口大小切换
  document.getElementById('js-ai-resize').addEventListener('click', _cycleSize)

  // 发送
  document.getElementById('js-ai-send').addEventListener('click', _onSend)
  document.getElementById('js-ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _onSend() }
  })

  // 语音输入
  _initVoice()
}

/**
 * 初始化语音识别（Web Speech API）
 * 每次录音新建实例，避免 Chrome 复用实例静默失败
 */
function _initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  const micBtn = document.getElementById('js-ai-mic')

  // 浏览器不支持时隐藏按钮
  if (!SpeechRecognition) {
    micBtn.style.display = 'none'
    return
  }

  let _recognition = null

  // 错误码 → 中文提示
  const _errMsg = {
    'not-allowed':      '麦克风权限被拒绝，请在浏览器地址栏允许麦克风访问',
    'no-speech':        '未检测到声音，请靠近麦克风再试',
    'audio-capture':    '未找到麦克风设备',
    'network':          '语音识别需要网络连接',
    'service-not-allowed': '页面需在 https 或 localhost 下运行才能使用语音',
  }

  function _stopListening() {
    micBtn.classList.remove('ai-chat__mic--active')
    micBtn.title = '语音输入'
    // 清空输入框的临时内容
    const input = document.getElementById('js-ai-input')
    if (input.dataset.interim) {
      input.value = ''
      delete input.dataset.interim
    }
    _recognition = null
  }

  function _startListening() {
    _recognition = new SpeechRecognition()
    _recognition.lang = 'zh-CN'
    _recognition.continuous = false
    _recognition.interimResults = true   // 开启实时结果，输入框即时显示
    _recognition.maxAlternatives = 1

    _recognition.onstart = () => {
      micBtn.classList.add('ai-chat__mic--active')
      micBtn.title = '录音中，点击停止'
    }

    // 实时把临时识别结果显示在输入框，让用户确认麦克风有收音
    _recognition.onresult = (e) => {
      const input = document.getElementById('js-ai-input')
      let interim = ''
      let final   = ''
      for (const result of e.results) {
        if (result.isFinal) final   += result[0].transcript
        else                interim += result[0].transcript
      }
      if (final) {
        input.value = final.trim()
        delete input.dataset.interim
      } else {
        input.value = interim
        input.dataset.interim = '1'   // 标记为临时内容
      }
    }

    _recognition.onend = () => {
      const input = document.getElementById('js-ai-input')
      const text  = input.value.trim()
      _stopListening()
      // 有最终识别结果才发送
      if (text && !input.dataset.interim) {
        _onSend()
      }
    }

    _recognition.onerror = (e) => {
      const msg = _errMsg[e.error] || `语音识别出错：${e.error}`
      _appendMessage('assistant', `🎤 ${msg}`)
      _stopListening()
    }

    _recognition.start()
  }

  micBtn.addEventListener('click', () => {
    if (_streaming) return
    if (_recognition) {
      _recognition.stop()
    } else {
      _startListening()
    }
  })
}

// ── 分析上下文注入 ────────────────────────────────

/**
 * 收集当前分析状态，注入到 AI 对话上下文中
 * 让 AI 在回答时能引用淹没数据、DEM 标注、检测结果
 */
async function _buildAnalysisContext(userText) {
  const parts = []

  // 1. 淹没水深数据
  try {
    const floodState = getFloodState()
    if (floodState.active) {
      parts.push(`【淹没水深分析】
- 当前时间步: T+${floodState.step}h / 共${floodState.totalSteps}步
- 峰值步: T+${floodState.peakStep}h, 峰值水深: ${floodState.peakDepth}m
- 正在播放: ${floodState.playing ? '是' : '否'}`)
    }
  } catch (_) {}

  // 2. DEM 高程标注
  try {
    const resp = await fetch('http://localhost:3001/api/dem/annotations')
    if (resp.ok) {
      const data = await resp.json()
      if (data.annotations?.summary) {
        parts.push(`【DEM高程分析】${data.annotations.summary}`)
      }
      if (data.annotations?.markers?.length > 0) {
        const labels = data.annotations.markers.slice(0, 5).map(function(m) { return m.label }).join(', ')
        parts.push(`标注点(${data.annotations.markers.length}个): ${labels}`)
      }
    }
  } catch (_) {}

  if (parts.length === 0) return ''

  return '\n\n【系统注入：当前分析状态】\n' + parts.join('\n') +
    '\n\n请结合以上分析数据回答用户问题。如果问题不需要这些数据，正常回答即可。'
}

/**
 * 展开/收起聊天窗口
 */
function _toggleWindow() {
  const win = document.getElementById('js-ai-window')
  const isOpen = win.classList.toggle('ai-chat__window--open')
  if (isOpen) document.getElementById('js-ai-input').focus()
}

/** 窗口尺寸三档循环：sm → md → lg → sm */
const _SIZE_CLASSES = ['ai-chat__window--sm', 'ai-chat__window--md', 'ai-chat__window--lg']
function _cycleSize() {
  const win = document.getElementById('js-ai-window')
  const current = _SIZE_CLASSES.findIndex(function(c) { return win.classList.contains(c) })
  const next = (current + 1) % _SIZE_CLASSES.length
  _SIZE_CLASSES.forEach(function(c) { win.classList.remove(c) })
  win.classList.add(_SIZE_CLASSES[next])
  _scrollToBottom()
}

/** 外部设置窗口尺寸 */
export function setAiChatSize(size) {
  const win = document.getElementById('js-ai-window')
  if (!win) return
  _SIZE_CLASSES.forEach(function(c) { win.classList.remove(c) })
  if (size === 'sm') win.classList.add('ai-chat__window--sm')
  if (size === 'lg') win.classList.add('ai-chat__window--lg')
  // md 是默认（不加类）
}

/**
 * 用户点击发送
 */
async function _onSend() {
  if (_streaming) return
  const input = document.getElementById('js-ai-input')
  const text  = input.value.trim()
  if (!text) return
  input.value = ''

  // 渲染用户气泡
  _appendMessage('user', text)

  // ── 地图视觉增强：尝试截取地图截图（2D 或 3D） ──
  // DEM/高程/面积类查询跳过截图，保留 tools 通道（hasImage=false 才传 DEM_TOOLS）
  const _needsDemTool = /高程|DEM|面积|低洼|淹没区|低于\s*\d|统计|地形|连通|最低点|最高点|划片|区域分析/.test(text)
  let screenshotData = null
  if (!_needsDemTool) try {
    const { getMapMode } = await import('./_amap.js')
    const mode = getMapMode()
    if (mode === 'satellite' || mode === 'standard') {
      screenshotData = await captureMapScreenshotResized()
    } else if (mode === '3d') {
      const App = getApp()
      if (App) {
        try {
          const r = await App.Renderer.GetSnapshot([1024, 576], 0.85)
          if (r?.success && r.result) {
            const raw = typeof r.result === 'string' ? r.result : ''
            let b64 = raw, mime = 'image/jpeg'
            if (raw.startsWith('data:')) {
              const [header, data] = raw.split(',')
              b64 = data
              mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg'
            } else if (raw.startsWith('iVBORw0KGgo')) {
              mime = 'image/png'
            }
            if (b64) screenshotData = { image: b64, is3d: true, mime }
          }
        } catch (e) { console.warn('[aiChat] 3D 截图失败:', e.message) }
      }
    }
  } catch (_) { /* _amap 未初始化，忽略 */ }

  // ── 注入分析上下文（淹没数据 + DEM 标注 + 检测结果）───
  const analysisCtx = await _buildAnalysisContext(text)
  const userText = analysisCtx ? text + analysisCtx : text

  if (screenshotData && screenshotData.image) {
    let geoNote = ''
    if (screenshotData.bounds) {
      const geoCtxParts = []
      const regionEl = document.getElementById('info-region')
      const region = regionEl ? regionEl.textContent || '' : ''
      if (region) geoCtxParts.push(`【${region}】`)
      geoCtxParts.push(
        `北纬${screenshotData.bounds.south.toFixed(4)}°~${screenshotData.bounds.north.toFixed(4)}°，` +
        `东经${screenshotData.bounds.west.toFixed(4)}°~${screenshotData.bounds.east.toFixed(4)}°`
      )
      let nearby = ''
      try {
        const amapMod = await import('./_amap.js')
        if (amapMod.getNearbyPois) nearby = amapMod.getNearbyPois()
      } catch (_) {}
      geoNote = `\n\n【地理参考】\n当前截图地理位置：${geoCtxParts.join(' ')}` +
                (nearby ? `\n周边地名/设施：${nearby}` : '')
    }
    const sceneNote = screenshotData.is3d ? '\n\n【当前视图】这是密云水库数字孪生3D场景截图，非卫星图。' : ''
    const mime = screenshotData.mime || (screenshotData.is3d ? 'image/jpeg' : 'image/png')
    _messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mime};base64,${screenshotData.image}` } },
        { type: 'text', text: `${userText}${geoNote}${sceneNote}` },
      ],
    })
  } else {
    _messages.push({ role: 'user', content: userText })
  }
  if (_messages.length > 10) _messages = _messages.slice(-10)

  // 创建 AI 回复气泡（占位）
  const bubbleId = `ai-b-${Date.now()}`
  _appendMessage('assistant', '...', bubbleId)

  await _streamResponse(bubbleId)
}

/**
 * 流式调用 Claude API
 */
async function _streamResponse(bubbleId) {
  _streaming = true
  _setSendEnabled(false)

  const bubble = document.getElementById(bubbleId)
  let fullText = ''

  try {
    // 先检查后端服务是否可达
    let resp
    try {
      resp = await fetch(_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: _messages }),
      })
    } catch (fetchErr) {
      if (fetchErr.message === 'Failed to fetch') {
        _setBubbleText(bubble, '[连接失败] 无法连接到本地 AI 服务。请确认：\n1. 已执行 npm run dev:server 启动后端\n2. 后端在 http://localhost:3001 正常运行')
      } else {
        _setBubbleText(bubble, `[网络错误] ${fetchErr.message}`)
      }
      console.error('[AI助手] 请求异常:', fetchErr)
      return
    }

    if (!resp.ok) {
      const errText = await resp.text()
      _setBubbleText(bubble, `[请求失败 ${resp.status}] ${errText}`)
      return
    }

    // 逐块读取 SSE 流
    const reader  = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() // 保留未完整的最后一行

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') continue
        let json
        try { json = JSON.parse(raw) } catch { continue }
        const delta = json.choices?.[0]?.delta?.content ?? ''
        fullText += delta
        // 显示时去掉 <actions> 块，保留打字机光标
        _setBubbleText(bubble, _stripActions(fullText) + '▋')
      }
    }

    // 流结束：去掉光标，解析执行操作
    _setBubbleText(bubble, _stripActions(fullText))

    const actions = _extractActions(fullText)
    if (actions.length > 0) {
      _appendStatusLine(bubble, `⚙ 正在执行 ${actions.length} 个操作...`)
      await _executeActions(actions)
      _appendStatusLine(bubble, '✅ 完成')
    }

    // 保存 AI 回复（含 actions 原文，供上下文参考）
    _messages.push({ role: 'assistant', content: fullText })
    if (_messages.length > 10) _messages = _messages.slice(-10)

  } catch (err) {
    _setBubbleText(bubble, `[网络错误] ${err.message}`)
    console.error('[AI助手] 请求异常:', err)
  } finally {
    _streaming = false
    _setSendEnabled(true)
    _scrollToBottom()
  }
}

/**
 * 去除文本中的 <actions> 标签块
 */
function _stripActions(text) {
  return text.replace(/<actions>[\s\S]*?<\/actions>/g, '').trimEnd()
}

/**
 * 从文本末尾提取 <actions>[...json...]</actions>
 */
function _extractActions(text) {
  const m = text.match(/<actions>([\s\S]*?)<\/actions>/)
  if (!m) return []
  try { return JSON.parse(m[1]) } catch { return [] }
}

/**
 * 根据指令 cmd 调用对应模块函数
 */
async function _executeActions(actions) {
  const App = getApp()
  for (const action of actions) {
    try {
      switch (action.cmd) {
        case 'setWeather':
          await setWeather(action.type)
          break
        case 'setTime':
          await setTime(Number(action.hour))
          break
        case 'flyTo':
          if (App) {
            await App.CameraControl.FlyTo({
              targetPosition: [action.lng, action.lat, action.alt ?? 0],
              rotation: { pitch: action.pitch ?? -45, yaw: action.yaw ?? 0 },
              distance: action.distance ?? 5000,
              flyTime: 2,
            })
          }
          break
        case 'cameraReset':
          await cameraReset()
          break
        case 'switchTab':
          triggerTab(action.tab)
          break
        case 'createTab':
          createCustomTab(action.name, action.template || '首页')
          break
        case 'removeTab':
          removeCustomTab(action.name)
          break
        case 'showHeatmap':
          await showHeatmap()
          break
        case 'hideHeatmap':
          await destroyHeatmap()
          break
        case 'showMigration':
          await showMigration()
          break
        case 'hideMigration':
          await destroyMigration()
          break
        case 'toggleGate':
          await toggleGate(Number(action.idx) || 0)
          break
        case 'setRainfall':
          await startRainfall(Number(action.mm) || 0)
          break
        case 'resetRainfall':
          await resetWaterLevel()
          break
        case 'startFlood':
          await startFlood(action.scenario || '50yr')
          break
        case 'stopFlood':
          await stopFlood()
          break
        case 'resetFlood':
          await resetFlood()
          break
        case 'toggleDrone':
          await toggleDrone()
          break
        case 'switchTheme':
          switchTheme(action.theme || 'A')
          break
        // ── 地图视觉检测结果 ──
        case 'detectResult': {
          const detections = action.detections || []
          const boundsData = action.bounds || null
          if (detections.length > 0) {
            try {
              const { renderDetectionOnMap, syncDetectionTo3D } = await import('./_mapDetect.js')
              await renderDetectionOnMap(detections, boundsData)
              await syncDetectionTo3D(detections, boundsData)
            } catch (err) {
              console.warn('[AI助手] 检测结果渲染失败:', err)
            }
          }
          break
        }
        // ── DEM 高程标注 ──
        case 'demAnnotate':
          await fetch('http://localhost:3001/api/dem/annotations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.annotations)
          })
          break
        case 'demClear':
          await clearDemAnnotations()
          break
        // ── 淹没水深热力图 ──
        case 'showFloodHeatmap':
          await showFloodHeatmap()
          break
        case 'hideFloodHeatmap':
          hideFloodHeatmap()
          break
        case 'jumpToPeak':
          await jumpToPeak()
          break
        case 'jumpToStep':
          await jumpToStep(Number(action.step) || 1)
          break
        case 'playFlood':
          playFlood()
          break
        case 'pauseFlood':
          pauseFlood()
          break
        // ── 前后对比 ──
        case 'compareFlood': {
          try {
            const stepA = action.stepA || 64
            const stepB = action.stepB || 96
            const resp = await fetch(`http://localhost:3001/api/flood/compare?stepA=${stepA}&stepB=${stepB}`)
            if (resp.ok) {
              const data = await resp.json()
              // 注入对比结果到对话历史，让 AI 在下一轮能引用
              const summary = `【淹没对比结果 T+${stepA}h vs T+${stepB}h】
平均水深下降: ${data.summary.avgDrop}m, 最大下降: ${data.summary.maxDrop}m
对比格点数: ${data.summary.comparedCells}, 趋势: ${data.summary.direction}`
              // 追加一条 system 消息
              _messages.push({ role: 'user', content: summary })
              if (_messages.length > 10) _messages = _messages.slice(-10)
              console.log('[AI助手] 对比数据已注入:', summary)
            }
          } catch (err) { console.warn('[AI助手] compareFlood失败:', err) }
          break
        }
        // ── UI 布局 ──
        case 'collapsePanels':
          document.querySelectorAll('.side-panel').forEach(function(p) { p.classList.add('side-panel--collapsed') })
          break
        case 'expandPanels':
          document.querySelectorAll('.side-panel').forEach(function(p) { p.classList.remove('side-panel--collapsed') })
          break
        case 'setStage':
          setStage(Number(action.stage) || 1)
          break
        case 'nextStage':
          nextStage()
          break
        case 'setText': {
          const el = document.querySelector(action.selector)
          if (el) el.textContent = action.value
          break
        }
        default:
          console.warn('[AI助手] 未知指令:', action.cmd)
      }
    } catch (err) {
      console.warn('[AI助手] 执行失败:', action.cmd, err)
    }
  }
}

// ── DOM 工具函数 ────────────────────────────────

function _appendMessage(role, text, id = '') {
  const list = document.getElementById('js-ai-messages')
  const div  = document.createElement('div')
  div.className = `ai-chat__msg ai-chat__msg--${role}`
  if (id) div.id = id
  div.textContent = text
  list.appendChild(div)
  _scrollToBottom()
}

function _setBubbleText(el, text) {
  if (el) el.textContent = text
  _scrollToBottom()
}

function _appendStatusLine(bubbleEl, text) {
  if (!bubbleEl) return
  const span = document.createElement('span')
  span.className = 'ai-chat__status'
  span.textContent = '\n' + text
  bubbleEl.appendChild(span)
  _scrollToBottom()
}

function _scrollToBottom() {
  const list = document.getElementById('js-ai-messages')
  if (list) list.scrollTop = list.scrollHeight
}

function _setSendEnabled(enabled) {
  const btn   = document.getElementById('js-ai-send')
  const input = document.getElementById('js-ai-input')
  if (btn)   btn.disabled   = !enabled
  if (input) input.disabled = !enabled
}
