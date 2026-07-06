// DEM 高程标注模块 — 轮询后端标注数据并在 Cesium 3D 地图上渲染
// 通信链路: Claude(Python分析) → POST /api/dem/annotations → 前端轮询 → 渲染

import { getApp, onSceneReady } from './_wdp.js'
import { wgs84ToGcj02 } from './_coordConvert.js'
import { clearDetectionOverlays } from './_mapDetect.js'

const DEM_API = 'http://localhost:3001/api/dem/annotations'
const POLL_INTERVAL_MS = 2000

// ── 运行时状态 ──────────────────────────────────────────
let _sceneReady = false
let _lastVersion = 0
let _entities = []           // { entity, customId, type }
let _pollTimer = null
let _btnEl = null
let _busy = false            // 操作锁，防止渲染和清除并发

// 默认图标地址（一个定位标记 SVG base64）
const _MARKER_ICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<circle cx="16" cy="14" r="10" fill="#ff4444" stroke="#fff" stroke-width="2"/>' +
  '<polygon points="16,32 10,20 22,20" fill="#ff4444" stroke="#fff" stroke-width="1.5"/>' +
  '</svg>'
)

// ── 实体管理 ────────────────────────────────────────────

/** 清理所有 DEM 标注实体（原子操作，防并发） */
async function _clearEntities() {
  const items = _entities.splice(0)  // 原子截取，防止并发写入
  for (const item of items) {
    try {
      if (item.entity) await item.entity.Delete()
    } catch (e) {
      // entity already removed
    }
  }
}

/** 创建 POI 标记点 */
async function _createMarker(lon_wgs84, lat_wgs84, label, elevation) {
  const App = getApp()
  if (!App) return null

  const [gcjLon, gcjLat] = wgs84ToGcj02(lon_wgs84, lat_wgs84)
  const customId = `dem-marker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  try {
    const poi = new App.Poi({
      location: [gcjLon, gcjLat, 0],
      poiStyle: {
        markerNormalUrl: _MARKER_ICON,
        markerActivateUrl: _MARKER_ICON,
        markerSize: [28, 34],
        labelVisible: true,
        labelContent: [label, 'ffffffff', '14'],
        labelTop: true,
        labelBgSize: [200, 28],
        labelBgOffset: [0, -4],
        textBoxWidth: 200,
      },
      bVisible: true,
      entityName: label,
      customId,
    })

    const res = await App.Scene.Add(poi, {
      calculateCoordZ: { coordZRef: 'surface', coordZOffset: 0 },
    })

    if (res.success) {
      const entity = res.result?.object || poi
      _entities.push({ entity, customId, type: 'marker' })
      return entity
    }
  } catch (e) {
    console.warn('[DEM] 标记创建失败:', label, e.message)
  }
  return null
}

/** 创建矩形边框（用 Range loop_line，透明填充 + 红边框） */
async function _createRectangle(west, south, east, north, color, label, fillColor) {
  const App = getApp()
  if (!App) return null

  const customId = `dem-rect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // 四个角 → GCJ-02（Range 用 polygon2D，[lng, lat] 二维）
  const sw = wgs84ToGcj02(west, south)
  const se = wgs84ToGcj02(east, south)
  const ne = wgs84ToGcj02(east, north)
  const nw = wgs84ToGcj02(west, north)

  try {
    const lineColor = color || 'ff0000cc'
    // fill: 有 fillColor 就用，否则透明
    const useFill = fillColor || '00000000'
    const range = new App.Range({
      polygon2D: { coordinates: [[[sw[0], sw[1]], [se[0], se[1]], [ne[0], ne[1]], [nw[0], nw[1]]]] },
      rangeStyle: {
        type: 'loop_line',
        fillAreaType: 'block',
        height: fillColor ? 40 : 80,  // 淹没热力 40m，DEM 轮廓 80m
        strokeWeight: 4,
        color: lineColor,
        fillAreaColor: useFill,
      },
      entityName: label,
      customId,
      bVisible: true,
    })

    const res = await App.Scene.Add(range, {
      calculateCoordZ: { coordZRef: 'surface', coordZOffset: 2 },
    })

    if (res.success) {
      const entity = res.result?.object || range
      _entities.push({ entity, customId, type: 'rect' })
      return entity
    } else {
      console.warn('[DEM] Range 创建失败:', res.message)
    }
  } catch (e) {
    console.warn('[DEM] 矩形边框创建失败:', label, e.message)
  }
  return null
}

/** 创建矩形标签 POI（在矩形中心显示文字） */
async function _createRectLabel(west, south, east, north, label) {
  const App = getApp()
  if (!App) return null

  const centerLon = (west + east) / 2
  const centerLat = (north + south) / 2
  const [gcjLon, gcjLat] = wgs84ToGcj02(centerLon, centerLat)
  const customId = `dem-rectlabel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  try {
    const poi = new App.Poi({
      location: [gcjLon, gcjLat, 0],
      poiStyle: {
        markerNormalUrl: '',   // 无图标，只显示文字标签
        markerActivateUrl: '',
        markerSize: [1, 1],
        labelVisible: true,
        labelContent: [label, 'ffffffff', '13'],
        labelTop: false,
        labelBgSize: [280, 24],
        labelBgOffset: [0, 0],
        textBoxWidth: 280,
      },
      bVisible: true,
      entityName: label,
      customId,
    })

    const res = await App.Scene.Add(poi, {
      calculateCoordZ: { coordZRef: 'surface', coordZOffset: 30 },
    })

    if (res.success) {
      const entity = res.result?.object || poi
      _entities.push({ entity, customId, type: 'rect-label' })
      return entity
    }
  } catch (e) {
    console.warn('[DEM] 标签创建失败:', label, e.message)
  }
  return null
}

// ── 主渲染逻辑 ──────────────────────────────────────────

async function _renderAnnotations(annotations) {
  if (!_sceneReady || _busy) return
  _busy = true

  // 先清旧标注
  await _clearEntities()

  if (!annotations) { _busy = false; return }

  const { markers, rectangles, flyTo, summary } = annotations

  // 创建矩形框
  if (rectangles && rectangles.length > 0) {
    const isFlood = rectangles[0] && rectangles[0].id && String(rectangles[0].id).startsWith('flood-')
    if (isFlood) {
      // 淹没热力图：只打一行汇总日志，不逐个 log
      for (const rect of rectangles) {
        await _createRectangle(rect.west, rect.south, rect.east, rect.north, rect.color, rect.label, rect.fillColor)
      }
      console.log('[DEM] 淹没热力: ' + rectangles.length + ' 格点')
    } else {
      for (const rect of rectangles) {
        await _createRectangle(rect.west, rect.south, rect.east, rect.north, rect.color, rect.label, rect.fillColor)
        await _createRectLabel(rect.west, rect.south, rect.east, rect.north,
          rect.id ? `📐 ${rect.id}: ${rect.label}` : `📐 ${rect.label}`)
      }
    }
  }

  // 创建标记点
  if (markers && markers.length > 0) {
    for (const marker of markers) {
      await _createMarker(marker.lon, marker.lat, marker.label, marker.elevation)
    }
  }

  // 相机飞行
  if (flyTo && flyTo.lon && flyTo.lat) {
    const App = getApp()
    if (App) {
      try {
        const [gcjLon, gcjLat] = wgs84ToGcj02(flyTo.lon, flyTo.lat)
        await App.CameraControl.FlyTo({
          targetPosition: [gcjLon, gcjLat, flyTo.alt || 0],
          rotation: { pitch: -60, yaw: 0 },
          distance: flyTo.distance || 3000,
          flyTime: 2,
        })
      } catch (e) {
        console.warn('[DEM] 相机飞行失败:', e.message)
      }
    }
  }

  console.log(`[DEM] 渲染完成: ${rectangles?.length || 0} 矩形, ${markers?.length || 0} 标记`)
  _busy = false
}

// ── 轮询 ────────────────────────────────────────────────

let _firstPoll = true

async function _poll() {
  try {
    const resp = await fetch(DEM_API)
    if (!resp.ok) return
    const data = await resp.json()

    if (_firstPoll) {
      // 首次轮询只同步版本号，不渲染旧数据
      _firstPoll = false
      _lastVersion = data.version || 0
      return
    }

    if (data.version > _lastVersion) {
      _lastVersion = data.version
      console.log(`[DEM] 检测到新标注 v${data.version}:`, data.annotations?.summary || '')
      await _renderAnnotations(data.annotations)

      if (_btnEl && data.annotations) {
        _btnEl.classList.add('dem-btn--active')
      }
    }
  } catch (e) {
    // 后端未启动，静默忽略
  }
}

/** 清除标注（同时调用后端 API），暂停轮询防竞态 */
async function _clearAnnotations() {
  _busy = true
  // 暂停轮询
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null }

  // 清本地实体
  await _clearEntities()
  _lastVersion = 0
  // 同步清除 2D 检测覆盖物
  try { clearDetectionOverlays() } catch (e) {}
  // 注意：不重置 _firstPoll——清除后下次轮询应立即渲染新数据，不再跳过

  // 清后端文件
  try {
    await fetch(DEM_API, { method: 'DELETE' })
  } catch (e) { /* ignore */ }

  if (_btnEl) _btnEl.classList.remove('dem-btn--active')
  console.log('[DEM] 标注已清除')

  // 恢复轮询
  _pollTimer = setInterval(_poll, POLL_INTERVAL_MS)
  _busy = false
}

// ── UI ──────────────────────────────────────────────────

function _createButton() {
  const container = document.querySelector('.top-bar__right')
  if (!container) return

  const btn = document.createElement('button')
  btn.className = 'reset-btn dem-btn'
  btn.id = 'js-dem-btn'
  btn.title = 'DEM 高程标注'
  btn.textContent = '🏔 DEM'
  btn.style.cssText = 'position:relative;'

  btn.addEventListener('click', async () => {
    if (_lastVersion > 0) {
      await _clearAnnotations()
    }
  })

  const resetBtn = document.getElementById('js-btn-reset')
  container.insertBefore(btn, resetBtn)
  _btnEl = btn
}

// ── 样式注入 ────────────────────────────────────────────

function _injectStyle() {
  const style = document.createElement('style')
  style.textContent = `
    .dem-btn--active {
      background: rgba(255, 68, 68, 0.2) !important;
      border-color: #ff4444 !important;
      color: #ff4444 !important;
    }
  `
  document.head.appendChild(style)
}

// ── 公开接口 ────────────────────────────────────────────

/** 初始化 DEM 标注模块 */
export function initDem() {
  _injectStyle()

  // 场景就绪后开始轮询
  onSceneReady(async () => {
    _sceneReady = true
    console.log('[DEM] 模块就绪，开始轮询')
    _pollTimer = setInterval(_poll, POLL_INTERVAL_MS)
    // 立即检查一次
    _poll()
  })
}

/** 手动触发标注渲染（供其他模块调用） */
export async function renderDemAnnotations(annotations) {
  await _renderAnnotations(annotations)
}

/** 清除 DEM 标注 */
export async function clearDemAnnotations() {
  await _clearAnnotations()
}