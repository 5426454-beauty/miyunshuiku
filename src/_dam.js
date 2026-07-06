// 大坝控制模块 — CustomApi.Dam：显隐 + 透明 + 镜头跳转
import { getApp } from './_wdp.js'

// ═══════════════════════════════
// 大坝配置（用户实测视角）
// ═══════════════════════════════
const DAM_CONFIGS = [
  {
    id: 'baihe',
    label: '白河主坝',
    type: '主坝',
    placename: '白河主坝',
    camera: {
      location: [116.82501690104066, 40.476012617329303, 835.44131096932836],
      rotation: { pitch: -33.419490814208984, yaw: -37.052711486816406 },
      flyTime: 2,
    },
  },
  {
    id: 'chahe',
    label: '潮河主坝',
    type: '主坝',
    placename: '潮河主坝',
    camera: {
      location: [116.9875074245512, 40.451280555010101, 655.20179237860179],
      rotation: { pitch: -35.128524780273438, yaw: 171.02969360351562 },
      flyTime: 2,
    },
  },
  {
    id: 'zoumazhuang',
    label: '走马庄副坝',
    type: '副坝',
    placename: '走马庄副坝',
    heatmapName: '走马坝热力图',           // liftandshow 专用 placename
    camera: {
      location: [116.85416897085862, 40.47470347368791, 524.15401656003553],
      rotation: { pitch: -35.299411773681641, yaw: -93.615882873535156 },
      flyTime: 2,
    },
  },
]

// 运行时状态
let _visState   = {}   // { [id]: true/false }  显示/隐藏
let _transState = {}   // { [id]: true/false }  true=实体, false=透明
let _heatState  = {}   // { [id]: true/false }  热力图显隐（仅走马庄）

// ═══════════════════════════════
// API 调用
// ═══════════════════════════════
async function _callDamApi(placename, action, params = {}) {
  const App = getApp()
  if (!App) return null
  const jsondata = {
    apiClassName: 'CustomApi',
    apiFuncName: 'Dam',
    args: { placename, action, moreparameters: params },
  }
  try {
    const res = await App.Customize.RunCustomizeApi(jsondata)
    console.log('[Dam]', placename + '.' + action, JSON.stringify(params), '→', res?.success)
    return res
  } catch (e) {
    console.warn('[Dam] 失败:', placename, action, e.message)
    return null
  }
}

async function _flyToDam(cfg) {
  const App = getApp()
  if (!App || !cfg.camera) return
  try { await App.CameraControl.SetCameraPose(cfg.camera) } catch (e) {}
}

// ═══════════════════════════════
// 单坝操作
// ═══════════════════════════════
async function _toggleVisibility(cfg) {
  await _flyToDam(cfg)
  const cur = _visState[cfg.id] !== false   // 默认可见
  const show = !cur
  await _callDamApi(cfg.placename, 'setvisibility', { show: String(show) })
  _visState[cfg.id] = show
  _updateBtns(cfg.id)
}

async function _toggleTransparent(cfg) {
  await _flyToDam(cfg)
  const cur = _transState[cfg.id] !== false  // 默认实体
  const appearance = cur ? 'transparent' : 'normal'
  await _callDamApi(cfg.placename, 'maketransparent', { appearance })
  _transState[cfg.id] = !cur
  _updateBtns(cfg.id)
}

async function _toggleHeatmap(cfg) {
  await _flyToDam(cfg)
  const cur = _heatState[cfg.id] === true
  const show = !cur
  await _callDamApi(cfg.heatmapName, 'liftandshow', { height: '200', show: String(show) })
  _heatState[cfg.id] = show
  _updateBtns(cfg.id)
}

// ═══════════════════════════════
// 批量操作
// ═══════════════════════════════
async function _allShow() {
  for (const cfg of DAM_CONFIGS) {
    await _callDamApi(cfg.placename, 'setvisibility', { show: 'true' })
    _visState[cfg.id] = true
  }
  _refreshAllBtns()
}

async function _allHide() {
  for (const cfg of DAM_CONFIGS) {
    await _callDamApi(cfg.placename, 'setvisibility', { show: 'false' })
    _visState[cfg.id] = false
  }
  _refreshAllBtns()
}

async function _allNormal() {
  for (const cfg of DAM_CONFIGS) {
    await _callDamApi(cfg.placename, 'maketransparent', { appearance: 'normal' })
    _transState[cfg.id] = true
  }
  _refreshAllBtns()
}

async function _allTransparent() {
  for (const cfg of DAM_CONFIGS) {
    await _callDamApi(cfg.placename, 'maketransparent', { appearance: 'transparent' })
    _transState[cfg.id] = false
  }
  _refreshAllBtns()
}

// ═══════════════════════════════
// UI 渲染
// ═══════════════════════════════
function _renderPanel() {
  const body = document.getElementById('js-panel-dam-body')
  if (!body) return

  let html = `<div class="dam-actions">
    <button class="dam-batch-btn" id="js-dam-all-show">全部显示</button>
    <button class="dam-batch-btn" id="js-dam-all-hide">全部隐藏</button>
    <button class="dam-batch-btn" id="js-dam-all-normal">全部实体</button>
    <button class="dam-batch-btn" id="js-dam-all-transparent">全部透明</button>
  </div>`

  for (const cfg of DAM_CONFIGS) {
    const vis = _visState[cfg.id] !== false
    const solid = _transState[cfg.id] !== false
    const heat = _heatState[cfg.id] === true
    const heatHtml = cfg.heatmapName ? `
      <button class="dam-btn dam-btn--heat${heat ? ' dam-btn--active' : ''}"
              id="js-dam-heat-${cfg.id}" title="热力图抬升">🔥</button>` : ''
    html += `
    <div class="dam-row" data-dam="${cfg.id}">
      <span class="dam-label">${cfg.label}</span>
      <span class="dam-type">${cfg.type}</span>
      <button class="dam-btn dam-btn--eye${vis ? ' dam-btn--active' : ''}"
              id="js-dam-eye-${cfg.id}" title="显示/隐藏">👁</button>
      <button class="dam-btn dam-btn--glass${solid ? ' dam-btn--active' : ''}"
              id="js-dam-glass-${cfg.id}" title="实体/透明">🔍</button>${heatHtml}
    </div>`
  }

  body.innerHTML = html

  // 绑定事件
  document.getElementById('js-dam-all-show')?.addEventListener('click', _allShow)
  document.getElementById('js-dam-all-hide')?.addEventListener('click', _allHide)
  document.getElementById('js-dam-all-normal')?.addEventListener('click', _allNormal)
  document.getElementById('js-dam-all-transparent')?.addEventListener('click', _allTransparent)

  for (const cfg of DAM_CONFIGS) {
    document.getElementById(`js-dam-eye-${cfg.id}`)?.addEventListener('click', () => _toggleVisibility(cfg))
    document.getElementById(`js-dam-glass-${cfg.id}`)?.addEventListener('click', () => _toggleTransparent(cfg))
    if (cfg.heatmapName) {
      document.getElementById(`js-dam-heat-${cfg.id}`)?.addEventListener('click', () => _toggleHeatmap(cfg))
    }
  }
}

function _updateBtns(id) {
  const vis = _visState[id] !== false
  const solid = _transState[id] !== false
  const heat = _heatState[id] === true
  const eyeBtn = document.getElementById(`js-dam-eye-${id}`)
  const glassBtn = document.getElementById(`js-dam-glass-${id}`)
  const heatBtn = document.getElementById(`js-dam-heat-${id}`)
  if (eyeBtn) eyeBtn.classList.toggle('dam-btn--active', vis)
  if (glassBtn) glassBtn.classList.toggle('dam-btn--active', solid)
  if (heatBtn) heatBtn.classList.toggle('dam-btn--active', heat)
}

function _refreshAllBtns() {
  for (const cfg of DAM_CONFIGS) _updateBtns(cfg.id)
}

// ═══════════════════════════════
// 公开接口
// ═══════════════════════════════
export function initDam() {
  _renderPanel()
}

export function showDamPanel() {
  const panel = document.getElementById('panel-dam')
  if (panel) panel.style.display = ''
}

export function hideDamPanel() {
  const panel = document.getElementById('panel-dam')
  if (panel) panel.style.display = 'none'
}