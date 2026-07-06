// 右侧面板 — 支持多种 renderType 动态切换
import * as echarts from 'echarts'
import { getChartTheme } from './_chartTheme.js'

let _safetyChart = null

// ─────────────────────────────────────────
// 面板1 — 多种 renderType
// ─────────────────────────────────────────

function _renderGrid(items, badge) {
  return `
    <div class="water-quality-grid">
      ${items.map(i => `
        <div class="wq-item">
          <span class="wq-label">${i.label}</span>
          <span class="wq-value">${i.value}</span>
          <span class="wq-unit">${i.unit}</span>
        </div>
      `).join('')}
    </div>
    <div class="panel1-footer">
      <span class="quality-badge" style="color:${badge.color};border-color:${badge.color};background:${badge.color}22">
        ${badge.text}
      </span>
    </div>
  `
}

function _renderProgress(items, badge) {
  return `
    <div class="progress-list">
      ${items.map(i => `
        <div class="progress-item">
          <div class="progress-header">
            <span class="progress-label">${i.label}</span>
            <span class="progress-val" style="color:${i.color}">${i.value}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${i.value}%;background:${i.color}"></div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="panel1-footer">
      <span class="quality-badge" style="color:${badge.color};border-color:${badge.color};background:${badge.color}22">
        ${badge.text}
      </span>
    </div>
  `
}

function _renderStatusTag(items, badge) {
  return `
    <div class="status-tag-grid">
      ${items.map(i => `
        <div class="status-tag-item">
          <span class="status-tag-label">${i.label}</span>
          <span class="status-tag-val" style="color:${i.statusColor};border-color:${i.statusColor}66;background:${i.statusColor}18">
            ${i.status}
          </span>
        </div>
      `).join('')}
    </div>
    <div class="panel1-footer">
      <span class="quality-badge" style="color:${badge.color};border-color:${badge.color};background:${badge.color}22">
        ${badge.text}
      </span>
    </div>
  `
}

function _updatePanel1(data) {
  const header = document.querySelector('#panel-water .panel__header')
  if (header) header.innerHTML = `<span class="panel__icon">◈</span>${data.title}`

  const body = document.querySelector('#panel-water .panel__body')
  if (!body) return

  if (data.renderType === 'grid') {
    body.innerHTML = _renderGrid(data.items, data.badge)
  } else if (data.renderType === 'progress') {
    body.innerHTML = _renderProgress(data.items, data.badge)
  } else if (data.renderType === 'status-tag') {
    body.innerHTML = _renderStatusTag(data.items, data.badge)
  }
}

// ─────────────────────────────────────────
// 面板2 — 弧形评分仪表（固定结构，数据切换）
// ─────────────────────────────────────────

function _updatePanel2(data) {
  const header = document.querySelector('#panel-safety .panel__header')
  if (header) header.innerHTML = `<span class="panel__icon">◈</span>${data.title}`

  const scoreNumEl   = document.querySelector('.score-num')
  const scoreLabelEl = document.querySelector('.score-label')
  if (scoreNumEl)   { scoreNumEl.textContent = data.score; scoreNumEl.style.color = data.scoreColor }
  if (scoreLabelEl)  scoreLabelEl.textContent = data.scoreLabel

  if (_safetyChart) {
    const t = getChartTheme()
    _safetyChart.setOption({
      series: [{
        axisLine: {
          lineStyle: {
            color: [[data.score / 100, data.scoreColor], [1, t.gaugeTrack]],
          },
        },
        data: [{ value: data.score }],
      }],
    })
  }

  const metricsEl = document.getElementById('js-safety-metrics')
  if (metricsEl) {
    metricsEl.innerHTML = data.metrics.map(m => `
      <div class="safety-metric-item">
        <span class="sm-label">${m.label}</span>
        <span class="sm-value" style="color:${m.color}">${m.value}</span>
      </div>
    `).join('')
  }
}

// ─────────────────────────────────────────
// 面板3 — event-list / alert-list
// ─────────────────────────────────────────

function _renderEventList(events) {
  return events.map(item => `
    <div class="invest-item">
      <div class="invest-icon">${item.icon}</div>
      <div class="invest-info">
        <div class="invest-title">${item.title}</div>
        <div class="invest-val" style="color:${item.color}">${item.desc}</div>
      </div>
      <div class="invest-rate" style="color:${item.color}">${item.rate}</div>
    </div>
  `).join('')
}

function _renderAlertList(events) {
  return events.map(item => `
    <div class="alert-item" style="border-left:3px solid ${item.color}">
      <div class="alert-left">
        <span class="alert-icon">${item.icon}</span>
        <div class="alert-info">
          <div class="alert-title">${item.title}</div>
          <div class="alert-desc" style="color:${item.color}">${item.desc}</div>
        </div>
      </div>
      <span class="alert-level" style="color:${item.color};border-color:${item.color}66;background:${item.color}18">
        ${item.rate}
      </span>
    </div>
  `).join('')
}

function _updatePanel3(data) {
  const header = document.querySelector('#panel-invest .panel__header')
  if (header) header.innerHTML = `<span class="panel__icon">◈</span>${data.title}`

  const container = document.getElementById('js-invest-items')
  if (!container) return

  if (data.renderType === 'alert-list') {
    container.innerHTML = _renderAlertList(data.events)
  } else {
    container.innerHTML = _renderEventList(data.events)
  }
}

// ─────────────────────────────────────────
// 公共 API
// ─────────────────────────────────────────

export function initRightPanels(rightData) {
  _updatePanel1(rightData.panel1)

  // 初始化弧形仪表（固定结构，只需创建一次）
  const el = document.getElementById('gauge-safety')
  if (el) {
    const t = getChartTheme()
    _safetyChart = echarts.init(el, null, { renderer: 'canvas' })
    _safetyChart.setOption({
      backgroundColor: 'transparent',
      series: [{
        type: 'gauge',
        startAngle: 210, endAngle: -30,
        radius: '95%', min: 0, max: 100,
        axisLine: {
          lineStyle: {
            width: 12,
            color: [[rightData.panel2.score / 100, rightData.panel2.scoreColor],
                    [1, t.gaugeTrack]],
          },
        },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: false }, pointer: { show: false }, detail: { show: false },
        data: [{ value: rightData.panel2.score }],
      }],
    })
  }

  _updatePanel2(rightData.panel2)
  _updatePanel3(rightData.panel3)
}

export function updateRightPanels(rightData) {
  _updatePanel1(rightData.panel1)

  const safetyPanel = document.getElementById('panel-safety')
  if (rightData.panel2) {
    if (safetyPanel) safetyPanel.style.display = ''
    _updatePanel2(rightData.panel2)
  } else {
    if (safetyPanel) safetyPanel.style.display = 'none'
  }

  const investPanel = document.getElementById('panel-invest')
  if (rightData.panel3) {
    if (investPanel) investPanel.style.display = ''
    _updatePanel3(rightData.panel3)
  } else {
    if (investPanel) investPanel.style.display = 'none'
  }
}
