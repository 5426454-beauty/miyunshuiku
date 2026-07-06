// 天气和时间控制模块 — 控件在设置下拉面板中
import { getApp, onSceneReady } from './_wdp.js'

/**
 * 初始化天气和时间控制
 */
export function initWeatherControl() {
  // 等待场景就绪后再绑定事件
  onSceneReady(() => {
    _bindEvents()
    console.log('[天气控制] 已启用')
  })
}

/**
 * 绑定事件（控件已在 index.html 的设置下拉面板中）
 */
function _bindEvents() {
  const weatherSelect = document.getElementById('js-weather-select')
  const timeSlider = document.getElementById('js-time-slider')
  const timeDisplay = document.getElementById('js-time-display')
  const presetBtns = document.querySelectorAll('.settings-preset-btn')

  if (!weatherSelect || !timeSlider) return

  // 天气切换
  weatherSelect.addEventListener('change', async (e) => {
    const weatherType = e.target.value
    await _setWeather(weatherType)
  })

  // 时间滑块
  timeSlider.addEventListener('input', (e) => {
    const hour = parseFloat(e.target.value)
    _updateTimeDisplay(hour)
  })

  timeSlider.addEventListener('change', async (e) => {
    const hour = parseFloat(e.target.value)
    await _setTime(hour)
  })

  // 快捷时间按钮
  presetBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const hour = parseFloat(btn.dataset.time)
      timeSlider.value = hour
      _updateTimeDisplay(hour)
      await _setTime(hour)
    })
  })
}

/**
 * 设置天气
 */
async function _setWeather(type) {
  const App = getApp()
  if (!App) return

  try {
    const res = await App.Environment.SetSceneWeather(type, 1, false)
    console.log(`[天气] 已切换至: ${type}`, res)
  } catch (err) {
    console.error('[天气] 设置失败:', err)
  }
}

/**
 * 设置时间
 */
async function _setTime(hour) {
  const App = getApp()
  if (!App) return

  try {
    const h = Math.floor(hour)
    const m = Math.round((hour % 1) * 60)
    const hh = String(h).padStart(2, '0')
    const mm = String(m).padStart(2, '0')
    const timeString = `${hh}:${mm}`

    const res = await App.Environment.SetSkylightTime(timeString, 1, false)
    console.log(`[时间] 已设置为: ${timeString}`, res)
  } catch (err) {
    console.error('[时间] 设置失败:', err)
  }
}

// ── 供 AI 模块调用的公开接口 ──────────────────────
export async function setWeather(type) { return _setWeather(type) }
export async function setTime(hour)    { return _setTime(hour) }

/**
 * 更新时间显示
 */
function _updateTimeDisplay(hour) {
  const h = Math.floor(hour)
  const m = Math.round((hour % 1) * 60)
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  const display = document.getElementById('js-time-display')
  if (display) {
    display.textContent = `${hh}:${mm}`
  }
}