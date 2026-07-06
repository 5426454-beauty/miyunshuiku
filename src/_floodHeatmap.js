// _floodHeatmap.js — 淹没水深 3D 场景热力图
// 格点数据 → DEM 标注 API → WDP 3D 场景半透明矩形渲染
// 支持 96 帧时序播放控制

const API_BASE = 'http://localhost:3001/api/flood'

let _state = {
  active: false,
  step: 64,
  totalSteps: 96,
  speed: 2,
  playing: false,
  timer: null,
  stepCache: {},
  peakStep: 64,
  peakDepth: 0.365,
  thinFactor: 200,    // 稀疏采样（115k cells → ~575 rects）
  minDepth: 0.01,     // 最小水深阈值
  cellSizeM: 600,
  loading: false,
}

const DEPTH_LEVELS = [
  { max: 0.03, fill: '440044ff', stroke: '664488ff', name: '浅蓝' },
  { max: 0.06, fill: '4400ccff', stroke: '6600eeff', name: '青色' },
  { max: 0.10, fill: '4400ff44', stroke: '6633ff66', name: '绿色' },
  { max: 0.15, fill: '44ffcc00', stroke: '66ffdd33', name: '黄色' },
  { max: 0.25, fill: '44ff6600', stroke: '66ff8833', name: '橙色' },
  { max: 999,  fill: '44ff0022', stroke: '66ff3355', name: '红色' },
]

function _pickColor(depth) {
  for (const lvl of DEPTH_LEVELS) { if (depth <= lvl.max) return { fill: lvl.fill, stroke: lvl.stroke } }
  return DEPTH_LEVELS[DEPTH_LEVELS.length - 1]
}

async function _loadStep(step) {
  if (_state.stepCache[step]) return _state.stepCache[step]
  try {
    const resp = await fetch(API_BASE + '/grid/' + step + '?compact=1')
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const data = await resp.json()
    _state.stepCache[step] = data.cells
    const keys = Object.keys(_state.stepCache)
    if (keys.length > 20) delete _state.stepCache[keys[0]]
    return data.cells
  } catch (e) { console.warn('[FloodHeatmap] 加载失败:', e.message); return [] }
}

function _cellsToRects(cells) {
  const rects = []
  const thin = _state.thinFactor
  const halfM = _state.cellSizeM / 2
  const halfLat = halfM / 111320
  const cosLat = Math.cos(40.5 * Math.PI / 180)
  const halfLng = halfM / (111320 * cosLat)

  for (let i = 0; i < cells.length; i += thin) {
    const [lng, lat, depth] = cells[i]
    if (depth < _state.minDepth) continue
    const color = _pickColor(depth)
    rects.push({
      west: lng - halfLng, east: lng + halfLng,
      south: lat - halfLat, north: lat + halfLat,
      color: color.stroke, fillColor: color.fill,
      label: depth.toFixed(3) + 'm',
      id: 'flood-' + _state.step + '-' + i,
    })
  }
  return rects
}

async function _pushTo3D(rects) {
  try {
    const resp = await fetch('http://localhost:3001/api/dem/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'rectangles', markers: [], rectangles: rects, flyTo: null,
        summary: '淹没水深 T+' + _state.step + 'h: ' + rects.length + ' 个格点',
      }),
    })
    if (!resp.ok) { const err = await resp.json(); throw new Error(err.error || 'HTTP ' + resp.status) }
    return true
  } catch (e) { console.warn('[FloodHeatmap] 推送失败:', e.message); return false }
}

async function _render() {
  if (!_state.active) return
  const cells = await _loadStep(_state.step)
  if (!cells || cells.length === 0) { _updateStepDisplay(); return }
  const rects = _cellsToRects(cells)
  if (rects.length === 0) { _updateStepDisplay(); return }
  await _pushTo3D(rects)
  _updateStepDisplay()
}

function _play() {
  if (_state.playing) return
  _state.playing = true; _updatePlayBtn()
  const interval = Math.max(300, 1500 / _state.speed)
  _state.timer = setInterval(async () => {
    if (!_state.playing) return
    _state.step++
    if (_state.step > _state.totalSteps) { _state.step = _state.totalSteps; _pause(); return }
    await _render()
  }, interval)
}

function _pause() { _state.playing = false; if (_state.timer) { clearInterval(_state.timer); _state.timer = null }; _updatePlayBtn() }
async function _jumpTo(step) { _state.step = Math.max(1, Math.min(_state.totalSteps, step)); await _render() }

function _createControls() {
  if (document.getElementById('js-flood-ctrl')) return
  const ctrl = document.createElement('div')
  ctrl.id = 'js-flood-ctrl'; ctrl.className = 'flood-ctrl'; ctrl.style.display = 'none'
  ctrl.innerHTML = '<div class="flood-ctrl__header"><span>🌊 淹没水深时序</span><button class="flood-ctrl__close" id="js-flood-ctrl-close">✕</button></div>' +
    '<div class="flood-ctrl__body"><div class="flood-ctrl__row">' +
    '<button class="flood-ctrl__btn" id="js-flood-play">▶</button>' +
    '<button class="flood-ctrl__btn" id="js-flood-prev">⏮</button>' +
    '<button class="flood-ctrl__btn" id="js-flood-next">⏭</button>' +
    '<span class="flood-ctrl__label" id="js-flood-step-label">T+1h</span>' +
    '<select class="flood-ctrl__speed" id="js-flood-speed">' +
    '<option value="1">1x</option><option value="2" selected>2x</option>' +
    '<option value="4">4x</option><option value="8">8x</option></select>' +
    '<button class="flood-ctrl__btn" id="js-flood-peak" title="跳到峰值">🔝</button>' +
    '</div><input type="range" class="flood-ctrl__slider" id="js-flood-slider" min="1" max="96" value="1" step="1" title="时间步"></div>'
  document.body.appendChild(ctrl)
  document.getElementById('js-flood-play').addEventListener('click', function() { if (_state.playing) _pause(); else _play() })
  document.getElementById('js-flood-prev').addEventListener('click', function() { _pause(); _jumpTo(_state.step - 1) })
  document.getElementById('js-flood-next').addEventListener('click', function() { _pause(); _jumpTo(_state.step + 1) })
  document.getElementById('js-flood-peak').addEventListener('click', function() { _pause(); _jumpTo(_state.peakStep) })
  document.getElementById('js-flood-ctrl-close').addEventListener('click', hideFloodHeatmap)
  document.getElementById('js-flood-speed').addEventListener('change', function() { _state.speed = parseInt(this.value, 10); if (_state.playing) { _pause(); _play() } })
  document.getElementById('js-flood-slider').addEventListener('input', function() { _pause(); _jumpTo(parseInt(this.value, 10)) })
}

function _updateStepDisplay() { const el = document.getElementById('js-flood-step-label'); if (el) el.textContent = 'T+' + _state.step + 'h'; const slider = document.getElementById('js-flood-slider'); if (slider) slider.value = _state.step }
function _updatePlayBtn() { const btn = document.getElementById('js-flood-play'); if (btn) btn.textContent = _state.playing ? '⏸' : '▶' }

export async function initFloodHeatmap() {
  _createControls()
  try {
    const resp = await fetch(API_BASE + '/steps'); const meta = await resp.json()
    _state.totalSteps = meta.steps.length
    let peak = meta.steps[0]; meta.steps.forEach(function(s) { if (s.count > peak.count) peak = s })
    _state.peakStep = peak.step
    const sumResp = await fetch(API_BASE + '/summary'); const summary = await sumResp.json()
    _state.peakDepth = summary.maxDepth
    console.log('[FloodHeatmap] 就绪: ' + _state.totalSteps + '步, 峰值T+' + _state.peakStep + 'h=' + _state.peakDepth + 'm')
  } catch (e) { console.warn('[FloodHeatmap] 初始化失败:', e.message) }
}

export async function showFloodHeatmap() {
  if (_state.active) return; _state.active = true
  const ctrl = document.getElementById('js-flood-ctrl'); if (ctrl) ctrl.style.display = ''
  const slider = document.getElementById('js-flood-slider'); if (slider) slider.max = _state.totalSteps
  _state.step = _state.peakStep || 20; _updateStepDisplay(); await _render()
  console.log('[FloodHeatmap] 已显示 T+' + _state.step + 'h')
}

export function hideFloodHeatmap() {
  _state.active = false; _pause()
  fetch('http://localhost:3001/api/dem/annotations', { method: 'DELETE' }).catch(function() {})
  const ctrl = document.getElementById('js-flood-ctrl'); if (ctrl) ctrl.style.display = 'none'
  _state.stepCache = {}
  console.log('[FloodHeatmap] 已隐藏')
}

export async function jumpToStep(step) { await _jumpTo(step) }
export async function jumpToPeak() { await _jumpTo(_state.peakStep) }
export function playFlood() { _play() }
export function pauseFlood() { _pause() }
export function getFloodState() { return { active: _state.active, step: _state.step, totalSteps: _state.totalSteps, peakStep: _state.peakStep, peakDepth: _state.peakDepth, playing: _state.playing } }