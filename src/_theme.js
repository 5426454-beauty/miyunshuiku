// 主题切换模块 — data-theme 属性 + localStorage 持久化
const STORAGE_KEY = 'shuikujuzhen_theme'

const THEME_NAMES = {
  A: '霓虹科技',
  B: '深蓝科技',
  C: '极简暗黑',
}

/**
 * 切换主题
 * @param {"A"|"B"|"C"} theme
 */
export function switchTheme(theme) {
  if (!['A', 'B', 'C'].includes(theme)) return
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(STORAGE_KEY, theme)
  _updateActiveCard(theme)
  // 重新应用透明度
  const opacitySlider = document.getElementById('js-opacity-slider')
  if (opacitySlider) _applyOpacity(opacitySlider.value)
  console.log(`[主题] 已切换为: ${THEME_NAMES[theme]}`)
  // 通知订阅者（ECharts / Heatmap / Migration 等重新读取 CSS 变量）
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }))
}

/**
 * 获取当前主题
 */
export function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'A'
}

/**
 * 获取主题名称
 */
export function getThemeName(theme) {
  return THEME_NAMES[theme] || ''
}

// ---- 内部 ----

function _updateActiveCard(theme) {
  document.querySelectorAll('.settings-card[data-theme]').forEach(card => {
    card.classList.toggle('active', card.dataset.theme === theme)
  })
}

function _bindSettingsDropdown() {
  const toggle = document.getElementById('js-btn-settings')
  const dropdown = document.getElementById('js-settings-dropdown')
  if (!toggle || !dropdown) return

  toggle.addEventListener('click', (e) => {
    e.stopPropagation()
    dropdown.classList.toggle('hidden')
  })

  // 点击外部关闭
  document.addEventListener('click', () => {
    dropdown.classList.add('hidden')
  })
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation()
  })

  // 主题卡片点击
  dropdown.querySelectorAll('.settings-card[data-theme]').forEach(card => {
    card.addEventListener('click', () => {
      switchTheme(card.dataset.theme)
      dropdown.classList.add('hidden')
    })
  })

  // 面板透明度滑块
  const opacitySlider = document.getElementById('js-opacity-slider')
  const opacityDisplay = document.getElementById('js-opacity-display')
  if (opacitySlider) {
    // 从 localStorage 恢复
    const savedOpacity = localStorage.getItem('shuikujuzhen_panel_opacity')
    if (savedOpacity) {
      opacitySlider.value = savedOpacity
      opacityDisplay.textContent = savedOpacity + '%'
      _applyOpacity(savedOpacity)
    }
    opacitySlider.addEventListener('input', () => {
      const val = opacitySlider.value
      opacityDisplay.textContent = val + '%'
      _applyOpacity(val)
      localStorage.setItem('shuikujuzhen_panel_opacity', val)
    })
  }
}

// 各主题面板基础色（rgb部分）
const PANEL_COLORS = {
  A: '0, 10, 20',
  B: '10, 14, 26',
  C: '12, 12, 12',
}

function _applyOpacity(val) {
  const alpha = (val / 100).toFixed(2)
  const theme = getCurrentTheme()
  const rgb = PANEL_COLORS[theme] || PANEL_COLORS.A
  document.documentElement.style.setProperty('--bg-panel', `rgba(${rgb}, ${alpha})`)
}

/**
 * 页面加载时恢复上次主题（默认霓虹科技 A）
 */
export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY) || 'A'
  switchTheme(saved)
  _bindSettingsDropdown()
}