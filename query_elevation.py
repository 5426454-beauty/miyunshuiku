"""
高程查询与分析工具 - DEM 数据分析 + JSON 输出
数据来源: 高程5米.tif (GeoTIFF, EPSG:4326, ~7.6m分辨率, 覆盖密云地区)

用法:
  python query_elevation.py <经度> <纬度>              — 查询单点
  python query_elevation.py --info                     — 显示数据信息
  python query_elevation.py --find-lowest <N>           — 找最低N个点 (JSON)
  python query_elevation.py --areas-below <阈值>        — 找低于阈值的连通区域 (JSON)
  python query_elevation.py --areas-below-near <经度> <纬度> <半径km> <阈值> — 局部搜索 (JSON)
  python query_elevation.py --annotate-lowest <N>       — 输出可直接POST的标注JSON
  python query_elevation.py --annotate-areas-below <阈值> — 输出可直接POST的标注JSON
  python query_elevation.py --annotate-areas-near <经度> <纬度> <半径km> <阈值> — 输出标注JSON
"""

import tifffile
import numpy as np
from scipy import ndimage
import json
import sys
import os

# 常量：从 TIFF 元数据中提取
ORIGIN_LON = 116.16918878470267       # 左上角经度
ORIGIN_LAT = 40.893200890308236       # 左上角纬度
PIXEL_SCALE_X = 6.859558531934311e-05  # 每像素经度跨度（约7.6m）
PIXEL_SCALE_Y = 6.246038433086673e-05  # 每像素纬度跨度（约6.9m）
NODATA = -32767

_data = None

def _load_data():
    """加载 DEM 数组（懒加载，自动搜索多个路径）"""
    global _data
    if _data is None:
        filepath = None
        # 逐级搜索（优先级从高到低）
        candidates = [
            os.path.join(os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else '.', '高程5米.tif'),
            '高程5米.tif',
            os.path.join(os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else '.', 'dem5.tif'),
            'dem5.tif',
            os.path.join(os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else '.',
                         '淹没水深计算系统V2.0', '淹没水深计算系统V2.0', 'data', 'input', 'dem5.tif'),
            os.path.join('淹没水深计算系统V2.0', '淹没水深计算系统V2.0', 'data', 'input', 'dem5.tif'),
            os.path.join(os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else '.',
                         '淹没水深计算系统V2.0', '淹没水深计算系统V2.0', 'data', 'output', 'dem_original.tif'),
        ]
        for fp in candidates:
            if os.path.exists(fp):
                filepath = fp
                break
        if filepath is None:
            searched = '\n  '.join(candidates)
            raise FileNotFoundError(f"找不到 DEM 数据文件，已搜索:\n  {searched}")
        sys.stderr.write(f"正在加载 DEM 数据: {filepath}\n")
        _data = tifffile.imread(filepath)
        valid = _data[_data != NODATA]
        sys.stderr.write(f"加载完成: {_data.shape}, 高程范围 {valid.min():.2f}m ~ {valid.max():.2f}m\n")
    return _data
    return _data


def _pixel_to_coord(row, col):
    """像素坐标 → 经纬度（WGS84）"""
    lon = ORIGIN_LON + col * PIXEL_SCALE_X
    lat = ORIGIN_LAT - row * PIXEL_SCALE_Y
    return lon, lat


def _coord_to_pixel(lon, lat):
    """经纬度 → 像素坐标（返回 row, col）"""
    col = (lon - ORIGIN_LON) / PIXEL_SCALE_X
    row = (ORIGIN_LAT - lat) / PIXEL_SCALE_Y
    return int(round(row)), int(round(col))


def query(lon, lat):
    """查询单点高程"""
    data = _load_data()
    row, col = _coord_to_pixel(lon, lat)

    if row < 0 or row >= data.shape[0] or col < 0 or col >= data.shape[1]:
        return {'lon': lon, 'lat': lat, 'elevation': None, 'valid': False,
                'reason': '坐标超出DEM覆盖范围'}

    elevation = float(data[row, col])
    if elevation == NODATA or np.isnan(elevation):
        return {'lon': lon, 'lat': lat, 'elevation': None, 'valid': False,
                'reason': '该位置为水体/无数据区域', 'pixel': [row, col]}

    return {'lon': lon, 'lat': lat, 'elevation': round(elevation, 2),
            'valid': True, 'pixel': [row, col]}


def find_lowest(n=10):
    """找到高程最低的 N 个点（排除 NODATA）"""
    data = _load_data()
    mask = data != NODATA
    valid_flat = data[mask]
    sorted_indices = np.argsort(valid_flat)

    rows, cols = np.where(mask)
    results = []
    for i in range(min(n, len(sorted_indices))):
        idx = sorted_indices[i]
        r, c = rows[idx], cols[idx]
        lon, lat = _pixel_to_coord(r, c)
        results.append({
            'rank': i + 1,
            'lon': round(lon, 10),
            'lat': round(lat, 10),
            'elevation': round(float(valid_flat[idx]), 2),
            'pixel': [int(r), int(c)]
        })
    return results


def find_highest(n=10):
    """找到高程最高的 N 个点"""
    data = _load_data()
    mask = data != NODATA
    valid_flat = data[mask]
    sorted_indices = np.argsort(valid_flat)[::-1]

    rows, cols = np.where(mask)
    results = []
    for i in range(min(n, len(sorted_indices))):
        idx = sorted_indices[i]
        r, c = rows[idx], cols[idx]
        lon, lat = _pixel_to_coord(r, c)
        results.append({
            'rank': i + 1,
            'lon': round(lon, 10),
            'lat': round(lat, 10),
            'elevation': round(float(valid_flat[idx]), 2),
            'pixel': [int(r), int(c)]
        })
    return results


def find_areas_below(threshold, min_pixels=30):
    """
    找到所有低于 threshold 的连通区域

    Args:
        threshold: 高程阈值（米）
        min_pixels: 最小区域像素数，过滤噪点（默认30，约1500m²）

    Returns:
        [{region_id, west, south, east, north, center_lon, center_lat,
          min_elevation, max_elevation, avg_elevation, area_pixels,
          lowest_points: [{lon, lat, elevation}]}]
    """
    data = _load_data()
    binary = (data < threshold) & (data != NODATA)

    # 连通区域标记
    labeled, num_features = ndimage.label(binary)

    if num_features == 0:
        return []

    results = []
    for region_id in range(1, num_features + 1):
        region_mask = labeled == region_id
        pixel_count = np.sum(region_mask)

        if pixel_count < min_pixels:
            continue

        rows, cols = np.where(region_mask)
        elevations = data[region_mask]

        # 边界框
        min_row, max_row = rows.min(), rows.max()
        min_col, max_col = cols.min(), cols.max()

        west, south = _pixel_to_coord(max_row, min_col)   # south = max_row
        east, north = _pixel_to_coord(min_row, max_col)   # north = min_row

        # 中心
        center_lon = (west + east) / 2
        center_lat = (south + north) / 2

        # 最低点（区域内）
        min_idx_in_region = np.argmin(elevations)
        lowest_row, lowest_col = rows[min_idx_in_region], cols[min_idx_in_region]
        lowest_lon, lowest_lat = _pixel_to_coord(lowest_row, lowest_col)

        results.append({
            'region_id': region_id,
            'west': round(west, 8),
            'south': round(south, 8),
            'east': round(east, 8),
            'north': round(north, 8),
            'center_lon': round(center_lon, 8),
            'center_lat': round(center_lat, 8),
            'min_elevation': round(float(elevations.min()), 2),
            'max_elevation': round(float(elevations.max()), 2),
            'avg_elevation': round(float(elevations.mean()), 2),
            'area_pixels': int(pixel_count),
            'lowest_point': {
                'lon': round(lowest_lon, 10),
                'lat': round(lowest_lat, 10),
                'elevation': round(float(elevations.min()), 2)
            }
        })

    # 按最低高程排序
    results.sort(key=lambda r: r['min_elevation'])
    return results


def find_areas_below_near(lon, lat, radius_km, threshold):
    """
    在指定位置附近搜索低于阈值的连通区域

    Args:
        lon, lat: 中心点坐标（WGS84）
        radius_km: 搜索半径（公里）
        threshold: 高程阈值（米）

    Returns:
        与 find_areas_below 相同格式
    """
    data = _load_data()
    center_row, center_col = _coord_to_pixel(lon, lat)

    # 计算窗口大小（像素）
    lat_deg_per_km = 1.0 / 111.32
    lon_deg_per_km = 1.0 / (111.32 * np.cos(np.radians(lat)))
    delta_lat = radius_km * lat_deg_per_km
    delta_lon = radius_km * lon_deg_per_km

    delta_row = int(delta_lat / PIXEL_SCALE_Y) + 1
    delta_col = int(delta_lon / PIXEL_SCALE_X) + 1

    # 裁剪窗口
    r1 = max(0, center_row - delta_row)
    r2 = min(data.shape[0], center_row + delta_row + 1)
    c1 = max(0, center_col - delta_col)
    c2 = min(data.shape[1], center_col + delta_col + 1)

    window = data[r1:r2, c1:c2]
    binary = (window < threshold) & (window != NODATA)

    labeled, num_features = ndimage.label(binary)

    if num_features == 0:
        return []

    results = []
    for region_id in range(1, num_features + 1):
        region_mask = labeled == region_id
        pixel_count = np.sum(region_mask)

        if pixel_count < 5:  # 局部搜索时降低过滤阈值
            continue

        rows, cols = np.where(region_mask)
        # 转换回全局像素坐标
        global_rows = rows + r1
        global_cols = cols + c1
        elevations = window[region_mask]

        min_row, max_row = global_rows.min(), global_rows.max()
        min_col, max_col = global_cols.min(), global_cols.max()

        west, south = _pixel_to_coord(max_row, min_col)
        east, north = _pixel_to_coord(min_row, max_col)

        center_lon2 = (west + east) / 2
        center_lat2 = (south + north) / 2

        min_idx = np.argmin(elevations)
        ll_row, ll_col = global_rows[min_idx], global_cols[min_idx]
        ll_lon, ll_lat = _pixel_to_coord(ll_row, ll_col)

        results.append({
            'region_id': region_id,
            'west': round(west, 8),
            'south': round(south, 8),
            'east': round(east, 8),
            'north': round(north, 8),
            'center_lon': round(center_lon2, 8),
            'center_lat': round(center_lat2, 8),
            'min_elevation': round(float(elevations.min()), 2),
            'max_elevation': round(float(elevations.max()), 2),
            'avg_elevation': round(float(elevations.mean()), 2),
            'area_pixels': int(pixel_count),
            'lowest_point': {
                'lon': round(ll_lon, 10),
                'lat': round(ll_lat, 10),
                'elevation': round(float(elevations.min()), 2)
            }
        })

    results.sort(key=lambda r: r['min_elevation'])
    return results


# ══════════════════════════
# 标注生成器 — 输出可直接 POST 到 /api/dem/annotations 的 JSON
# ══════════════════════════

def _make_annotation(payload):
    """生成统一格式的标注 JSON（可直接 POST 到 Express 后端）"""
    return payload


# 密云水库关键地标
_LANDMARKS = [
    {'name': '白河主坝',     'lon': 116.825, 'lat': 40.476},
    {'name': '潮河主坝',     'lon': 116.988, 'lat': 40.451},
    {'name': '走马庄副坝',   'lon': 116.854, 'lat': 40.475},
    {'name': '第三溢洪道',   'lon': 117.001, 'lat': 40.465},
    {'name': '库区中心',     'lon': 116.965, 'lat': 40.505},
    {'name': '潮河入库口',   'lon': 117.056, 'lat': 40.514},
    {'name': '白河入库口',   'lon': 116.888, 'lat': 40.531},
]

def _name_region(center_lon, center_lat):
    """根据区域中心坐标，匹配最近的地标命名"""
    best = None
    best_dist = float('inf')
    for lm in _LANDMARKS:
        d = ((center_lon - lm['lon']) * 84.65)**2 + ((center_lat - lm['lat']) * 111.32)**2
        if d < best_dist:
            best_dist = d
            best = lm
    return best['name'] if best else '未知区域'

def _rect_distance(r1, r2):
    """两个矩形（west/south/east/north）之间的最小间隙，0=重叠"""
    dx = max(0, max(r1['west'], r2['west']) - min(r1['east'], r2['east']))
    dy = max(0, max(r1['south'], r2['south']) - min(r1['north'], r2['north']))
    return max(dx, dy)


def _merge_rectangles(rects, gap_deg=0.003):
    """
    迭代合并相邻矩形（间距 < gap_deg 度，~300m），大矩形不吞小矩形。
    """
    if len(rects) <= 1:
        return rects

    merged = [dict(r) for r in rects]
    for r in merged:
        if 'area_pixels' not in r:
            r['area_pixels'] = 0
        r['_approx_deg2'] = (r['east'] - r['west']) * (r['north'] - r['south'])

    changed = True
    while changed:
        changed = False
        i = 0
        while i < len(merged):
            j = i + 1
            while j < len(merged):
                dist = _rect_distance(merged[i], merged[j])
                if dist < gap_deg:
                    # 大小比例 >10× → 不合并（防巨框吞小框）
                    ai = merged[i]['_approx_deg2']
                    aj = merged[j]['_approx_deg2']
                    ratio = ai / max(aj, 1e-12)
                    if ratio < 0.1 or ratio > 10:
                        j += 1; continue
                    merged[i]['west']  = min(merged[i]['west'],  merged[j]['west'])
                    merged[i]['south'] = min(merged[i]['south'], merged[j]['south'])
                    merged[i]['east']  = max(merged[i]['east'],  merged[j]['east'])
                    merged[i]['north'] = max(merged[i]['north'], merged[j]['north'])
                    merged[i]['area_pixels'] += merged[j].get('area_pixels', 0)
                    merged[i]['_approx_deg2'] = (merged[i]['east'] - merged[i]['west']) * (merged[i]['north'] - merged[i]['south'])
                    merged[i]['id'] = merged[i]['id'] + '+' + merged[j]['id']
                    merged.pop(j)
                    changed = True
                else:
                    j += 1
            i += 1

    # 外扩 5% padding
    for r in merged:
        pad_lng = (r['east'] - r['west']) * 0.05
        pad_lat = (r['north'] - r['south']) * 0.05
        r['west']  = max(-180, r['west'] - pad_lng)
        r['east']  = min( 180, r['east'] + pad_lng)
        r['south'] = max( -90, r['south'] - pad_lat)
        r['north'] = min(  90, r['north'] + pad_lat)

    # 合并后重新计算 km²，过滤极小噪点，重新编号
    filtered = []
    for r in merged:
        lat_mid = (r['north'] + r['south']) / 2
        lng_km_per_deg = 111.32 * abs(np.cos(np.radians(lat_mid)))
        lat_km_per_deg = 111.32
        area_km2 = (r['east'] - r['west']) * lng_km_per_deg * (r['north'] - r['south']) * lat_km_per_deg
        if area_km2 < 0.1:
            continue  # 过滤 <0.1 km² 纯噪点
        r['area_km2'] = round(area_km2, 2)
        filtered.append(r)

    for r in filtered:
        clon = (r['west'] + r['east']) / 2
        clat = (r['north'] + r['south']) / 2
        r['_name'] = _name_region(clon, clat)
        r['label'] = f"{r['_name']}  {r['area_km2']} km²"

    # 去重：同名区域加方位后缀（下游/上游/东/西）
    names_seen = {}
    for r in filtered:
        nm = r['_name']
        if nm in names_seen:
            names_seen[nm] += 1
            r['label'] = f"{nm}·{names_seen[nm]}号  {r['area_km2']} km²"
        else:
            names_seen[nm] = 0

    return filtered


def annotate_lowest(n=10):
    """为最低 N 个点生成标注"""
    points = find_lowest(n)
    if not points:
        return _make_annotation({'type': 'markers', 'markers': [], 'note': '无有效数据'})

    markers = [{
        'lon': p['lon'], 'lat': p['lat'],
        'elevation': p['elevation'],
        'label': f"最低#{p['rank']}: {p['elevation']}m"
    } for p in points]

    # 飞到第一个点（最低点）
    return _make_annotation({
        'type': 'markers',
        'markers': markers,
        'flyTo': {
            'lon': points[0]['lon'], 'lat': points[0]['lat'],
            'alt': 0, 'distance': 3000
        }
    })


def annotate_areas_below(threshold, min_pixels=30, max_regions=50):
    """为低于阈值的连通区域生成标注（max_regions 提高以先收集再合并）"""
    areas = find_areas_below(threshold, min_pixels)

    rectangles = []
    markers = []

    for i, area in enumerate(areas[:max_regions]):
        # 矩形框
        rectangles.append({
            'id': f'area-{area["region_id"]}',
            'west': area['west'],
            'south': area['south'],
            'east': area['east'],
            'north': area['north'],
            'area_pixels': area['area_pixels'],
            'label': '',
            'color': 'ff0000cc' if area['min_elevation'] < threshold - 10 else 'ffc800cc'
        })
        # 最低点标记
        lp = area['lowest_point']
        markers.append({
            'lon': lp['lon'], 'lat': lp['lat'],
            'elevation': lp['elevation'],
            'label': f"区域#{i+1}最低: {lp['elevation']}m"
        })

    # ── 合并相邻矩形（间距 < 0.005° ≈ 500m）──
    before = len(rectangles)
    rectangles = _merge_rectangles(rectangles)
    if before != len(rectangles):
        sys.stderr.write(f"合并矩形: {before} → {len(rectangles)}\n")

    # 飞到第一个区域的中心
    fly = None
    if areas:
        fly = {
            'lon': areas[0]['center_lon'],
            'lat': areas[0]['center_lat'],
            'alt': 0,
            'distance': 5000
        }

    names = [r['label'] for r in rectangles]
    return _make_annotation({
        'type': 'both',
        'rectangles': rectangles,
        'markers': markers,
        'flyTo': fly,
        'summary': f"发现 {len(rectangles)} 个低于 {threshold}m 的连通低洼区域：" + "；".join(names)
    })


def annotate_areas_near(lon, lat, radius_km, threshold):
    """为指定位置附近的低洼区域生成标注"""
    areas = find_areas_below_near(lon, lat, radius_km, threshold)

    rectangles = []
    markers = []

    for i, area in enumerate(areas[:50]):
        rectangles.append({
            'id': f'near-area-{area["region_id"]}',
            'west': area['west'],
            'south': area['south'],
            'east': area['east'],
            'north': area['north'],
            'area_pixels': area['area_pixels'],
            'label': '',
            'color': 'ff0000cc'
        })
        lp = area['lowest_point']
        markers.append({
            'lon': lp['lon'], 'lat': lp['lat'],
            'elevation': lp['elevation'],
            'label': f"区域#{i+1}最低: {lp['elevation']}m"
        })

    # ── 合并相邻矩形 ──
    before = len(rectangles)
    rectangles = _merge_rectangles(rectangles)
    if before != len(rectangles):
        sys.stderr.write(f"合并矩形: {before} → {len(rectangles)}\n")

    names = [r['label'] for r in rectangles]
    return _make_annotation({
        'type': 'both',
        'rectangles': rectangles,
        'markers': markers,
        'flyTo': {'lon': lon, 'lat': lat, 'alt': 0, 'distance': radius_km * 1000},
        'summary': f"在 ({lon:.6f}, {lat:.6f}) 周围 {radius_km}km 内发现 {len(rectangles)} 个低于 {threshold}m 的区域：" + "；".join(names)
    })


# ══════════════════════════
# KML 导出
# ══════════════════════════

def _rectangles_to_kml(rectangles, name="DEM低洼区域分析"):
    """将矩形列表转为 KML 字符串"""
    kml = f'''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>{name}</name>'''
    for i, r in enumerate(rectangles):
        w, s, e, n = r['west'], r['south'], r['east'], r['north']
        label = r.get('label', f'区域{i+1}')
        line_color = (r.get('color', 'ff0000cc')).replace('#', '')
        # KML 颜色是 AABBGGRR 格式
        kml_line = 'cc0000ff'  # 红色边框
        kml_fill = '4c0000ff'  # 半透明红填充
        kml += f'''
  <Placemark>
    <name>{label}</name>
    <Style>
      <LineStyle><color>{kml_line}</color><width>3</width></LineStyle>
      <PolyStyle><color>{kml_fill}</color><fill>1</fill><outline>1</outline></PolyStyle>
    </Style>
    <Polygon>
      <extrude>1</extrude>
      <altitudeMode>clampToGround</altitudeMode>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>
            {w},{s},0 {e},{s},0 {e},{n},0 {w},{n},0 {w},{s},0
          </coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>'''
    kml += '\n</Document>\n</kml>'
    return kml

def export_kml(threshold, min_pixels=30, output_path=None, area_filter=None):
    """运行分析并导出 KML 文件，area_filter 可按地名筛选（如'白河主坝'）"""
    areas = find_areas_below(threshold, min_pixels)
    rects = [{'west': a['west'], 'south': a['south'], 'east': a['east'],
              'north': a['north'], 'color': 'ff0000cc',
              'id': f'area-{a["region_id"]}',
              'area_pixels': a['area_pixels'],
              'label': f"≤{threshold}m 区域{a['region_id']}"} for a in areas]
    # 合并
    rects = _merge_rectangles(rects)
    # 筛选
    if area_filter:
        rects = [r for r in rects if area_filter in r.get('label', '')]
    kml = _rectangles_to_kml(rects, f"密云水库 ≤{threshold}m 低洼区域")
    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(kml)
        sys.stderr.write(f"KML 已保存到: {output_path}\n")
    return kml


# ══════════════════════════
# CLI 入口
# ══════════════════════════

if __name__ == '__main__':
    # 强制 UTF-8 输出（Windows 终端默认 GBK 会导致中文乱码）
    if sys.platform == 'win32':
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

    args = sys.argv[1:]

    if len(args) == 0:
        print("用法:")
        print("  python query_elevation.py <经度> <纬度>")
        print("  python query_elevation.py --info")
        print("  python query_elevation.py --find-lowest <N>")
        print("  python query_elevation.py --areas-below <阈值> [min_pixels]")
        print("  python query_elevation.py --areas-below-near <经度> <纬度> <半径km> <阈值>")
        print("  python query_elevation.py --annotate-lowest <N>")
        print("  python query_elevation.py --annotate-areas-below <阈值>")
        print("  python query_elevation.py --annotate-areas-near <经度> <纬度> <半径km> <阈值>")
        sys.exit(0)

    cmd = args[0]

    if cmd == '--info':
        data = _load_data()
        valid = data[data != NODATA]
        print(json.dumps({
            'file': '高程5米.tif',
            'shape': list(data.shape),
            'dtype': str(data.dtype),
            'pixel_size_deg': [PIXEL_SCALE_X, PIXEL_SCALE_Y],
            'pixel_size_m': [round(PIXEL_SCALE_X * 111320, 1), round(PIXEL_SCALE_Y * 111320, 1)],
            'bounds_wsg84': {
                'west': round(ORIGIN_LON, 6),
                'east': round(ORIGIN_LON + PIXEL_SCALE_X * data.shape[1], 6),
                'south': round(ORIGIN_LAT - PIXEL_SCALE_Y * data.shape[0], 6),
                'north': round(ORIGIN_LAT, 6)
            },
            'elevation_range': [round(float(valid.min()), 2), round(float(valid.max()), 2)],
            'nodata': NODATA
        }, ensure_ascii=False, indent=2))

    elif cmd == '--find-lowest':
        n = int(args[1]) if len(args) > 1 else 10
        results = find_lowest(n)
        print(json.dumps(results, ensure_ascii=False, indent=2))

    elif cmd == '--find-highest':
        n = int(args[1]) if len(args) > 1 else 10
        results = find_highest(n)
        print(json.dumps(results, ensure_ascii=False, indent=2))

    elif cmd == '--areas-below':
        threshold = float(args[1]) if len(args) > 1 else 0
        min_pixels = int(args[2]) if len(args) > 2 else 30
        areas = find_areas_below(threshold, min_pixels)
        print(json.dumps(areas, ensure_ascii=False, indent=2))

    elif cmd == '--areas-below-near':
        lon = float(args[1])
        lat = float(args[2])
        radius_km = float(args[3])
        threshold = float(args[4])
        areas = find_areas_below_near(lon, lat, radius_km, threshold)
        print(json.dumps(areas, ensure_ascii=False, indent=2))

    elif cmd == '--annotate-lowest':
        n = int(args[1]) if len(args) > 1 else 10
        annotation = annotate_lowest(n)
        print(json.dumps(annotation, ensure_ascii=False, indent=2))

    elif cmd == '--annotate-areas-below':
        threshold = float(args[1]) if len(args) > 1 else 0
        min_pixels = int(args[2]) if len(args) > 2 else 30
        annotation = annotate_areas_below(threshold, min_pixels)
        print(json.dumps(annotation, ensure_ascii=False, indent=2))

    elif cmd == '--annotate-areas-near':
        lon = float(args[1])
        lat = float(args[2])
        radius_km = float(args[3])
        threshold = float(args[4])
        annotation = annotate_areas_near(lon, lat, radius_km, threshold)
        print(json.dumps(annotation, ensure_ascii=False, indent=2))

    elif cmd == '--export-kml':
        threshold = float(args[1]) if len(args) > 1 else 150
        min_pixels = int(args[2]) if len(args) > 2 else 30
        out = args[3] if len(args) > 3 and args[3] not in ('none', '-', '') else None
        area_filter = args[4] if len(args) > 4 else None
        kml = export_kml(threshold, min_pixels, out, area_filter)
        if not out:
            print(kml)

    elif cmd == '--post':
        # 一键模式：运行分析并将结果 POST 到 Express 后端
        # 用法: python query_elevation.py --post --annotate-areas-below -20
        #       python query_elevation.py --post --annotate-areas-near 116.965 40.505 5 143
        endpoint = 'http://localhost:3001/api/dem/annotations'

        if len(args) < 2:
            print("错误: --post 需要指定分析命令", file=sys.stderr)
            sys.exit(1)

        # 运行对应的分析命令
        sub_cmd = args[1]
        sub_args = args[2:]
        result = None

        if sub_cmd == '--annotate-areas-below':
            threshold = float(sub_args[0]) if sub_args else 0
            min_pixels = int(sub_args[1]) if len(sub_args) > 1 else 30
            result = annotate_areas_below(threshold, min_pixels)
        elif sub_cmd == '--annotate-areas-near':
            lon = float(sub_args[0])
            lat = float(sub_args[1])
            radius_km = float(sub_args[2])
            threshold = float(sub_args[3])
            result = annotate_areas_near(lon, lat, radius_km, threshold)
        elif sub_cmd == '--annotate-lowest':
            n = int(sub_args[0]) if sub_args else 10
            result = annotate_lowest(n)
        elif sub_cmd == '--find-lowest':
            n = int(sub_args[0]) if sub_args else 10
            result = find_lowest(n)
        else:
            print(f"未知子命令: {sub_cmd}", file=sys.stderr)
            sys.exit(1)

        # POST 到后端
        payload = json.dumps(result, ensure_ascii=False).encode('utf-8')
        try:
            import urllib.request
            req = urllib.request.Request(endpoint, data=payload, method='POST')
            req.add_header('Content-Type', 'application/json; charset=utf-8')
            with urllib.request.urlopen(req) as resp:
                resp_data = json.loads(resp.read())
                print(json.dumps(resp_data, ensure_ascii=False))
                if resp_data.get('ok'):
                    sys.stderr.write(f"✅ 已推送到前端 (v{resp_data.get('version')})\n")
        except Exception as e:
            sys.stderr.write(f"❌ POST 失败: {e}\n")
            # 降级：打印 JSON 到 stdout
            print(json.dumps(result, ensure_ascii=False, indent=2))

    else:
        # 尝试解析为两个数字（经纬度查询）
        try:
            lon, lat = float(args[0]), float(args[1])
            result = query(lon, lat)
            print(json.dumps(result, ensure_ascii=False))
        except (ValueError, IndexError):
            print(f"未知命令: {cmd}")
            sys.exit(1)