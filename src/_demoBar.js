// _demoBar.js — 路演专用：步骤指示器 + 快速操作条
// 根据演示阶段动态切换可见按钮

import { showFloodHeatmap, hideFloodHeatmap, jumpToPeak, playFlood, pauseFlood, getFloodState } from './_floodHeatmap.js'
import { toggleGate } from './_gate.js'
import { startRainfall } from './_rainfall.js'
import { setWeather } from './_weather.js'

const STAGES = [
  { id: 0, label: '',         actions: [] },
  { id: 1, label: '预警',     actions: [
    { id: 'rain',     icon: '🌧', label: '暴雨',   action() { startRainfall(120); setWeather('ModerateRain') } },
    { id: 'dem',      icon: '📊', label: 'DEM分析', action() { /* AI驱动 */ } },
    { id: 'flood',    icon: '🌊', label: '淹没热力', action() { showFloodHeatmap() } },
  ]},
  { id: 2, label: '评估',     actions: [] },  // AI驱动
  { id: 3, label: '决策',     actions: [
    { id: 'confirm',  icon: '✅', label: '确认执行', action() { /* AI驱动 */ } },
  ]},
  { id: 4, label: '执行',     actions: [
    { id: 'flood2',   icon: '🌊', label: '淹没热力', action() { showFloodHeatmap() } },
    { id: 'peak',     icon: '🔝', label: '洪峰',   action() { jumpToPeak() } },
    { id: 'gate',     icon: '🚪', label: '闸门',   action() { toggleGate(0); toggleGate(1) } },
  ]},
  { id: 5, label: '验证',     actions: [
    { id: 'compare',  icon: '📊', label: '对比分析', action() { /* AI驱动 */ } },
  ]},
  { id: 6, label: '',         actions: [] },
]

let _currentStage = 0
let _barEl = null
let _stepEl = null

// ── 创建步骤指示器 ──
function _createStepBar() {
  if (document.getElementById('js-demo-stepbar')) return
  const el = document.createElement('div')
  el.id = 'js-demo-stepbar'
  el.className = 'demo-stepbar'
  el.style.display = 'none'
  el.innerHTML = STAGES.filter(function(s) { return s.id > 0 && s.id < 6 }).map(function(s) {
    return '<span class="demo-stepbar__dot" data-stage="' + s.id + '">' + s.label + '</span>'
  }).join('<span class="demo-stepbar__connector">→</span>')
  document.querySelector('.scene-container').appendChild(el)
  _stepEl = el
}

// ── 创建快速操作条 ──
function _createActionBar() {
  if (document.getElementById('js-demo-actionbar')) return
  const el = document.createElement('div')
  el.id = 'js-demo-actionbar'
  el.className = 'demo-actionbar'
  el.style.display = 'none'
  document.querySelector('.scene-container').appendChild(el)
  _barEl = el
}

function _rebuildActions() {
  if (!_barEl) return
  const stage = STAGES[_currentStage]
  if (!stage || stage.actions.length === 0) {
    _barEl.style.display = 'none'
    _barEl.innerHTML = ''
    return
  }
  _barEl.style.display = ''
  _barEl.innerHTML = stage.actions.map(function(a) {
    return '<button class="demo-actionbar__btn" data-action="' + a.id + '" title="' + a.label + '">' + a.icon + ' ' + a.label + '</button>'
  }).join('')

  // 绑定事件
  _barEl.querySelectorAll('.demo-actionbar__btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const id = this.dataset.action
      const action = stage.actions.find(function(a) { return a.id === id })
      if (action && action.action) action.action()
    })
  })
}

// ── 公开 API ──

/** 初始化 */
export function initDemoBar() {
  _createStepBar()
  _createActionBar()
}

/** 切换到指定阶段 */
export function setStage(stageId) {
  _currentStage = stageId

  // 更新步骤指示器
  if (_stepEl) {
    _stepEl.style.display = (stageId >= 1 && stageId <= 5) ? '' : 'none'
    _stepEl.querySelectorAll('.demo-stepbar__dot').forEach(function(dot) {
      var s = parseInt(dot.dataset.stage, 10)
      dot.classList.toggle('demo-stepbar__dot--active', s === stageId)
      dot.classList.toggle('demo-stepbar__dot--done', s < stageId)
    })
  }

  // 重建操作按钮
  _rebuildActions()
}

/** 下一步 */
export function nextStage() {
  if (_currentStage < 6) setStage(_currentStage + 1)
}

/** 上一步 */
export function prevStage() {
  if (_currentStage > 1) setStage(_currentStage - 1)
}

/** 获取当前阶段 */
export function getStage() { return _currentStage }