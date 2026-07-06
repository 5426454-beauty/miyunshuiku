// Tab 切换模块：绑定导航点击，切换两侧面板数据
import { tabData } from './mockData.js'
import { updateLeftPanels }  from './_leftPanel.js'
import { updateRightPanels } from './_rightPanel.js'
import { hideInspectionRoutes } from './_inspection.js'
import { destroyHeatmap } from './_heatmap.js'
import { destroyMigration } from './_migration.js'
import { destroyViewshed } from './_viewshed.js'
import { stopAllGates, initGates } from './_gate.js'
import { destroyRainfall, initRainfallScene } from './_rainfall.js'
import { destroyDrone } from './_drone.js'
import { showDischargePanel, hideDischargePanel } from './_discharge.js'
import { showFloodPanel, hideFloodPanel } from './_flood.js'
import { showDamPanel, hideDamPanel } from './_dam.js'

import { showMapAnalysisTab, hideMapAnalysisTab } from './_mapAnalysisTab.js'

const _TAB_MAP = {
  '首页': 'home',
  '四全': 'siQuan',
  '四制': 'siZhi',
  '四预': 'siYu',
  '四管': 'siGuan',
  '地图分析': '_map3d',
}

let _currentTab = '首页'

// AI 创建的自定义标签数据，key = 标签名
const _customTabData = {}

function _switchTab(tabName) {
  if (tabName === _currentTab) return

  // 离开地图分析时：隐藏自定义面板
  if (_currentTab === '地图分析') {
    hideMapAnalysisTab()
  }

  // 离开四管时：销毁场景效果 + 隐藏悬浮球 + 隐藏大坝面板
  if (_currentTab === '四管') {
    hideInspectionRoutes()
    destroyHeatmap()
    destroyMigration()
    destroyViewshed()
    stopAllGates()
    destroyRainfall()
    destroyDrone()
    hideDamPanel()
    _setToolsVisible(false)
  }

  // 离开四预时：隐藏降雨面板 + 泄洪 + 淹没，恢复预警处置能力面板
  if (_currentTab === '四预') {
    hideDischargePanel()
    hideFloodPanel()
    const rainfallPanel = document.getElementById('panel-rainfall-sim')
    if (rainfallPanel) rainfallPanel.style.display = 'none'
    const gatePanel = document.getElementById('panel-gate')
    if (gatePanel) gatePanel.style.display = ''
    const waterPanel = document.getElementById('panel-water')
    if (waterPanel) waterPanel.classList.remove('panel--collapsed')
  }

  _currentTab = tabName

  // 无人机巡检卡片 — 只在首页显示
  const droneCard = document.getElementById('js-drone-patrol')
  if (droneCard) {
    droneCard.style.display = (tabName === '首页') ? '' : 'none'
  }

  // 进入四管时：显示悬浮球 + 大坝面板
  // 进入地图分析：显示 3D 分析面板
  if (tabName === '地图分析') {
    showMapAnalysisTab()
    _setToolsVisible(false)
  }

  if (tabName === '四管') {
    _setToolsVisible(true)
    initGates()
    initRainfallScene()
    showDamPanel()
  }

  // 进入四预时：显示降雨模拟面板（替代面板2）+ 泄洪 + 淹没，收起预警处置能力
  if (tabName === '四预') {
    showDischargePanel()
    showFloodPanel()
    const rainfallPanel = document.getElementById('panel-rainfall-sim')
    if (rainfallPanel) rainfallPanel.style.display = ''
    const gatePanel = document.getElementById('panel-gate')
    if (gatePanel) gatePanel.style.display = 'none'
    const waterPanel = document.getElementById('panel-water')
    if (waterPanel) waterPanel.classList.add('panel--collapsed')
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('nav-item--active', item.textContent.trim() === tabName)
  })

  // 优先内置数据，再查自定义数据
  const key = _TAB_MAP[tabName]

  // 地图分析 Tab 不需要 mock 数据（使用自定义面板）
  if (key === '_map3d') return

  const data = key ? tabData[key] : _customTabData[tabName]
  if (!data) return

  updateLeftPanels(data.left)
  updateRightPanels(data.right)
}

/** 为所有 panel 标题栏绑定折叠切换 */
function _initCollapsiblePanels() {
  document.querySelectorAll('.panel__header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('panel--collapsed')
    })
  })
}

export function initTabSwitch() {
  // 动态添加"地图分析" Tab
  const nav = document.querySelector('.top-bar__nav')
  if (nav && !nav.querySelector('[data-tab="地图分析"]')) {
    const a = document.createElement('a')
    a.className = 'nav-item'
    a.href = '#'
    a.textContent = '地图分析'
    a.dataset.tab = '地图分析'
    nav.appendChild(a)
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault()
      _switchTab(item.textContent.trim())
    })
  })

  // 初始化面板折叠功能
  _initCollapsiblePanels()

  // 监听主题切换，重新渲染 ECharts 图表
  window.addEventListener('theme-changed', () => {
    const key = _TAB_MAP[_currentTab]
    const data = key ? tabData[key] : _customTabData[_currentTab]
    if (data) {
      updateLeftPanels(data.left)
      updateRightPanels(data.right)
    }
  })
}

// ── 供 AI 模块调用的公开接口 ──────────────────────

export function triggerTab(name) {
  _switchTab(name)
}

/**
 * 创建自定义标签页（以现有 Tab 数据为模板），自动切换
 */
export function createCustomTab(name, template = '首页') {
  // 已存在则直接切换
  if (_TAB_MAP[name] || _customTabData[name]) {
    _switchTab(name)
    return
  }

  // 支持中文名（首页）或数据 key（home）两种写法
  const dataKey = _TAB_MAP[template] || template
  const src = tabData[dataKey] || tabData.home
  _customTabData[name] = JSON.parse(JSON.stringify(src))

  // 动态插入导航 Tab
  const nav = document.querySelector('.top-bar__nav')
  const a = document.createElement('a')
  a.className = 'nav-item nav-item--custom'
  a.href = '#'
  a.textContent = name
  a.addEventListener('click', e => {
    e.preventDefault()
    _switchTab(name)
  })
  nav.appendChild(a)

  _switchTab(name)
}

/**
 * 删除自定义标签页（内置 Tab 不可删除）
 */
export function removeCustomTab(name) {
  if (!_customTabData[name]) return

  delete _customTabData[name]

  document.querySelectorAll('.nav-item--custom').forEach(item => {
    if (item.textContent.trim() === name) item.remove()
  })

  // 若当前就在该 Tab，退回首页
  if (_currentTab === name) {
    _currentTab = ''
    _switchTab('首页')
  }
}

function _setToolsVisible(visible) {
  const toolbar = document.getElementById('js-floating-toolbar')
  if (toolbar) toolbar.style.display = visible ? 'flex' : 'none'
}
