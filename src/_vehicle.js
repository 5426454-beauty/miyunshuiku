// 车辆放置模块：在水库大坝附近放置两辆车
import { getApp, onSceneReady } from './_wdp.js'

const VEHICLE_SEED_ID = 'b35a9a0bd25bc1d9dd87d5e72e03efb4'

// 两辆车的配置（从场景中取点实测坐标）
const VEHICLE_CONFIGS = [
  {
    customId: 'my-vehicle-1',
    name: 'SUV',
    location: [116.96587828689788, 40.505726772420587, 84.288043328631758],
    rotator: { pitch: 0, yaw: 285, roll: 0 },
    scale3d: [1, 1, 1],
  },
  {
    customId: 'my-vehicle-2',
    name: '小轿车',
    location: [116.96586276624623, 40.505569701942235, 83.857357767486519],
    rotator: { pitch: 0, yaw: 195, roll: 0 },
    scale3d: [1, 1, 1],
  },
]

const vehicleEntities = [null, null]

/**
 * 在场景中放置一辆车
 */
function _placeOneVehicle(App, cfg, index) {
  const vehicle = new App.Static({
    location: cfg.location,
    seedId: VEHICLE_SEED_ID,
    rotator: cfg.rotator,
    scale3d: cfg.scale3d,
    entityName: cfg.name,
    customId: cfg.customId,
    bVisible: true,
  })

  App.Scene.Add(vehicle, {
    calculateCoordZ: { coordZRef: 'surface', coordZOffset: 0 },
  })
    .then(({ success, message }) => {
      if (!success) {
        console.error(`[Vehicle] ${cfg.name} 添加失败:`, message)
        return
      }
      vehicleEntities[index] = vehicle
      console.log(`[Vehicle] ${cfg.name} 已放置, eid:`, vehicle.eid)
    })
    .catch(err => console.error(`[Vehicle] ${cfg.name} 异常:`, err))
}

/**
 * 场景就绪后放置所有车辆
 */
function _placeVehicles(App) {
  VEHICLE_CONFIGS.forEach((cfg, i) => _placeOneVehicle(App, cfg, i))
}

/**
 * 初始化车辆模块
 */
export function initVehicle() {
  const App = getApp()
  if (App) {
    _placeVehicles(App)
  } else {
    onSceneReady((App) => _placeVehicles(App))
  }
}

/**
 * 清除所有车辆
 */
export async function destroyVehicle() {
  const App = getApp()
  if (!App) return
  for (let i = 0; i < vehicleEntities.length; i++) {
    if (!vehicleEntities[i]) continue
    try {
      await vehicleEntities[i].Delete()
    } catch (_) {
      /* ignore */
    }
    console.log(`[Vehicle] ${VEHICLE_CONFIGS[i].name} 已移除`)
    vehicleEntities[i] = null
  }
}