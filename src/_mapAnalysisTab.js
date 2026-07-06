// 地图智能分析 Tab — 内嵌原生 ES 模块，复用主项目 AMap 实例（无 iframe）
// API 后端仍由 map-agent FastAPI 服务提供（端口 8000）

import { getMapInstance, getNearbyPois, setMapMode, getMapMode } from './_amap.js'
import { getApp } from './_wdp.js'
import { cgcs2000ToGcj02 } from './_coordConvert.js'
import { clearDetectionOverlays } from './_mapDetect.js'
import { clearDemAnnotations } from './_dem.js'

const BASE = 'http://localhost:8000'

// ── 运行时状态 ──────────────────────────────────────────────────────────────────
let _map          = null
let _mouseTool    = null
let _geocoder     = null
let _searchGeocoder = null
let _autoComplete = null
let _initialized  = false

let _markers      = []   // 检测标记
let _overlays     = []   // 检测矩形/折线
let _measureLines = []   // 精准测量线
let _3dPois       = []   // 3D 场景 POI 标记
let _evtSrc       = null // 主 SSE
let _isRunning    = false
let _measureMode  = null
let _screenshotPreview = null
let _nearbyPois   = ''
let _geocodeTimer = null
let _acTimer      = null
let _searchMarker = null
let _searchHistory = JSON.parse(localStorage.getItem('ma_search_history') || '[]')

// 遍历状态
let _tvBounds    = null
let _tvRect      = null
let _tvMarkers   = []
let _tvSessionId = null
let _tvEs        = null
let _tvOnDraw    = null
let _lastSummary = null
let _traverseContext = ''

// 专业模式状态
let _ppAreaMode  = 'viewport'
let _ppOverlays  = []
let _ppDrawShape = null
let _ppBounds    = null
let _ppEs        = null
let _ppOnDraw    = null

// ── 水位线 ──────────────────────────────────────────────────────────────────────
const WL_LEVELS = [
  { name: '155',   label: '155.0 m', color: '#4fc3f7' },
  { name: '156',   label: '156.0 m', color: '#29b6f6' },
  { name: '157',   label: '157.0 m', color: '#039be5' },
  { name: '157d5', label: '157.5 m', color: '#0277bd' },
  { name: '158d5', label: '158.5 m', color: '#01579b' },
  { name: '160',   label: '160.0 m', color: '#c62828' },
]
const _wlCache = {}  // name → Promise<AMap.Polyline[]>

function _wlColor(name) { return WL_LEVELS.find(l => l.name === name)?.color || '#58a6ff' }

function _activeWLLayers() {
  return WL_LEVELS.filter(lv => {
    const cb = document.getElementById(`ma-wl-cb-${lv.name}`)
    return cb && cb.checked
  }).map(lv => ({ name: lv.name, color: lv.color, label: lv.label }))
}

async function _loadWLLayer(name) {
  if (!_map) throw new Error('AMap 实例未就绪，请切换到卫星图后重试')
  const st = document.getElementById(`ma-wl-st-${name}`)
  if (st) { st.textContent = '…'; st.className = 'ma-wl-st ld' }
  const resp = await fetch(`${BASE}/api/water-level/${name}`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const gj    = await resp.json()
  const color = _wlColor(name)
  const lines = []
  for (const feat of gj.features) {
    for (const ring of feat.geometry.coordinates) {
      const line = new AMap.Polyline({
        path: ring.map(([lng, lat]) => [lng, lat]),
        strokeColor: color, strokeWeight: 2.5, strokeOpacity: 0.9,
        strokeStyle: 'solid', zIndex: 50, bubble: true, zooms: [2, 20],
      })
      _map.add(line)
      line.hide()
      lines.push(line)
    }
  }
  if (st) { st.textContent = '✓'; st.className = 'ma-wl-st ok' }
  return lines
}

function _ensureWL(name) {
  if (!_wlCache[name]) {
    _wlCache[name] = _loadWLLayer(name).catch(err => {
      console.error('[MA] 水位线加载失败', name, err.message)
      const st = document.getElementById(`ma-wl-st-${name}`)
      if (st) { st.textContent = '✗'; st.title = err.message; st.className = 'ma-wl-st er' }
      delete _wlCache[name]
      return []
    })
  }
  return _wlCache[name]
}

async function _toggleWL(name, visible) {
  const lines = await _ensureWL(name)
  lines.forEach(l => visible ? l.show() : l.hide())
}

function _buildWLPanel() {
  const container = document.getElementById('ma-wl-items')
  if (!container) return
  container.innerHTML = ''
  WL_LEVELS.forEach(lv => {
    const item = document.createElement('label')
    item.className = 'ma-wl-item'
    item.innerHTML =
      `<input type="checkbox" id="ma-wl-cb-${lv.name}" data-wl="${lv.name}">` +
      `<span class="ma-wl-dash" style="background:${lv.color}"></span>` +
      `<span class="ma-wl-lbl">${lv.label}</span>` +
      `<span class="ma-wl-st" id="ma-wl-st-${lv.name}">—</span>`
    item.querySelector('input').addEventListener('change', function () {
      _toggleWL(this.dataset.wl, this.checked)
    })
    container.appendChild(item)
  })
  const allBtn = document.getElementById('ma-wl-all-btn')
  if (allBtn) allBtn.addEventListener('click', function () {
    const cbs = container.querySelectorAll('input[type=checkbox]')
    const anyOff = [...cbs].some(c => !c.checked)
    cbs.forEach(c => { c.checked = anyOff; _toggleWL(c.dataset.wl, anyOff) })
    this.textContent = anyOff ? '全隐' : '全选'
  })
  const flyBtn = document.getElementById('ma-wl-fly')
  if (flyBtn) flyBtn.addEventListener('click', () => {
    if (_map) _map.setZoomAndCenter(11, [116.909, 40.518])
    const cbs = container.querySelectorAll('input[type=checkbox]')
    cbs.forEach(c => { c.checked = true; _toggleWL(c.dataset.wl, true) })
    if (allBtn) allBtn.textContent = '全隐'
  })
}

// ── 坐标转换（GCJ-02 → WGS-84） ───────────────────────────────────────────────
function _tlat(x, y) {
  let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x))
  r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI)) * 2/3
  r += (20*Math.sin(y*Math.PI)   + 40*Math.sin(y/3*Math.PI)) * 2/3
  r += (160*Math.sin(y/12*Math.PI) + 320*Math.sin(y/30*Math.PI)) * 2/3
  return r
}
function _tlng(x, y) {
  let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x))
  r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI)) * 2/3
  r += (20*Math.sin(x*Math.PI)   + 40*Math.sin(x/3*Math.PI)) * 2/3
  r += (150*Math.sin(x/12*Math.PI) + 300*Math.sin(x/30*Math.PI)) * 2/3
  return r
}
function _gcj2wgs(lng, lat) {
  const a = 6378245.0, ee = 0.00669342162296594323
  let dlat = _tlat(lng - 105, lat - 35)
  let dlng = _tlng(lng - 105, lat - 35)
  const rad = lat / 180 * Math.PI
  let magic = Math.sin(rad); magic = 1 - ee * magic * magic
  const sq = Math.sqrt(magic)
  dlat = dlat * 180 / ((a*(1-ee)) / (magic*sq) * Math.PI)
  dlng = dlng * 180 / (a / sq * Math.cos(rad) * Math.PI)
  return [+(lng - dlng).toFixed(6), +(lat - dlat).toFixed(6)]
}
function _fmtCorner(lat, lng) {
  return `${Math.abs(lat).toFixed(6)}°${lat>=0?'N':'S'}\n${Math.abs(lng).toFixed(6)}°${lng>=0?'E':'W'}`
}

// ── 视口信息 ────────────────────────────────────────────────────────────────────
function _updateViewportInfo() {
  if (!_map) return
  document.getElementById('ma-info-zoom').textContent = Math.round(_map.getZoom())
  const size = _map.getSize()
  const cols = Math.ceil(size.width  / 256)
  const rows = Math.ceil(size.height / 256)
  document.getElementById('ma-info-tiles').textContent = `${cols}×${rows}=${cols*rows}`
  const bounds = _map.getBounds()
  const ne = bounds.getNorthEast(), sw = bounds.getSouthWest()
  const [neLng, neLat] = _gcj2wgs(ne.getLng(), ne.getLat())
  const [swLng, swLat] = _gcj2wgs(sw.getLng(), sw.getLat())
  document.getElementById('ma-ic-nw').textContent = _fmtCorner(neLat, swLng)
  document.getElementById('ma-ic-ne').textContent = _fmtCorner(neLat, neLng)
  document.getElementById('ma-ic-sw').textContent = _fmtCorner(swLat, swLng)
  document.getElementById('ma-ic-se').textContent = _fmtCorner(swLat, neLng)
}

function _scheduleRegionUpdate() {
  clearTimeout(_geocodeTimer)
  _geocodeTimer = setTimeout(_updateRegionName, 1500)
}

function _updateRegionName() {
  if (!_geocoder || !_map) return
  const c = _map.getCenter()
  _geocoder.getAddress([c.getLng(), c.getLat()], (status, result) => {
    if (status === 'complete' && result.regeocode) {
      const addr  = result.regeocode.addressComponent
      const parts = []
      if (addr.province) parts.push(addr.province)
      if (addr.city && addr.city !== addr.province) parts.push(addr.city)
      if (addr.district) parts.push(addr.district)
      if (addr.township) parts.push(addr.township)
      const name = parts.length ? parts.join(' ') : result.regeocode.formattedAddress
      const el = document.getElementById('ma-info-region')
      if (el) el.textContent = name || '—'
      const features = []
      ;(result.regeocode.pois || []).slice(0, 8).forEach(p => {
        if (p.name) { const t = (p.type||'').split(';')[0]; features.push(t ? `${p.name}(${t})` : p.name) }
      })
      ;(result.regeocode.aois || []).slice(0, 5).forEach(a => {
        if (a.name && !features.some(f => f.startsWith(a.name))) features.push(a.name)
      })
      _nearbyPois = features.join('、')
    } else {
      const el = document.getElementById('ma-info-region')
      if (el) el.textContent = '—'
      _nearbyPois = ''
    }
  })
}

function _updateScreenshotPreview() {
  if (!_map) return
  const bounds = _map.getBounds(), center = _map.getCenter(), size = _map.getSize()
  if (!size || size.width === 0) return
  const ne = bounds.getNorthEast(), sw = bounds.getSouthWest()
  const lngSpan = (ne.getLng() - sw.getLng()) * 1024 / size.width
  const latSpan = (ne.getLat() - sw.getLat()) * 768  / size.height
  const path = [
    [center.getLng() - lngSpan/2, center.getLat() + latSpan/2],
    [center.getLng() + lngSpan/2, center.getLat() + latSpan/2],
    [center.getLng() + lngSpan/2, center.getLat() - latSpan/2],
    [center.getLng() - lngSpan/2, center.getLat() - latSpan/2],
  ]
  if (_screenshotPreview) {
    _screenshotPreview.setPath(path)
  } else {
    _screenshotPreview = new AMap.Polygon({
      path, strokeColor: '#f0c040', strokeWeight: 2, strokeOpacity: 0.85,
      strokeStyle: 'dashed', fillColor: '#f0c040', fillOpacity: 0.04,
      zIndex: 30, bubble: true,
    })
    _map.add(_screenshotPreview)
  }
}

// ── 工具函数 ────────────────────────────────────────────────────────────────────
function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function _appendLog(msg, type) {
  const log  = document.getElementById('ma-log')
  if (!log) return
  const item = document.createElement('div')
  item.className = 'ma-log-item'
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  item.innerHTML = `<span class="ma-log-time">${time}</span><span class="ma-log-msg ${type||''}">${_escHtml(msg)}</span>`
  log.appendChild(item)
  log.scrollTop = log.scrollHeight
}

function _setRunning(running) {
  _isRunning = running
  const startBtn = document.getElementById('ma-start-btn')
  const stopBtn  = document.getElementById('ma-stop-btn')
  if (startBtn) startBtn.style.display = running ? 'none' : ''
  if (stopBtn)  stopBtn.style.display  = running ? ''     : 'none'
  const dot = document.getElementById('ma-status-dot')
  if (dot) dot.className = 'ma-dot' + (running ? ' running' : '')
}

function _setStatus(msg, type) {
  const el  = document.getElementById('ma-status-text')
  const dot = document.getElementById('ma-status-dot')
  if (el)  el.textContent = msg
  if (dot) dot.className  = 'ma-dot' + (type === 'run' ? ' running' : type === 'err' ? ' error' : '')
}

function _clearAllOverlays() {
  if (!_map) return
  _map.remove(_markers);   _markers     = []
  _map.remove(_overlays);  _overlays    = []
  _map.remove(_measureLines); _measureLines = []
  _tvMarkers.forEach(m => _map.remove(m)); _tvMarkers = []
  _ppOverlays.forEach(p => _map.remove(p)); _ppOverlays = []
  if (_screenshotPreview) { _map.remove(_screenshotPreview); _screenshotPreview = null }
  if (_tvRect) { _map.remove(_tvRect); _tvRect = null }
  if (_ppDrawShape) { _map.remove(_ppDrawShape); _ppDrawShape = null }
}

// ── 双层标注辅助：在 3D 场景创建 POI ─────────────────────────────────────────────
async function _add3DPoiAt(gcjLng, gcjLat, label) {
  const App = getApp()
  if (!App) return null
  try {
    const poi = new App.Poi({
      location: [gcjLng, gcjLat, 0],
      poiStyle: {
        markerVisible: true,
        markerNormalUrl: _POI_ICON,
        markerSize: [28, 36],
        labelVisible: true,
        labelContent: [label, 'ffffffff', '13'],
        labelTop: true,
        labelBgSize: [160, 26],
        labelBgOffset: [0, -4],
        textBoxWidth: 160,
      },
      bVisible: true,
      entityName: label,
      customId: `ma3d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    })
    const res = await App.Scene.Add(poi, { calculateCoordZ: { coordZRef: 'surface', coordZOffset: 10 } })
    if (res.success) { const e = res.result?.object || poi; _3dPois.push(e); return e }
  } catch (e) { console.warn('[ma] 3D POI 创建失败:', e.message) }
  return null
}

// ── 双层标注辅助：在 2D 地图创建标记点 ───────────────────────────────────────────
function _add2DMarkerAt(gcjLng, gcjLat, label) {
  if (!_map) return
  const marker = new AMap.Marker({
    position: new AMap.LngLat(gcjLng, gcjLat), anchor: 'center',
    content: '<div style="width:14px;height:14px;background:#ff4444;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(255,68,68,0.7)"></div>',
    title: label, zIndex: 120,
  })
  marker.setLabel({
    content: `<div style="background:rgba(220,38,38,0.92);color:#fff;padding:4px 9px;border-radius:5px;font-size:12px;white-space:nowrap">${label}</div>`,
    direction: 'top', offset: new AMap.Pixel(0, -4),
  })
  _map.add(marker); _markers.push(marker)
}

// 红色圆点图标（点位+文字 风格）
const _POI_ICON = 'data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
  '<circle cx="12" cy="12" r="10" fill="#f85149" stroke="#fff" stroke-width="2.5"/>' +
  '<circle cx="12" cy="12" r="3.5" fill="#fff"/>' +
  '</svg>'
)
async function _capture3DScene() {
  const App = getApp()
  if (!App) return null
  try {
    const playerEl = document.getElementById('player')
    const w = playerEl ? Math.min(playerEl.clientWidth, 800) : 800
    const h = playerEl ? Math.round(w * playerEl.clientHeight / playerEl.clientWidth) : 450

    const r = await App.Renderer.GetSnapshot([w, h], 0.85)
    if (!r?.success || !r.result) return null

    // result 可能是 base64 字符串或 data URL
    const raw = typeof r.result === 'string' ? r.result : ''
    let b64 = raw
    let mime = 'image/jpeg'
    if (raw.startsWith('data:')) {
      const [header, data] = raw.split(',')
      b64 = data
      mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg'
    } else if (raw.startsWith('iVBORw0KGgo')) {
      mime = 'image/png'
    }
    if (!b64) return null
    return { image: b64, width: w, height: h, mime }
  } catch (e) {
    console.warn('[3D capture] GetSnapshot 失败:', e.message)
    return null
  }
}

// ── 3D 模式检测分析 ──────────────────────────────────────────────────────────────
async function _startAnalysis3D(target) {
  _setRunning(true)
  _setStatus('截取 3D 场景…', 'run')
  const logEl = document.getElementById('ma-log')
  if (logEl) logEl.innerHTML = ''

  for (const p of _3dPois) { try { await p.Delete() } catch (e) {} }
  _3dPois = []

  _appendLog('截取 3D 场景截图…')
  const scene = await _capture3DScene()
  if (!scene) {
    _appendLog('3D 截图失败，视频帧不可用（尝试刷新页面重试）', 'err')
    _setStatus('截图失败', 'err')
    _setRunning(false)
    return
  }

  const img = document.getElementById('ma-preview-img')
  const ph  = document.getElementById('ma-preview-placeholder')
  if (img) { img.src = `data:${scene.mime};base64,` + scene.image; img.style.display = '' }
  if (ph)  ph.style.display = 'none'

  _appendLog(`截图成功（${scene.width}×${scene.height}），AI 检测中…`)
  _setStatus('AI 检测中…', 'run')

  let result
  try {
    const imageType = scene.mime === 'image/png' ? 'png' : 'jpeg'
    const resp = await fetch('http://localhost:3001/api/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: scene.image, target, scene_type: '3d', image_type: imageType }),
    })
    result = await resp.json()
  } catch (err) {
    _appendLog('请求失败：' + err.message, 'err')
    _setStatus('请求失败', 'err')
    _setRunning(false)
    return
  }

  const detections = result.detections || []
  if (!detections.length) {
    _appendLog('未检测到目标', '')
    _setStatus('未检测到目标', '')
    _setRunning(false)
    return
  }

  _appendLog(`检测到 ${detections.length} 个目标，拾取坐标中…`)

  const App = getApp()
  if (!App) {
    _appendLog('WDP 场景未就绪', 'err')
    _setRunning(false)
    return
  }

  // PickWorldPointByScreenPos 使用截图分辨率坐标空间（实测确认）
  const sW = scene.width   // 800
  const sH = scene.height  // 378
  _appendLog(`坐标空间 ${sW}×${sH}（截图尺寸）`)

  // Phase 1：逐个拾取屏幕坐标 → 笛卡尔坐标（每步 8s 超时）
  const cartItems = []
  for (const det of detections) {
    const box = det.box_2d
    if (!Array.isArray(box) || box.length < 4) { _appendLog(`无效 box_2d: ${JSON.stringify(box)}`, 'warn'); continue }
    const [x1, y1, x2, y2] = box
    const sx = Math.round((x1 + x2) / 2 / 1000 * sW)
    const sy = Math.round((y1 + y2) / 2 / 1000 * sH)
    try {
      const r = await Promise.race([
        App.Tools.Picker.PickWorldPointByScreenPos([sx, sy]),
        new Promise((_, rej) => setTimeout(() => rej(new Error('拾取超时')), 8000)),
      ])
      if (!r?.success || !r.result) { _appendLog(`无命中 (${sx},${sy})`, 'warn'); continue }
      const cartPoint = Array.isArray(r.result) ? r.result : r.result?.point
      if (cartPoint) cartItems.push({ det, cartPoint })
    } catch (e) {
      _appendLog(`拾取失败 (${sx},${sy}): ${e.message}`, 'warn')
    }
  }

  if (!cartItems.length) {
    _appendLog('所有目标坐标拾取失败（可能命中天空/水面）', 'warn')
    _setStatus('坐标拾取失败', 'warn')
    _setRunning(false)
    return
  }

  _appendLog(`拾取到 ${cartItems.length} 个坐标，批量转换 GIS…`)

  // Phase 2：一次批量 CartesianToGIS（原来 N 次 → 1 次，大幅减少超时风险）
  let gisCoords = []
  try {
    const gisRes = await Promise.race([
      App.Tools.Coordinate.CartesianToGIS(cartItems.map(p => p.cartPoint)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('GIS转换超时')), 15000)),
    ])
    gisCoords = gisRes?.result?.to || gisRes?.result || []
  } catch (e) {
    _appendLog(`GIS坐标批量转换失败: ${e.message}`, 'warn')
    _setRunning(false)
    return
  }

  // Phase 3：构建 POI 列表
  const addJobs = []
  for (let i = 0; i < cartItems.length; i++) {
    const { det } = cartItems[i]
    const coords = Array.isArray(gisCoords[i]) ? gisCoords[i] : null
    if (!coords) { _appendLog(`第 ${i + 1} 个目标坐标转换失败`, 'warn'); continue }
    const [lng, lat, alt] = coords
    if (i < 3) _appendLog(`GIS[${i}] ${lng.toFixed(4)},${lat.toFixed(4)},${Math.round(alt || 0)}m`)
    const [gcjLng, gcjLat] = cgcs2000ToGcj02(lng, lat)
    const label = det.description || target
    const bgW = Math.min(Math.max(label.length * 14 + 16, 80), 200)
    const poi = new App.Poi({
      location: [gcjLng, gcjLat, (typeof alt === 'number' ? alt : 200) + 10],
      poiStyle: {
        markerVisible: true,
        markerNormalUrl: _POI_ICON,
        markerSize: [24, 24],
        labelVisible: true,
        labelContent: [label, 'ffffffff', '13'],
        labelTop: true,
        labelBgSize: [bgW, 26],
        labelBgOffset: [0, -4],
        textBoxWidth: bgW,
      },
      bVisible: true,
      entityName: label,
      customId: `ma3d-${Date.now()}-${i}`,
    })
    addJobs.push({ poi, det, gcjLng, gcjLat, label })
  }

  _appendLog(`并发添加 ${addJobs.length} 个标注…`)

  // 全部并发执行，避免串行累加延迟（calculateCoordZ 单次耗时，但并行后总时间 ≈ 单次）
  const settled = await Promise.allSettled(
    addJobs.map(({ poi }) =>
      App.Scene.Add(poi, { calculateCoordZ: { coordZRef: 'surface', coordZOffset: 10 } })
    )
  )

  let placed = 0
  for (let i = 0; i < settled.length; i++) {
    const { det, gcjLng, gcjLat, label } = addJobs[i]
    const r = settled[i]
    if (r.status === 'fulfilled' && r.value?.success) {
      _3dPois.push(r.value.result?.object || r.value.result)
      _add2DMarkerAt(gcjLng, gcjLat, label)
      placed++
      _appendLog(`✓ ${label}（${Math.round((det.confidence || 0) * 100)}%）`)
    } else {
      _appendLog(`✗ ${label}: ${r.reason?.message || r.status}`, 'warn')
    }
  }

  _appendLog(`完成，已标注 ${placed} 个目标`)
  _setStatus(`已标注 ${placed} 个目标`, '')
  const clrBtn = document.getElementById('ma-clear-markers-btn')
  if (clrBtn) clrBtn.style.display = placed > 0 ? '' : 'none'
  _setRunning(false)
}

// ── 启动检测分析 ─────────────────────────────────────────────────────────────────
async function _startAnalysis() {
  const target = document.getElementById('ma-target-input').value.trim()
  if (!target || !_map) { alert(target ? '地图尚未就绪' : '请输入分析目标'); return }

  _map.remove(_markers); _map.remove(_overlays); _map.remove(_measureLines)
  _markers = []; _overlays = []; _measureLines = []

  // 3D 模式：截图 3D 场景 + PickWorldPointByScreenPos 坐标转换
  if (getMapMode() === '3d') return _startAnalysis3D(target)

  const clrBtn = document.getElementById('ma-clear-markers-btn')
  if (clrBtn) clrBtn.style.display = 'none'
  const logEl = document.getElementById('ma-log')
  if (logEl) logEl.innerHTML = ''
  const img = document.getElementById('ma-preview-img')
  if (img) img.style.display = 'none'
  const ph  = document.getElementById('ma-preview-placeholder')
  if (ph) ph.style.display = ''
  const badge = document.getElementById('ma-step-badge')
  if (badge) badge.style.display = 'none'

  _setRunning(true)
  _setStatus('分析中…', 'run')

  const center = _map.getCenter()
  const zoom   = Math.round(_map.getZoom())
  const bounds = _map.getBounds()
  if (!bounds) {
    _appendLog('地图视野未就绪，请先切换到卫星图', 'err')
    _setStatus('请先切换到卫星/标准地图', 'err')
    _setRunning(false)
    return
  }
  const ne = bounds.getNorthEast(), sw = bounds.getSouthWest()

  try {
    const resp = await fetch(`${BASE}/api/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target, lat: center.getLat(), lng: center.getLng(), zoom,
        mode: 'search',
        north: ne.getLat(), south: sw.getLat(), east: ne.getLng(), west: sw.getLng(),
        region: (document.getElementById('ma-info-region') || {}).textContent || '',
        nearby_pois: _nearbyPois || getNearbyPois(),
        active_wl: _activeWLLayers(),
      }),
    })
    const { session_id } = await resp.json()
    if (_evtSrc) _evtSrc.close()
    _evtSrc = new EventSource(`${BASE}/api/stream/${session_id}`)
    _evtSrc.onmessage = _handleSSEEvent
    _evtSrc.onerror = () => { _appendLog('连接中断', 'err'); _setStatus('连接中断', 'err'); _setRunning(false) }
  } catch (err) {
    _appendLog('启动失败：' + err.message, 'err')
    _setStatus('启动失败', 'err')
    _setRunning(false)
  }
}

function _stopAnalysis() {
  if (_evtSrc) { _evtSrc.close(); _evtSrc = null }
  _setRunning(false)
  _setStatus('已停止', '')
  _appendLog('用户手动停止', '')
}

// ── 视野分析 ────────────────────────────────────────────────────────────────────
async function _startAnalyze() {
  const question = document.getElementById('ma-analyze-input').value.trim()
  if (!question || !_map) { alert(question ? '地图尚未就绪' : '请输入分析问题'); return }

  _map.remove(_measureLines); _measureLines = []
  const resultBox = document.getElementById('ma-analyze-result')
  if (resultBox) { resultBox.style.display = 'none'; resultBox.textContent = '' }

  _setRunning(true)
  _setStatus('分析中…', 'run')

  const center = _map.getCenter()
  try {
    const resp = await fetch(`${BASE}/api/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: center.getLat(), lng: center.getLng(),
        zoom: Math.round(_map.getZoom()), mode: 'analyze', question,
      }),
    })
    const { session_id } = await resp.json()
    if (_evtSrc) _evtSrc.close()
    _evtSrc = new EventSource(`${BASE}/api/stream/${session_id}`)
    _evtSrc.onmessage = _handleSSEEvent
    _evtSrc.onerror = () => { _appendLog('连接中断', 'err'); _setStatus('连接中断', 'err'); _setRunning(false) }
  } catch (err) {
    _appendLog('分析失败：' + err.message, 'err')
    _setStatus('分析失败', 'err')
    _setRunning(false)
  }
}

// ── SSE 主事件处理 ────────────────────────────────────────────────────────────
function _handleSSEEvent(e) {
  const data = JSON.parse(e.data)
  switch (data.type) {
    case 'log':
      _appendLog(data.message)
      break

    case 'screenshot': {
      const img = document.getElementById('ma-preview-img')
      const ph  = document.getElementById('ma-preview-placeholder')
      if (img) { img.src = 'data:image/png;base64,' + data.image; img.style.display = '' }
      if (ph)  ph.style.display = 'none'
      const badge = document.getElementById('ma-step-badge')
      if (badge) { badge.textContent = `步骤 ${data.step}`; badge.style.display = '' }
      break
    }

    case 'annotated_screenshot': {
      const img2 = document.getElementById('ma-preview-img')
      if (img2) { img2.src = 'data:image/png;base64,' + data.image; img2.style.display = '' }
      const ph2  = document.getElementById('ma-preview-placeholder')
      if (ph2) ph2.style.display = 'none'
      const badge2 = document.getElementById('ma-step-badge')
      if (badge2) { badge2.textContent = '检测框（红框=模型预测位置）'; badge2.style.display = '' }
      break
    }

    case 'set_zoom':
      if (_map) _map.setZoom(data.zoom, false)
      _appendLog(`缩放 → ${data.zoom}`, 'action')
      break

    case 'fly_to':
      if (_map) _map.setZoomAndCenter(data.zoom, [data.lng, data.lat], false)
      _appendLog(`移动 → [${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}] zoom=${data.zoom}`, 'action')
      break

    case 'add_marker': {
      if (!_map || !isFinite(data.lat) || !isFinite(data.lng)) { _appendLog('[ERROR] 坐标无效', 'err'); break }
      const pct = (data.confidence * 100).toFixed(0)
      const marker = new AMap.Marker({
        position: new AMap.LngLat(data.lng, data.lat), anchor: 'center',
        content: '<div style="width:14px;height:14px;background:#ff4444;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(255,68,68,0.7)"></div>',
        title: data.description, zIndex: 120,
      })
      marker.setLabel({
        content: `<div style="background:rgba(220,38,38,0.92);color:#fff;padding:4px 9px;border-radius:5px;font-size:12px;white-space:nowrap">${data.description}　${pct}%</div>`,
        direction: 'right', offset: new AMap.Pixel(4, 0),
      })
      _map.add(marker); _markers.push(marker)
      _add3DPoiAt(data.lng, data.lat, `${data.description} ${pct}%`)
      _appendLog(`标记：${data.description} (${pct}%)`, 'action')
      break
    }

    case 'add_rect': {
      if (!_map) break
      const poly = new AMap.Polygon({
        path: [[data.west,data.north],[data.east,data.north],[data.east,data.south],[data.west,data.south]],
        strokeColor: '#ff4444', strokeWeight: 2, strokeOpacity: 0.9,
        fillColor: '#ff4444', fillOpacity: 0.12, zIndex: 100,
      })
      _map.add(poly); _overlays.push(poly)
      break
    }

    case 'add_polyline': {
      if (!_map || !data.latlngs || data.latlngs.length < 2) break
      const line = new AMap.Polyline({
        path: data.latlngs.map(([lat, lng]) => new AMap.LngLat(lng, lat)),
        strokeColor: '#00e5ff', strokeWeight: 4, strokeOpacity: 0.9, zIndex: 120,
      })
      _map.add(line); _overlays.push(line)
      _appendLog(`🛣️ ${data.label||'道路'}（${data.latlngs.length} 点）`, 'action')
      break
    }

    case 'analyze_result': {
      const resultBox = document.getElementById('ma-analyze-result')
      if (resultBox) { resultBox.textContent = data.answer || ''; resultBox.style.display = '' }
      for (const m of (data.measurements || [])) {
        if (m.type === 'length' && m.latlngs && m.latlngs.length >= 2) {
          const line = new AMap.Polyline({
            path: m.latlngs.map(([lat, lng]) => new AMap.LngLat(lng, lat)),
            strokeColor: '#00e5ff', strokeWeight: 3, strokeOpacity: 0.95, strokeStyle: 'dashed', zIndex: 120,
          })
          _map.add(line); _measureLines.push(line)
          const dist = m.km < 1 ? `${(m.km*1000).toFixed(0)} 米` : `${m.km.toFixed(3)} 公里`
          _appendLog(`📏 ${m.label||'测量'}：${dist}`, 'action')
        }
        if (m.type === 'count' && m.rects && m.rects.length > 0) {
          for (const r of m.rects) {
            const p2 = new AMap.Polygon({
              path: [[r.west,r.north],[r.east,r.north],[r.east,r.south],[r.west,r.south]],
              strokeColor: '#ff9800', strokeWeight: 1.5, fillColor: '#ff9800', fillOpacity: 0.12, zIndex: 110,
            })
            _map.add(p2); _measureLines.push(p2)
          }
          _appendLog(`🏠 ${m.label||'目标'}：${m.count} 个`, 'action')
        }
      }
      break
    }

    case 'error':
      _appendLog('错误：' + data.message, 'err')
      _setStatus('发生错误', 'err')
      _setRunning(false)
      if (_evtSrc) { _evtSrc.close(); _evtSrc = null }
      break

    case 'done':
      _appendLog('✓ 任务完成', 'done')
      _setStatus(`分析完成，共标记 ${_markers.length} 个目标`, '')
      _setRunning(false)
      if (_evtSrc) { _evtSrc.close(); _evtSrc = null }
      if (_markers.length > 0 || _overlays.length > 0) {
        const clrBtn = document.getElementById('ma-clear-markers-btn')
        if (clrBtn) clrBtn.style.display = ''
      }
      break
  }
}

// ── 精准测量 ────────────────────────────────────────────────────────────────────
function _startMeasure(mode) {
  if (!_mouseTool) { alert('地图尚未就绪'); return }
  if (_measureMode === mode) {
    _mouseTool.close(false); _measureMode = null
    document.querySelectorAll('.ma-measure-btn').forEach(b => b.classList.remove('active'))
    return
  }
  _mouseTool.close(false)
  _measureMode = mode
  document.querySelectorAll('.ma-measure-btn').forEach(b => b.classList.remove('active'))
  document.getElementById(mode === 'dist' ? 'ma-btn-dist' : 'ma-btn-area').classList.add('active')
  if (mode === 'dist') {
    _mouseTool.rule({ strokeColor: '#00e5ff', strokeWeight: 2, strokeStyle: 'dashed' })
  } else {
    _mouseTool.measureArea({ strokeColor: '#3fb950', strokeWeight: 2, fillColor: 'rgba(63,185,80,0.1)' })
  }
}

function _clearMeasure() {
  if (_mouseTool) _mouseTool.close(true)
  _measureMode = null
  document.querySelectorAll('.ma-measure-btn').forEach(b => b.classList.remove('active'))
}

// ── 搜索历史 & 下拉 ─────────────────────────────────────────────────────────────
function _saveHistory(q) {
  if (!q) return
  _searchHistory = [q, ..._searchHistory.filter(h => h !== q)].slice(0, 12)
  localStorage.setItem('ma_search_history', JSON.stringify(_searchHistory))
}

function _closeDropdown() { document.getElementById('ma-search-dropdown').classList.remove('open') }

function _positionDropdown() {
  const rect = document.getElementById('ma-search-wrap').getBoundingClientRect()
  const dd   = document.getElementById('ma-search-dropdown')
  dd.style.top   = rect.bottom + 'px'
  dd.style.left  = rect.left   + 'px'
  dd.style.width = rect.width  + 'px'
}

function _showHistoryDropdown(filter) {
  const dd = document.getElementById('ma-search-dropdown')
  let items = filter
    ? _searchHistory.filter(h => h.toLowerCase().includes(filter.toLowerCase())).map(h => ({ text: h }))
    : _searchHistory.map(h => ({ text: h }))
  if (!items.length) { _closeDropdown(); return }
  _positionDropdown()
  dd.innerHTML = ''
  const sep = document.createElement('div')
  sep.className = 'ma-sdrop-sep'
  sep.innerHTML = '<span>历史记录</span>'
  const cb = document.createElement('button')
  cb.textContent = '清除'
  cb.addEventListener('click', e => { e.stopPropagation(); _searchHistory = []; localStorage.removeItem('ma_search_history'); _closeDropdown() })
  sep.appendChild(cb)
  dd.appendChild(sep)
  items.forEach(({ text }) => {
    const item = document.createElement('div')
    item.className = 'ma-sdrop-item'
    item.innerHTML = '<span class="ma-sdrop-icon">🕒</span>'
    const label = document.createElement('span')
    label.textContent = text
    item.appendChild(label)
    item.addEventListener('click', () => {
      document.getElementById('ma-search-input').value = text
      _closeDropdown(); _doSearch()
    })
    dd.appendChild(item)
  })
  dd.classList.add('open')
}

function _navigateToGeocode(geo) {
  const loc = geo.location
  const lvl = geo.level || ''
  let zoom = 15
  if (/省|自治区/.test(lvl)) zoom = 8
  else if (/市/.test(lvl)) zoom = 11
  else if (/区|县|镇/.test(lvl)) zoom = 13
  if (_map) _map.setZoomAndCenter(zoom, [loc.getLng(), loc.getLat()], false, 300)
  if (_searchMarker) { _map.remove(_searchMarker); _searchMarker = null }
  _searchMarker = new AMap.Marker({
    position: new AMap.LngLat(loc.getLng(), loc.getLat()), anchor: 'center',
    content: '<div style="width:16px;height:16px;background:#58a6ff;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 5px rgba(88,166,255,0.3)"></div>',
    zIndex: 200,
  })
  _map.add(_searchMarker)
  setTimeout(() => { if (_searchMarker) { _map.remove(_searchMarker); _searchMarker = null } }, 4000)
}

function _doSearch() {
  const inp = document.getElementById('ma-search-input')
  const btn = document.getElementById('ma-search-btn')
  const q   = inp.value.trim()
  if (!q || !_searchGeocoder) return
  btn.disabled = true
  inp.classList.remove('err')
  _closeDropdown()
  _searchGeocoder.getLocation(q, (status, result) => {
    btn.disabled = false
    if (status === 'complete' && result.geocodes && result.geocodes.length) {
      _navigateToGeocode(result.geocodes[0])
      _saveHistory(q)
    } else {
      inp.classList.add('err')
      setTimeout(() => inp.classList.remove('err'), 2000)
    }
  })
}

// ── 区域遍历 ────────────────────────────────────────────────────────────────────
function _tvStartDraw() {
  if (!_mouseTool) { alert('地图尚未就绪'); return }
  if (_tvOnDraw) { _mouseTool.off('draw', _tvOnDraw); _tvOnDraw = null }
  const drawBtn = document.getElementById('ma-tv-draw-btn')
  drawBtn.classList.add('active')
  drawBtn.textContent = '在地图上拖动画框…'
  _mouseTool.close(false)
  _mouseTool.rectangle({
    strokeColor: '#f0c040', strokeWeight: 2, strokeStyle: 'dashed',
    fillColor: '#f0c040', fillOpacity: 0.06, zIndex: 80,
  })
  _tvOnDraw = (e) => {
    _mouseTool.off('draw', _tvOnDraw); _tvOnDraw = null
    drawBtn.classList.remove('active')
    drawBtn.textContent = '✏️ 重新框选'
    _mouseTool.close(false)
    const b = e.obj.getBounds()
    _tvBounds = {
      north: b.getNorthEast().getLat(), south: b.getSouthWest().getLat(),
      east:  b.getNorthEast().getLng(), west:  b.getSouthWest().getLng(),
    }
    _map.remove(e.obj)
    _tvDrawBoundsRect()
    _tvRefreshBoundsUI()
  }
  _mouseTool.on('draw', _tvOnDraw)
}

function _tvDrawBoundsRect() {
  if (_tvRect) _map.remove(_tvRect)
  if (!_tvBounds) { _tvRect = null; return }
  const { north, south, east, west } = _tvBounds
  _tvRect = new AMap.Polygon({
    path: [[west,north],[east,north],[east,south],[west,south]],
    strokeColor: '#f0c040', strokeWeight: 2, strokeStyle: 'dashed',
    fillColor: '#f0c040', fillOpacity: 0.06, zIndex: 80,
  })
  _map.add(_tvRect)
}

function _tvRefreshBoundsUI() {
  const boundsEl = document.getElementById('ma-tv-bounds-info')
  const tileEst  = document.getElementById('ma-tv-tile-est')
  if (!_tvBounds) {
    if (boundsEl) boundsEl.classList.remove('show')
    if (tileEst)  tileEst.textContent = '—格'
    return
  }
  const b = _tvBounds
  ;['n','s','e','w'].forEach(d => {
    const el = document.getElementById(`ma-tv-${d}`)
    if (el) el.textContent = b[{n:'north',s:'south',e:'east',w:'west'}[d]].toFixed(5) + '°'
  })
  if (boundsEl) boundsEl.classList.add('show')
  _tvUpdateTileEst()
}

async function _tvUpdateTileEst() {
  let b = _tvBounds
  const wlFilter = document.getElementById('ma-tv-wl-filter')
  const wlVal = wlFilter ? wlFilter.value : ''
  const tileEst = document.getElementById('ma-tv-tile-est')
  if (!b && !wlVal) { if (tileEst) tileEst.textContent = '—格'; return }
  if (!b && wlVal) {
    try {
      const r = await fetch(`${BASE}/api/water-level/${wlVal}/bbox`)
      if (!r.ok) { if (tileEst) tileEst.textContent = '—格'; return }
      b = await r.json()
    } catch { if (tileEst) tileEst.textContent = '—格'; return }
  }
  try {
    const zoomSel = document.getElementById('ma-tv-zoom')
    const resp = await fetch(`${BASE}/api/traverse/estimate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...b, zoom: parseInt(zoomSel ? zoomSel.value : 17), prompt: '' }),
    })
    const { tiles } = await resp.json()
    if (tileEst) tileEst.textContent = tiles + ' 格'
  } catch { if (tileEst) tileEst.textContent = '?格' }
}

function _tvClear() {
  _tvBounds = null
  if (_tvRect) { _map.remove(_tvRect); _tvRect = null }
  _tvMarkers.forEach(m => _map.remove(m)); _tvMarkers = []
  _tvRefreshBoundsUI()
  const boundsEl = document.getElementById('ma-tv-bounds-info')
  if (boundsEl) boundsEl.classList.remove('show')
  const drawBtn = document.getElementById('ma-tv-draw-btn')
  if (drawBtn) { drawBtn.textContent = '✏️ 框选区域'; drawBtn.classList.remove('active') }
  const progBar  = document.getElementById('ma-tv-progress-bar')
  const progTxt  = document.getElementById('ma-tv-progress-txt')
  const startBtn = document.getElementById('ma-tv-start-btn')
  const stopBtn  = document.getElementById('ma-tv-stop-btn')
  if (progBar)  progBar.style.display  = 'none'
  if (progTxt)  progTxt.style.display  = 'none'
  if (startBtn) startBtn.style.display = ''
  if (stopBtn)  stopBtn.style.display  = 'none'
  if (_tvOnDraw && _mouseTool) { _mouseTool.off('draw', _tvOnDraw); _tvOnDraw = null }
  if (_tvEs) { _tvEs.close(); _tvEs = null }
}

async function _tvStart() {
  const wlFilter = document.getElementById('ma-tv-wl-filter')
  const wlVal    = wlFilter ? wlFilter.value : ''
  let bounds     = _tvBounds
  if (!bounds && !wlVal) { alert('请先框选区域，或选择水位线过滤范围'); return }
  const promptEl = document.getElementById('ma-tv-prompt')
  const prompt   = promptEl ? promptEl.value.trim() : ''
  if (!prompt) { alert('请输入识别目标，例如：违规建筑'); return }

  if (!bounds && wlVal) {
    try {
      const r = await fetch(`${BASE}/api/water-level/${wlVal}/bbox`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      bounds = await r.json()
    } catch (e) { alert('获取水位线范围失败：' + e.message); return }
  }

  _tvMarkers.forEach(m => _map.remove(m)); _tvMarkers = []
  const startBtn = document.getElementById('ma-tv-start-btn')
  const stopBtn  = document.getElementById('ma-tv-stop-btn')
  const progBar  = document.getElementById('ma-tv-progress-bar')
  const progFill = document.getElementById('ma-tv-progress-fill')
  const progTxt  = document.getElementById('ma-tv-progress-txt')
  if (startBtn) startBtn.style.display = 'none'
  if (stopBtn)  stopBtn.style.display  = ''
  if (progBar)  progBar.style.display  = ''
  if (progTxt)  { progTxt.style.display = ''; progTxt.textContent = '准备中…' }
  if (progFill) progFill.style.width = '0%'

  const zoomSel = document.getElementById('ma-tv-zoom')
  try {
    const resp = await fetch(`${BASE}/api/traverse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...bounds, zoom: parseInt(zoomSel ? zoomSel.value : 17), prompt,
        active_wl: _activeWLLayers(), wl_filter: wlVal,
      }),
    })
    if (!resp.ok) throw new Error(`服务端错误 ${resp.status}`)
    const { session_id } = await resp.json()
    _tvSessionId = session_id
    if (_tvEs) _tvEs.close()
    _tvEs = new EventSource(`${BASE}/api/stream/${session_id}`)
    _tvEs.onmessage = _handleTvEvent
    _tvEs.onerror = () => { _appendLog('遍历连接中断', 'err'); _tvDone() }
  } catch (e) {
    _appendLog('遍历启动失败：' + e.message, 'err')
    _tvDone()
  }
}

async function _tvStop() {
  if (_tvSessionId) {
    try { await fetch(`${BASE}/api/traverse/${_tvSessionId}/stop`, { method: 'POST' }) } catch {}
  }
  if (_tvEs) { _tvEs.close(); _tvEs = null }
  _tvDone()
}

function _tvDone() {
  const startBtn = document.getElementById('ma-tv-start-btn')
  const stopBtn  = document.getElementById('ma-tv-stop-btn')
  if (startBtn) startBtn.style.display = ''
  if (stopBtn)  stopBtn.style.display  = 'none'
}

function _handleTvEvent(e) {
  const data = JSON.parse(e.data)
  const progFill = document.getElementById('ma-tv-progress-fill')
  const progTxt  = document.getElementById('ma-tv-progress-txt')
  const reopenBtn= document.getElementById('ma-tv-reopen-btn')
  switch (data.type) {
    case 'traverse_start':
      if (progTxt) progTxt.textContent = `0 / ${data.total} 格`
      _appendLog(`开始遍历，共 ${data.total} 格`, 'action')
      break
    case 'traverse_progress': {
      const pct = (data.current / data.total * 100).toFixed(0)
      if (progFill) progFill.style.width = pct + '%'
      if (progTxt)  progTxt.textContent  = `${data.current} / ${data.total} 格`
      break
    }
    case 'traverse_finding':
      _addFindingMarker(data)
      break
    case 'traverse_summary':
      if (_tvEs) { _tvEs.close(); _tvEs = null }
      _tvDone()
      _lastSummary = data
      _traverseContext = data.summary || ''
      if (reopenBtn) reopenBtn.style.display = ''
      if (progTxt) progTxt.textContent = `完成：${(data.findings||[]).length} 处目标，共 ${data.total_tiles} 格`
      _appendLog(`✓ 遍历完成，发现 ${(data.findings||[]).length} 处目标`, 'done')
      break
    case 'screenshot':
      _handleSSEEvent(e)
      break
    case 'log':
      _appendLog(data.message)
      break
    case 'error':
      _appendLog('遍历错误：' + data.message, 'err')
      _tvDone()
      if (_tvEs) { _tvEs.close(); _tvEs = null }
      break
    case 'done':
      if (_tvEs) { _tvEs.close(); _tvEs = null }
      _tvDone()
      break
  }
}

function _findingLngLat(f) {
  const b = f.bounds, box = f.box_2d
  if (box && box.length === 4) {
    const cx = (box[0] + box[2]) / 2 / 1000
    const cy = (box[1] + box[3]) / 2 / 1000
    return [b.west + (b.east - b.west) * cx, b.north - (b.north - b.south) * cy]
  }
  return [(b.west + b.east) / 2, (b.north + b.south) / 2]
}

function _addFindingMarker(f) {
  if (!f.bounds || !_map) return
  const [lng, lat] = _findingLngLat(f)
  const conf  = ((f.confidence || 0.8) * 100).toFixed(0)
  const label = f.finding_type || f.type || '目标'
  const marker = new AMap.Marker({
    position: new AMap.LngLat(lng, lat), anchor: 'center',
    content: '<div style="width:12px;height:12px;background:#f0c040;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(240,192,64,0.7)"></div>',
    title: f.description || label, zIndex: 110,
  })
  marker.setLabel({
    content: `<div style="background:rgba(180,140,0,0.92);color:#fff;padding:4px 9px;border-radius:5px;font-size:12px;white-space:nowrap">${label} ${conf}%</div>`,
    direction: 'right', offset: new AMap.Pixel(4, 0),
  })
  _map.add(marker); _tvMarkers.push(marker)
}

function _renderSummary(data) {
  const modal      = document.getElementById('ma-tv-modal')
  const summaryEl  = document.getElementById('ma-tv-modal-summary')
  const findingsEl = document.getElementById('ma-tv-modal-findings')
  if (!modal) return
  if (summaryEl) summaryEl.textContent = data.summary || ''
  if (findingsEl) {
    findingsEl.innerHTML = ''
    const zoomSel = document.getElementById('ma-tv-zoom')
    ;(data.findings || []).forEach(f => {
      const item = document.createElement('div')
      item.className = 'ma-tv-finding-item'
      item.innerHTML =
        `<span>📍</span>` +
        `<div><div style="font-size:11px;color:#58a6ff;font-weight:600">${_escHtml(f.type||'未知')}</div>` +
        `<div style="font-size:11px;color:#8b949e">${_escHtml(f.description||'')}</div></div>`
      item.addEventListener('click', () => {
        if (f.bounds && _map) {
          const [lng, lat] = _findingLngLat(f)
          _map.setZoomAndCenter(parseInt(zoomSel ? zoomSel.value : 17), [lng, lat], false, 300)
        }
      })
      findingsEl.appendChild(item)
    })
  }
  modal.classList.add('open')
}

// ── 专业模式面板 ─────────────────────────────────────────────────────────────────
const _PP_TYPE_COLOR = { building: '#f0883e', road: '#58a6ff', dam: '#3fb950', custom: '#da3633' }

function _ppUpdateAreaUI() {
  const hint     = document.getElementById('ma-pp-draw-hint')
  const boundsEl = document.getElementById('ma-pp-bounds-info')
  if (_ppAreaMode === 'viewport') {
    if (hint) hint.style.display = 'none'
    if (boundsEl) boundsEl.classList.remove('show')
  } else {
    if (hint) { hint.style.display = ''; hint.textContent = _ppAreaMode === 'rect' ? '在地图上拖拽框选目标区域' : '在地图上点击绘制多边形（双击结束）' }
    if (_ppBounds && boundsEl) boundsEl.classList.add('show')
    _ppStartDraw()
  }
}

function _ppStartDraw() {
  if (!_mouseTool) { setTimeout(_ppStartDraw, 800); return }
  if (_ppOnDraw) { _mouseTool.off('draw', _ppOnDraw); _ppOnDraw = null }
  _mouseTool.close(false)
  const opts = { strokeColor: '#f0883e', strokeWeight: 2, strokeStyle: 'dashed', fillColor: '#f0883e', fillOpacity: 0.06, zIndex: 90 }
  if (_ppAreaMode === 'rect') _mouseTool.rectangle(opts)
  else _mouseTool.polygon(opts)
  _ppOnDraw = (e) => {
    _mouseTool.off('draw', _ppOnDraw); _ppOnDraw = null
    _mouseTool.close(false)
    const b = e.obj.getBounds()
    _ppBounds = {
      north: b.getNorthEast().getLat(), south: b.getSouthWest().getLat(),
      east:  b.getNorthEast().getLng(), west:  b.getSouthWest().getLng(),
    }
    if (_ppDrawShape) _map.remove(_ppDrawShape)
    _ppDrawShape = e.obj
    const el = document.getElementById('ma-pp-bounds-text')
    if (el) el.textContent = `N${_ppBounds.north.toFixed(4)} S${_ppBounds.south.toFixed(4)} E${_ppBounds.east.toFixed(4)} W${_ppBounds.west.toFixed(4)}`
    const bi = document.getElementById('ma-pp-bounds-info')
    if (bi) bi.classList.add('show')
    const hint = document.getElementById('ma-pp-draw-hint')
    if (hint) hint.style.display = 'none'
  }
  _mouseTool.on('draw', _ppOnDraw)
}

function _ppClearDraw() {
  _ppBounds = null
  if (_ppDrawShape && _map) { _map.remove(_ppDrawShape); _ppDrawShape = null }
  if (_ppOnDraw && _mouseTool) { _mouseTool.off('draw', _ppOnDraw); _ppOnDraw = null }
  const bi = document.getElementById('ma-pp-bounds-info')
  if (bi) bi.classList.remove('show')
  if (_ppAreaMode !== 'viewport') {
    const hint = document.getElementById('ma-pp-draw-hint')
    if (hint) { hint.style.display = ''; hint.textContent = _ppAreaMode === 'rect' ? '在地图上拖拽框选目标区域' : '在地图上点击绘制多边形（双击结束）' }
    _ppStartDraw()
  }
}

async function _ppStartExtract() {
  if (!_map) { _ppStatus('地图未就绪', true); return }
  const activeTypeBtn = document.querySelector('#ma-pro-panel .ma-pp-type-btn.active')
  const appType       = activeTypeBtn ? activeTypeBtn.dataset.type : 'building'
  const textPrompt    = appType === 'custom' ? (document.getElementById('ma-pp-custom-input') || {}).value?.trim() || '' : ''
  if (appType === 'custom' && !textPrompt) { _ppStatus('请输入自定义目标描述', true); return }
  if (_ppAreaMode !== 'viewport' && !_ppBounds) { _ppStatus('请先框选范围', true); return }

  const startBtn = document.getElementById('ma-pp-start-btn')
  const resultEl = document.getElementById('ma-pp-result')
  const logEl    = document.getElementById('ma-pp-log')
  if (startBtn) startBtn.disabled = true
  if (resultEl) resultEl.classList.remove('show')
  if (logEl)    logEl.innerHTML   = ''
  _ppStatus('⏳ 提交任务…')

  const center = _map.getCenter()
  const body   = {
    app_type: appType, bounds_mode: _ppAreaMode === 'viewport' ? 'viewport' : 'custom',
    lat: center.getLat(), lng: center.getLng(), zoom: Math.round(_map.getZoom()),
    text_prompt: textPrompt, active_wl: _activeWLLayers(),
  }
  if (_ppAreaMode !== 'viewport' && _ppBounds) Object.assign(body, _ppBounds)

  try {
    const resp = await fetch(`${BASE}/api/aiearth/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const { session_id } = await resp.json()
    if (_ppEs) _ppEs.close()
    _ppEs = new EventSource(`${BASE}/api/stream/${session_id}`)
    _ppEs.onmessage = _handlePpEvent
    _ppEs.onerror = () => { _ppLog('连接中断', 'err'); _ppDone() }
  } catch (err) {
    _ppLog('启动失败：' + err.message, 'err')
    _ppStatus('启动失败', true)
    _ppDone()
  }
}

function _handlePpEvent(e) {
  const data = JSON.parse(e.data)
  switch (data.type) {
    case 'log':
      _ppLog(data.message); _ppStatus(data.message)
      break
    case 'aie_result': {
      const typeName = { building: '建筑物', road: '路网', dam: '拦河坝', custom: '目标' }[data.app_type] || data.app_type
      const color = _PP_TYPE_COLOR[data.app_type] || '#58a6ff'
      ;(data.features || []).forEach(f => {
        if (!f.geometry) return
        const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates
          : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat(1) : null
        if (!rings) return
        rings.forEach(ring => {
          const poly = new AMap.Polygon({
            path: ring.map(([lng, lat]) => [lng, lat]),
            strokeColor: color, strokeWeight: 2, fillColor: color, fillOpacity: 0.15, zIndex: 50,
          })
          _map.add(poly); _ppOverlays.push(poly)
        })
      })
      _ppResult(`识别完成，共发现 ${data.count} 个${typeName}要素`)
      _ppStatus('✅ 提取完成')
      break
    }
    case 'error':
      _ppLog('错误：' + data.message, 'err')
      _ppStatus('❌ ' + data.message, true)
      _ppDone()
      if (_ppEs) { _ppEs.close(); _ppEs = null }
      break
    case 'done':
      _ppDone()
      if (_ppEs) { _ppEs.close(); _ppEs = null }
      break
  }
}

function _ppClearAll() {
  _ppOverlays.forEach(p => _map && _map.remove(p)); _ppOverlays = []
  const logEl   = document.getElementById('ma-pp-log')
  const resultEl= document.getElementById('ma-pp-result')
  const statusEl= document.getElementById('ma-pp-status')
  if (logEl)    logEl.innerHTML   = ''
  if (resultEl) resultEl.classList.remove('show')
  if (statusEl) statusEl.textContent = ''
  if (_ppEs) { _ppEs.close(); _ppEs = null }
  _ppDone()
}

function _ppLog(msg, cls) {
  const log = document.getElementById('ma-pp-log')
  if (!log) return
  const row = document.createElement('div')
  row.className = 'ma-pp-log-row'
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  row.innerHTML = `<span class="ma-pp-log-time">${time}</span><span class="ma-pp-log-msg ${cls||''}">${_escHtml(msg)}</span>`
  log.appendChild(row); log.scrollTop = log.scrollHeight
}

function _ppStatus(msg, isErr) {
  const el = document.getElementById('ma-pp-status')
  if (el) { el.textContent = msg; el.style.color = isErr ? '#f85149' : '#f0883e' }
}

function _ppResult(msg) {
  const el   = document.getElementById('ma-pp-result-text')
  const wrap = document.getElementById('ma-pp-result')
  if (el)   el.textContent = msg
  if (wrap) wrap.classList.add('show')
}

function _ppDone() {
  const btn = document.getElementById('ma-pp-start-btn')
  if (btn) btn.disabled = false
}

// ── AI 对话 ─────────────────────────────────────────────────────────────────────
function _initChat() {
  let chatHistory = []
  let chatBusy    = false

  const fab   = document.getElementById('ma-chat-fab')
  const panel = document.getElementById('ma-chat-panel')
  const msgs  = document.getElementById('ma-cp-msgs')
  const input = document.getElementById('ma-cp-input')
  const send  = document.getElementById('ma-cp-send')
  if (!fab || !panel) return

  fab.addEventListener('click', () => panel.classList.toggle('open'))
  document.getElementById('ma-cp-clear').addEventListener('click', () => {
    chatHistory = []; msgs.innerHTML = ''
  })

  function addMsg(role, text, loading) {
    const div = document.createElement('div')
    div.className = 'ma-cm ' + role + (loading ? ' loading' : '')
    div.textContent = text
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight
    return div
  }

  function addAnnotatedMsg(text, imgB64) {
    const div = document.createElement('div')
    div.className = 'ma-cm ai'
    if (text) { const p = document.createElement('div'); p.textContent = text; div.appendChild(p) }
    if (imgB64) {
      const img = document.createElement('img')
      img.src = 'data:image/png;base64,' + imgB64
      img.style.cssText = 'width:100%;border-radius:6px;margin-top:6px;cursor:pointer'
      img.addEventListener('click', () => {
        const w = window.open(); w.document.write(`<img src="${img.src}" style="max-width:100%">`)
      })
      div.appendChild(img)
    }
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight
    return div
  }

  async function doChat() {
    if (chatBusy) return
    const text = input.value.trim()
    if (!text || !_map) return
    input.value = ''
    chatHistory.push({ role: 'user', content: text })
    addMsg('user', text)
    chatBusy = true; send.disabled = true; input.disabled = true
    const loader = addMsg('ai', '正在截图并分析，请稍候…', true)
    const center = _map.getCenter()

    // 3D 模式：捕获 WDP 场景截图
    let screenshotB64 = ''
    let sceneType = getMapMode()
    if (sceneType === '3d') {
      const snap = await _capture3DScene()
      if (snap) screenshotB64 = snap.image
    }

    try {
      const resp = await fetch(`${BASE}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory,
          lat:  center.getLat(), lng:  center.getLng(),
          zoom: Math.round(_map.getZoom()),
          region: (document.getElementById('ma-info-region') || {}).textContent || '',
          nearby_pois: _nearbyPois || getNearbyPois(),
          active_wl: _activeWLLayers(),
          traverse_context: _traverseContext,
          screenshot_b64: screenshotB64,
          scene_type: sceneType,
        }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const reply = (data.reply || '').replace(/\*\*(.*?)\*\*/gs, '$1').replace(/\*(.*?)\*/gs, '$1').replace(/^#+\s*/gm, '').replace(/`([^`]*)`/g, '$1')
      if (data.annotated_image) { loader.remove(); addAnnotatedMsg(reply, data.annotated_image) }
      else { loader.textContent = reply; loader.classList.remove('loading') }
      chatHistory.push({ role: 'assistant', content: data.reply || '' })
    } catch (err) {
      loader.textContent = '请求失败：' + err.message
      loader.classList.remove('loading')
      chatHistory.pop()
    } finally {
      chatBusy = false; send.disabled = false; input.disabled = false; input.focus()
    }
  }

  send.addEventListener('click', doChat)
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doChat() } })
}

// ── 初始化 MouseTool & Geocoder ────────────────────────────────────────────────
function _initPlugins() {
  if (!window.AMap || !_map) return
  AMap.plugin(['AMap.MouseTool', 'AMap.Geocoder', 'AMap.AutoComplete'], () => {
    if (!_mouseTool) {
      _mouseTool = new AMap.MouseTool(_map)
      _mouseTool.on('draw', () => {
        document.querySelectorAll('.ma-measure-btn').forEach(b => b.classList.remove('active'))
        _measureMode = null
      })
    }
    if (!_geocoder)       _geocoder       = new AMap.Geocoder({ radius: 3000 })
    if (!_searchGeocoder) _searchGeocoder = new AMap.Geocoder({ city: '全国' })
    if (!_autoComplete)   _autoComplete   = new AMap.AutoComplete({ city: '全国' })
  })
}

// ── CSS ─────────────────────────────────────────────────────────────────────────
const _CSS = `
/* ── Map Analysis Panel shared base ── */
#ma-sidebar, #ma-pro-panel {
  position: absolute;
  top: -10px; left: -10px; right: -10px; bottom: -10px;
  background: #161b22;
  display: none;
  flex-direction: column;
  overflow-y: auto; overflow-x: hidden;
  z-index: 10;
  font-family: -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
  color: #c9d1d9;
  font-size: 13px;
  box-sizing: border-box;
}
#ma-sidebar { border-right: 1px solid #30363d; }
#ma-pro-panel { border-left: 1px solid #30363d; }

/* section blocks */
.ma-s-header, .ma-s-control, .ma-s-search, .ma-s-info,
.ma-s-measure, .ma-s-traverse, .ma-s-analyze, .ma-s-preview,
.ma-pp-header, .ma-pp-section { padding: 10px 14px; border-bottom: 1px solid #30363d; flex-shrink: 0; box-sizing: border-box; }

.ma-s-header { padding: 14px 14px 10px; }
.ma-s-title { font-size: 14px; font-weight: 700; color: #58a6ff; display: flex; align-items: center; gap: 6px; }
.ma-s-subtitle { font-size: 10px; color: #8b949e; margin-top: 2px; }
.ma-input-label { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 5px; }

/* inputs & buttons */
.ma-text-input {
  width: 100%; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d;
  border-radius: 6px; color: #e6edf3; font-size: 12px; outline: none;
  transition: border-color 0.15s; box-sizing: border-box;
}
.ma-text-input:focus { border-color: #58a6ff; }
.ma-text-input::placeholder { color: #484f58; }
.ma-text-input.err { border-color: #f85149; }
.ma-btn-row { display: flex; gap: 6px; margin-top: 8px; }
.ma-btn {
  flex: 1; padding: 8px 0; border: none; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; color: #fff;
}
.ma-btn:hover { opacity: 0.82; }
.ma-btn:disabled { opacity: 0.4; cursor: not-allowed; }
#ma-start-btn { background: #1f6feb; }
#ma-stop-btn  { background: #b91c1c; display: none; }
#ma-analyze-btn { background: #238636; }
#ma-tv-start-btn { background: #1f6feb; flex: 1; padding: 7px 0; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; color: #fff; }
#ma-tv-stop-btn  { padding: 7px 10px; background: #b91c1c; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; display: none; color: #fff; }

/* viewport info */
.ma-s-info-title { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 5px; }
.ma-info-meta { display: flex; align-items: center; gap: 0; margin-bottom: 4px; }
.ma-info-chip { font-size: 11px; color: #8b949e; display: flex; align-items: baseline; gap: 4px; }
.ma-info-chip + .ma-info-chip { margin-left: 16px; }
.ma-info-chip-val { color: #58a6ff; font-weight: 700; font-size: 12px; font-family: 'SFMono-Regular',Consolas,monospace; }
.ma-info-region-row { font-size: 10px; color: #8b949e; margin-bottom: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ma-info-region-row span { color: #c9d1d9; }
.ma-corners-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 5px; }
.ma-corner-item { display: flex; gap: 3px; align-items: flex-start; }
.ma-corner-dir { font-size: 10px; color: #3fb950; font-weight: 700; width: 16px; flex-shrink: 0; margin-top: 1px; }
.ma-corner-val { font-size: 10px; color: #8b949e; font-family: 'SFMono-Regular',Consolas,monospace; line-height: 1.4; white-space: pre; }

/* status & log */
#ma-status-bar { padding: 5px 14px; font-size: 11px; color: #8b949e; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.ma-dot { width: 7px; height: 7px; border-radius: 50%; background: #484f58; flex-shrink: 0; }
.ma-dot.running { background: #3fb950; animation: ma-pulse 1.4s ease-in-out infinite; }
.ma-dot.error   { background: #f85149; }
@keyframes ma-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
#ma-log { height: 110px; flex-shrink: 0; overflow-y: auto; padding: 6px 14px; font-size: 11px; line-height: 1.65; font-family: 'SFMono-Regular',Consolas,monospace; }
#ma-log::-webkit-scrollbar { width: 4px; }
#ma-log::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; }
.ma-log-item { display: flex; gap: 6px; padding: 1px 0; }
.ma-log-time { color: #484f58; flex-shrink: 0; }
.ma-log-msg  { color: #8b949e; word-break: break-all; }
.ma-log-msg.action { color: #58a6ff; }
.ma-log-msg.done   { color: #3fb950; }
.ma-log-msg.err    { color: #f85149; }

/* preview */
#ma-preview-wrap { position: relative; border-radius: 6px; overflow: hidden; border: 1px solid #30363d; background: #0d1117; min-height: 40px; display: flex; align-items: center; justify-content: center; margin-top: 6px; }
#ma-preview-img { width: 100%; display: none; }
#ma-preview-placeholder { font-size: 10px; color: #484f58; padding: 10px; }
#ma-step-badge { position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.65); color: #58a6ff; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 20px; display: none; }

/* search dropdown */
#ma-search-dropdown {
  position: fixed; background: #1c2128; border: 1px solid #30363d; border-top: none;
  border-radius: 0 0 6px 6px; z-index: 9999; max-height: 200px; overflow-y: auto; display: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}
#ma-search-dropdown.open { display: block; }
.ma-sdrop-sep { padding: 4px 10px; font-size: 10px; color: #484f58; text-transform: uppercase; letter-spacing: 0.6px; display: flex; justify-content: space-between; border-bottom: 1px solid #21262d; position: sticky; top: 0; background: #1c2128; }
.ma-sdrop-sep button { background: none; border: none; color: #f85149; font-size: 10px; cursor: pointer; }
.ma-sdrop-item { padding: 6px 10px; font-size: 12px; cursor: pointer; color: #c9d1d9; display: flex; align-items: flex-start; gap: 6px; border-bottom: 1px solid #21262d; }
.ma-sdrop-item:hover { background: #21262d; }
.ma-sdrop-icon { color: #8b949e; flex-shrink: 0; font-size: 11px; }
#ma-search-wrap { display: flex; gap: 6px; }
#ma-search-btn { padding: 8px 12px; background: #238636; border: none; border-radius: 6px; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
#ma-search-btn:hover { opacity: 0.85; }
#ma-search-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* measure */
.ma-measure-btns { display: flex; gap: 6px; }
.ma-measure-btn { flex: 1; padding: 7px 0; border: 1px solid #30363d; border-radius: 6px; background: #0d1117; color: #c9d1d9; font-size: 12px; cursor: pointer; transition: all 0.15s; }
.ma-measure-btn:hover { border-color: #58a6ff; color: #58a6ff; }
.ma-measure-btn.active { border-color: #3fb950; color: #3fb950; background: #0f2a17; }
#ma-measure-clear { width: 100%; margin-top: 5px; padding: 6px 0; border: 1px solid #30363d; border-radius: 6px; background: transparent; color: #8b949e; font-size: 12px; cursor: pointer; }
#ma-measure-clear:hover { border-color: #f85149; color: #f85149; }

/* analyze result */
#ma-analyze-result { margin-top: 6px; padding: 7px 9px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; font-size: 12px; color: #3fb950; line-height: 1.6; display: none; white-space: pre-wrap; word-break: break-all; }

/* water level */
.ma-wl-section-title { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 5px; display: flex; align-items: center; justify-content: space-between; }
#ma-wl-all-btn { background: none; border: none; color: #8b949e; font-size: 10px; cursor: pointer; }
#ma-wl-all-btn:hover { color: #58a6ff; }
#ma-wl-items { padding: 2px 0; }
.ma-wl-item { display: flex; align-items: center; gap: 7px; padding: 5px 14px; cursor: pointer; }
.ma-wl-item:hover { background: #21262d; }
.ma-wl-item input[type=checkbox] { width: 13px; height: 13px; cursor: pointer; accent-color: #58a6ff; }
.ma-wl-dash { width: 20px; height: 3px; border-radius: 2px; flex-shrink: 0; }
.ma-wl-lbl { font-size: 12px; flex: 1; font-family: 'SFMono-Regular',Consolas,monospace; }
.ma-wl-st { font-size: 9px; color: #484f58; min-width: 12px; text-align: right; }
.ma-wl-st.ok { color: #3fb950; }
.ma-wl-st.ld { color: #58a6ff; }
.ma-wl-st.er { color: #f85149; }
#ma-wl-fly { display: block; width: 100%; padding: 7px 0; background: #1a3a5c; border: none; border-top: 1px solid #30363d; color: #58a6ff; font-size: 11px; cursor: pointer; transition: background 0.12s; }
#ma-wl-fly:hover { background: #1f6feb; color: #fff; }

/* traverse */
.ma-traverse-row { display: flex; gap: 6px; margin-bottom: 7px; }
#ma-tv-draw-btn { flex: 1; padding: 7px 0; border: 1px solid #30363d; border-radius: 6px; background: #0d1117; color: #c9d1d9; font-size: 12px; cursor: pointer; transition: all 0.15s; }
#ma-tv-draw-btn:hover  { border-color: #58a6ff; color: #58a6ff; }
#ma-tv-draw-btn.active { border-color: #3fb950; color: #3fb950; background: #0f2a17; }
#ma-tv-clear-btn { padding: 7px 10px; border: 1px solid #30363d; border-radius: 6px; background: #0d1117; color: #8b949e; font-size: 12px; cursor: pointer; }
#ma-tv-clear-btn:hover { border-color: #f85149; color: #f85149; }
#ma-tv-bounds-info { font-size: 10px; color: #484f58; font-family: 'SFMono-Regular',Consolas,monospace; margin-bottom: 6px; line-height: 1.5; display: none; }
#ma-tv-bounds-info.show { display: block; }
.ma-tv-row { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
.ma-tv-row-lbl { font-size: 11px; color: #8b949e; flex-shrink: 0; }
.ma-tv-sel { flex: 1; padding: 5px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; font-size: 12px; outline: none; }
#ma-tv-tile-est { font-size: 10px; color: #484f58; flex-shrink: 0; }
#ma-tv-wl-hint { font-size: 10px; color: #d29922; background: rgba(210,153,34,0.08); border: 1px solid rgba(210,153,34,0.25); border-radius: 4px; padding: 4px 7px; margin-bottom: 6px; line-height: 1.4; }
.ma-traverse-btns { display: flex; gap: 6px; }
#ma-tv-progress-bar { height: 3px; background: #30363d; border-radius: 2px; margin-top: 6px; display: none; overflow: hidden; }
#ma-tv-progress-fill { height: 100%; background: #1f6feb; width: 0%; transition: width 0.3s; }
#ma-tv-progress-txt { font-size: 10px; color: #8b949e; margin-top: 3px; display: none; font-family: 'SFMono-Regular',Consolas,monospace; }
#ma-tv-reopen-btn { display: none; width: 100%; margin-top: 5px; padding: 6px 0; border: 1px solid #30363d; border-radius: 6px; background: transparent; color: #8b949e; font-size: 11px; cursor: pointer; }
#ma-tv-reopen-btn:hover { border-color: #58a6ff; color: #58a6ff; }

/* traverse modal */
#ma-tv-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 10000; display: none; align-items: center; justify-content: center; }
#ma-tv-modal.open { display: flex; }
#ma-tv-modal-box { background: #161b22; border: 1px solid #30363d; border-radius: 12px; width: 520px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,0.7); }
#ma-tv-modal-hdr { padding: 12px 16px; background: #21262d; border-bottom: 1px solid #30363d; border-radius: 12px 12px 0 0; display: flex; align-items: center; justify-content: space-between; cursor: move; user-select: none; }
#ma-tv-modal-title { font-size: 14px; font-weight: 700; color: #58a6ff; }
#ma-tv-modal-close { background: none; border: none; color: #8b949e; font-size: 16px; cursor: pointer; }
#ma-tv-modal-close:hover { color: #f85149; }
#ma-tv-modal-body { flex: 1; overflow-y: auto; padding: 14px 16px; font-size: 12px; color: #c9d1d9; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.ma-tv-finding-item { padding: 5px 7px; margin-bottom: 3px; background: #0d1117; border: 1px solid #30363d; border-radius: 5px; cursor: pointer; display: flex; align-items: flex-start; gap: 7px; }
.ma-tv-finding-item:hover { border-color: #58a6ff; }

/* chat */
#ma-chat-fab { position: fixed; right: 308px; bottom: 28px; width: 46px; height: 46px; border-radius: 50%; background: #1f6feb; color: #fff; font-size: 20px; border: none; cursor: pointer; z-index: 500; box-shadow: 0 4px 14px rgba(0,0,0,0.45); display: none; align-items: center; justify-content: center; transition: opacity 0.15s; }
#ma-chat-fab:hover { opacity: 0.85; }
#ma-chat-panel { position: fixed; right: 300px; bottom: 84px; width: 340px; height: 460px; background: #161b22; border: 1px solid #30363d; border-radius: 12px; z-index: 500; display: none; flex-direction: column; box-shadow: 0 8px 28px rgba(0,0,0,0.55); }
#ma-chat-panel.open { display: flex; }
#ma-cp-header { padding: 11px 13px; background: #21262d; border-bottom: 1px solid #30363d; border-radius: 12px 12px 0 0; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
#ma-cp-title { font-size: 13px; font-weight: 700; color: #58a6ff; }
#ma-cp-subtitle { font-size: 10px; color: #8b949e; margin-top: 1px; }
#ma-cp-clear { background: none; border: none; color: #8b949e; font-size: 11px; cursor: pointer; padding: 3px 7px; border-radius: 4px; }
#ma-cp-clear:hover { color: #f85149; }
#ma-cp-msgs { flex: 1; overflow-y: auto; padding: 10px 10px 5px; display: flex; flex-direction: column; gap: 8px; }
.ma-cm { max-width: 90%; padding: 8px 10px; border-radius: 10px; font-size: 12px; line-height: 1.6; word-break: break-word; white-space: pre-wrap; }
.ma-cm.user { background: #1f6feb; color: #fff; align-self: flex-end; }
.ma-cm.ai   { background: #21262d; color: #c9d1d9; align-self: flex-start; border: 1px solid #30363d; }
.ma-cm.ai.loading { color: #8b949e; font-style: italic; }
#ma-cp-foot { padding: 9px 10px; border-top: 1px solid #30363d; display: flex; gap: 7px; flex-shrink: 0; }
#ma-cp-input { flex: 1; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 7px; color: #e6edf3; font-size: 12px; outline: none; }
#ma-cp-input:focus { border-color: #58a6ff; }
#ma-cp-input:disabled { opacity: 0.5; }
#ma-cp-send { padding: 8px 12px; background: #1f6feb; color: #fff; border: none; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer; flex-shrink: 0; }
#ma-cp-send:disabled { opacity: 0.4; cursor: not-allowed; }

/* pro panel */
.ma-pp-header { padding: 13px 14px 10px; }
.ma-pp-title { font-size: 13px; font-weight: 700; color: #f0883e; display: flex; align-items: center; gap: 5px; }
.ma-pp-subtitle { font-size: 10px; color: #8b949e; margin-top: 2px; }
.ma-pp-sec-label { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 7px; }
.ma-pp-tabs { display: flex; gap: 4px; }
.ma-pp-tab { flex: 1; padding: 5px 0; background: #0d1117; border: 1px solid #30363d; border-radius: 5px; color: #8b949e; font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
.ma-pp-tab:hover { border-color: #58a6ff; color: #58a6ff; }
.ma-pp-tab.active { border-color: #f0883e; color: #f0883e; background: rgba(240,136,62,0.08); }
.ma-pp-draw-hint { margin-top: 7px; padding: 5px 8px; background: rgba(88,166,255,0.08); border: 1px solid rgba(88,166,255,0.25); border-radius: 4px; font-size: 11px; color: #58a6ff; line-height: 1.4; }
.ma-pp-bounds-info { margin-top: 5px; display: none; align-items: center; gap: 5px; }
.ma-pp-bounds-info.show { display: flex; }
#ma-pp-bounds-text { flex: 1; font-size: 10px; color: #8b949e; font-family: 'SFMono-Regular',Consolas,monospace; word-break: break-all; }
#ma-pp-clear-draw { padding: 3px 6px; border: 1px solid #30363d; border-radius: 4px; background: transparent; color: #8b949e; font-size: 11px; cursor: pointer; }
#ma-pp-clear-draw:hover { border-color: #f85149; color: #f85149; }
.ma-pp-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.ma-pp-type-btn { padding: 9px 5px; background: #0d1117; border: 1px solid #30363d; border-radius: 7px; cursor: pointer; text-align: center; transition: all 0.15s; display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; color: #8b949e; }
.ma-pp-type-btn:hover { border-color: #58a6ff; color: #c9d1d9; }
.ma-pp-type-btn.active { border-color: #f0883e; color: #f0883e; background: rgba(240,136,62,0.08); }
.ma-pp-type-icon { font-size: 16px; }
#ma-pp-custom-wrap { margin-top: 7px; display: none; }
#ma-pp-custom-wrap.show { display: block; }
.ma-pp-actions { display: flex; gap: 5px; }
#ma-pp-start-btn { flex: 1; padding: 8px 0; border: none; border-radius: 5px; background: #9a3e00; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
#ma-pp-start-btn:hover:not(:disabled) { opacity: 0.85; }
#ma-pp-start-btn:disabled { opacity: 0.4; cursor: not-allowed; }
#ma-pp-clear-btn { padding: 8px 10px; background: transparent; border: 1px solid #30363d; border-radius: 5px; color: #8b949e; font-size: 12px; cursor: pointer; }
#ma-pp-clear-btn:hover { border-color: #f85149; color: #f85149; }
#ma-pp-status { padding: 5px 14px 3px; flex-shrink: 0; font-size: 11px; color: #f0883e; min-height: 18px; border-bottom: 1px solid #30363d; }
#ma-pp-log { height: 140px; overflow-y: auto; padding: 4px 14px 7px; font-size: 11px; line-height: 1.65; font-family: 'SFMono-Regular',Consolas,monospace; border-bottom: 1px solid #30363d; }
.ma-pp-log-row { display: flex; gap: 5px; padding: 1px 0; }
.ma-pp-log-time { color: #484f58; flex-shrink: 0; }
.ma-pp-log-msg  { color: #8b949e; word-break: break-all; }
.ma-pp-log-msg.done { color: #3fb950; }
.ma-pp-log-msg.err  { color: #f85149; }
#ma-pp-result { padding: 9px 14px; flex-shrink: 0; display: none; }
#ma-pp-result.show { display: block; }
.ma-pp-result-lbl { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
#ma-pp-result-text { font-size: 12px; color: #3fb950; line-height: 1.6; }
`

// ── HTML ─────────────────────────────────────────────────────────────────────────
const _SIDEBAR_HTML = `
<div id="ma-sidebar">
  <div class="ma-s-header">
    <div class="ma-s-title">🛰️ 地图智能分析</div>
    <div class="ma-s-subtitle">密云水库流域 · 高德卫星影像</div>
  </div>

  <div class="ma-s-search" style="padding:10px 14px;border-bottom:1px solid #30363d;flex-shrink:0">
    <div class="ma-input-label">🔍 搜索定位</div>
    <div id="ma-search-wrap">
      <input id="ma-search-input" class="ma-text-input" type="text" placeholder="输入地名、地址…" autocomplete="off" style="flex:1">
      <button id="ma-search-btn">定位</button>
    </div>
  </div>

  <div class="ma-s-control">
    <div class="ma-input-label">分析目标</div>
    <input id="ma-target-input" class="ma-text-input" type="text" placeholder="例如：违规建筑、临时搭建物…" autocomplete="off">
    <div class="ma-btn-row">
      <button id="ma-start-btn"  class="ma-btn">▶ 启动分析</button>
      <button id="ma-stop-btn"   class="ma-btn">■ 停止</button>
    </div>
    <button id="ma-clear-markers-btn" style="display:none;width:100%;margin-top:6px;padding:7px 0;background:transparent;border:1px solid #30363d;border-radius:6px;color:#8b949e;font-size:12px;cursor:pointer;transition:all 0.15s">✕ 清除标注</button>
  </div>

  <div class="ma-s-info" style="padding:8px 14px 9px;border-bottom:1px solid #30363d;background:#0d1117;flex-shrink:0">
    <div class="ma-s-info-title">视口信息</div>
    <div class="ma-info-meta">
      <div class="ma-info-chip">缩放 <span class="ma-info-chip-val" id="ma-info-zoom">—</span></div>
      <div class="ma-info-chip">瓦片 <span class="ma-info-chip-val" id="ma-info-tiles">—</span></div>
    </div>
    <div class="ma-info-region-row">区域 <span id="ma-info-region">—</span></div>
    <div class="ma-corners-wrap">
      <div class="ma-corner-item"><span class="ma-corner-dir">NW</span><span class="ma-corner-val" id="ma-ic-nw">—</span></div>
      <div class="ma-corner-item"><span class="ma-corner-dir">NE</span><span class="ma-corner-val" id="ma-ic-ne">—</span></div>
      <div class="ma-corner-item"><span class="ma-corner-dir">SW</span><span class="ma-corner-val" id="ma-ic-sw">—</span></div>
      <div class="ma-corner-item"><span class="ma-corner-dir">SE</span><span class="ma-corner-val" id="ma-ic-se">—</span></div>
    </div>
  </div>

  <div class="ma-s-measure">
    <div class="ma-input-label" style="margin-bottom:6px">精准测量</div>
    <div class="ma-measure-btns">
      <button class="ma-measure-btn" id="ma-btn-dist">📏 测距</button>
      <button class="ma-measure-btn" id="ma-btn-area">⬡ 测面积</button>
    </div>
    <button id="ma-measure-clear">✕ 清除测量</button>
  </div>

  <div class="ma-s-analyze">
    <div class="ma-input-label" style="margin-bottom:6px">视野分析</div>
    <input id="ma-analyze-input" class="ma-text-input" type="text" placeholder="例：主干道多长？绿地面积大吗？" autocomplete="off">
    <div class="ma-btn-row"><button id="ma-analyze-btn" class="ma-btn" style="background:#238636">⬡ 分析当前视野</button></div>
    <div id="ma-analyze-result"></div>
  </div>

  <div id="ma-status-bar">
    <div class="ma-dot" id="ma-status-dot"></div>
    <span id="ma-status-text">就绪 — 在地图上定位后点击启动</span>
  </div>

  <div id="ma-log"></div>

  <div class="ma-s-preview">
    <div class="ma-input-label" style="margin-bottom:5px">最新截图</div>
    <div id="ma-preview-wrap">
      <span id="ma-preview-placeholder">截图将在分析时显示</span>
      <img id="ma-preview-img" alt="map screenshot">
      <span id="ma-step-badge"></span>
    </div>
  </div>
</div>
`

const _PRO_HTML = `
<div id="ma-pro-panel">
  <div class="ma-pp-header">
    <div class="ma-pp-title">🛰️ 专业模式</div>
    <div class="ma-pp-subtitle">AI Earth 遥感精准提取 · 地物智能识别</div>
  </div>

  <div class="ma-pp-section">
    <div class="ma-pp-sec-label">提取范围</div>
    <div class="ma-pp-tabs">
      <button class="ma-pp-tab active" data-area="viewport">当前视野</button>
      <button class="ma-pp-tab" data-area="rect">框选范围</button>
      <button class="ma-pp-tab" data-area="poly">绘制区域</button>
    </div>
    <div id="ma-pp-draw-hint" class="ma-pp-draw-hint" style="display:none">在地图上拖拽框选目标区域</div>
    <div id="ma-pp-bounds-info" class="ma-pp-bounds-info">
      <span id="ma-pp-bounds-text"></span>
      <button id="ma-pp-clear-draw">✕</button>
    </div>
  </div>

  <div class="ma-pp-section">
    <div class="ma-pp-sec-label">提取类型</div>
    <div class="ma-pp-type-grid">
      <div class="ma-pp-type-btn active" data-type="building"><span class="ma-pp-type-icon">🏘️</span><span>建筑物</span></div>
      <div class="ma-pp-type-btn" data-type="road"><span class="ma-pp-type-icon">🛣️</span><span>路网地物</span></div>
      <div class="ma-pp-type-btn" data-type="dam"><span class="ma-pp-type-icon">💧</span><span>拦河坝</span></div>
      <div class="ma-pp-type-btn" data-type="custom"><span class="ma-pp-type-icon">✏️</span><span>自定义目标</span></div>
    </div>
    <div id="ma-pp-custom-wrap">
      <input id="ma-pp-custom-input" class="ma-text-input" type="text" placeholder="输入目标，如：光伏板、储水池…" autocomplete="off">
    </div>
  </div>

  <div class="ma-pp-section">
    <div class="ma-pp-actions">
      <button id="ma-pp-start-btn">▶ 开始提取</button>
      <button id="ma-pp-clear-btn">✕ 清除</button>
    </div>
  </div>

  <div id="ma-pp-status"></div>
  <div style="padding:5px 14px 3px;font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.8px;flex-shrink:0">运行日志</div>
  <div id="ma-pp-log"></div>
  <div id="ma-pp-result">
    <div class="ma-pp-result-lbl">提取结果</div>
    <div id="ma-pp-result-text"></div>
  </div>

  <div style="padding:8px 14px 10px;border-top:1px solid #30363d;flex-shrink:0">
    <div class="ma-pp-sec-label" style="margin-bottom:6px">🗺️ 区域遍历分析</div>
    <div class="ma-traverse-row">
      <button id="ma-tv-draw-btn">✏️ 框选区域</button>
      <button id="ma-tv-clear-btn">✕</button>
    </div>
    <div id="ma-tv-bounds-info">
      <span>N</span> <span id="ma-tv-n">—</span>  <span>S</span> <span id="ma-tv-s">—</span>
      <span>E</span> <span id="ma-tv-e">—</span>  <span>W</span> <span id="ma-tv-w">—</span>
    </div>
    <div class="ma-tv-row">
      <span class="ma-tv-row-lbl">缩放</span>
      <select id="ma-tv-zoom" class="ma-tv-sel">
        <option value="15">15 — 约 940m/格</option>
        <option value="16">16 — 约 470m/格</option>
        <option value="17" selected>17 — 约 235m/格</option>
        <option value="18">18 — 约 118m/格</option>
      </select>
      <span id="ma-tv-tile-est">—格</span>
    </div>
    <div class="ma-tv-row">
      <span class="ma-tv-row-lbl">水位过滤</span>
      <select id="ma-tv-wl-filter" class="ma-tv-sel">
        <option value="">不限制</option>
        <option value="155">155.0 m 以内</option>
        <option value="156">156.0 m 以内</option>
        <option value="157">157.0 m 以内</option>
        <option value="157d5">157.5 m 以内</option>
        <option value="158d5">158.5 m 以内</option>
        <option value="160">160.0 m 以内</option>
      </select>
    </div>
    <div id="ma-tv-wl-hint" style="display:none">⚠ 指该水位线封闭多边形内部（水面覆盖范围）</div>
    <input id="ma-tv-prompt" class="ma-text-input" type="text" placeholder="识别目标，如：违规建筑…" autocomplete="off" style="margin-bottom:7px">
    <div class="ma-traverse-btns">
      <button id="ma-tv-start-btn">▶ 开始遍历</button>
      <button id="ma-tv-stop-btn">■ 停止</button>
    </div>
    <div id="ma-tv-progress-bar"><div id="ma-tv-progress-fill"></div></div>
    <div id="ma-tv-progress-txt"></div>
    <button id="ma-tv-reopen-btn">📊 查看上次报告</button>
  </div>

  <div style="padding:5px 14px 0;border-top:1px solid #30363d;flex-shrink:0">
    <div class="ma-wl-section-title">💧 水位线图层 <button id="ma-wl-all-btn">全选</button></div>
    <div id="ma-wl-items"></div>
    <button id="ma-wl-fly">📍 定位密云水库</button>
  </div>
</div>
`

const _MODAL_HTML = `
<div id="ma-tv-modal">
  <div id="ma-tv-modal-box">
    <div id="ma-tv-modal-hdr">
      <span id="ma-tv-modal-title">📊 遍历分析报告</span>
      <button id="ma-tv-modal-close">✕</button>
    </div>
    <div id="ma-tv-modal-body">
      <div id="ma-tv-modal-summary"></div>
      <div id="ma-tv-modal-findings"></div>
    </div>
  </div>
</div>
`

const _CHAT_HTML = `
<div id="ma-chat-panel">
  <div id="ma-cp-header">
    <div>
      <div id="ma-cp-title">💬 AI 地图对话</div>
      <div id="ma-cp-subtitle">自动截取当前视图供 AI 参考</div>
    </div>
    <button id="ma-cp-clear">清空</button>
  </div>
  <div id="ma-cp-msgs"></div>
  <div id="ma-cp-foot">
    <input id="ma-cp-input" type="text" placeholder="输入问题，Enter 发送…" autocomplete="off">
    <button id="ma-cp-send">发送</button>
  </div>
</div>
<button id="ma-chat-fab" title="AI 对话">💬</button>
<div id="ma-search-dropdown"></div>
`

// ── 事件绑定 ────────────────────────────────────────────────────────────────────
function _bindEvents() {
  // 检测分析
  document.getElementById('ma-start-btn').addEventListener('click', _startAnalysis)
  document.getElementById('ma-stop-btn').addEventListener('click',  _stopAnalysis)
  document.getElementById('ma-analyze-btn').addEventListener('click', _startAnalyze)
  document.getElementById('ma-clear-markers-btn').addEventListener('click', async () => {
    if (_map) { _map.remove(_markers); _map.remove(_overlays); _markers = []; _overlays = [] }
    if (_3dPois.length) {
      for (const p of _3dPois) { try { await p.Delete() } catch (e) {} }
      _3dPois = []
    }
    clearDetectionOverlays()
    await clearDemAnnotations()
    document.getElementById('ma-clear-markers-btn').style.display = 'none'
    _appendLog('标注已清除', '')
    _setStatus('标注已清除', '')
  })

  // 精准测量
  document.getElementById('ma-btn-dist').addEventListener('click',    () => _startMeasure('dist'))
  document.getElementById('ma-btn-area').addEventListener('click',    () => _startMeasure('area'))
  document.getElementById('ma-measure-clear').addEventListener('click', _clearMeasure)

  // 搜索
  const searchBtn   = document.getElementById('ma-search-btn')
  const searchInput = document.getElementById('ma-search-input')
  searchBtn.addEventListener('click', _doSearch)
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') _doSearch() })
  searchInput.addEventListener('focus',   function () { if (_searchHistory.length) _showHistoryDropdown(this.value.trim() || null) })
  searchInput.addEventListener('input',   function () {
    clearTimeout(_acTimer)
    const q = this.value.trim()
    if (!q) { _showHistoryDropdown(null); return }
    _acTimer = setTimeout(() => {
      if (_autoComplete) {
        _autoComplete.search(q, (status, result) => {
          if (status === 'complete' && result.tips && result.tips.length) {
            const dd = document.getElementById('ma-search-dropdown')
            _positionDropdown()
            dd.innerHTML = ''
            result.tips.slice(0, 8).forEach(tip => {
              if (!tip.name) return
              const item = document.createElement('div')
              item.className = 'ma-sdrop-item'
              item.innerHTML = '<span class="ma-sdrop-icon">📍</span>'
              const label = document.createElement('span')
              label.textContent = tip.name
              item.appendChild(label)
              item.addEventListener('click', () => {
                searchInput.value = tip.name
                _closeDropdown()
                _saveHistory(tip.name)
                if (tip.location && _map) {
                  _map.setZoomAndCenter(16, [tip.location.getLng(), tip.location.getLat()], false, 300)
                } else _doSearch()
              })
              dd.appendChild(item)
            })
            dd.classList.add('open')
          } else _showHistoryDropdown(q)
        })
      } else _showHistoryDropdown(q)
    }, 250)
  })
  document.addEventListener('click', e => {
    const wrap = document.getElementById('ma-search-wrap')
    const dd   = document.getElementById('ma-search-dropdown')
    if (!wrap.contains(e.target) && !dd.contains(e.target)) _closeDropdown()
  })

  // 遍历
  document.getElementById('ma-tv-draw-btn').addEventListener('click', _tvStartDraw)
  document.getElementById('ma-tv-clear-btn').addEventListener('click', _tvClear)
  document.getElementById('ma-tv-start-btn').addEventListener('click', _tvStart)
  document.getElementById('ma-tv-stop-btn').addEventListener('click',  _tvStop)
  document.getElementById('ma-tv-zoom').addEventListener('change', _tvUpdateTileEst)
  document.getElementById('ma-tv-wl-filter').addEventListener('change', function () {
    const hint = document.getElementById('ma-tv-wl-hint')
    if (hint) hint.style.display = this.value ? '' : 'none'
    _tvUpdateTileEst()
  })
  document.getElementById('ma-tv-reopen-btn').addEventListener('click', () => {
    if (_lastSummary) _renderSummary(_lastSummary)
  })

  // 遍历弹窗
  document.getElementById('ma-tv-modal-close').addEventListener('click', () => {
    document.getElementById('ma-tv-modal').classList.remove('open')
  })
  document.getElementById('ma-tv-modal').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('open')
  })

  // 遍历弹窗拖动
  ;(function () {
    const modal = document.getElementById('ma-tv-modal')
    const box   = document.getElementById('ma-tv-modal-box')
    const hdr   = document.getElementById('ma-tv-modal-hdr')
    let dragging = false, ox = 0, oy = 0
    hdr.addEventListener('mousedown', e => {
      if (e.target.id === 'ma-tv-modal-close') return
      dragging = true
      const r = box.getBoundingClientRect()
      box.style.position = 'fixed'; box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.margin = '0'
      modal.style.alignItems = 'flex-start'; modal.style.justifyContent = 'flex-start'
      ox = e.clientX - r.left; oy = e.clientY - r.top
      e.preventDefault()
    })
    document.addEventListener('mousemove', e => { if (dragging) { box.style.left = (e.clientX - ox) + 'px'; box.style.top = (e.clientY - oy) + 'px' } })
    document.addEventListener('mouseup', () => { dragging = false })
  })()

  // 专业模式 — 范围 tab
  document.querySelectorAll('#ma-pro-panel .ma-pp-tab').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#ma-pro-panel .ma-pp-tab').forEach(b => b.classList.remove('active'))
      this.classList.add('active')
      _ppAreaMode = this.dataset.area
      _ppUpdateAreaUI()
    })
  })

  // 专业模式 — 类型按钮
  document.querySelectorAll('#ma-pro-panel .ma-pp-type-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#ma-pro-panel .ma-pp-type-btn').forEach(b => b.classList.remove('active'))
      this.classList.add('active')
      const wrap = document.getElementById('ma-pp-custom-wrap')
      if (wrap) wrap.classList.toggle('show', this.dataset.type === 'custom')
    })
  })

  document.getElementById('ma-pp-clear-draw').addEventListener('click', _ppClearDraw)
  document.getElementById('ma-pp-start-btn').addEventListener('click', _ppStartExtract)
  document.getElementById('ma-pp-clear-btn').addEventListener('click', _ppClearAll)
}

// ── 公开接口 ────────────────────────────────────────────────────────────────────
export function showMapAnalysisTab() {
  // UI 变更先同步完成，不等模式切换
  document.querySelectorAll('.side-panel--left > .panel, .side-panel--right > .panel')
    .forEach(p => { p.style.display = 'none' })
  const lp = document.querySelector('.side-panel--left')
  const rp = document.querySelector('.side-panel--right')
  if (lp) lp.style.overflow = 'hidden'
  if (rp) rp.style.overflow = 'hidden'
  document.getElementById('ma-sidebar').style.display   = 'flex'
  document.getElementById('ma-pro-panel').style.display = 'flex'
  document.getElementById('ma-chat-fab').style.display  = 'flex'

  _initMapFeatures()
}

function _initMapFeatures() {
  _map = getMapInstance()

  if (_map && !_mouseTool) _initPlugins()

  if (_map && !_mapEventsRegistered) {
    _map.on('mapmove',    _updateScreenshotPreview)
    _map.on('zoomchange', _updateScreenshotPreview)
    _map.on('moveend',    () => { _updateViewportInfo(); _scheduleRegionUpdate() })
    _map.on('zoomend',    () => { _updateViewportInfo(); _scheduleRegionUpdate() })
    _mapEventsRegistered = true
  }

  if (_map) { _updateViewportInfo(); _scheduleRegionUpdate(); _updateScreenshotPreview() }
}

let _mapEventsRegistered = false

export function hideMapAnalysisTab() {
  const sidebar  = document.getElementById('ma-sidebar')
  const proPanel = document.getElementById('ma-pro-panel')
  const chatFab  = document.getElementById('ma-chat-fab')
  const chatPanel= document.getElementById('ma-chat-panel')

  if (sidebar)   sidebar.style.display   = 'none'
  if (proPanel)  proPanel.style.display  = 'none'
  if (chatFab)   chatFab.style.display   = 'none'
  if (chatPanel) chatPanel.classList.remove('open')

  // 恢复常规面板
  document.querySelectorAll('.side-panel--left > .panel, .side-panel--right > .panel')
    .forEach(p => { p.style.display = '' })
  const lp = document.querySelector('.side-panel--left')
  const rp = document.querySelector('.side-panel--right')
  if (lp) lp.style.overflow = ''
  if (rp) rp.style.overflow = ''

  // 清除检测标注（保留水位线，水位线按需保留）
  if (_map) {
    _map.remove(_markers);  _markers = []
    _map.remove(_overlays); _overlays = []
    _map.remove(_measureLines); _measureLines = []
    if (_screenshotPreview) { _map.remove(_screenshotPreview); _screenshotPreview = null }
  }
  if (_3dPois.length) {
    const App = getApp()
    if (App) { for (const p of _3dPois) { try { p.Delete() } catch (e) {} } }
    _3dPois = []
  }

  // 停止进行中的任务
  if (_evtSrc)  { _evtSrc.close();  _evtSrc  = null }
  if (_tvEs)    { _tvEs.close();    _tvEs    = null }
  if (_ppEs)    { _ppEs.close();    _ppEs    = null }
  _setRunning(false)
}

export function initMapAnalysisTab() {
  if (_initialized) return
  _initialized = true

  // 注入 CSS
  const style = document.createElement('style')
  style.textContent = _CSS
  document.head.appendChild(style)

  // 注入 HTML
  const lp = document.querySelector('.side-panel--left')
  const rp = document.querySelector('.side-panel--right')
  if (lp) lp.insertAdjacentHTML('beforeend', _SIDEBAR_HTML)
  if (rp) rp.insertAdjacentHTML('beforeend', _PRO_HTML)
  document.body.insertAdjacentHTML('beforeend', _MODAL_HTML + _CHAT_HTML)

  // 绑定事件
  _bindEvents()
  _buildWLPanel()
  _initChat()

  console.log('[MapAnalysis] 内嵌地图分析面板就绪')
}
