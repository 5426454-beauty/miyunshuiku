// CGCS2000 ↔ GCJ-02 坐标系转换
// 密云水库尺度下 CGCS2000 ≈ WGS84（偏差 < 0.1m）
// 主要转换：WGS84 → GCJ-02（火星坐标）

const PI = Math.PI
const A  = 6378245.0                // 长半轴
const EE = 0.00669342162296594323   // 偏心率平方

function _isOutOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function _transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0
  return ret
}

function _transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0
  return ret
}

/**
 * WGS84 → GCJ-02（高德/腾讯/Google国内）
 * @param {number} lng - WGS84 经度
 * @param {number} lat - WGS84 纬度
 * @returns {[number, number]} [gcjLng, gcjLat]
 */
export function wgs84ToGcj02(lng, lat) {
  if (_isOutOfChina(lng, lat)) return [lng, lat]
  let dlat = _transformLat(lng - 105.0, lat - 35.0)
  let dlng = _transformLng(lng - 105.0, lat - 35.0)
  const radlat = lat / 180.0 * PI
  let magic = Math.sin(radlat)
  magic = 1 - EE * magic * magic
  const sqrtmagic = Math.sqrt(magic)
  dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI)
  dlng = (dlng * 180.0) / (A / sqrtmagic * Math.cos(radlat) * PI)
  return [lng + dlng, lat + dlat]
}

/**
 * CGCS2000 → GCJ-02（密云水库尺度直接等同于 WGS84→GCJ-02）
 * @param {number} lng - CGCS2000 经度
 * @param {number} lat - CGCS2000 纬度
 * @returns {[number, number]} [gcjLng, gcjLat]
 */
export function cgcs2000ToGcj02(lng, lat) {
  return wgs84ToGcj02(lng, lat)
}

/**
 * 批量转换坐标数组 [[lng,lat], ...]
 */
export function batchToGcj02(coords) {
  return coords.map(([lng, lat]) => wgs84ToGcj02(lng, lat))
}