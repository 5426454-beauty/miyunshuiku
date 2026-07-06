// 动态面板渲染器 — 首页面板根据 config.json 配置动态生成
import * as echarts from 'echarts'
import { tabData } from './mockData.js'
import { getChartTheme } from './_chartTheme.js'

const CONFIG_API = 'http://localhost:3001/api/config'

// 各 chartType 的 fallback 数据（对应 mockData.home 的首页数据）
const _FALLBACK = {
  line: {
    labels: tabData.home.left.panel3.dates,
    values: tabData.home.left.panel3.values,
  },
  bar: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    values: [68, 75, 62, 80, 71, 85],
  },
  list: {
    items: tabData.home.left.panel1.stats.map(s => ({
      label: s.label, value: s.value, unit: s.unit,
    })),
  },
}

// 已创建的 echarts 实例，切换 Tab 时 dispose
let _charts = []

function _disposeCharts() {
  _charts.forEach(c => c.dispose())
  _charts = []
}

// 从配置的 API 列表里按名称找到对应 URL 并 fetch
async function _fetchData(dataSourceId, apis) {
  if (!dataSourceId) return null
  const api = apis.find(a => a.name === dataSourceId)
  if (!api) return null
  try {
    const res = await fetch(api.url)
    return await res.json()
  } catch {
    return null
  }
}

// 折线图
function _renderLine(el, data) {
  const t = getChartTheme()
  const chart = echarts.init(el, null, { renderer: 'canvas' })
  chart.setOption({
    backgroundColor: 'transparent',
    grid: { top: 10, bottom: 22, left: 40, right: 10 },
    xAxis: {
      type: 'category',
      data: data.labels,
      axisLine:  { lineStyle: { color: t.axisLine } },
      axisLabel: { color: t.axisLabel, fontSize: 9, interval: 4 },
      axisTick:  { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: t.splitLine } },
      axisLabel: { color: t.axisLabel, fontSize: 9 },
    },
    series: [{
      type: 'line',
      data: data.values,
      smooth: true,
      symbol: 'none',
      lineStyle: { color: t.cyan, width: 2 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: t.areaFrom },
            { offset: 1, color: t.areaTo },
          ],
        },
      },
    }],
  })
  _charts.push(chart)
}

// 柱状图
function _renderBar(el, data) {
  const t = getChartTheme()
  const chart = echarts.init(el, null, { renderer: 'canvas' })
  chart.setOption({
    backgroundColor: 'transparent',
    grid: { top: 10, bottom: 22, left: 28, right: 10 },
    xAxis: {
      type: 'category',
      data: data.labels,
      axisLine:  { lineStyle: { color: t.axisLine } },
      axisLabel: { color: t.axisLabel, fontSize: 9 },
      axisTick:  { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: t.splitLine } },
      axisLabel: { color: t.axisLabel, fontSize: 9 },
    },
    series: [{
      type: 'bar',
      data: data.values.map(v => ({
        value: v,
        itemStyle: { color: t.cyan, borderRadius: [3, 3, 0, 0] },
      })),
      barMaxWidth: 16,
    }],
  })
  _charts.push(chart)
}

// 列表
function _renderList(el, data) {
  el.innerHTML = data.items.map(item => `
    <div class="dyn-list-item">
      <span class="dyn-list-label">${item.label}</span>
      <span class="dyn-list-value">${item.value}${item.unit ? ` <em>${item.unit}</em>` : ''}</span>
    </div>
  `).join('')
}

// 渲染单侧面板
async function _renderSide(panelCfg, sideEl, apis) {
  if (!sideEl) return

  // 应用面板样式
  const s = panelCfg.style || {}
  if (s.width)              sideEl.style.width   = s.width
  if (s.bgColor)            sideEl.style.background = s.bgColor
  if (s.opacity !== undefined) sideEl.style.opacity = s.opacity

  // 重建面板内容
  sideEl.innerHTML = ''

  for (const mod of (panelCfg.modules || [])) {
    const chartId = `dyn-chart-${mod.id}`
    const isChart = mod.chartType === 'line' || mod.chartType === 'bar'

    sideEl.insertAdjacentHTML('beforeend', `
      <section class="panel">
        <div class="panel__header">
          <span class="panel__icon">◈</span>${mod.title}
        </div>
        <div class="panel__body">
          <div id="${chartId}"${isChart ? ' style="width:100%;height:160px;"' : ' class="dyn-list"'}></div>
        </div>
      </section>
    `)

    // 获取数据：先尝试 API，失败则用 fallback
    let data = await _fetchData(mod.dataSourceId, apis)
    if (!data) data = _FALLBACK[mod.chartType] || _FALLBACK.list

    const el = document.getElementById(chartId)
    if (!el) continue

    if (mod.chartType === 'line')      _renderLine(el, data)
    else if (mod.chartType === 'bar')  _renderBar(el, data)
    else                               _renderList(el, data)
  }
}

// 公共入口：初始化 / 重渲染动态面板（首页调用）
export async function initDynPanels() {
  _disposeCharts()

  let config
  try {
    const res = await fetch(CONFIG_API)
    config = await res.json()
  } catch {
    // 后端不可用，降级到 mockData 原始渲染
    const { initLeftPanels }  = await import('./_leftPanel.js')
    const { initRightPanels } = await import('./_rightPanel.js')
    initLeftPanels(tabData.home.left)
    initRightPanels(tabData.home.right)
    return
  }

  const leftEl  = document.querySelector('.side-panel--left')
  const rightEl = document.querySelector('.side-panel--right')
  const apis    = config.apis || []

  await Promise.all([
    _renderSide(config.panels.left,  leftEl,  apis),
    _renderSide(config.panels.right, rightEl, apis),
  ])
}
