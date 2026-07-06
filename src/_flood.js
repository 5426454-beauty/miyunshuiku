// 淹没预演模块 — 3D 洪水演进仿真
// 四预 Tab 右侧面板，置于泄洪调度预演下方
import { getApp, onSceneReady } from './_wdp.js'

const PLACE_WATER = '库区水面'
const BASE_WATER_LEVEL = 155
const MAX_WATER_LEVEL = 158.5
const TOTAL_FRAMES = 48
const TOTAL_HOURS = 24
const PLAYBACK_INTERVAL_MS = 800

const SCENARIOS = {
  normal:  { name: '常规泄洪', targetRise: 1.5,  rainfall: 80,  weatherPhases: ['LightRain','LightRain','ModerateRain','ModerateRain'], area: '3.8 km²' },
  '20yr':  { name: '20年一遇洪水', targetRise: 4.0, rainfall: 150, weatherPhases: ['ModerateRain','ModerateRain','HeavyRain','HeavyRain'], area: '7.5 km²' },
  '50yr':  { name: '50年一遇洪水', targetRise: 7.0, rainfall: 220, weatherPhases: ['ModerateRain','HeavyRain','HeavyRain','HeavyRain'], area: '12.6 km²' },
  '100yr': { name: '100年一遇洪水', targetRise: 11.0, rainfall: 300, weatherPhases: ['HeavyRain','HeavyRain','HeavyRain','HeavyRain'], area: '22.1 km²' },
}

const PHASE_LABELS = ['降雨积蓄', '水位上涨', '低洼漫溢', '淹没峰值']

const FLOOD_ZONE_DEFS = [
  { id: 'zone-light', name: '轻度漫溢', color: '33aa55',
    coordinates: [[116.994195,40.465409],[116.990881,40.477073],[116.978609,40.479639],[116.972096,40.470390],[116.971354,40.456302],[116.984658,40.447411],[116.998150,40.449521],[116.997460,40.457409]] },
  { id: 'zone-mid',   name: '中度淹没', color: 'ddaa33',
    coordinates: [[116.997337,40.464867],[116.993757,40.470393],[116.986128,40.468565],[116.983088,40.461413],[116.988960,40.456527],[116.996042,40.456435],[116.997141,40.459739]] },
  { id: 'zone-heavy', name: '重度淹没', color: 'dd7733',
    coordinates: [[117.000726,40.466058],[117.000315,40.467660],[116.998718,40.467871],[116.997290,40.466812],[116.996447,40.465112],[116.996992,40.462851],[116.999379,40.462513],[117.000837,40.463894]] },
  { id: 'zone-core',  name: '核心淹没', color: 'cc4444',
    coordinates: [[117.001472,40.465902],[117.000963,40.466576],[117.000016,40.466209],[116.999708,40.465014],[117.000485,40.463994],[117.001155,40.464426],[117.001814,40.465036],[117.001713,40.465359]] },
]

const FLOW_PATH_DEFS = [
  { id: 'flow-main', name: '主泄洪道', coords: [[117.002136,40.466034,0],[116.992648,40.465193,0],[116.986645,40.467606,0],[116.977820,40.465449,0]] },
  { id: 'flow-east', name: '东溢洪道', coords: [[116.985138,40.467199,0],[116.981194,40.472639,0],[116.975265,40.481406,0]] },
]

const CAMERA_VIEWS = { overview: { targetPosition: [116.990,40.465,2000], rotation: { pitch: -89, yaw: 0 }, distance: 100, flyTime: 2 } }

let _sceneEntities = []
let _currentScenario = '50yr'
let _currentRise = 0
let _animating = false
let _abortFlag = { value: false }
let _intervalId = null
let _currentFrame = 0

const WAIT = ms => new Promise(r => setTimeout(r, ms))

function _$(id) { return document.getElementById(id) }
function _getPanel() { return _$('panel-flood') }

// ── WaterSurface API ───────────────────────────────────
async function _callWaterSurface(action, params = {}) {
  const App = getApp()
  if (!App) return null
  try {
    const res = await App.Customize.RunCustomizeApi({
      apiClassName: 'CustomApi', apiFuncName: 'WaterSurface',
      args: { placename: PLACE_WATER, action, moreparameters: params },
    })
    return res
  } catch (e) { console.warn('[Flood] WaterSurface 失败:', action, e.message); return null }
}

// ── UI ────────────────────────────────────────────────
function _setStatus(text, cls = '') { const el = _$('js-flood-status'); if (el) { el.textContent = text; el.className = 'flood-status ' + cls } }
function _setPhaseUI(phase) { const c = _$('js-flood-phases'); if (c) c.querySelectorAll('.flood-phase').forEach((el,i) => { el.className = 'flood-phase' + (i<phase?' flood-phase--done':i===phase?' flood-phase--active':'') }) }
function _setProgress(frame) { const f = _$('js-flood-progress-fill'); if (f) f.style.width = Math.round(frame/TOTAL_FRAMES*100)+'%' }
function _updateScenarioParams() {
  const s = SCENARIOS[_currentScenario]
  const r = _$('js-flood-rise-val'); if (r) r.textContent = s.targetRise.toFixed(1)+' m'
  const a = _$('js-flood-rain-val'); if (a) a.textContent = s.rainfall+' mm'
  const b = _$('js-flood-area-val'); if (b) b.textContent = s.area
}

// ── 场景实体管理 ────────────────────────────────────────
async function _initWaterSurface() {
  const App = getApp(); if (!App) return false
  try { await _callWaterSurface('setvisibility',{show:'true'}); await _callWaterSurface('setheight',{height:String(BASE_WATER_LEVEL),duration:'0'}); return true }
  catch (e) { console.error('[Flood] 水面初始化失败:',e); return false }
}

function _generateGridPoints(polygon, spacing) {
  const lngs = polygon.map(c => c[0]), lats = polygon.map(c => c[1])
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)]
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)]
  const points = []
  for (let lng = minLng; lng <= maxLng; lng += spacing) {
    for (let lat = minLat; lat <= maxLat; lat += spacing) {
      let inside = false
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        if ((polygon[i][1] > lat) !== (polygon[j][1] > lat) && lng < (polygon[j][0] - polygon[i][0]) * (lat - polygon[i][1]) / (polygon[j][1] - polygon[i][1]) + polygon[i][0]) inside = !inside
      }
      if (inside) points.push({ point: [lng, lat, 0], value: 50 })
    }
  }
  return points
}

async function _createFloodZones() {
  const App = getApp(); if (!App) return
  for (let i = 0; i < FLOOD_ZONE_DEFS.length; i++) {
    const def = FLOOD_ZONE_DEFS[i]
    const features = _generateGridPoints(def.coordinates, 0.002)
    try {
      const c = def.color
      const heatmap = new App.HeatMap({
        heatMapStyle: { type:'fit', brushDiameter:3000, mappingValueRange:[1,100], gradientSetting:['000000','000000',c,c,c] },
        bVisible: false, entityName: def.name, customId: 'flood-'+def.id, points: { features },
      })
      const res = await App.Scene.Add(heatmap, { calculateCoordZ: { coordZRef:'surface', coordZOffset:15 } })
      if (res?.success) {
        const entity = res.result?.object || heatmap
        _sceneEntities.push({ entity, customId:'flood-'+def.id, type:'zone', def })
        const clipPolygon = def.coordinates.map(([lng,lat]) => [lng,lat,0])
        entity.Clip(clipPolygon, '00000000').then(() => {}, () => {})
      }
    } catch (e) { console.warn('[Flood] HeatMap 创建失败:',def.name,e.message) }
  }
}

async function _createFlowPaths() {
  const App = getApp(); if (!App) return
  for (const def of FLOW_PATH_DEFS) {
    try {
      const path = new App.Path({
        polyline: { coordinates: def.coords },
        pathStyle: { type:'arrow', width:18, color:'00d4ffcc', passColor:'00d4ff22' },
        entityName: def.name, customId: 'flood-'+def.id,
      })
      const res = await App.Scene.Add(path)
      if (res?.success) { const e = res.result?.object || path; await e.SetVisible(false); _sceneEntities.push({ entity:e, customId:'flood-'+def.id, type:'path', def }) }
    } catch (e) { console.warn('[Flood] 路径创建失败:',def.name,e.message) }
  }
}

async function _destroySceneEntities() {
  for (const item of _sceneEntities) { try { await item.entity.Delete() } catch (_) {} }
  _sceneEntities.length = 0
}

function _findEntity(customId) { return _sceneEntities.find(s => s.customId===customId) }

async function _setEntityVisible(customId, visible) {
  const item = _findEntity(customId); if (!item) return
  try { await item.entity.SetVisible(visible) } catch (e) { console.warn('[Flood] SetVisible 失败:',customId,e.message) }
}

// ── 水位动画 ────────────────────────────────────────────
async function _animateWaterToFrame(frame, targetRise) {
  const rise = targetRise * frame / TOTAL_FRAMES; _currentRise = rise
  try { await _callWaterSurface('setheight',{height:String(Math.min(BASE_WATER_LEVEL+rise,MAX_WATER_LEVEL).toFixed(1)),duration:'0.3'}) } catch (_) {}
}

async function _resetWaterLevel() {
  try { await _callWaterSurface('setheight',{height:String(BASE_WATER_LEVEL),duration:'1'}) } catch (_) {}
  _currentRise = 0
}

// ── 阶段视觉效果：逐帧更新渐变色，实现平滑演变 ──────
// 每个区域在 12 帧内从透明渐变到目标色
const ZONE_FRAME_RANGE = [
  { id: 'zone-light',  start: 1,  end: 12 },   // 帧 1-12
  { id: 'zone-mid',    start: 8,  end: 20 },   // 帧 8-20（略早入场）
  { id: 'zone-heavy',  start: 16, end: 30 },   // 帧 16-30
  { id: 'zone-core',   start: 24, end: 48 },   // 帧 24-48
]

function _gradientForFrame(frame, zoneIdx) {
  // 返回该帧下该区域的 gradientSetting 数组
  const c = FLOOD_ZONE_DEFS[zoneIdx].color
  const range = ZONE_FRAME_RANGE[zoneIdx]
  if (frame < range.start) return ['000000','000000','000000','000000','000000']
  if (frame >= range.end) return ['000000','000000',c,c,c]
  // 线性插值：进度 0→1
  const progress = (frame - range.start) / (range.end - range.start)
  // 梯度从全透明逐步过渡到目标色
  // progress=0: ['000000','000000','000000','000000','000000']
  // progress=0.5: ['000000','000000','000000',c,c]
  // progress=1: ['000000','000000',c,c,c]
  if (progress < 0.33) {
    return ['000000','000000','000000','000000',c]
  } else if (progress < 0.66) {
    return ['000000','000000','000000',c,c]
  } else {
    return ['000000','000000',c,c,c]
  }
}

async function _applyFrameVisuals(frame) {
  // 为每个区域更新渐变，并控制显隐
  for (let i = 0; i < FLOOD_ZONE_DEFS.length; i++) {
    const def = FLOOD_ZONE_DEFS[i]
    const item = _findEntity('flood-' + def.id)
    if (!item) continue
    const range = ZONE_FRAME_RANGE[i]
    const visible = frame >= range.start
    // 先设显隐
    if (visible) {
      await _setEntityVisible('flood-' + def.id, true)
      // 逐帧更新渐变
      const grad = _gradientForFrame(frame, i)
      try { await item.entity.Update({ heatMapStyle: { gradientSetting: grad } }) } catch (_) {}
    } else {
      await _setEntityVisible('flood-' + def.id, false)
    }
  }
  // 水流路径在最后 12 帧显示
  const showPaths = frame >= 36
  for (const def of FLOW_PATH_DEFS) {
    await _setEntityVisible('flood-' + def.id, showPaths)
  }
}

// ── 阶段逻辑 ────────────────────────────────────────────
function _getPhase(frame) { if (frame<=0) return -1; if (frame<=11) return 0; if (frame<=23) return 1; if (frame<=35) return 2; return 3 }
function _getHour(frame) { return parseFloat((frame/TOTAL_FRAMES*TOTAL_HOURS).toFixed(1)) }

// ── 预演主逻辑 ─────────────────────────────────────────
function _stopAnimation() { if (_intervalId) { clearInterval(_intervalId); _intervalId=null } _animating=false }

async function _startSimulation() {
  const App = getApp(); if (!App||_animating) return
  const scenario = SCENARIOS[_currentScenario]; if (!scenario) return
  if (!(await _initWaterSurface())) { _setStatus('水面初始化失败','flood-status--error'); return }
  _animating=true; _abortFlag.value=false; _currentFrame=0; _setPhaseUI(0); _setProgress(0)
  const bs=_$('js-flood-btn-start'), bp=_$('js-flood-btn-stop'), br=_$('js-flood-btn-reset')
  if (bs) bs.style.display='none'; if (bp) bp.style.display=''; if (br) br.disabled=true
  _setStatus('预演准备中...')
  if (_sceneEntities.length===0) { await _createFloodZones(); await _createFlowPaths() }
  try { await App.CameraControl.FlyTo(CAMERA_VIEWS.overview) } catch (_) {}
  _setStatus('洪水演进中…','flood-status--running')
  let prevPhase=-1
  _intervalId = setInterval(async () => {
    if (_abortFlag.value) { _stopAnimation(); return }
    _currentFrame++; const frame=_currentFrame
    _animateWaterToFrame(frame,scenario.targetRise); _setProgress(frame)
    const phase=_getPhase(frame)
    if (phase!==prevPhase) { prevPhase=phase; _setPhaseUI(phase) }
    // 每帧更新渐变，实现平滑过渡
    await _applyFrameVisuals(frame)
    _setStatus(`T+${_getHour(frame)}h · 水位 +${_currentRise.toFixed(1)}m · ${PHASE_LABELS[phase]||''}`,'flood-status--running')
    if (frame>=TOTAL_FRAMES) { _stopAnimation(); _setStatus('预演完成 — 淹没峰值',''); if (bs) bs.style.display='none'; if (bp) bp.style.display='none'; if (br) br.disabled=false }
  }, PLAYBACK_INTERVAL_MS)
}

async function _stopSimulation() { _abortFlag.value=true; _stopAnimation(); const bs=_$('js-flood-btn-start'), bp=_$('js-flood-btn-stop'), br=_$('js-flood-btn-reset'); if (bs) bs.style.display=''; if (bp) bp.style.display='none'; if (br) br.disabled=false; _setStatus('已停止','') }
async function _resetSimulation() { _abortFlag.value=true; _stopAnimation(); await _destroySceneEntities(); await _resetWaterLevel(); _currentFrame=0; _setProgress(0); _setPhaseUI(0); const bs=_$('js-flood-btn-start'), bp=_$('js-flood-btn-stop'), br=_$('js-flood-btn-reset'); if (bs) bs.style.display=''; if (bp) bp.style.display='none'; if (br) br.disabled=true; _setStatus('就绪') }

async function _jumpToPhase(phaseIndex) {
  _abortFlag.value=true; _stopAnimation()
  const scenario=SCENARIOS[_currentScenario]; if (!scenario) return
  if (!(await _initWaterSurface())) return
  if (_sceneEntities.length===0) { await _createFloodZones(); await _createFlowPaths() }
  const fs=[1,12,24,36], fe=[11,23,35,48]
  const tf=Math.round((fs[phaseIndex]+fe[phaseIndex])/2)
  const rise=scenario.targetRise*tf/TOTAL_FRAMES
  await _callWaterSurface('setheight',{height:String(Math.min(BASE_WATER_LEVEL+rise,MAX_WATER_LEVEL).toFixed(1)),duration:'1'})
  _currentRise=rise; _currentFrame=tf; _setProgress(tf); _setPhaseUI(phaseIndex)
  _setStatus(`T+${_getHour(tf)}h · 水位 +${_currentRise.toFixed(1)}m · ${PHASE_LABELS[phaseIndex]}`,'')
  await _applyFrameVisuals(tf)
  const bs=_$('js-flood-btn-start'), bp=_$('js-flood-btn-stop'), br=_$('js-flood-btn-reset')
  if (bs) bs.style.display=''; if (bp) bp.style.display='none'; if (br) br.disabled=false
}

// ── 事件绑定 & 初始化 ──────────────────────────────────
export function initFlood() {
  const panel=_getPanel(); if (!panel) return
  const select=_$('js-flood-scenario'); if (select) select.addEventListener('change',()=>{ _currentScenario=select.value; _updateScenarioParams() })
  _updateScenarioParams()
  const bs=_$('js-flood-btn-start'); if (bs) bs.addEventListener('click',()=>_startSimulation())
  const bp=_$('js-flood-btn-stop'); if (bp) bp.addEventListener('click',()=>_stopSimulation())
  const br=_$('js-flood-btn-reset'); if (br) br.addEventListener('click',()=>_resetSimulation())
  const phases=_$('js-flood-phases'); if (phases) phases.querySelectorAll('.flood-phase').forEach((el,i)=>{ el.style.cursor='pointer'; el.addEventListener('click',()=>_jumpToPhase(i)) })
  onSceneReady(async ()=>{ const ok=await _initWaterSurface(); console.log('[Flood] 水面初始化'+(ok?'完成':'失败')) })
}

export function showFloodPanel() { const p=_getPanel(); if (p) p.style.display='' }
export function hideFloodPanel() { const p=_getPanel(); if (p) p.style.display='none'; if (_animating) { _abortFlag.value=true; _stopAnimation(); _destroySceneEntities().catch(()=>{}); _resetWaterLevel() } }

export async function startFlood(sk) { if (SCENARIOS[sk]) { _currentScenario=sk; const s=_$('js-flood-scenario'); if (s) s.value=sk; _updateScenarioParams() } return _startSimulation() }
export async function stopFlood() { return _stopSimulation() }
export async function resetFlood() { return _resetSimulation() }