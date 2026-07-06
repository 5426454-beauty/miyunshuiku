// 迁徙图模块（Parabola 飞线）
import { getApp } from './_wdp.js'

// 飞线实例缓存（数组，支持批量清理）
let _lines = []

/** 从 CSS 变量读取当前主题的飞线颜色 */
function _getParabolaColor() {
  const style = getComputedStyle(document.documentElement)
  const orange = style.getPropertyValue('--accent-orange').trim() || '#FF4500'
  return orange.replace('#', '') + 'ff'   // HEXA，不透明
}

// 数据集定义（以 PickPointEvent 实测点 [117.0226, 40.5019] 为汇聚点）
const _DATASETS = {
  default: [
    { from: [116.9949, 40.4861, 0], to: [117.0226, 40.5019, 0], label: '西南方向' },
    { from: [117.0499, 40.4841, 0], to: [117.0226, 40.5019, 0], label: '东南方向' },
    { from: [116.9899, 40.5211, 0], to: [117.0226, 40.5019, 0], label: '西北方向' },
    { from: [117.0529, 40.5261, 0], to: [117.0226, 40.5019, 0], label: '东北方向' },
    { from: [116.9779, 40.5001, 0], to: [117.0226, 40.5019, 0], label: '正西方向' },
    { from: [117.0649, 40.5011, 0], to: [117.0226, 40.5019, 0], label: '正东方向' },
  ],
}

/**
 * 初始化迁徙图控制
 */
export function initMigration() {
  const btn = document.querySelector('#js-floating-toolbar [data-tool="migration"]')
  if (btn) btn.addEventListener('click', _toggleMigration)
}

/**
 * 切换迁徙图显示/隐藏
 */
async function _toggleMigration() {
  const btn = document.querySelector('#js-floating-toolbar [data-tool="migration"]')
  if (!btn) return
  const isActive = btn.classList.contains('toolbar-btn--active')

  if (isActive) {
    await _hideLines()
    btn.classList.remove('toolbar-btn--active')
  } else {
    await _showLines()
  }
}

/**
 * 渲染飞线
 * 性能方案：Promise.all 并发 Add，避免串行等待阻塞主线程
 */
async function _showLines(datasetKey = 'default') {
  const App = getApp()
  if (!App) {
    console.warn('[迁徙图] WDP 未就绪')
    return
  }

  // 先飞到目标区域
  await _focusArea()

  const dataset = _DATASETS[datasetKey]

  // 构造所有 Parabola 对象（官方真值：polyline.coordinates 两点，parabolaStyle）
  const parabolas = dataset.map((item, i) => new App.Parabola({
    polyline: {
      coordinates: [item.from, item.to],
    },
    parabolaStyle: {
      topHeight: 3000,
      topScale: 0.5,
      type: 'scanline',
      width: 30,
      color: _getParabolaColor(),
      gather: true,
    },
    bVisible: true,
    entityName: `迁徙线-${item.label}`,
    customId: `migration-line-${i}`,
  }))

  // Promise.all 并发添加，避免串行阻塞
  const results = await Promise.all(
    parabolas.map(p => App.Scene.Add(p))
  )

  // 仅保存添加成功的实例
  parabolas.forEach((p, i) => {
    if (results[i]?.success) {
      _lines.push(p)
    } else {
      console.warn(`[迁徙图] 第${i}条飞线添加失败:`, results[i]?.message)
    }
  })

  if (_lines.length > 0) {
    const btn = document.querySelector('#js-floating-toolbar [data-tool="migration"]')
    if (btn) btn.classList.add('toolbar-btn--active')
    console.log(`[迁徙图] 已渲染 ${_lines.length} 条飞线`)
  }
}

/**
 * 相机飞到迁徙图区域
 * 官方真值：CameraControl.FlyTo 使用 targetPosition + distance
 */
async function _focusArea() {
  const App = getApp()
  if (!App) return

  try {
    await App.CameraControl.FlyTo({
      targetPosition: [117.0226, 40.5019, 0],
      rotation: { pitch: -80, yaw: 0 }, // 俯视视角
      distance: 12000,
      flyTime: 2,
    })
  } catch (err) {
    console.error('[迁徙图] 相机飞行失败:', err)
  }
}

/**
 * 清理所有飞线
 */
async function _hideLines() {
  if (_lines.length === 0) return

  // Promise.all 并发删除
  await Promise.all(_lines.map(p => p.Delete().catch(() => {})))
  _lines = []
  console.log('[迁徙图] 已清理')
}

// ── 供 AI 模块调用的公开接口 ──────────────────────
export async function showMigration() { return _showLines() }

/**
 * 销毁（Tab 切换时调用）
 */
export async function destroyMigration() {
  await _hideLines()
  const btn = document.querySelector('#js-floating-toolbar [data-tool="migration"]')
  if (btn) btn.classList.remove('toolbar-btn--active')
}