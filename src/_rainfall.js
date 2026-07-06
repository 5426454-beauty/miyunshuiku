// 降雨量 → 水位联动模块（CustomApi.WaterSurface）
// 参考 Excel 第12行：WaterSurface API — setvisibility / lift / setheight
import { getApp, onSceneReady } from './_wdp.js'
import { setWeather } from './_weather.js'

// WaterSurface placename（用户实测确认：库区水面 126-158.5m）
const PLACE_WATER = '库区水面'
// 备选：库区可变水面 155-160m（expand/setTransitionZoneColor 专用）
const PLACE_DYNAMIC = '库区可变水面'

const BASE_WATER_LEVEL = 155   // 复位基准水位（米）
const MAX_WATER_LEVEL = 158.5  // 库区水面最高水位
const MM_PER_METER_RISE = 10

// 降雨模拟观察视角（从场景中实测获取）
const RAINFALL_CAMERA_POSE = {
  location: [116.9772199095752, 40.451339388063438, 159.12192299751504],
  rotation: { pitch: -25.388338088989258, yaw: -1.8511199951171875 },
  flyTime: 2,
}

/** 镜头飞到库区水面区域 */
async function _flyToWater() {
  const App = getApp()
  if (!App) return
  try { await App.CameraControl.SetCameraPose(RAINFALL_CAMERA_POSE) } catch (e) {}
}

let animTimer = null
let animActive = false
let currentLevel = BASE_WATER_LEVEL

let _onWaterRiseUpdate = null

export function onWaterRiseUpdate(cb) { _onWaterRiseUpdate = cb }
export function getWaterRiseM()        { return currentLevel - BASE_WATER_LEVEL }
export function isAnimating()          { return animActive }

// ── WaterSurface API ───────────────────────────────────
async function _callWaterSurface(placename, action, params = {}) {
  const App = getApp()
  if (!App) return null

  const jsondata = {
    apiClassName: 'CustomApi',
    apiFuncName: 'WaterSurface',
    args: {
      placename,
      action,
      moreparameters: params,
    },
  }
  try {
    const res = await App.Customize.RunCustomizeApi(jsondata)
    console.log('[Rainfall]', placename + '.' + action, JSON.stringify(params), '→', res?.success)
    return res
  } catch (e) {
    console.warn('[Rainfall] WaterSurface 失败:', e.message)
    return null
  }
}

// ── UI 初始化 ──────────────────────────────────────────
export function initRainfall() {
  // 旧工具栏按钮兼容
  const toolbarBtn = document.querySelector('#js-floating-toolbar [data-tool="rainfall"]')
  if (toolbarBtn) {
    toolbarBtn.addEventListener('click', () => {
      const panel = document.getElementById('js-rainfall-panel')
      if (panel) panel.classList.toggle('tool-panel--open')
    })
  }
  // 旧浮动面板兼容（只在没有新版面板时创建）
  if (!document.getElementById('panel-rainfall-sim')) {
    _createPanel()
  } else {
    _bindNewPanel()
  }

  // 场景就绪后预初始化水面
  onSceneReady(async () => {
    await initRainfallScene()
  })
}

export async function initRainfallScene() {
  console.log('[Rainfall] 场景就绪，初始化库区水面...')
  await _callWaterSurface(PLACE_WATER, 'setvisibility', { show: 'true' })
  currentLevel = BASE_WATER_LEVEL
}

// ── 新版面板绑定 ─────────────────────────────────────────
function _bindNewPanel() {
  const slider = document.getElementById('js-rainfall-slider')
  const sliderVal = document.getElementById('js-rainfall-slider-val')
  const startBtn = document.getElementById('js-rainfall-start')
  const resetBtn = document.getElementById('js-rainfall-reset')
  const progressFill = document.getElementById('js-rainfall-progress-fill')
  const progressText = document.getElementById('js-rainfall-progress-text')
  const progressWrap = document.getElementById('js-rainfall-progress')
  const waterLevelEl = document.getElementById('js-rainfall-waterlevel')
  const mmEl = document.getElementById('js-rainfall-mm')
  const statusEl = document.getElementById('js-rainfall-status')

  // 滑块联动
  if (slider && sliderVal) {
    slider.addEventListener('input', function() {
      sliderVal.textContent = this.value + ' mm'
    })
  }

  // 预设按钮
  document.querySelectorAll('.rainfall-sim__preset').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const mm = parseInt(this.dataset.mm, 10)
      if (slider) { slider.value = mm; slider.dispatchEvent(new Event('input')) }
    })
  })

  // 开始降雨
  if (startBtn) {
    startBtn.addEventListener('click', async function() {
      const mm = parseInt(slider.value, 10) || 0
      if (mm <= 0) return
      startBtn.disabled = true
      if (resetBtn) resetBtn.disabled = true
      if (mmEl) mmEl.innerHTML = mm + '<small>mm/24h</small>'
      if (statusEl) { statusEl.textContent = '降雨中'; statusEl.className = 'rainfall-sim__status rainfall-sim__status--raining' }
      if (progressWrap) progressWrap.style.display = ''
      if (progressFill) progressFill.style.width = '0%'
      try {
        await startRainfall(mm)
      } finally {
        startBtn.disabled = false
        if (resetBtn) resetBtn.disabled = false
      }
    })
  }

  // 停止复位
  if (resetBtn) {
    resetBtn.addEventListener('click', async function() {
      await resetWaterLevel()
      if (waterLevelEl) waterLevelEl.innerHTML = BASE_WATER_LEVEL + '<small>m</small>'
      if (mmEl) mmEl.innerHTML = '--<small>mm/24h</small>'
      if (statusEl) { statusEl.textContent = '正常'; statusEl.className = 'rainfall-sim__status' }
      if (progressWrap) progressWrap.style.display = 'none'
      if (progressFill) progressFill.style.width = '0%'
      if (slider) { slider.value = 0; sliderVal.textContent = '0 mm' }
    })
  }

  // 注册回调更新进度
  onWaterRiseUpdate(function(progress, riseM) {
    var rise = parseFloat(riseM) || 0
    if (progressFill) progressFill.style.width = Math.round(progress) + '%'
    if (progressText) progressText.textContent = '水位: +' + rise.toFixed(1) + 'm'
    if (waterLevelEl) waterLevelEl.innerHTML = (BASE_WATER_LEVEL + rise).toFixed(1) + '<small>m</small>'
    if (statusEl && progress > 0) { statusEl.textContent = progress >= 99 ? '峰值' : '上涨中'; statusEl.className = 'rainfall-sim__status rainfall-sim__status--rising' }
    if (!animActive && progress >= 99) {
      if (statusEl) { statusEl.textContent = '洪峰'; statusEl.className = 'rainfall-sim__status rainfall-sim__status--rising' }
    }
  })
}

// ── 内部辅助 ───────────────────────────────────────────
function _updateUI(progress, riseM) {
  const progressEl = document.getElementById('js-rain-progress')
  const riseEl     = document.getElementById('js-rain-rise')
  if (progressEl) progressEl.style.width = progress + '%'
  if (riseEl)     riseEl.textContent     = riseM + ' m'
  if (!animActive) {
    const startBtn = document.getElementById('js-rain-start')
    const resetBtn = document.getElementById('js-rain-reset')
    if (startBtn) startBtn.disabled = false
    if (resetBtn) resetBtn.disabled = currentLevel <= BASE_WATER_LEVEL
  }
}

function _stopTimer() {
  if (animTimer) { clearInterval(animTimer); animTimer = null }
}

// ── UI 面板 ────────────────────────────────────────────
function _createPanel() {
  onWaterRiseUpdate(_updateUI)

  const toolbar = document.getElementById('js-floating-toolbar')
  if (!toolbar) return

  const panel = document.createElement('div')
  panel.className = 'rainfall-tool__panel tool-panel'
  panel.id        = 'js-rainfall-panel'
  panel.innerHTML = `
    <div class="rainfall-tool__panel-title">降雨量 → 水位联动</div>
    <div class="rainfall-tool__row">
      <label>24H 降雨量</label>
      <input type="range" id="js-rain-slider" min="0" max="300" value="0" />
      <span id="js-rain-val">0</span><span>mm</span>
    </div>
    <div class="rainfall-tool__rise">
      <span class="rainfall-tool__rise-label">预计水位上升</span>
      <span class="rainfall-tool__rise-val" id="js-rain-rise">0.0 m</span>
    </div>
    <div class="rainfall-tool__progress">
      <div class="rainfall-tool__progress-fill" id="js-rain-progress"></div>
    </div>
    <div class="rainfall-tool__btns">
      <button class="rainfall-tool__action-btn" id="js-rain-start">开始模拟</button>
      <button class="rainfall-tool__action-btn rainfall-tool__action-btn--reset" id="js-rain-reset" disabled>复位水位</button>
    </div>
  `
  toolbar.appendChild(panel)

  // 滑块
  const slider = document.getElementById('js-rain-slider')
  const valEl  = document.getElementById('js-rain-val')
  const riseEl = document.getElementById('js-rain-rise')
  slider.addEventListener('input', () => {
    const mm = parseFloat(slider.value)
    valEl.textContent  = mm
    riseEl.textContent = (mm / MM_PER_METER_RISE).toFixed(1) + ' m'
  })

  // 开始模拟
  document.getElementById('js-rain-start').addEventListener('click', async () => {
    const mm = parseFloat(slider.value)
    if (mm <= 0 || animActive) return
    const startBtn = document.getElementById('js-rain-start')
    startBtn.disabled = true
    document.getElementById('js-rain-reset').disabled = false
    const ok = await startRainfall(mm).catch(() => false)
    if (!ok) startBtn.disabled = false
  })

  // 复位
  document.getElementById('js-rain-reset').addEventListener('click', async () => {
    document.getElementById('js-rain-reset').disabled = true
    slider.value = 0
    valEl.textContent  = '0'
    riseEl.textContent = '0.0 m'
    await resetWaterLevel()
  })
}

// ── 降雨模拟（API 自带动画，一次调用搞定）─────────────
export async function startRainfall(mm) {
  const App = getApp()
  if (!App) return false
  if (animActive) { console.log('[Rainfall] 正在动画中，忽略'); return false }

  const mmVal = parseFloat(mm)
  if (!mmVal || mmVal <= 0) return false

  const targetLevel = Math.min(BASE_WATER_LEVEL + mmVal / MM_PER_METER_RISE, MAX_WATER_LEVEL)
  const duration = Math.max(1, Math.round(Math.abs(targetLevel - currentLevel) * 0.5))
  console.log('[Rainfall] ' + mmVal + 'mm → 目标水位 ' + targetLevel.toFixed(1) + 'm, 动画 ' + duration + 's')

  animActive = true

  try {
    await _flyToWater()

    // 切换天气
    const weather = mmVal >= 200 ? 'HeavyRain' :
                    mmVal >= 100 ? 'ModerateRain' :
                    mmVal >= 50  ? 'LightRain' : 'PartlyCloudy'
    await setWeather(weather)

    // 直接调用 setheight（用户实测确认 placename='库区水面' 有效）
    const res = await _callWaterSurface(PLACE_WATER, 'setheight', {
      height: String(targetLevel),
      duration: String(duration),
    })

    currentLevel = targetLevel
    if (_onWaterRiseUpdate) _onWaterRiseUpdate(100, targetLevel - BASE_WATER_LEVEL)

    console.log('[Rainfall] setheight 完成 →', res?.success)
    return !!res?.success
  } catch (e) {
    console.error('[Rainfall] 异常:', e.message)
    return false
  } finally {
    animActive = false
  }
}

// ── 复位 ───────────────────────────────────────────────
export async function resetWaterLevel() {
  const App = getApp()
  if (!App) return

  _stopTimer()
  animActive = false

  const rise = currentLevel - BASE_WATER_LEVEL
  console.log('[Rainfall] 复位, 下降 ' + rise.toFixed(1) + 'm')

  // 先 setheight 回到基准水位
  await _callWaterSurface(PLACE_WATER, 'setheight', {
    height: String(BASE_WATER_LEVEL),
    duration: '2',
  })

  // 等动画完成后更新状态
  currentLevel = BASE_WATER_LEVEL
  if (_onWaterRiseUpdate) _onWaterRiseUpdate(0, 0)

  // 恢复天气
  try {
    const res = await App.Environment.SetSceneWeather('Sunny', 1, false)
    console.log('[Rainfall] 天气已恢复为 Sunny, 水位=' + currentLevel, '结果=' + JSON.stringify(res))
  } catch (e) {
    console.error('[Rainfall] 天气恢复失败:', e.message)
  }
}

// ── 清理 ───────────────────────────────────────────────
export function destroyRainfall() {
  _stopTimer()
  animActive = false
  currentLevel = BASE_WATER_LEVEL
}