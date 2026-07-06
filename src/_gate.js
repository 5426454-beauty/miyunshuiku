// 闸门启闭模块 — 第三溢洪道 6 闸门 + 水花联动
import { getApp } from './_wdp.js'

const PLACE_NAME = '第三溢洪道'
const DURATION   = 2

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

// 6 个闸门独立配置（闸门与水花 ID 一致）
const GATE_CONFIGS = [
  { label: '01号闸门', id: '01' },
  { label: '02号闸门', id: '02' },
  { label: '03号闸门', id: '03' },
  { label: '04号闸门', id: '04' },
  { label: '05号闸门', id: '05' },
  { label: '06号闸门', id: '06' },
]

let _openRange = 0.5
let _openState = Array(6).fill(false)

// ── 通用 Sluice API 调用 ───────────────────────────────
async function _callSluice(ids, action, extra = {}) {
  const App = getApp()
  if (!App) { console.warn('[闸门] WDP 未就绪'); return null }

  const jsondata = {
    apiClassName: 'CustomApi',
    apiFuncName: 'Sluice',
    args: {
      placename: PLACE_NAME,
      Ids: ids,
      action,
      moreparameters: {
        ...extra,
      },
    },
  }

  console.log('[闸门]', JSON.stringify(jsondata))
  try {
    const res = await App.Customize.RunCustomizeApi(jsondata)
    return res
  } catch (e) {
    console.error('[闸门] 异常:', e)
    return null
  }
}

// ── 水花显隐 ──────────────────────────────────────────
async function _showSplash(ids) {
  return _callSluice(ids, 'setvisibility', { show: 'true' })
}

async function _hideSplash(ids) {
  return _callSluice(ids, 'setvisibility', { show: 'false' })
}

// ── 泄流效果（flowrate 0~8，按 openrange 比例） ───────
function _openrangeToFlowrate(openrange) {
  return String(Math.round(openrange * 8 * 10) / 10)
}

async function _setDischargeFlow(ids, openrange) {
  const flowrate = _openrangeToFlowrate(openrange)
  return _callSluice(ids, 'setdischargeflow', { flowrate })
}

// ── 闸门启闭（水花 + 闸门 + 泄流联动） ─────────────────
async function _openGate(ids, openrange) {
  // 幅度为 0 等同于不开启
  if (openrange <= 0) return false
  await _flyToGate()
  await _showSplash(ids)
  await _callSluice(ids, 'open', {
    openrange: String(openrange),
    duration: String(DURATION),
  })
  await _setDischargeFlow(ids, openrange)
  return true
}

async function _closeGate(ids) {
  await _setDischargeFlow(ids, 0)
  await _callSluice(ids, 'close', {
    openrange: '0',
    duration: String(DURATION),
  })
  await _hideSplash(ids)
  return true
}

// ── 单闸切换 ──────────────────────────────────────────
export async function toggleGate(idx) {
  const cfg = GATE_CONFIGS[idx]
  if (!cfg) return

  if (_openState[idx]) {
    await _closeGate([cfg.id])
    _openState[idx] = false
  } else {
    const ok = await _openGate([cfg.id], _openRange)
    if (ok) _openState[idx] = true  // 只有实际执行了开闸才标记为开启
  }
}

// ── 全部开关 ──────────────────────────────────────────
export async function openAllGates() {
  for (let i = 0; i < GATE_CONFIGS.length; i++) {
    if (!_openState[i]) {
      const ok = await _openGate([GATE_CONFIGS[i].id], _openRange)
      if (ok) _openState[i] = true
    }
  }
}

export async function closeAllGates() {
  for (let i = 0; i < GATE_CONFIGS.length; i++) {
    if (_openState[i]) {
      await _closeGate([GATE_CONFIGS[i].id])
      _openState[i] = false
    }
  }
}

export async function stopAllGates() {
  await closeAllGates()
}

// ── 幅度读写 ──────────────────────────────────────────
export function setGateRange(v) {
  const val = parseFloat(v)
  _openRange = isNaN(val) ? 0.5 : Math.min(Math.max(val, 0), 1)
}
export function getGateRange() { return _openRange }
export function getGateState() {
  return _openState.map((s, i) => ({ active: s, label: GATE_CONFIGS[i].label }))
}

// ── UI 面板 ──────────────────────────────────────────
export function initGate() {
  const btn = document.querySelector('#js-floating-toolbar [data-tool="gate"]')
  if (btn) btn.addEventListener('click', () => {
    const panel = document.getElementById('js-gate-panel')
    if (panel) panel.classList.toggle('tool-panel--open')
  })
  _createPanel()
}

function _createPanel() {
  const toolbar = document.getElementById('js-floating-toolbar')
  if (!toolbar) return

  const gateBtnsHTML = GATE_CONFIGS.map((g, i) =>
    `<button class="gate-tool__gate-btn" id="js-gate-btn-${i}" data-idx="${i}">
      <span>${g.label} 开闸</span>
    </button>`
  ).join('')

  const panel = document.createElement('div')
  panel.className = 'gate-tool__panel tool-panel'
  panel.id = 'js-gate-panel'
  panel.innerHTML = `
    <div class="gate-tool__panel-title">第三溢洪道 · 闸门启闭</div>
    <div class="gate-tool__row">
      <label>开启幅度</label>
      <input type="range" id="js-gate-range" min="0" max="100" value="50" step="5" />
      <span id="js-gate-range-val">0.5</span>
    </div>
    <div class="gate-tool__btns">${gateBtnsHTML}</div>
    <div class="gate-tool__actions">
      <button class="gate-tool__action-btn" id="js-gate-open-all">全部开启</button>
      <button class="gate-tool__action-btn gate-tool__action-btn--close" id="js-gate-close-all">全部关闭</button>
    </div>
  `
  toolbar.appendChild(panel)

  // 幅度滑块
  const rangeSlider = document.getElementById('js-gate-range')
  const rangeVal    = document.getElementById('js-gate-range-val')
  rangeSlider.addEventListener('input', () => {
    const v = parseInt(rangeSlider.value) / 100
    rangeVal.textContent = v.toFixed(2)
    setGateRange(v)
  })

  // 6 个独立按钮
  for (let i = 0; i < GATE_CONFIGS.length; i++) {
    const gateBtn = document.getElementById(`js-gate-btn-${i}`)
    gateBtn.addEventListener('click', async () => {
      gateBtn.disabled = true
      await toggleGate(i)
      _updateBtn(gateBtn, i)
      gateBtn.disabled = false
    })
  }

  // 全部开启 / 全部关闭
  document.getElementById('js-gate-open-all').addEventListener('click', async () => {
    await openAllGates()
    for (let i = 0; i < GATE_CONFIGS.length; i++) {
      _updateBtn(document.getElementById(`js-gate-btn-${i}`), i)
    }
  })

  document.getElementById('js-gate-close-all').addEventListener('click', async () => {
    await closeAllGates()
    for (let i = 0; i < GATE_CONFIGS.length; i++) {
      _updateBtn(document.getElementById(`js-gate-btn-${i}`), i)
    }
  })
}

function _updateBtn(btn, idx) {
  const span = btn.querySelector('span')
  span.textContent = _openState[idx]
    ? `${GATE_CONFIGS[idx].label} 关闸`
    : `${GATE_CONFIGS[idx].label} 开闸`
  btn.classList.toggle('gate-tool__gate-btn--active', _openState[idx])
}

// ── 兼容旧接口 ────────────────────────────────────────
export async function initGates() {}
export function destroyGate() { stopAllGates() }