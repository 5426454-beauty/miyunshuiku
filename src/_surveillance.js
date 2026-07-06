// 视频监控模块：周界 Range + 监控 POI + 告警联动 + Window 视频窗口
import { getApp, onSceneReady } from './_wdp.js'

// 4 个监控点位（分别放置在大坝和溢洪道上）
const _CAMS = [
  { id: 'cam-001', name: '监控点位1', location: [116.826222, 40.478450, 95.62] },
  { id: 'cam-002', name: '监控点位2', location: [116.833144, 40.484334, 155.91] },
  { id: 'cam-003', name: '监控点位3', location: [116.853559, 40.480574, 150.55] },
  { id: 'cam-004', name: '监控点位4', location: [116.817509, 40.491933, 159.96] },
]

// 周界多边形顶点（顺时针排列，包裹4个监控点位，[lng, lat]，首尾闭合）
const _PERIMETER = [
  [116.820, 40.446],   // 左下（白河 + 潮河之间）
  [117.006, 40.446],   // 右下（潮河 + 第三溢洪道之间）
  [117.006, 40.481],   // 右上（白河 + 第三溢洪道之间）
  [116.820, 40.481],   // 左上（白河 + 走马庄之间）
  [116.820, 40.446],   // 闭合
]

const _POI_NORMAL = 'https://wdp5-api-debug.51aes.com/static/newMarker.png'
const _POI_ACTIVE = 'https://wdp5-api-debug.51aes.com/static/newMarker_active.png'
const _VIDEO_URL  = 'https://wdp5-api-debug.51aes.com/static/videoUI.mp4'

// 模块内状态
let _isShowing  = false
let _rangeObj   = null   // 周界实体
let _poiObjs    = []     // POI 实体数组
let _videoObjMap = {}    // { camId: winObj }  各点位对应的视频窗口实体

// ── 清理所有三维实体 ───────────────────────────────────
async function _hide() {
  // 删除所有视频窗口
  for (const winObj of Object.values(_videoObjMap)) {
    try { winObj.Delete() } catch (e) {
      console.warn('[Surveillance] 视频窗口删除异常', e)
    }
  }
  _videoObjMap = {}

  // 删除所有 POI
  for (const obj of _poiObjs) {
    try { obj.Delete() } catch (e) {
      console.warn('[Surveillance] POI 删除异常', e)
    }
  }
  _poiObjs = []

  // 删除周界
  if (_rangeObj) {
    try { _rangeObj.Delete() } catch (e) {
      console.warn('[Surveillance] Range 删除异常', e)
    }
    _rangeObj = null
  }

  _isShowing = false
}

// ── 告警联动：点击 POI → 聚焦镜头 + 切换视频窗口 ────────
async function _onPoiClick(cam, poiObj) {
  const App = getApp()
  if (!App) return

  // 1. 镜头聚焦到该监控点位
  await App.CameraControl.Focus({
    rotation:       { pitch: -40, yaw: -90 },
    distanceFactor: 0.1,
    flyTime:        1.0,
    entity:         [poiObj],
  })

  // 2. 切换视频窗口（已有则关，无则开）
  const existingWin = _videoObjMap[cam.id]
  if (existingWin) {
    try { existingWin.Delete() } catch (e) {
      console.warn('[Surveillance] 视频窗口关闭异常', e)
    }
    delete _videoObjMap[cam.id]
  } else {
    try {
      const winEntity = new App.Window({
        location:    cam.location,
        windowStyle: {
          url:    _VIDEO_URL,
          size:   [320, 180],
          offset: [-160, -120],  // 水平居中（-半宽），POI 正上方贴近
        },
        bVisible:   true,
        entityName: `${cam.name}-视频`,
        customId:   `${cam.id}-video`,
      })
      const res = await App.Scene.Add(winEntity)
      if (res.success) {
        _videoObjMap[cam.id] = res.result.object
      } else {
        console.warn('[Surveillance] 视频窗口创建失败', cam.id, res)
      }
    } catch (e) {
      console.warn('[Surveillance] 视频窗口创建异常', cam.id, e)
    }
  }
}

// ── 创建所有实体 ──────────────────────────────────────
async function _show() {
  const App = getApp()
  if (!App) return

  // 1. 创建周界 Range（地表贴合，高度 15m）
  const range = new App.Range({
    polygon2D: {
      coordinates: [_PERIMETER],
    },
    rangeStyle: {
      type:          'loop_line',
      fillAreaType:  'block',
      height:        7.5,
      strokeWeight:  8,
      color:         '00d4ffcc',   // HEXA: cyan 80% 不透明
      fillAreaColor: '00d4ff1a',   // HEXA: cyan 10% 透明填充
    },
    bVisible:   true,
    entityName: '监控周界',
    customId:   'perimeter-range',
  })
  const rangeRes = await App.Scene.Add(range, {
    calculateCoordZ: { coordZRef: 'surface', coordZOffset: -15 },
  })
  if (rangeRes.success) {
    _rangeObj = rangeRes.result.object
  } else {
    console.warn('[Surveillance] 周界创建失败', rangeRes)
  }

  // 2. 逐个创建 POI 并绑定告警联动点击事件
  for (const cam of _CAMS) {
    const poi = new App.Poi({
      location: cam.location,
      poiStyle: {
        markerNormalUrl:   _POI_NORMAL,
        markerActivateUrl: _POI_ACTIVE,
        markerSize:        [100, 159],
        labelVisible:      false,
      },
      bVisible:   true,
      entityName: cam.name,
      customId:   cam.id,
    })
    const poiRes = await App.Scene.Add(poi)
    if (poiRes.success) {
      const poiObj = poiRes.result.object
      _poiObjs.push(poiObj)
      // 绑定告警联动：点击 → 聚焦 + 切换视频
      poiObj.onClick(() => _onPoiClick(cam, poiObj))
    } else {
      console.warn('[Surveillance] POI 创建失败', cam.id, poiRes)
    }
  }

  // 3. 镜头飞行聚焦到全部监控点位
  if (_poiObjs.length > 0) {
    await App.CameraControl.Focus({
      rotation:       { pitch: -40, yaw: -90 },
      distanceFactor: 0.15,
      flyTime:        1.5,
      entity:         _poiObjs,
    })
  }

  _isShowing = true
}

/**
 * 将视频监控切换逻辑绑定到按钮
 * 每次四全面板渲染时调用，自动恢复上次状态
 */
export function bindSurveillanceBtn(btn) {
  btn.textContent = _isShowing ? '关闭视频监控' : '开启视频监控'
  if (_isShowing) btn.classList.add('surveillance-btn--active')

  // 场景未就绪时禁用，就绪后启用
  if (!getApp()) {
    btn.disabled = true
    onSceneReady(() => { btn.disabled = false })
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true
    try {
      if (_isShowing) {
        await _hide()
        btn.textContent = '开启视频监控'
        btn.classList.remove('surveillance-btn--active')
      } else {
        await _show()
        btn.textContent = '关闭视频监控'
        btn.classList.add('surveillance-btn--active')
      }
    } catch (e) {
      console.error('[Surveillance] 操作异常', e)
    } finally {
      btn.disabled = false
    }
  })
}
