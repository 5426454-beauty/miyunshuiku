// 可视域分析模块
import { getApp, onSceneReady } from './_wdp.js'

// 可视域实体实例（单例）
let _viewshedInstance = null
// 是否处于"选点等待"状态
let _picking = false

// 性能保护：限制更新频率，防止 GPU 过载
let _lastUpdateTime = 0
const _UPDATE_INTERVAL_MS = 300

/**
 * 初始化可视域模块
 */
export function initViewshed() {
  const btn = document.querySelector('#js-floating-toolbar [data-tool="viewshed"]')
  if (btn) btn.addEventListener('click', _togglePanel)
  _createPanel()
  // 场景就绪后才注册点击事件
  onSceneReady(() => _registerClickEvent())
}

/**
 * 创建参数控制面板（注入到工具栏内）
 */
function _createPanel() {
  const toolbar = document.getElementById('js-floating-toolbar')
  if (!toolbar) return

  const panel = document.createElement('div')
  panel.className = 'viewshed-tool__panel tool-panel'
  panel.id = 'js-viewshed-panel'
  panel.innerHTML = `
    <div class="viewshed-tool__panel-title">可视域分析</div>
    <div class="viewshed-tool__row">
      <label>视野角度</label>
      <input type="range" id="js-vs-fov" min="10" max="120" value="70" step="5" />
      <span id="js-vs-fov-val">70°</span>
    </div>
    <div class="viewshed-tool__row">
      <label>可视半径</label>
      <input type="range" id="js-vs-radius" min="100" max="3000" value="800" step="100" />
      <span id="js-vs-radius-val">800m</span>
    </div>
    <div class="viewshed-tool__hint" id="js-vs-hint">点击场景地面设置观察点</div>
  `
  toolbar.appendChild(panel)

  // 滑块实时更新（节流保护 GPU）
  document.getElementById('js-vs-fov').addEventListener('input', (e) => {
    document.getElementById('js-vs-fov-val').textContent = e.target.value + '°'
    _throttledUpdate()
  })
  document.getElementById('js-vs-radius').addEventListener('input', (e) => {
    document.getElementById('js-vs-radius-val').textContent = e.target.value + 'm'
    _throttledUpdate()
  })
}

/**
 * 切换面板显示，同时控制取点模式
 */
function _togglePanel() {
  const btn = document.querySelector('#js-floating-toolbar [data-tool="viewshed"]')
  const panel = document.getElementById('js-viewshed-panel')
  if (!btn || !panel) return
  const isActive = btn.classList.contains('toolbar-btn--active')

  if (isActive) {
    // 关闭：清理实例，收起面板，退出取点
    _destroy()
    btn.classList.remove('toolbar-btn--active')
    panel.classList.remove('tool-panel--open')
    _picking = false
  } else {
    // 开启：显示面板，进入等待取点状态
    btn.classList.add('toolbar-btn--active')
    panel.classList.add('tool-panel--open')
    _picking = true
    _setHint('点击场景地面设置观察点')
  }
}

/**
 * 注册场景点击事件（取点）
 * 官方真值：RegisterSceneEvents 可重复注册，不覆盖其他模块
 */
async function _registerClickEvent() {
  const App = getApp()
  if (!App) return

  await App.Renderer.RegisterSceneEvents([{
    name: 'OnEntityClicked',
    func: async (res) => {
      if (!_picking) return

      const pos = res?.result?.position
      if (!pos || pos.length < 3) return

      await _placeViewshed(pos)
    },
  }])
}

/**
 * 在指定坐标放置/更新可视域
 * 官方真值：首次 Scene.Add，后续用 SetLocation + Update 避免重复创建
 */
async function _placeViewshed(position) {
  const App = getApp()
  if (!App) return

  const fov = Number(document.getElementById('js-vs-fov').value)
  const radius = Number(document.getElementById('js-vs-radius').value)
  const [lng, lat, alt] = position

  if (_viewshedInstance) {
    // 动态更新：直接更新位置和样式，不重新 Add
    await _viewshedInstance.SetLocation([lng, lat, alt + 10])
    await _viewshedInstance.Update({
      viewshedStyle: {
        fieldOfView: fov,
        radius,
        outline: true,
        hiddenColor: 'ff3c3ccc',  // 红色半透明：不可见区域
        visibleColor: '3cff71cc', // 绿色半透明：可见区域
      },
    })
    _setHint(`观察点: ${lng.toFixed(5)}, ${lat.toFixed(5)}`)
    return
  }

  // 首次创建
  const viewshed = new App.Viewshed({
    location: [lng, lat, alt + 10], // 观察点抬高 10 米（地面以上人眼高度）
    rotator: { pitch: 0, yaw: 0, roll: 0 },
    viewshedStyle: {
      fieldOfView: fov,
      radius,
      outline: true,
      hiddenColor: 'ff3c3ccc',  // 红色半透明：不可见区域
      visibleColor: '3cff71cc', // 绿色半透明：可见区域
    },
    bVisible: true,
    entityName: '可视域分析',
    customId: 'viewshed-001',
  })

  const res = await App.Scene.Add(viewshed, {
    calculateCoordZ: {
      coordZRef: 'ground',
      coordZOffset: 10, // 抬高 10 米（观察者高度）
    },
  })

  if (res.success) {
    _viewshedInstance = viewshed
    _setHint(`观察点: ${lng.toFixed(5)}, ${lat.toFixed(5)}`)
    console.log('[可视域] 已创建')
  } else {
    console.error('[可视域] 创建失败:', res.message)
    _setHint('创建失败，请重试')
  }
}

/**
 * 节流更新（防止 GPU 过载）
 * 滑块拖动时限制最高 ~3次/秒
 */
function _throttledUpdate() {
  const now = Date.now()
  if (now - _lastUpdateTime < _UPDATE_INTERVAL_MS) return
  _lastUpdateTime = now

  if (!_viewshedInstance) return

  const fov = Number(document.getElementById('js-vs-fov').value)
  const radius = Number(document.getElementById('js-vs-radius').value)

  _viewshedInstance.Update({
    viewshedStyle: {
      fieldOfView: fov,
      radius,
      outline: true,
      hiddenColor: 'ff3c3ccc',
      visibleColor: '3cff71cc',
    },
  }).catch(() => {})
}

/**
 * 更新面板提示文字
 */
function _setHint(text) {
  const el = document.getElementById('js-vs-hint')
  if (el) el.textContent = text
}

/**
 * 清理可视域实体
 */
async function _destroy() {
  if (_viewshedInstance) {
    await _viewshedInstance.Delete().catch(() => {})
    _viewshedInstance = null
    console.log('[可视域] 已清理')
  }
}

/**
 * 销毁（Tab 切换时调用）
 */
export async function destroyViewshed() {
  await _destroy()
  _picking = false
  const btn = document.querySelector('#js-floating-toolbar [data-tool="viewshed"]')
  const panel = document.getElementById('js-viewshed-panel')
  if (btn) btn.classList.remove('toolbar-btn--active')
  if (panel) panel.classList.remove('tool-panel--open')
}