// 地图截图工具 — 使用 html2canvas 截取 AMap 2D 卫星图
// 替代 map-agent 的 Playwright 截图，在浏览器端直接完成

import html2canvas from 'html2canvas'

let _mapInstance = null

/**
 * 注册 AMap 地图实例（供截图和搜索模块使用）
 */
export function setMapInstance(map) {
  _mapInstance = map
}

/**
 * 获取当前注册的地图实例
 */
export function getMapInstance() {
  return _mapInstance
}

/**
 * 截取当前 2D 地图卫星图（使用 html2canvas）
 * @returns {Promise<{image: string, bounds: {north,south,east,west}} | null>}
 */
export async function captureMapScreenshot() {
  if (!_mapInstance) {
    console.warn('[MapScreenshot] 地图实例未注册')
    return null
  }

  try {
    const container = document.getElementById('amap-map')
    if (!container) {
      console.warn('[MapScreenshot] amap-map 容器未找到')
      return null
    }

    const canvas = await html2canvas(container, {
      useCORS: true,        // 允许跨域图片（AMap 瓦片来自 webapi.amap.com）
      allowTaint: false,    // 不污染 canvas
      backgroundColor: null,
      logging: false,
    })

    const img_b64 = canvas.toDataURL('image/png')

    // 获取四至边界
    const b = _mapInstance.getBounds()
    const ne = b.getNorthEast()
    const sw = b.getSouthWest()

    return {
      image: img_b64.split(',')[1] || img_b64,
      bounds: {
        north: ne.getLat(),
        south: sw.getLat(),
        east:  ne.getLng(),
        west:  sw.getLng(),
      },
    }
  } catch (e) {
    console.error('[MapScreenshot] 截图失败:', e)
    return null
  }
}

/**
 * 截取缩放后的卫星图（限制尺寸以减少 token 消耗）
 * @param {number} maxWidth - 最大宽度
 * @param {number} maxHeight - 最大高度
 * @returns {Promise<{image: string, bounds: {north,south,east,west}} | null>}
 */
export async function captureMapScreenshotResized(maxWidth = 1024, maxHeight = 768) {
  if (!_mapInstance) return null

  try {
    const container = document.getElementById('amap-map')
    if (!container) return null

    const fullCanvas = await html2canvas(container, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      logging: false,
    })

    // 缩放
    let w = fullCanvas.width
    let h = fullCanvas.height
    if (w > maxWidth || h > maxHeight) {
      const ratio = Math.min(maxWidth / w, maxHeight / h)
      w = Math.round(w * ratio)
      h = Math.round(h * ratio)
    }

    const offCanvas = document.createElement('canvas')
    offCanvas.width = w
    offCanvas.height = h
    const ctx = offCanvas.getContext('2d')
    ctx.drawImage(fullCanvas, 0, 0, w, h)

    const img_b64 = offCanvas.toDataURL('image/png')

    const b = _mapInstance.getBounds()
    const ne = b.getNorthEast()
    const sw = b.getSouthWest()

    return {
      image: img_b64.split(',')[1] || img_b64,
      bounds: {
        north: ne.getLat(),
        south: sw.getLat(),
        east:  ne.getLng(),
        west:  sw.getLng(),
      },
    }
  } catch (e) {
    console.error('[MapScreenshot] 缩放截图失败:', e)
    return null
  }
}

// 调试方法
window.__testScreenshot = async function () {
  const result = await captureMapScreenshotResized()
  if (result) {
    console.log('[MapScreenshot] 截图成功, image 长度:', result.image.length)
    console.log('[MapScreenshot] bounds:', result.bounds)
  } else {
    console.log('[MapScreenshot] 截图失败 — 请确认已切换到 2D 地图模式')
  }
  return result
}