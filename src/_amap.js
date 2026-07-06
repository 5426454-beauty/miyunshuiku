// 高德地图 2D 图层 — 与 WDP 3D 场景叠加切换
import { getApp, onSceneReady } from './_wdp.js'
import { cgcs2000ToGcj02, wgs84ToGcj02 } from './_coordConvert.js'
import { setMapInstance } from './_mapScreenshot.js'
import { initMapSearch } from './_mapSearch.js'
import { initDetectUI } from './_mapDetect.js'

const AMAP_KEY     = '905dc2961a8e92d89f396ab80f86644a'
const AMAP_SECRET  = '03da948a22f287b75010983c555df0d3'
const AMAP_URL     = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_KEY}`

const DEFAULT_CENTER = cgcs2000ToGcj02(116.9653770483, 40.5054633531)
const DEFAULT_ZOOM   = 14

let _map          = null
let _mapMode      = '3d'
let _ready        = false
let _last3DCam    = null  // { eyeLng, eyeLat, eyeAlt, tgtLng, tgtLat, tgtAlt, pitch, yaw }
let _last2DZoom   = DEFAULT_ZOOM  // 记住 2D 模式下最后一次 zoom，切换时不丢失
let _nearbyPois   = ''    // 当前视野周边 POI 名称

// ── 加载 Amap SDK ────────────────────────────────────
function _loadScript() {
  return new Promise((resolve, reject) => {
    if (window.AMap) return resolve(window.AMap)
    window._AMapSecurityConfig = { securityJsCode: AMAP_SECRET }
    const script = document.createElement('script')
    script.src = AMAP_URL
    script.onload  = () => resolve(window.AMap)
    script.onerror = () => reject(new Error('Amap SDK 加载失败'))
    document.head.appendChild(script)
  })
}

// ── 创建地图 ────────────────────────────────────────
async function _createMap() {
  await _loadScript()
  const container = document.getElementById('amap-map')
  if (!container) return

  _map = new AMap.Map(container, {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    layers: [new AMap.TileLayer.Satellite()],
    mapStyle: 'amap://styles/dark',
    features: ['bg', 'road', 'building'],
    showBuildingBlock: false,
    resizeEnable: true,
  })

  _map.on('moveend', _onMapMove)
  _map.on('moveend', _updateNearbyPois)
  _ready = true

  // 注册地图实例到截图和搜索模块
  setMapInstance(_map)

  // 初始化搜索模块（需要 AMap.Geocoder/AutoComplete 插件）
  initMapSearch()

  console.log('[Amap] 地图初始化完成')
}

// ── 周边 POI 更新 ────────────────────────────────────────
let _poiTimer = null
function _updateNearbyPois() {
  clearTimeout(_poiTimer)
  _poiTimer = setTimeout(async () => {
    try {
      // 等待 Geocoder 插件加载
      let geocoder
      if (window.AMap) {
        // 简单方式：内联 geocoder 获取
        await new Promise((resolve) => {
          AMap.plugin('AMap.Geocoder', () => {
            geocoder = new AMap.Geocoder({ radius: 3000 })
            resolve()
          })
        })
        if (geocoder && _map) {
          const c = _map.getCenter()
          geocoder.getAddress([c.getLng(), c.getLat()], (status, result) => {
            if (status === 'complete' && result.regeocode) {
              const features = []
              ;(result.regeocode.pois || []).slice(0, 8).forEach(p => {
                if (p.name) {
                  const ts = (p.type || '').split(';')[0]
                  features.push(ts ? `${p.name}(${ts})` : p.name)
                }
              })
              ;(result.regeocode.aois || []).slice(0, 5).forEach(a => {
                if (a.name && !features.some(f => f.startsWith(a.name))) {
                  features.push(a.name)
                }
              })
              _nearbyPois = features.join('、')
            }
          })
        }
      }
    } catch (_) { /* 静默 */ }
  }, 1500)
}

// ── GCJ-02 → WGS84 ──────────────────────────────────
function _gcj02ToWgs84(lng, lat) {
  let w = lng, s = lat
  for (let i = 0; i < 3; i++) {
    const [gl, gs] = wgs84ToGcj02(w, s)
    w += lng - gl; s += lat - gs
  }
  return [w, s]
}

// ── 眼位高度 ↔ 地图缩放（严格互逆） ──────────────────
const ZOOM_ALT_BASE = [
  /* zoom 8  */ 400000,
  /* zoom 9  */ 240000,
  /* zoom 10 */ 120000,
  /* zoom 11 */ 60000,
  /* zoom 12 */ 26000,
  /* zoom 13 */ 13000,
  /* zoom 14 */ 6400,
  /* zoom 15 */ 3200,
  /* zoom 16 */ 1600,
  /* zoom 17 */ 800,
]

let _altMultiplier = 1.0  // 缩放倍数（运行时 __setAltMultiplier(v) 可调）

function _zoomToEyeAlt(zoom) {
  // 线性插值，支持小数 zoom
  const z = Math.max(8, Math.min(17, zoom))
  const zLow = Math.floor(z)
  const zHigh = Math.min(17, zLow + 1)
  const frac = z - zLow
  const baseLow  = ZOOM_ALT_BASE[zLow - 8]
  const baseHigh = ZOOM_ALT_BASE[zHigh - 8]
  return (baseLow + (baseHigh - baseLow) * frac) * _altMultiplier
}

function _eyeAltToZoom(eyeAlt) {
  // 二分查找 + 线性插值，返回小数 zoom
  const adj = eyeAlt / _altMultiplier
  if (adj >= ZOOM_ALT_BASE[0]) return 8   // 比 zoom 8 还远
  if (adj <= ZOOM_ALT_BASE[9]) return 17  // 比 zoom 17 还近
  for (let i = 0; i < 9; i++) {
    if (adj <= ZOOM_ALT_BASE[i] && adj >= ZOOM_ALT_BASE[i + 1]) {
      const frac = (ZOOM_ALT_BASE[i] - adj) / (ZOOM_ALT_BASE[i] - ZOOM_ALT_BASE[i + 1])
      return (8 + i) + frac
    }
  }
  return 14
}

// 运行时调参：在控制台输入 __setAltMultiplier(0.8) 或 __setAltMultiplier(1.2) 实时调整
window.__setAltMultiplier = function (v) {
  const val = parseFloat(v)
  if (isNaN(val) || val <= 0) { console.warn('用法: __setAltMultiplier(0.5~2.0)，当前=' + _altMultiplier); return }
  _altMultiplier = val
  console.log('[Amap] _altMultiplier 已更新为 ' + val + '（值越小3D拉得越近）')
  // 如果在 2D 模式，立即应用新倍率
  if (_map && _mapMode !== '3d') _onMapMove()
}

// ── 更新 _last3DCam ──────────────────────────────────
async function _updateLastCam() {
  const App = getApp()
  if (!App) { console.log('[Amap] App 未就绪'); return }
  try {
    const info = await App.CameraControl.GetCameraInfo()
    if (!info?.success) { console.log('[Amap] 失败', JSON.stringify(info).slice(0, 200)); return }
    const r = info.result
    const eye = r?.location
    if (!eye) { console.log('[Amap] 缺少 location'); return }
    const pitch = r.rotation?.pitch ?? SYNC_PITCH
    const yaw   = r.rotation?.yaw   ?? SYNC_YAW

    // 从眼位推算地面注视点：眼位在注视点后方，需沿视线方向补偿
    const pitchRad = (90 + pitch) * Math.PI / 180  // pitch=-80 → 10°
    const hDist    = eye[2] * Math.tan(pitchRad)
    const yawRad   = yaw * Math.PI / 180
    const latPerM  = 1 / 111320
    const lngPerM  = 1 / (111320 * Math.cos(eye[1] * Math.PI / 180))
    // cos(yaw) → 东西, -sin(yaw) → 南北 (yaw=0=东, yaw=-90=北)
    const dLng = hDist *  Math.cos(yawRad) * lngPerM
    const dLat = hDist * -Math.sin(yawRad) * latPerM

    _last3DCam = {
      eyeLng: eye[0], eyeLat: eye[1], eyeAlt: eye[2],
      tgtLng: eye[0] + dLng, tgtLat: eye[1] + dLat, tgtAlt: 0,
      pitch, yaw,
    }
    console.log('[Amap] OK', `eyeAlt=${eye[2].toFixed(0)} tgt=[${_last3DCam.tgtLng.toFixed(5)},${_last3DCam.tgtLat.toFixed(5)}]`)
  } catch (e) {
    console.log('[Amap] 异常', e.message)
  }
}

// ── 2D → 3D 同步（拖拽地图） ─────────────────────────
// 锁定正北朝上 + 近垂直俯视，与 2D 地图方向完全一致
const SYNC_PITCH = -80
const SYNC_YAW   = -90  // WDP 场景 yaw=0 非正北，-90° 对齐 2D 地图

function _onMapMove() {
  const App = getApp()
  if (!App || _mapMode === '3d') return

  const center = _map.getCenter()
  const zoom   = _map.getZoom()
  _last2DZoom = zoom
  const [tgtLng, tgtLat] = _gcj02ToWgs84(center.lng, center.lat)
  const eyeAlt = _zoomToEyeAlt(zoom)

  _last3DCam = {
    eyeLng: tgtLng, eyeLat: tgtLat, eyeAlt,
    tgtLng, tgtLat, tgtAlt: 0,
    pitch: SYNC_PITCH, yaw: SYNC_YAW,
  }

  App.CameraControl.FlyTo({
    targetPosition: [tgtLng, tgtLat, 0],
    rotation: { pitch: SYNC_PITCH, yaw: SYNC_YAW },
    distance: eyeAlt,
    flyTime: 0,  // 瞬间到位，不飞
  }).catch(() => {})
}

// ── 图层模式切换 ────────────────────────────────────
export async function setMapMode(mode) {
  if (!_map || !_ready) return

  const amapEl = document.getElementById('amap-container')

  if (mode === '3d') {
    // 切换回 3D 时淡出 2D 图层
    if (amapEl) amapEl.classList.remove('amap--visible')
    _mapMode = mode

  } else {
    const from3D = _mapMode === '3d'

    if (from3D) {
      // 3D → 2D：从当前 3D 相机推导 zoom，保持视野一致
      await _updateLastCam()
      if (_last3DCam) {
        const { tgtLng, tgtLat, eyeAlt } = _last3DCam
        const [gcjLng, gcjLat] = cgcs2000ToGcj02(tgtLng, tgtLat)
        const computedZoom = _eyeAltToZoom(eyeAlt)
        _last2DZoom = computedZoom  // 同步 zoom 状态
        _map.setZoomAndCenter(computedZoom, [gcjLng, gcjLat])
      } else {
        _map.setZoomAndCenter(_last2DZoom, DEFAULT_CENTER)
      }
    }
    // 2D ↔ 2D 只换图层，不重新定位

    _map.setLayers([mode === 'satellite'
      ? new AMap.TileLayer.Satellite()
      : new AMap.TileLayer()
    ])

    if (from3D) amapEl.classList.add('amap--visible')
    _mapMode = mode
  }

  _updateBtns()
}

export function getMapMode() { return _mapMode }
export function getNearbyPois() { return _nearbyPois }
export function getMapInstance() { return _map }

// ── 按钮状态 ────────────────────────────────────────
function _updateBtns() {
  document.querySelectorAll('.map-toggle-btn').forEach(btn => {
    btn.classList.toggle('map-toggle-btn--active', btn.dataset.mode === _mapMode)
  })
}

// ── 创建切换按钮 ────────────────────────────────────
function _createToggleBtns() {
  const right = document.querySelector('.top-bar__right')
  if (!right) return

  const wrap = document.createElement('div')
  wrap.className = 'map-toggle'
  wrap.innerHTML = `
    <button class="map-toggle-btn map-toggle-btn--active" data-mode="3d">3D</button>
    <button class="map-toggle-btn" data-mode="satellite">🛰 卫星</button>
    <button class="map-toggle-btn" data-mode="standard">🗺 标准</button>
  `
  const resetBtn = document.getElementById('js-btn-reset')
  if (resetBtn) {
    resetBtn.parentNode.insertBefore(wrap, resetBtn)
  } else {
    right.appendChild(wrap)
  }

  wrap.querySelectorAll('.map-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setMapMode(btn.dataset.mode))
  })

  }

// ── 创建 Amap 容器 ─────────────────────────────────
function _createContainer() {
  const scene = document.querySelector('.scene-container')
  if (!scene || document.getElementById('amap-container')) return

  const container = document.createElement('div')
  container.id = 'amap-container'
  container.innerHTML = `<div id="amap-map"></div>`
  const player = document.getElementById('player')
  if (player) {
    player.parentNode.insertBefore(container, player.nextSibling)
  } else {
    scene.appendChild(container)
  }

  }

// ── 主初始化 ────────────────────────────────────────
export async function initAmap() {
  _createContainer()
  _createToggleBtns()

  try {
    await _createMap()
    initDetectUI()
    console.log('[Amap] 2D 地图图层就绪')
  } catch (e) {
    console.error('[Amap] 初始化失败:', e)
  }

  onSceneReady((App) => {
    // 持续缓存相机完整状态
    setInterval(() => {
      if (_ready) _updateLastCam()
    }, 1000)
  })
}