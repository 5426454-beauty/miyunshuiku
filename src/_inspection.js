// 机器人巡检模块：三条巡检路线（App.Path）
import { getApp, onSceneReady } from './_wdp.js'

const _ROUTES = [
  {
    id:    'inspection-route-1',
    name:  '巡检线路1',
    color: 'ff3333cc',
    passColor: 'ff333333',
    width: 20,
    // 沿无人机巡检路径南侧
    coordinates: [
      [116.9634, 40.5035, 120],
      [116.9684, 40.5020, 110],
      [116.9704, 40.5005, 105],
      [116.9724, 40.4995, 100],
      [116.9744, 40.4990,  95],
    ],
    camera: {
      location: [116.968, 40.500, 600],
      rotation: { pitch: -45, yaw: 90 },
      flyTime: 2,
    },
  },
  {
    id:    'inspection-route-2',
    name:  '巡检线路2',
    color: '00ff88cc',
    passColor: '00ff8833',
    width: 20,
    // 沿无人机巡检路径西侧
    coordinates: [
      [116.9604, 40.5045, 110],
      [116.9584, 40.5040, 105],
      [116.9569, 40.5030, 100],
      [116.9554, 40.5015,  95],
    ],
    camera: {
      location: [116.957, 40.502, 500],
      rotation: { pitch: -42, yaw: 85 },
      flyTime: 2,
    },
  },
  {
    id:    'inspection-route-3',
    name:  '巡检线路3',
    color: 'fb923ccc',
    passColor: 'fb923c33',
    width: 20,
    // 沿无人机巡检路径北侧
    coordinates: [
      [116.9644, 40.5090, 115],
      [116.9684, 40.5095, 110],
      [116.9714, 40.5100, 105],
      [116.9744, 40.5105, 100],
    ],
    camera: {
      location: [116.969, 40.509, 500],
      rotation: { pitch: -38, yaw: 78 },
      flyTime: 2,
    },
  },
]

let _pathObjs   = []
let _animTokens = {}

// ── 创建单条路径 ──────────────────────────────────────
async function _createRoute(App, route) {
  const path = new App.Path({
    polyline: { coordinates: route.coordinates },
    pathStyle: {
      type:      'arrow',
      width:     route.width,
      color:     route.color,
      passColor: route.passColor,
    },
    entityName: route.name,
    customId:   route.id,
  })
  const res = await App.Scene.Add(path, {
    calculateCoordZ: { coordZRef: 'surface', coordZOffset: 2 },
  })
  if (res.success) return res.result.object
  console.warn(`[Inspection] ${route.name} 创建失败`, res)
  return null
}

// ── 沿路线逐点飞行相机 ────────────────────────────────
async function _flyAlongRoute(App, route, index, token) {
  const coords  = route.coordinates
  const flyTime = 15

  for (let i = 0; i < coords.length; i++) {
    if (_animTokens[index] !== token) return

    const [lng, lat, z] = coords[i]
    const camZ = Math.max(z + 150, 200)

    try {
      await App.CameraControl.SetCameraPose({
        location: [lng, lat, camZ],
        rotation: { pitch: -32, yaw: 0 },
        flyTime,
      })
    } catch (_) {}

    await new Promise(res => setTimeout(res, flyTime * 1000 + 200))
  }
}

// ── 同步视频窗口显隐（有任意路线显示则展示） ──────────
function _syncVideoBox() {
  const box = document.getElementById('inspection-video-box')
  if (!box) return
  const anyVisible = _pathObjs.some(obj => obj !== null && obj !== undefined)
  box.style.display = anyVisible ? 'block' : 'none'
}

// ── 点击面板条目：切换单条路线显隐 + 逐点飞行 ──────────
export async function toggleRoute(index) {
  const App = getApp()
  if (!App) return

  const route = _ROUTES[index]
  if (!route) return

  while (_pathObjs.length < _ROUTES.length) _pathObjs.push(null)

  if (_pathObjs[index]) {
    // 已显示 → 取消动画 + 删除路线
    delete _animTokens[index]
    try { await _pathObjs[index].Delete() } catch (_) {}
    _pathObjs[index] = null
    _syncVideoBox()
  } else {
    // 未显示 → 先创建路线，再启动逐点飞行
    _pathObjs[index] = await _createRoute(App, route)
    _syncVideoBox()

    const token = Date.now()
    _animTokens[index] = token
    _flyAlongRoute(App, route, index, token)
  }
}

// ── 是否已显示（供面板刷新激活态用）────────────────────
export function isRouteVisible(index) {
  return !!_pathObjs[index]
}

// ── 离开四管 Tab 时销毁所有已显示路线 ────────────────
export async function hideInspectionRoutes() {
  _animTokens = {}
  for (const obj of _pathObjs) {
    if (obj) try { await obj.Delete() } catch (_) {}
  }
  _pathObjs = []
  _syncVideoBox()
}

export function initInspection() {
  onSceneReady(() => {})
}
