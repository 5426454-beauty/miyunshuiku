// 左侧面板 — 支持多种 chartType 动态切换
import * as echarts from 'echarts'
import { bindSurveillanceBtn } from './_surveillance.js'
import { toggleRoute, isRouteVisible } from './_inspection.js'
import { getChartTheme } from './_chartTheme.js'
// echarts 实例，切换 tab 时先 dispose 再重建
let _p2Chart = null
let _p3Chart = null

// ─────────────────────────────────────────
// echarts option 构建器
// ─────────────────────────────────────────

function _optDualGauge(gaugeA, gaugeB) {
  const t = getChartTheme()
  const _gauge = (value, name, color, cx) => ({
    type: 'gauge',
    center: [cx, '52%'],
    radius: '80%',
    startAngle: 210, endAngle: -30,
    min: 0, max: 100,
    axisLine: {
      lineStyle: {
        width: 10,
        color: [[value / 100, color], [1, t.gaugeTrack]],
      },
    },
    axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
    pointer: { length: '52%', width: 4, itemStyle: { color } },
    detail: {
      valueAnimation: true, fontSize: 16, fontWeight: 'bold',
      color, formatter: '{value}%', offsetCenter: [0, '65%'],
    },
    title: { show: true, fontSize: 11, color: t.axisLabel, offsetCenter: [0, '90%'] },
    data: [{ value, name }],
  })
  return {
    backgroundColor: 'transparent',
    series: [_gauge(gaugeA.value, gaugeA.label, gaugeA.color, '28%'),
             _gauge(gaugeB.value, gaugeB.label, gaugeB.color, '72%')],
  }
}

function _optRadar(indicators, values, color) {
  const t = getChartTheme()
  return {
    backgroundColor: 'transparent',
    radar: {
      indicator: indicators,
      center: ['50%', '52%'],
      radius: '68%',
      axisName: { color: t.axisLabel, fontSize: 10 },
      axisLine:  { lineStyle: { color: t.axisLine } },
      splitLine: { lineStyle: { color: t.splitLine } },
      splitArea: { areaStyle: { color: [t.areaTo, t.gaugeTrack] } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: values,
        areaStyle: { color: `${color}30` },
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        symbol: 'circle', symbolSize: 5,
      }],
    }],
  }
}

function _optHBar(items) {
  const t = getChartTheme()
  const labels = items.map(i => i.label).reverse()
  const vals   = items.map(i => i.value).reverse()
  const colors = items.map(i => i.color).reverse()
  return {
    backgroundColor: 'transparent',
    grid: { top: 4, bottom: 4, left: 56, right: 36 },
    xAxis: {
      type: 'value', max: 100, show: false,
    },
    yAxis: {
      type: 'category', data: labels,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.axisLabel, fontSize: 10 },
    },
    series: [{
      type: 'bar',
      data: vals.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [0, 3, 3, 0] } })),
      barMaxWidth: 12,
      label: { show: true, position: 'right', color: t.axisLabel, fontSize: 10,
               formatter: '{c}%' },
      backgroundStyle: { color: t.gaugeTrack, borderRadius: [0, 3, 3, 0] },
      showBackground: true,
    }],
  }
}

function _optAreaLine(dates, values, yMin, lineColor) {
  const t = getChartTheme()
  const hex = lineColor.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return {
    backgroundColor: 'transparent',
    grid: { top: 10, bottom: 22, left: 40, right: 10 },
    xAxis: {
      type: 'category', data: dates,
      axisLine:  { lineStyle: { color: t.axisLine } },
      axisLabel: { color: t.axisLabel, fontSize: 9, interval: 4 },
      axisTick:  { show: false },
    },
    yAxis: {
      type: 'value', min: yMin,
      splitLine: { lineStyle: { color: t.splitLine } },
      axisLabel: { color: t.axisLabel, fontSize: 9 },
    },
    series: [{
      type: 'line', data: values, smooth: true, symbol: 'none',
      lineStyle: { color: lineColor, width: 2 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: `rgba(${r},${g},${b},0.4)` },
            { offset: 1, color: `rgba(${r},${g},${b},0.02)` },
          ],
        },
      },
    }],
  }
}

function _optVBar(dates, values, colorMap) {
  const t = getChartTheme()
  const maxVal = Math.max(...values)
  const barColors = values.map(v => colorMap[v] ?? colorMap[3])
  return {
    backgroundColor: 'transparent',
    grid: { top: 10, bottom: 22, left: 28, right: 10 },
    xAxis: {
      type: 'category', data: dates,
      axisLine:  { lineStyle: { color: t.axisLine } },
      axisLabel: { color: t.axisLabel, fontSize: 9, interval: 4 },
      axisTick:  { show: false },
    },
    yAxis: {
      type: 'value', min: 0, max: Math.max(maxVal + 1, 4),
      splitLine: { lineStyle: { color: t.splitLine } },
      axisLabel: { color: t.axisLabel, fontSize: 9 },
    },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: barColors[i], borderRadius: [3, 3, 0, 0] } })),
      barMaxWidth: 14,
    }],
  }
}

// ─────────────────────────────────────────
// 面板 DOM 更新
// ─────────────────────────────────────────

function _updatePanel1(data) {
  const header = document.querySelector('#panel-intro .panel__header')
  if (header) header.innerHTML = `<span class="panel__icon">◈</span>${data.title}`

  const statsEl = document.querySelector('#panel-intro .intro-stats')
  if (statsEl) {
    statsEl.innerHTML = data.stats.map(s => `
      <div class="stat-item">
        <span class="stat-label">${s.label}</span>
        <span class="stat-value">${s.value} <em>${s.unit}</em></span>
      </div>
    `).join('')
  }

  const descEl = document.querySelector('#panel-intro .intro-desc')
  if (descEl) descEl.textContent = data.desc

  const body = document.querySelector('#panel-intro .panel__body')

  // 四全 tab 注入视频监控按钮
  const oldSurv = body?.querySelector('.surveillance-btn')
  if (oldSurv) oldSurv.remove()
  if (data.showSurveillanceBtn && body) {
    const btn = document.createElement('button')
    btn.className = 'surveillance-btn'
    btn.textContent = '开启视频监控'
    body.appendChild(btn)
    bindSurveillanceBtn(btn)
  }
}

function _updatePanel2(data) {
  const header = document.querySelector('#panel-gate .panel__header')
  if (header) header.innerHTML = `<span class="panel__icon">◈</span>${data.title}`

  const body = document.querySelector('#panel-gate .panel__body')
  if (!body) return

  // 销毁旧实例
  if (_p2Chart) { _p2Chart.dispose(); _p2Chart = null }

  if (data.chartType === 'dual-gauge') {
    body.innerHTML = `
      <div id="p2-chart" style="width:100%;height:130px;"></div>
      <div class="gate-stats" id="p2-stats"></div>
    `
    _p2Chart = echarts.init(document.getElementById('p2-chart'), null, { renderer: 'canvas' })
    _p2Chart.setOption(_optDualGauge(data.gaugeA, data.gaugeB))

  } else if (data.chartType === 'radar') {
    body.innerHTML = `
      <div id="p2-chart" style="width:100%;height:148px;"></div>
      <div class="gate-stats" id="p2-stats"></div>
    `
    _p2Chart = echarts.init(document.getElementById('p2-chart'), null, { renderer: 'canvas' })
    _p2Chart.setOption(_optRadar(data.indicators, data.values, data.radarColor))

  } else if (data.chartType === 'hbar') {
    const rowH = Math.max(110, data.items.length * 18)
    body.innerHTML = `
      <div id="p2-chart" style="width:100%;height:${rowH}px;"></div>
    `
    _p2Chart = echarts.init(document.getElementById('p2-chart'), null, { renderer: 'canvas' })
    _p2Chart.setOption(_optHBar(data.items))
    return  // hbar 不展示 stats 列表
  }

  // dual-gauge / radar 下方渲染 stats
  const statsEl = document.getElementById('p2-stats')
  if (statsEl && data.stats) {
    statsEl.innerHTML = data.stats.map(s => `
      <div class="gate-stat-item">
        <span>${s.label}</span>
        <span class="val-cyan">${s.value} <em>${s.unit}</em></span>
      </div>
    `).join('')
  }
}

function _updatePanel3(data) {
  const header = document.querySelector('#panel-curve .panel__header')
  if (header) header.innerHTML = `<span class="panel__icon">◈</span>${data.title}`

  const body = document.querySelector('#panel-curve .panel__body')
  if (!body) return

  if (_p3Chart) { _p3Chart.dispose(); _p3Chart = null }

  // 预案管理列表（非 ECharts）
  if (data.chartType === 'plan-list') {
    body.innerHTML = `
      <div class="plan-list">
        ${data.plans.map((p, i) => `
          <div class="plan-item" data-plan-id="${p.id}">
            <div class="plan-item-header">
              <span class="plan-item-icon">📄</span>
              <span class="plan-item-title">${p.title}</span>
              <span class="plan-item-level" style="color:${p.levelColor};border-color:${p.levelColor}66">${p.level}</span>
            </div>
            <div class="plan-item-meta">
              <span>${p.date}</span>
              <span class="plan-item-status" style="color:${p.statusColor}">${p.status}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `
    // 绑定点击事件：打开文档查看器
    body.querySelectorAll('.plan-item').forEach(el => {
      el.addEventListener('click', () => {
        const planId = el.dataset.planId
        const plan = data.plans.find(p => p.id === planId)
        if (plan) _showPlanDoc(plan)
      })
    })
    return
  }

  // 机器人巡检图例（非 ECharts）
  if (data.chartType === 'inspection-legend') {
    body.innerHTML = `
      <div class="inspection-legend">
        ${data.routes.map((r, i) => `
          <div class="inspection-route" data-index="${i}">
            <span class="inspection-dot" style="background:${r.color};box-shadow:0 0 6px ${r.color}"></span>
            <span class="inspection-name">${r.name}</span>
            <span class="inspection-status" style="color:${r.color}">${r.status}</span>
            <div class="inspection-bar-wrap">
              <div class="inspection-bar" style="width:${r.progress}%;background:${r.color}"></div>
            </div>
            <span class="inspection-pct">${r.progress}%</span>
          </div>
        `).join('')}
      </div>
    `
    // 绑定点击：切换显隐 + 飞行，更新激活态样式
    body.querySelectorAll('.inspection-route').forEach(el => {
      el.addEventListener('click', async () => {
        const idx = Number(el.dataset.index)
        await toggleRoute(idx)
        el.classList.toggle('inspection-route--active', isRouteVisible(idx))
      })
    })
    return
  }

  body.innerHTML = `
    <div class="curve-meta" id="p3-meta">${data.meta}</div>
    <div id="p3-chart" class="line-chart"></div>
  `

  _p3Chart = echarts.init(document.getElementById('p3-chart'), null, { renderer: 'canvas' })

  if (data.chartType === 'area-line') {
    _p3Chart.setOption(_optAreaLine(data.dates, data.values, data.yMin, data.lineColor))
  } else if (data.chartType === 'vbar') {
    _p3Chart.setOption(_optVBar(data.dates, data.values, data.colorMap))
  }
}

// ─────────────────────────────────────────
// 公共 API
// ─────────────────────────────────────────

export function initLeftPanels(leftData) {
  _updatePanel1(leftData.panel1)
  _updatePanel2(leftData.panel2)
  _updatePanel3(leftData.panel3)
}

// ── 预案文档查看器 ──

function _showPlanDoc(plan) {
  // 移除已有查看器
  const old = document.getElementById('js-plan-viewer')
  if (old) old.remove()

  const viewer = document.createElement('div')
  viewer.id = 'js-plan-viewer'
  viewer.className = 'plan-viewer'
  viewer.innerHTML = `
    <div class="plan-viewer__overlay"></div>
    <div class="plan-viewer__panel">
      <div class="plan-viewer__header">
        <span>📋 ${plan.title}</span>
        <button class="plan-viewer__close" id="js-plan-viewer-close">✕</button>
      </div>
      <div class="plan-viewer__body">${plan.content}</div>
    </div>
  `

  document.querySelector('.scene-container').appendChild(viewer)

  // 关闭事件
  viewer.querySelector('#js-plan-viewer-close').addEventListener('click', () => viewer.remove())
  viewer.querySelector('.plan-viewer__overlay').addEventListener('click', () => viewer.remove())
}

export function updateLeftPanels(leftData) {
  _updatePanel1(leftData.panel1)
  _updatePanel2(leftData.panel2)
  _updatePanel3(leftData.panel3)
}
