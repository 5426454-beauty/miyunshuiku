// 主入口：WDP 初始化 + 面板初始化 + 时钟 + Tab 切换
import { initWdp, destroyWdp, onSceneReady } from './_wdp.js'
import { initLeftPanels }  from './_leftPanel.js'
import { initRightPanels } from './_rightPanel.js'
import { initTabSwitch }   from './_tabSwitch.js'
import { initCameraReset } from './_camera.js'
import { initPoiTool }    from './_poiTool.js'
import { initPathTool }   from './_pathTool.js'
import { initInspection } from './_inspection.js'
import { initWeatherControl } from './_weather.js'
import { initHeatmap } from './_heatmap.js'
import { initMigration } from './_migration.js'
import { initViewshed } from './_viewshed.js'
import { initGate } from './_gate.js'
import { initRainfall } from './_rainfall.js'
import { initDrone } from './_drone.js'
import { initAiChat } from './_aiChat.js'
import { initDem } from './_dem.js'
import { initVehicle, destroyVehicle } from './_vehicle.js'
import { initTheme }   from './_theme.js'
import { initDischarge } from './_discharge.js'
import { initFlood } from './_flood.js'
import { initDam } from './_dam.js'
import { initAmap } from './_amap.js'
import { initMapAgent } from './_mapAgent.js'
import { initMapAnalysisTab } from './_mapAnalysisTab.js'
import { initFloodHeatmap } from './_floodHeatmap.js'
import { initDemoBar } from './_demoBar.js'
import { tabData }         from './mockData.js'

/**
 * 更新顶部时钟显示
 */
function _startClock() {
  const _tick = () => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    const el = document.getElementById('js-time')
    if (el) el.textContent = `${hh}:${mm}:${ss}`

    const dateEl = document.getElementById('js-date')
    if (dateEl) {
      const y  = now.getFullYear()
      const mo = String(now.getMonth() + 1).padStart(2, '0')
      const d  = String(now.getDate()).padStart(2, '0')
      dateEl.textContent = `${y}-${mo}-${d}`
    }
  }
  _tick()
  setInterval(_tick, 1000)
}

/**
 * 主启动函数
 */
async function _bootstrap() {
  _startClock()
  initTheme()

  // 用首页数据初始化左右面板
  const homeData = tabData.home
  initLeftPanels(homeData.left)
  initRightPanels(homeData.right)

  // 绑定 Tab 切换事件
  initTabSwitch()

  // 初始化相机复位按钮
  initCameraReset()

  // 初始化 POI 取点工具
  initPoiTool()

  // 初始化地图智能分析面板
  initMapAgent()

  // 初始化路径绘制工具
  initPathTool()

  // 初始化机器人巡检模块
  initInspection()

  // 初始化天气和时间控制
  initWeatherControl()

  // 初始化热力图
  initHeatmap()

  // 初始化迁徙图
  initMigration()

  // 初始化可视域分析
  initViewshed()

  // 初始化闸门控制
  initGate()

  // 初始化降雨模拟
  initRainfall()

  // 初始化无人机巡检
  initDrone()

  // 初始化 DEM 高程标注模块
  initDem()

  // 初始化 AI 自然语言助手
  initAiChat()

  // 初始化车辆放置
  initVehicle()

  // 初始化大坝控制面板
  initDam()

  // 初始化泄洪调度预演面板
  initDischarge()

  // 初始化淹没预演面板
  initFlood()

  // 初始化淹没水深热力图模块
  initFloodHeatmap()

  // 初始化高德 2D 地图图层
  initAmap()

  // 初始化路演步骤指示器 + 快速操作条
  initDemoBar()

  // 初始化 3D 地图分析 Tab（在场景就绪后激活）
  onSceneReady(() => initMapAnalysisTab())

  // 启动 WDP 推流
  await initWdp()
}

window.addEventListener('beforeunload', () => {
  destroyVehicle()
  destroyWdp()
})

_bootstrap()
