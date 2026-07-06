// 地图目标检测模块 — 卫星图截图 → Qwen Vision 检测 → 2D 标注 + 3D 同步
// 移植自 map-agent 的 agent.py 核心逻辑：坐标转换、Mercator 反投影

import { getMapInstance, captureMapScreenshotResized } from './_mapScreenshot.js'
import { wgs84ToGcj02 } from './_coordConvert.js'

const API_DETECT = 'http://localhost:3001/api/detect'

// ── 坐标转换（从 map-agent Python 移植） ────────────────────────────────

/**
 * Web Mercator 反投影：y 归一化坐标 → 纬度
 * map-agent 实测验证修正线性插值偏北问题
 */
function _yToLat(yNorm, bounds) {
  const latN = bounds.north * Math.PI / 180
  const latS = bounds.south * Math.PI / 180
  const yN = Math.log(Math.tan(Math.PI / 4 + latN / 2))
  const yS = Math.log(Math.tan(Math.PI / 4 + latS / 2))
  const yM = yN - yNorm * (yN - yS)
  return (2 * Math.atan(Math.exp(yM)) - Math.PI / 2) * 180 / Math.PI
}

/**
 * 归一化坐标 [0,1000] → 经纬度边界框
 * @param {[number,number,number,number]} box2d - [x1, y1, x2, y2]
 * @param {{north,south,east,west}} bounds - 四至边界
 * @returns {{north,south,east,west}}
 */
export function boxToCoords(box2d, bounds) {
  const [x1, y1, x2, y2] = box2d
  const lngSpan = bounds.east - bounds.west
  return {
    north: _yToLat(y1 / 1000, bounds),
    south: _yToLat(y2 / 1000, bounds),
    west:  bounds.west + (x1 / 1000) * lngSpan,
    east:  bounds.west + (x2 / 1000) * lngSpan,
  }
}

export { _yToLat as yToLat }

// ── 2D 标注渲染 ────────────────────────────────────────────────────────

let _detectionMarkers = []
let _detectionRects = []

/**
 * 在 2D 地图上渲染检测结果
 * @param {Array} detections - [{ box_2d, confidence, description }]
 * @param {{north,south,east,west}|null} bounds - 截图时的四至边界
 */
export async function renderDetectionOnMap(detections, bounds) {
  const map = getMapInstance()
  if (!map) {
    console.warn('[MapDetect] 地图实例未注册')
    return
  }

  // 清除旧标注
  clearDetectionOverlays()

  // 如果没有 bounds 则用当前地图 bounds
  const b = bounds || (() => {
    const bb = map.getBounds()
    const ne = bb.getNorthEast()
    const sw = bb.getSouthWest()
    return { north: ne.getLat(), south: sw.getLat(), east: ne.getLng(), west: sw.getLng() }
  })()

  for (let i = 0; i < detections.length; i++) {
    const det = detections[i]
    const box = det.box_2d
    if (!box || box.length !== 4) continue

    const coords = boxToCoords(box, b)
    // 检查坐标有效性
    if (!isFinite(coords.north) || !isFinite(coords.south) ||
        !isFinite(coords.east) || !isFinite(coords.west)) continue

    const clat = (coords.north + coords.south) / 2
    const clng = (coords.east + coords.west) / 2
    const pct = Math.round((det.confidence || 0) * 100)
    const label = det.description || '目标'

    // 红色圆点标记
    const marker = new AMap.Marker({
      position: new AMap.LngLat(clng, clat),
      anchor: 'center',
      content: '<div style="width:14px;height:14px;background:#ff4444;border:2px solid #fff;' +
               'border-radius:50%;box-shadow:0 0 6px rgba(255,68,68,0.7);cursor:pointer"></div>',
      title: `${label} (${pct}%)`,
      zIndex: 120,
    })
    marker.setLabel({
      content: `<div style="background:rgba(0,0,0,0.75);color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;white-space:nowrap">${label} ${pct}%</div>`,
      direction: 'right',
      offset: new AMap.Pixel(4, 0),
    })
    map.add(marker)
    _detectionMarkers.push(marker)

    // 红色半透明矩形框
    const poly = new AMap.Polygon({
      path: [
        [coords.west, coords.north],
        [coords.east, coords.north],
        [coords.east, coords.south],
        [coords.west, coords.south],
      ],
      strokeColor: '#ff4444',
      strokeWeight: 2,
      strokeOpacity: 0.9,
      fillColor: '#ff4444',
      fillOpacity: 0.12,
      zIndex: 100,
    })
    map.add(poly)
    _detectionRects.push(poly)
  }

  console.log(`[MapDetect] 已渲染 ${_detectionMarkers.length} 个检测标注`)
}

/**
 * 清除所有检测标注
 */
export function clearDetectionOverlays() {
  const map = getMapInstance()
  if (map) {
    _detectionMarkers.forEach(m => map.remove(m))
    _detectionRects.forEach(r => map.remove(r))
  }
  _detectionMarkers = []
  _detectionRects = []
}

// ── 3D 场景同步 ────────────────────────────────────────────────────────

/**
 * 将检测结果推送到后端 DEM 标注 API，3D 场景自动同步渲染
 */
export async function syncDetectionTo3D(detections, bounds) {
  if (!detections || detections.length === 0) return

  const b = bounds || (() => {
    const map = getMapInstance()
    if (!map) return null
    const bb = map.getBounds()
    const ne = bb.getNorthEast()
    const sw = bb.getSouthWest()
    return { north: ne.getLat(), south: sw.getLat(), east: ne.getLng(), west: sw.getLng() }
  })()
  if (!b) return

  // 构建标注数据
  const markers = []
  const rectangles = []

  for (const det of detections) {
    const box = det.box_2d
    if (!box || box.length !== 4) continue

    const coords = boxToCoords(box, b)
    if (!isFinite(coords.north)) continue

    const clat = (coords.north + coords.south) / 2
    const clng = (coords.east + coords.west) / 2
    const pct = Math.round((det.confidence || 0) * 100)
    const label = det.description || '目标'

    // 转换为 WGS84（AMap bounds 是 GCJ-02）
    const [wLng, wLat] = _gcjToWgs84(clng, clat)

    markers.push({
      lon: wLng,
      lat: wLat,
      elevation: 0,
      label: `${label} (${pct}%)`,
    })

    const rNw = _gcjToWgs84(coords.west, coords.north)
    const rSe = _gcjToWgs84(coords.east, coords.south)
    rectangles.push({
      west: rSe[0],
      south: rSe[1],
      east: rNw[0],
      north: rNw[1],
      color: 'ff4444',
      label: label,
      id: `检测-${label}`,
    })
  }

  try {
    await fetch('http://localhost:3001/api/dem/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'both',
        markers,
        rectangles,
        flyTo: markers.length > 0
          ? { lon: markers[0].lon, lat: markers[0].lat, alt: 0, distance: 3000 }
          : null,
        summary: `AI 检测: ${detections.length} 个目标`,
      }),
    })
    console.log(`[MapDetect] 3D 同步完成: ${markers.length} 标记, ${rectangles.length} 矩形`)
  } catch (e) {
    console.warn('[MapDetect] 3D 同步失败:', e.message)
  }
}

// ── GCJ-02 → WGS84（简化迭代） ──────────────────────────────────────

function _gcjToWgs84(lng, lat) {
  // 密云水库尺度 CGCS2000 ≈ WGS84，主要处理 GCJ-02 偏移
  let w = lng
  let s = lat
  for (let i = 0; i < 3; i++) {
    const [gl, gs] = wgs84ToGcj02(w, s)
    w += lng - gl
    s += lat - gs
  }
  return [w, s]
}

// ── 公开：一键检测入口（工具栏按钮调用） ──────────────────────────────

/**
 * 执行一键目标检测
 * @param {string} target - 检测目标（如"大坝"、"溢洪道"）
 * @returns {Promise<Array>} 检测结果
 */
export async function runDetection(target) {
  if (!target) return []

  const screenshotData = await captureMapScreenshotResized()
  if (!screenshotData || !screenshotData.image) {
    console.warn('[MapDetect] 无法截取地图')
    return []
  }

  const regionEl = document.getElementById('info-region')
  const region = regionEl ? regionEl.textContent || '' : ''

  let nearby = ''
  try {
    const amapMod = await import('./_amap.js')
    if (amapMod.getNearbyPois) nearby = amapMod.getNearbyPois()
  } catch (_) {}

  try {
    const resp = await fetch(API_DETECT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: screenshotData.image,
        target,
        bounds: screenshotData.bounds,
        region,
        nearby_pois: nearby,
      }),
    })

    if (!resp.ok) {
      const err = await resp.json()
      throw new Error(err.error || `HTTP ${resp.status}`)
    }

    const result = await resp.json()
    const detections = result.detections || []

    // 渲染到 2D 地图
    await renderDetectionOnMap(detections, screenshotData.bounds)
    // 同步到 3D
    await syncDetectionTo3D(detections, screenshotData.bounds)

    return detections
  } catch (e) {
    console.error('[MapDetect] 检测失败:', e)
    throw e
  }
}

// ── 检测 UI 入口（搜索栏旁边的按钮） ──────────────────────────────

export function initDetectUI() {
  const btn = document.getElementById('js-map-detect-btn')
  if (!btn || btn._detectBound) return
  btn._detectBound = true

  btn.addEventListener('click', () => {
    const target = prompt('请输入检测目标（如：大坝、溢洪道、建筑、水体）', '大坝')
    if (target && target.trim()) {
      // 反馈按钮状态
      btn.textContent = '⏳'
      btn.disabled = true
      runDetection(target.trim()).then(dets => {
        console.log(`[MapDetect] 检测完成: ${dets.length} 个目标`)
        alert(dets.length > 0
          ? `检测完成：找到 ${dets.length} 个目标，已标注在地图上`
          : '未检测到目标，请尝试调整地图视野或更换目标词')
      }).catch(err => {
        alert(`检测失败: ${err.message}`)
      }).finally(() => {
        btn.textContent = '🔍'
        btn.disabled = false
      })
    }
  })
}