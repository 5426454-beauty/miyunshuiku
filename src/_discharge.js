// 泄洪调度预演模块 — 泄洪量计算 + 启闭闸门规划 + 3D 模拟
import { getApp, onSceneReady } from './_wdp.js'

// 闸门区域最佳观察视角（从场景中实测获取）
const GATE_CAMERA_POSE = {
  location: [117.00071174467659, 40.46546125640009, 191.91273090834079],
  rotation: { pitch: -13.811284065246582, yaw: -83.191871643066406 },
  flyTime: 2,
}

/** 镜头飞到第三溢洪道闸门区域 */
async function _flyToGate() {
  const App = getApp()
  if (!App) return
  try { await App.CameraControl.SetCameraPose(GATE_CAMERA_POSE) } catch (e) {}
}

// ═══════════════════════════════
// 物理常量
// ═══════════════════════════════
const G          = 9.81   // 重力加速度 m/s²
const CD         = 0.65   // 流量系数
const GATE_WIDTH = 10     // 闸门宽度 m（统一规格）
const MAX_GATE_HEIGHT = 30 // 闸门最大开启高度 m（openrange=1 对应的物理高度）

// ═══════════════════════════════
// 闸门配置（第三溢洪道 6 闸门独立控制）
// ═══════════════════════════════
const GATE_CONFIGS = [
  { label: '01号', placename: '第三溢洪道', ids: ['01'] },
  { label: '02号', placename: '第三溢洪道', ids: ['02'] },
  { label: '03号', placename: '第三溢洪道', ids: ['03'] },
  { label: '04号', placename: '第三溢洪道', ids: ['04'] },
  { label: '05号', placename: '第三溢洪道', ids: ['05'] },
  { label: '06号', placename: '第三溢洪道', ids: ['06'] },
]

// ═══════════════════════════════
// 运行时状态
// ═══════════════════════════════
let _currentMode  = 'forward'      // 'forward' | 'reverse'
let _simRunning   = false          // 模拟运行中
const _simAbort   = { value: false }
let _lastForwardPlan = null        // 最近一次正向计算结果，供模拟按钮使用
let _reversePlans = []              // 逆行推演生成的所有方案
let _selectedPlanIdx = -1           // 当前选中的方案索引

// ═══════════════════════════════
// 水力计算
// ═══════════════════════════════

/**
 * 单闸泄洪量（孔口出流公式）
 * Q = Cd × b × h × √(2g × ΔH)
 * 当水头差 <= 0 或开度 <= 0 时，泄洪量为 0
 */
function calcSingleDischarge(upLevel, downLevel, height) {
  const deltaH = upLevel - downLevel
  if (deltaH <= 0 || height <= 0) return 0
  return CD * GATE_WIDTH * height * Math.sqrt(2 * G * deltaH)
}

/**
 * 总泄洪量（所有启用闸门之和）
 */
function calcTotalDischarge(upLevel, downLevel, gatePlans) {
  return gatePlans
    .filter(g => g.enabled)
    .reduce((sum, g) => sum + calcSingleDischarge(upLevel, downLevel, g.height), 0)
}

/**
 * 根据目标泄洪量反算每闸门所需开度
 * 策略：平均分配给所有选中的闸门
 * 返回 [{ idx, height }]
 */
function planGateHeights(upLevel, downLevel, targetQ, enabledIndices) {
  const deltaH = upLevel - downLevel
  const count  = enabledIndices.length

  if (deltaH <= 0 || targetQ <= 0 || count === 0) return []

  const qPerGate   = targetQ / count
  const denominator = CD * GATE_WIDTH * Math.sqrt(2 * G * deltaH)
  const rawHeight   = qPerGate / denominator

  // 限制在合理范围，超过 30m 表示单闸能力不足
  const clamped = Math.min(Math.max(rawHeight, 0.5), 30)

  return enabledIndices.map(idx => ({
    idx,
    height: Math.round(clamped * 10) / 10, // 保留 1 位小数
    overflow: rawHeight > 30,               // 超限标记
  }))
}

// ═══════════════════════════════
// UI
// ═══════════════════════════════

function _getPanel() {
  return document.getElementById('panel-discharge')
}

function _readInputs() {
  const upEl  = document.getElementById('js-discharge-up')
  const downEl = document.getElementById('js-discharge-down')
  const up    = parseFloat(upEl?.value) || 0
  const down  = parseFloat(downEl?.value) || 0
  return { up, down }
}

function _readGatePlans() {
  const items = document.querySelectorAll('#js-discharge-gates .discharge-gate-item')
  const plans = []
  items.forEach(el => {
    const idx     = parseInt(el.dataset.idx, 10)
    const checked = el.querySelector('.discharge-gate-check')?.checked ?? false
    const height  = parseFloat(el.querySelector('.discharge-gate-height')?.value) || 0
    plans.push({ idx, enabled: checked, height: Math.min(height, 30) })
  })
  return plans
}

function _readTargetQ() {
  const el = document.getElementById('js-discharge-target-q')
  return parseFloat(el?.value) || 0
}

function _readPlanGates() {
  const checks = document.querySelectorAll('#js-discharge-target .discharge-plan-check')
  const indices = []
  checks.forEach((cb, i) => { if (cb.checked) indices.push(i) })
  return indices
}

function _showResults(html) {
  const el = document.getElementById('js-discharge-results')
  if (el) el.innerHTML = html
}

// ── 模式切换 ──

function _switchMode(mode) {
  _currentMode = mode
  document.querySelectorAll('.discharge-tab').forEach(tab => {
    tab.classList.toggle('discharge-tab--active', tab.dataset.mode === mode)
  })

  const gatesDiv  = document.getElementById('js-discharge-gates')
  const targetDiv = document.getElementById('js-discharge-target')
  const btnCalc   = document.getElementById('js-discharge-btn-calc')
  const btnSim    = document.getElementById('js-discharge-btn-sim')
  const btnSel    = document.getElementById('js-discharge-btn-sim-selected')
  const btnStop   = document.getElementById('js-discharge-btn-stop')

  if (mode === 'forward') {
    gatesDiv.style.display  = ''
    targetDiv.style.display = 'none'
    btnCalc.style.display   = ''
    btnSim.style.display    = 'none'
    btnSel.style.display    = 'none'
    btnCalc.textContent     = '计算泄洪量'
  } else {
    gatesDiv.style.display  = 'none'
    targetDiv.style.display = ''
    btnCalc.style.display   = 'none'
    btnSim.style.display    = ''
    btnSim.textContent      = '推演方案'
    // btnSel 由 _handlePlan 控制显示
  }
  // 停止按钮始终跟随模拟状态
  btnStop.style.display = _simRunning ? '' : 'none'
  _lastForwardPlan = null
  _reversePlans = []
  _selectedPlanIdx = -1
  _showResults('')
}

// ── 模式 1：计算泄洪量 ──

function _handleCalc() {
  const { up, down } = _readInputs()
  const plans = _readGatePlans()

  if (up <= down) {
    _showResults('<div class="discharge-error">上游水位必须大于下游水位</div>')
    return
  }

  const enabled = plans.filter(p => p.enabled)
  if (enabled.length === 0) {
    _showResults('<div class="discharge-error">请至少选择一个闸门</div>')
    return
  }

  const totalQ   = calcTotalDischarge(up, down, plans)
  const deltaH   = up - down

  let html = `<div class="discharge-result-title">计算结果</div>`
  html += `<div class="discharge-result-row"><span>水头差 ΔH</span><span class="discharge-val">${deltaH.toFixed(2)} m</span></div>`
  html += `<div class="discharge-result-divider"></div>`

  enabled.forEach(p => {
    const q = calcSingleDischarge(up, down, p.height)
    html += `<div class="discharge-result-row">
      <span>${GATE_CONFIGS[p.idx].label}闸门 (开度 ${p.height}m)</span>
      <span class="discharge-val">${q.toFixed(1)} m³/s</span>
    </div>`
  })

  const disabled = plans.filter(p => !p.enabled)
  if (disabled.length > 0) {
    html += `<div class="discharge-result-row discharge-result-dim">`
    html += `<span>${disabled.map(p => GATE_CONFIGS[p.idx].label).join('、')} 闸门 (未启用)</span>`
    html += `<span class="discharge-val">—</span></div>`
  }

  html += `<div class="discharge-result-divider"></div>`
  html += `<div class="discharge-result-row discharge-result-total">
    <span>总泄洪量</span>
    <span class="discharge-val discharge-val--big">${totalQ.toFixed(1)} <em>m³/s</em></span>
  </div>`

  // 超限提示
  const overflows = enabled.filter(p => p.height > 20)
  if (overflows.length > 0) {
    html += `<div class="discharge-warn">⚠ ${overflows.map(p => GATE_CONFIGS[p.idx].label).join('、')}闸门开度较大，请确认是否合理</div>`
  }

  // 模拟按钮
  html += `<button class="discharge-btn-sim-fwd" id="js-discharge-btn-sim-fwd">模拟泄洪效果</button>`

  // 保存当前方案供模拟使用
  _lastForwardPlan = { plans: enabled.map(p => ({ idx: p.idx, height: p.height })), up, down }

  _showResults(html)
}

// ── 模式 2：逆行推演（多方案生成） ──

/**
 * 生成所有非空子集（闸门组合）
 */
function _allSubsets(arr) {
  const result = []
  const n = arr.length
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset = []
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.push(arr[i])
    }
    result.push(subset)
  }
  // 按闸门数量升序排列
  result.sort((a, b) => a.length - b.length)
  return result
}

/**
 * 格式化方案描述
 */
function _formatPlanLabel(plan) {
  return plan.map(p => GATE_CONFIGS[p.idx].label).join('+')
}

function _handlePlan() {
  const { up, down } = _readInputs()
  const targetQ = _readTargetQ()
  const indices  = _readPlanGates()

  if (up <= down) {
    _showResults('<div class="discharge-error">上游水位必须大于下游水位</div>')
    return
  }
  if (targetQ <= 0) {
    _showResults('<div class="discharge-error">请输入有效的目标泄洪量</div>')
    return
  }
  if (indices.length === 0) {
    _showResults('<div class="discharge-error">请至少选择一个参与闸门</div>')
    return
  }

  const deltaH = up - down

  // 生成所有闸门组合（非空子集）
  const subsets = _allSubsets(indices)

  // 对每个组合计算方案
  _reversePlans = []
  _selectedPlanIdx = -1

  for (const subset of subsets) {
    const plans = planGateHeights(up, down, targetQ, subset)
    if (plans.length === 0) continue
    const allOverflow = plans.every(p => p.overflow)
    const actualQ = plans.reduce((sum, p) => sum + calcSingleDischarge(up, down, p.height), 0)
    _reversePlans.push({
      label: _formatPlanLabel(plans),
      plans,
      actualQ,
      allOverflow,
      gateCount: subset.length,
    })
  }

  // 按偏差排序（最接近目标的优先）
  _reversePlans.sort((a, b) => Math.abs(a.actualQ - targetQ) - Math.abs(b.actualQ - targetQ))

  if (_reversePlans.length === 0) {
    _showResults('<div class="discharge-error">当前水头差下无可行方案</div>')
    return
  }

  let html = `<div class="discharge-result-title">推演方案 (${_reversePlans.length}个)</div>`
  html += `<div class="discharge-result-row"><span>水头差 ΔH</span><span class="discharge-val">${deltaH.toFixed(2)} m</span></div>`
  html += `<div class="discharge-result-row"><span>目标泄洪量</span><span class="discharge-val">${targetQ.toFixed(1)} m³/s</span></div>`
  html += `<div class="discharge-result-divider"></div>`

  _reversePlans.forEach((rp, i) => {
    const diff = Math.abs(rp.actualQ - targetQ)
    const pct  = targetQ > 0 ? (diff / targetQ * 100) : 0
    const isFeasible = !rp.allOverflow && pct < 10

    html += `<div class="discharge-plan-card${rp.allOverflow ? ' discharge-plan-card--invalid' : ''}"
                  data-plan-idx="${i}">
      <div class="discharge-plan-header">
        <span class="discharge-plan-label">方案${String.fromCharCode(65 + i)}</span>
        <span class="discharge-plan-gates">${rp.label}闸门</span>
        <span class="discharge-plan-q">${rp.actualQ.toFixed(1)} m³/s</span>
      </div>`
    if (rp.allOverflow) {
      html += `<div class="discharge-plan-detail discharge-error">闸门全开仍无法达到目标流量</div>`
    } else {
      html += `<div class="discharge-plan-detail">`
      rp.plans.forEach(p => {
        const q = calcSingleDischarge(up, down, p.height)
        html += `${GATE_CONFIGS[p.idx].label}闸门 开度 <b>${p.height.toFixed(1)}m</b> → ${q.toFixed(1)} m³/s &nbsp;`
      })
      if (pct >= 1) {
        html += `<span class="discharge-warn">偏差 ${pct.toFixed(1)}%</span>`
      }
      html += `</div>`
    }
    html += `</div>`
  })

  _showResults(html)

  // 显示"模拟选中方案"按钮
  const btnSel = document.getElementById('js-discharge-btn-sim-selected')
  if (btnSel) btnSel.style.display = ''

  // 绑定方案选中事件
  const resultsEl = document.getElementById('js-discharge-results')
  if (resultsEl) {
    resultsEl.querySelectorAll('.discharge-plan-card:not(.discharge-plan-card--invalid)').forEach(card => {
      card.addEventListener('click', () => {
        resultsEl.querySelectorAll('.discharge-plan-card').forEach(c => c.classList.remove('discharge-plan-card--selected'))
        card.classList.add('discharge-plan-card--selected')
        _selectedPlanIdx = parseInt(card.dataset.planIdx, 10)
      })
    })
  }
}

// ═══════════════════════════════
// CustomApi 闸门调用（含开闸/关闸/水花/泄流）
// ═══════════════════════════════

function _heightToOpenRange(height) {
  return Math.min(Math.max(height / MAX_GATE_HEIGHT, 0), 1)
}

async function _callSluice(placename, ids, action, extra = {}) {
  const App = getApp()
  if (!App) return null
  try {
    const jsondata = {
      apiClassName: 'CustomApi',
      apiFuncName: 'Sluice',
      args: {
        placename,
        Ids: ids,
        action,
        moreparameters: { ...extra },
      },
    }
    const res = await App.Customize.RunCustomizeApi(jsondata)
    console.log(`[泄洪] ${placename} ${action} →`, res)
    return res
  } catch (e) {
    console.error('[泄洪] RunCustomizeApi 异常:', e)
    return null
  }
}

function _showSplash(placename, ids) {
  return _callSluice(placename, ids, 'setvisibility', { show: 'true' })
}

function _hideSplash(placename, ids) {
  return _callSluice(placename, ids, 'setvisibility', { show: 'false' })
}

function _setDischargeFlow(placename, ids, openrange) {
  const flowrate = String(Math.round(openrange * 8 * 10) / 10)
  return _callSluice(placename, ids, 'setdischargeflow', { flowrate })
}

// ═══════════════════════════════
// 3D 模拟启闭
// ═══════════════════════════════

const WAIT = ms => new Promise(r => setTimeout(r, ms))

async function _runSimulation(plans, up, down) {
  if (_simRunning) return
  _simRunning = true
  _simAbort.value = false

  const App = getApp()
  if (!App) {
    _simRunning = false
    return
  }

  await _flyToGate()

  const btnSim  = document.getElementById('js-discharge-btn-sim')
  const btnStop = document.getElementById('js-discharge-btn-stop')
  if (btnSim)  btnSim.style.display  = 'none'
  if (btnStop) btnStop.style.display = ''

  // Step 1: 关闭闸门 + 归零泄流 + 隐藏水花
  if (!_simAbort.value) {
    for (const p of plans) {
      const cfg = GATE_CONFIGS[p.idx]
      if (cfg) {
        await _setDischargeFlow(cfg.placename, cfg.ids, 0)
        await _callSluice(cfg.placename, cfg.ids, 'close', { openrange: '0', duration: '2' })
        await _hideSplash(cfg.placename, cfg.ids)
      }
    }
    await WAIT(500)
  }

  // Step 2: 水花 → 开闸 → 泄流
  for (const p of plans) {
    if (_simAbort.value) break
    const cfg = GATE_CONFIGS[p.idx]
    if (!cfg) continue
    const openrange = _heightToOpenRange(p.height)
    await _showSplash(cfg.placename, cfg.ids)
    await _callSluice(cfg.placename, cfg.ids, 'open', {
      openrange: String(Math.round(openrange * 100) / 100),
      duration: '2',
    })
    await _setDischargeFlow(cfg.placename, cfg.ids, openrange)
  }

  // Step 3: 计算并显示
  const deltaH = up - down
  const totalQ = plans.reduce((sum, p) => sum + calcSingleDischarge(up, down, p.height), 0)

  _showResults(`
    <div class="discharge-result-title discharge-sim-active">模拟运行中</div>
    <div class="discharge-result-row"><span>总泄洪量</span><span class="discharge-val discharge-val--big">${totalQ.toFixed(1)} <em>m³/s</em></span></div>
    ${plans.map(p => `
      <div class="discharge-result-row"><span>${GATE_CONFIGS[p.idx].label}闸门开度</span><span class="discharge-val">${p.height.toFixed(1)} m (${_heightToOpenRange(p.height).toFixed(2)})</span></div>
    `).join('')}
    <div class="discharge-info">闸门已开启，点击"停止模拟"关闭所有闸门</div>
  `)

  // Step 4: 等待用户停止
  while (!_simAbort.value) {
    await WAIT(200)
  }

  // Step 5: 归零泄流 → 关闭闸门 → 隐藏水花
  for (const p of plans) {
    const cfg = GATE_CONFIGS[p.idx]
    if (cfg) {
      await _setDischargeFlow(cfg.placename, cfg.ids, 0)
      await _callSluice(cfg.placename, cfg.ids, 'close', { openrange: '0', duration: '2' })
      await _hideSplash(cfg.placename, cfg.ids)
    }
  }

  _simRunning = false
  _simAbort.value = false

  if (btnSim)  btnSim.style.display  = ''
  if (btnStop) btnStop.style.display = 'none'
  _showResults(`
    <div class="discharge-info">模拟结束，所有闸门已关闭</div>
  `)
}

function _stopSimulation() {
  _simAbort.value = true
}

// ═══════════════════════════════
// 事件绑定 & 初始化
// ═══════════════════════════════

export function initDischarge() {
  const panel = _getPanel()
  if (!panel) return

  // 模式切换
  panel.querySelectorAll('.discharge-tab').forEach(tab => {
    tab.addEventListener('click', () => _switchMode(tab.dataset.mode))
  })

  // 模式 1：计算泄洪量按钮
  const btnCalc = document.getElementById('js-discharge-btn-calc')
  if (btnCalc) {
    btnCalc.addEventListener('click', () => _handleCalc())
  }

  // 模式 2：推演方案按钮
  const btnSim = document.getElementById('js-discharge-btn-sim')
  if (btnSim) {
    btnSim.addEventListener('click', () => _handlePlan())
  }

  // 停止模拟按钮
  const btnStop = document.getElementById('js-discharge-btn-stop')
  if (btnStop) {
    btnStop.addEventListener('click', () => _stopSimulation())
  }

  // 结果区域按钮事件委托（正向计算的"模拟泄洪效果"按钮）
  const resultsEl = document.getElementById('js-discharge-results')
  if (resultsEl) {
    resultsEl.addEventListener('click', async (e) => {
      if (e.target.id === 'js-discharge-btn-sim-fwd' && _lastForwardPlan) {
        const { plans, up, down } = _lastForwardPlan
        await _runSimulation(plans, up, down)
      }
    })
  }

  // 逆行推演"模拟选中方案"按钮
  const btnSel = document.getElementById('js-discharge-btn-sim-selected')
  if (btnSel) {
    btnSel.addEventListener('click', async () => {
      if (_selectedPlanIdx >= 0 && _selectedPlanIdx < _reversePlans.length) {
        const rp = _reversePlans[_selectedPlanIdx]
        if (rp && !rp.allOverflow && rp.plans.length > 0) {
          const { up, down } = _readInputs()
          await _runSimulation(rp.plans, up, down)
        }
      }
    })
  }

  // 输入框实时联动：当开度变化时自动重算
  panel.querySelectorAll('.discharge-gate-height').forEach(input => {
    input.addEventListener('input', () => {
      if (_currentMode === 'forward') _handleCalc()
    })
  })
  panel.querySelectorAll('.discharge-gate-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (_currentMode === 'forward') _handleCalc()
    })
  })

  // 水位变化时自动重算（防抖）
  let _debounceTimer = null
  const _debouncedCalc = () => {
    clearTimeout(_debounceTimer)
    _debounceTimer = setTimeout(() => {
      if (_currentMode === 'forward') _handleCalc()
    }, 400)
  }

  const upInput  = document.getElementById('js-discharge-up')
  const downInput = document.getElementById('js-discharge-down')
  if (upInput)  upInput.addEventListener('input', _debouncedCalc)
  if (downInput) downInput.addEventListener('input', _debouncedCalc)

  // 新 API 不需要预取实体，保留空实现以兼容
  onSceneReady(() => {
    console.log('[Discharge] 泄洪调度模块就绪（CustomApi.Sluice 模式）')
  })
}

export function showDischargePanel() {
  const panel = _getPanel()
  if (panel) panel.style.display = ''
}

export function hideDischargePanel() {
  const panel = _getPanel()
  if (panel) panel.style.display = 'none'
  // 如果正在模拟，停止
  if (_simRunning) _stopSimulation()
}