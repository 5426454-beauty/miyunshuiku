// ECharts 主题感知颜色工具 — 从 CSS 变量读取当前主题色
export function getChartTheme() {
  const style = getComputedStyle(document.documentElement)
  const cyan = style.getPropertyValue('--cyan').trim() || '#00d4ff'
  const textMuted = style.getPropertyValue('--text-muted').trim() || 'rgba(180,230,255,0.7)'

  const hex = cyan.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)

  return {
    cyan,
    cyanRGB: `${r}, ${g}, ${b}`,
    textMuted,
    axisLine: `rgba(${r},${g},${b},0.2)`,
    axisLabel: textMuted,
    splitLine: `rgba(${r},${g},${b},0.08)`,
    areaFrom: `rgba(${r},${g},${b},0.4)`,
    areaTo: `rgba(${r},${g},${b},0.02)`,
    gaugeTrack: `rgba(${r},${g},${b},0.08)`,
  }
}