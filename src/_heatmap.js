// 热力图模块
import { getApp } from './_wdp.js'

// 热力图实例缓存
let _heatmapInstance = null

/** 从 CSS 变量读取当前主题的色阶 */
function _getGradientColors() {
  const style = getComputedStyle(document.documentElement)
  const accentGreen  = style.getPropertyValue('--accent-green').trim()  || '#00FF88'
  const accentYellow = style.getPropertyValue('--accent-yellow').trim() || '#FFD700'
  const accentOrange = style.getPropertyValue('--accent-orange').trim() || '#FF4500'
  const cyan         = style.getPropertyValue('--cyan').trim()          || '#00FFFF'
  return [
    cyan.replace('#', ''),           // 低值：主题主色（冷）
    accentGreen.replace('#', ''),    // 次低：强调绿
    accentYellow.replace('#', ''),   // 中：强调黄
    accentOrange.replace('#', ''),   // 次高：强调橙
    'ff0000',                        // 高值：红色（固定）
  ]
}

/**
 * 初始化热力图控制
 */
export function initHeatmap() {
  const btn = document.querySelector('#js-floating-toolbar [data-tool="heatmap"]')
  if (btn) btn.addEventListener('click', _toggleHeatmap)
}

/**
 * 切换热力图显示/隐藏
 */
async function _toggleHeatmap() {
  const btn = document.querySelector('#js-floating-toolbar [data-tool="heatmap"]')
  if (!btn) return
  const isActive = btn.classList.contains('toolbar-btn--active')

  if (isActive) {
    await _hideHeatmap()
    btn.classList.remove('toolbar-btn--active')
  } else {
    await _showHeatmap()
  }
}

/**
 * 显示热力图
 */
async function _showHeatmap() {
  const App = getApp()
  if (!App) {
    console.warn('[热力图] WDP 未就绪')
    return
  }

  // 如果已存在，先删除
  if (_heatmapInstance) {
    await _heatmapInstance.Delete()
    _heatmapInstance = null
  }

  try {
    // 第一步：先飞到热力区域
    await _focusHeatmapArea()

    // 第二步：创建热力图数据（以 PickPointEvent 实测点 [117.0226, 40.5019] 为中心散布）
    const points = [
      [117.0226, 40.5019, 0],
      [117.0261, 40.5044, 0],
      [117.0194, 40.5049, 0],
      [117.0253, 40.4985, 0],
      [117.0188, 40.4989, 0],
      [117.0277, 40.5013, 0],
      [117.0168, 40.5022, 0],
    ]

    const mapdata = []
    for (let i = 0; i < points.length; i++) {
      mapdata.push({
        point: points[i],
        value: Math.floor(Math.random() * 100),
      })
    }

    // 创建热力图覆盖物
    // 官方真值：gradientSetting 必须是 5 个纯 HEX 颜色（不含 alpha）
    const heatmap = new App.HeatMap({
      heatMapStyle: {
        type: 'fit', // fit: 投影型（贴地），plane: 平面型
        brushDiameter: 12000, // 热力点笔刷直径（单位:米）
        mappingValueRange: [1, 100],
        gradientSetting: _getGradientColors(),
      },
      bVisible: true,
      entityName: '场景热力图',
      customId: 'heatmap-001',
      points: {
        features: mapdata,
      },
    })

    // 添加到场景，贴地显示
    const res = await App.Scene.Add(heatmap, {
      calculateCoordZ: {
        coordZRef: 'surface',
        coordZOffset: 10,
      },
    })

    console.log('[热力图] Scene.Add 结果:', res.success, res.message)

    if (res.success) {
      _heatmapInstance = heatmap
      const btn = document.querySelector('#js-floating-toolbar [data-tool="heatmap"]')
      if (btn) btn.classList.add('toolbar-btn--active')
      console.log('[热力图] 已显示')
    } else {
      console.error('[热力图] 添加失败:', res.message)
    }
  } catch (err) {
    console.error('[热力图] 创建失败:', err)
  }
}

/**
 * 相机飞到热力图区域
 * 官方真值：FlyTo 使用 targetPosition + distance，不是 location
 */
async function _focusHeatmapArea() {
  const App = getApp()
  if (!App) return

  try {
    // 与上方 points 坐标中心对齐
    await App.CameraControl.FlyTo({
      targetPosition: [117.0226, 40.5019, 0],
      rotation: {
        pitch: -60,
        yaw: 0,
      },
      distance: 8000,
      flyTime: 2,
    })
    console.log('[热力图] 相机已飞往热力区域')
  } catch (err) {
    console.error('[热力图] 相机飞行失败:', err)
  }
}

/**
 * 隐藏热力图
 */
async function _hideHeatmap() {
  if (_heatmapInstance) {
    try {
      await _heatmapInstance.Delete()
      _heatmapInstance = null
      console.log('[热力图] 已隐藏')
    } catch (err) {
      console.error('[热力图] 删除失败:', err)
    }
  }
}

// ── 供 AI 模块调用的公开接口 ──────────────────────
export async function showHeatmap() { return _showHeatmap() }

/**
 * 销毁热力图（Tab 切换时调用）
 */
export async function destroyHeatmap() {
  await _hideHeatmap()
  const btn = document.querySelector('#js-floating-toolbar [data-tool="heatmap"]')
  if (btn) {
    btn.classList.remove('toolbar-btn--active')
  }
}