// 无人机巡检模块 — 场景资产 + 路径飞行 + 相机跟随
// 当前密云水库场景可能无无人机实体，提供 POI 标记 + 纯相机巡航作为降级方案
import { getApp, onSceneReady } from './_wdp.js'

// 如果场景中有无人机实体，在此填入正确 EID（当前为旧项目 EID，已废弃）
const DRONE_EID = ""

// 巡检路径（沿密云水库坝体实测坐标，7个航点）
const PATH_COORDINATES = [
  [116.94401879238305, 40.441936859441093, 100],
  [116.94578307402044, 40.441421504812205, 100],
  [116.94928438433318, 40.440400071846057, 100],
  [116.95152235523011, 40.439733081919769, 100],
  [116.95184868872209, 40.439573417653513, 100],
  [116.95260515939248, 40.439066502826954, 100],
  [116.95512358046615, 40.437368474936157, 100],
]

// 巡检区域观察视角
const DRONE_CAMERA_POSE = {
  location: [116.96645593919577, 40.507920452046046, 213.95278713780923],
  rotation: { pitch: -23.799610137939453, yaw: 174.02470397949219 },
  flyTime: 2,
}

// ── 运行时状态 ──────────────────────────────────────────
let droneActive = false
let _droneEntity = null       // 场景中的无人机实体（如果存在）
let _dronePoi = null          // 降级方案的 POI 标记
let _pathObj = null           // Path 路径对象
let _boundObj = null          // Bound 移动绑定对象
let _cameraBeforeDrone = null

// ── 获取/搜索无人机实体 ──────────────────────────────────
async function _findDroneEntity() {
  if (_droneEntity) return _droneEntity
  const App = getApp()
  if (!App) return null

  // 方式 1：按 EID 查找
  if (DRONE_EID) {
    try {
      const res = await App.Scene.GetByEids([DRONE_EID])
      if (res?.success && res.result.length > 0) {
        console.log('[Drone] 通过 EID 找到无人机实体')
        _droneEntity = res.result[0]
        return _droneEntity
      }
    } catch (e) {
      console.warn('[Drone] EID 查找失败:', e.message)
    }
  }

  // 方式 2：搜索场景中名称包含"无人机"或"drone"的实体
  try {
    const projRes = await App.Scene.GetProject()
    if (projRes?.success && projRes.result?.Project) {
      for (const proj of projRes.result.Project) {
        if (proj.name && /(?:无人机|drone|uav)/i.test(proj.name)) {
          console.log('[Drone] 通过名称找到无人机:', proj.name)
          // 尝试按 eid 获取
          if (proj.eid) {
            const eRes = await App.Scene.GetByEids([proj.eid])
            if (eRes?.success && eRes.result.length > 0) {
              _droneEntity = eRes.result[0]
              return _droneEntity
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Drone] 场景搜索失败:', e.message)
  }

  console.warn('[Drone] 场景中未找到无人机实体，将使用 POI 标记降级方案')
  return null
}

// ── 降级方案：POI 标记沿路径移动 ─────────────────────────
async function _createDronePoi() {
  const App = getApp()
  if (!App) return null

  const iconUrl = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<circle cx="16" cy="16" r="14" fill="#00d4ff" stroke="#fff" stroke-width="2" opacity="0.9"/>' +
    '<text x="16" y="21" text-anchor="middle" font-size="16" fill="#000">✈</text>' +
    '</svg>'
  )

  try {
    const poi = new App.Poi({
      location: PATH_COORDINATES[0],
      poiStyle: { imageUrl: iconUrl },
      bVisible: true,
      entityName: '无人机巡检标记',
      customId: 'my-drone-poi',
    })
    const res = await App.Scene.Add(poi, {
      calculateCoordZ: { coordZRef: 'surface', coordZOffset: 100 },
    })
    if (res?.success) {
      console.log('[Drone] POI 降级标记已创建')
      return poi
    }
  } catch (e) {
    console.error('[Drone] POI 创建失败:', e.message)
  }
  return null
}

// ── 视频窗口 ────────────────────────────────────────────
function _showVideoBox() {
  const box = document.getElementById('inspection-video-box')
  if (box) box.style.display = ''
}

function _hideVideoBox() {
  const box = document.getElementById('inspection-video-box')
  if (box) box.style.display = 'none'
}

// ── 公共接口 ────────────────────────────────────────────
export function isDroneActive() { return droneActive }

export async function startDrone() {
  const App = getApp()
  if (!App || droneActive) {
    console.warn('[Drone] 已在运行或 WDP 未就绪')
    return
  }

  // 清理旧对象
  await cleanupDroneResources()

  // 保存当前相机
  try {
    const camInfo = await App.CameraControl.GetCameraInfo()
    if (camInfo?.success) _cameraBeforeDrone = camInfo.result
  } catch (e) {}

  // 先飞到巡检区域
  try { await App.CameraControl.SetCameraPose(DRONE_CAMERA_POSE) } catch (e) {}
  await new Promise(r => setTimeout(r, 1500))

  // 1. 找到或创建"无人机"实体
  let movingEntity = await _findDroneEntity()
  if (movingEntity) {
    // 场景有无人机实体：显示 + 启动骨骼动画
    try {
      await movingEntity.Update({
        bVisible: true,
        scale3d: [10, 10, 10],
        animSequenceIndex: 0,
        bPause: false,
        bLoop: true,
        playRate: 1,
      })
      console.log('[Drone] 无人机实体已激活')
    } catch (e) {
      console.error('[Drone] 无人机激活失败:', e.message)
      return
    }
  } else {
    // 降级方案：创建 POI 标记
    _dronePoi = await _createDronePoi()
    if (!_dronePoi) {
      console.error('[Drone] 无法创建 POI 标记，巡检启动失败')
      return
    }
    movingEntity = _dronePoi
  }

  // 2. 创建飞行路径
  try {
    _pathObj = new App.Path({
      polyline: { coordinates: PATH_COORDINATES },
      pathStyle: {
        type: 'arrow',
        width: 8,
        opacity: 0.25,
        color: '4090ffff',
        passColor: '29ff9fff',
      },
      customId: 'my-drone-path',
      bVisible: true,
    })
    const pathRes = await App.Scene.Add(_pathObj, {
      calculateCoordZ: { coordZRef: 'surface', coordZOffset: 10 },
    })
    if (!pathRes?.success) {
      console.error('[Drone] 路径创建失败:', pathRes?.message)
      return
    }
    console.log('[Drone] 飞行路径已创建')
  } catch (e) {
    console.error('[Drone] 路径创建异常:', e.message)
    return
  }

  // 3. 绑定移动
  try {
    _boundObj = new App.Bound({
      moving: movingEntity,
      path: _pathObj,
      boundStyle: { time: 45, bLoop: true, state: 'play' },
      customId: 'my-drone-bound',
      rotator: { pitch: 0, yaw: 360, roll: 0 },
      offset: { up: 8 },
    })
    const boundRes = await App.Scene.Add(_boundObj)
    if (!boundRes?.success) {
      console.error('[Drone] 移动绑定失败:', boundRes?.message)
      return
    }
    console.log('[Drone] 路径移动绑定成功')
  } catch (e) {
    console.error('[Drone] 移动绑定异常:', e.message)
    return
  }

  // 4. 相机跟随
  try {
    await App.CameraControl.Follow({
      followRotation: { pitch: -35, yaw: 0 },
      useRelativeRotation: true,
      distance: 150,
      bFPS: false,
      entity: movingEntity,
    })
    console.log('[Drone] 相机跟随已启动')
  } catch (e) {
    console.error('[Drone] 相机跟随失败:', e.message)
  }

  droneActive = true
  _showVideoBox()
  console.log('[Drone] 巡检已启动')
}

export async function stopDrone() {
  const App = getApp()
  if (!App || !droneActive) return

  droneActive = false
  _hideVideoBox()
  console.log('[Drone] 正在停止巡检...')

  // 1. 解除相机跟随锁
  try { await App.CameraControl.Stop() } catch (e) {
    console.warn('[Drone] CameraControl.Stop 失败:', e.message)
  }

  // 2. 清理资源
  await cleanupDroneResources()

  // 3. 隐藏无人机实体
  if (_droneEntity) {
    try {
      await _droneEntity.Update({ bVisible: false })
    } catch (e) {
      console.warn('[Drone] 隐藏无人机失败:', e.message)
    }
    _droneEntity = null
  }

  // 4. 飞回复位视角
  try {
    await App.CameraControl.SetCameraPose({
      location: [116.89500319446203, 40.455081174920032, 508.53713441609835],
      rotation: { pitch: -33.463161468505859, yaw: -50.210708618164062 },
      flyTime: 2,
    })
  } catch (e) {
    console.warn('[Drone] 复位相机失败:', e.message)
  }

  console.log('[Drone] 巡检已停止')
}

// ── 资源清理 ────────────────────────────────────────────
async function cleanupDroneResources() {
  // 清除 Bound
  if (_boundObj) {
    try { await _boundObj.Delete() } catch (e) {}
    _boundObj = null
  }
  // 清除 Path
  if (_pathObj) {
    try { await _pathObj.Delete() } catch (e) {}
    _pathObj = null
  }
  // 清除降级 POI
  if (_dronePoi) {
    try { await _dronePoi.Delete() } catch (e) {}
    _dronePoi = null
  }
  // 清除旧对象（按 customId 兜底清理）
  const App = getApp()
  if (App) {
    for (const cid of ['my-drone-bound', 'my-drone-path', 'my-drone-poi']) {
      try {
        const r = await App.Scene.GetByCustomId([cid])
        if (r?.success && r.result.length > 0) {
          await Promise.all(r.result.map(e => e.Delete().catch(() => {})))
        }
      } catch (e) {}
    }
  }
}

// ── 切换 ────────────────────────────────────────────────
export async function toggleDrone() {
  if (droneActive) {
    await stopDrone()
    _updateBtn(false)
  } else {
    _updateBtn(true)
    await startDrone()
    _updateBtn(false)
  }
}

// ── UI 初始化 ──────────────────────────────────────────
export function initDrone() {
  // 首页安全监测面板按钮
  const panelBtn = document.getElementById('js-drone-btn')
  if (panelBtn) {
    panelBtn.addEventListener('click', async () => {
      panelBtn.disabled = true
      try {
        if (droneActive) {
          await stopDrone()
          _updateBtn(false)
        } else {
          _updateBtn(true)
          await startDrone()
        }
      } finally {
        panelBtn.disabled = false
      }
    })
  }

  // 旧工具栏按钮兼容
  const toolbarBtn = document.querySelector('#js-floating-toolbar [data-tool="drone"]')
  if (toolbarBtn) {
    toolbarBtn.addEventListener('click', async () => {
      toolbarBtn.disabled = true
      try {
        if (droneActive) {
          await stopDrone()
          _updateBtn(false)
        } else {
          _updateBtn(true)
          await startDrone()
        }
      } finally {
        toolbarBtn.disabled = false
      }
    })
  }
}

function _updateBtn(active) {
  // 新面板按钮
  const panelBtn = document.getElementById('js-drone-btn')
  if (panelBtn) {
    panelBtn.textContent = active ? '⏳ 启动中...' : (droneActive ? '🛑 停止巡检' : '启动巡检')
    panelBtn.classList.toggle('drone-patrol__btn--flying', droneActive)
  }
  // 状态文字
  const statusEl = document.getElementById('js-drone-status')
  if (statusEl) {
    statusEl.textContent = droneActive ? '巡检中' : '待命'
    statusEl.classList.toggle('drone-patrol__status--flying', droneActive)
  }
  // 旧工具栏
  const toolbarBtn = document.querySelector('#js-floating-toolbar [data-tool="drone"]')
  if (toolbarBtn) toolbarBtn.classList.toggle('toolbar-btn--active', droneActive)
}

// ── 销毁 ────────────────────────────────────────────────
export async function destroyDrone() {
  if (droneActive) {
    await stopDrone()
    _updateBtn(false)
  }
}