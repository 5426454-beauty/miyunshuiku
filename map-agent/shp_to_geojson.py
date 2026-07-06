"""
把 密云水库库区水位/ 下的 SHP 文件转换为 GCJ-02 GeoJSON 并保存到 static/water_levels/
坐标系：CGCS2000_3_Degree_GK_Zone_39 → WGS84 → GCJ-02
每条线/环用径距抽稀（10 m 阈值）压缩点数

运行一次即可：
  python shp_to_geojson.py
"""

import shapefile
import json
import math
from pathlib import Path
from pyproj import CRS, Transformer

SHP_DIR = Path(__file__).parent / "密云水库库区水位"
OUT_DIR = Path(__file__).parent / "static" / "water_levels"
OUT_DIR.mkdir(parents=True, exist_ok=True)

PRJ_WKT = (
    'PROJCS["CGCS2000_3_Degree_GK_Zone_39",'
    'GEOGCS["GCS_China_Geodetic_Coordinate_System_2000",'
    'DATUM["D_China_2000",SPHEROID["CGCS2000",6378137.0,298.257222101]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
    'PROJECTION["Gauss_Kruger"],'
    'PARAMETER["False_Easting",39500000.0],'
    'PARAMETER["False_Northing",0.0],'
    'PARAMETER["Central_Meridian",117.0],'
    'PARAMETER["Scale_Factor",1.0],'
    'PARAMETER["Latitude_Of_Origin",0.0],'
    'UNIT["Meter",1.0]]'
)

_proj = Transformer.from_crs(CRS.from_wkt(PRJ_WKT), CRS.from_epsg(4326), always_xy=True)

# SHP 文件名 → 水位高程（m）
LEVELS = [
    ("155",   155.0),
    ("156",   156.0),
    ("157",   157.0),
    ("157d5", 157.5),
    ("158d5", 158.5),
    ("160",   160.0),
]


# ── WGS84 → GCJ-02 ──────────────────────────────────────────────────────────

def _wgs_to_gcj(lng: float, lat: float):
    x, y = lng - 105.0, lat - 35.0
    dlat = (-100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*math.sqrt(abs(x))
            + (20.0*math.sin(6.0*x*math.pi) + 20.0*math.sin(2.0*x*math.pi)) * 2/3
            + (20.0*math.sin(y*math.pi) + 40.0*math.sin(y/3.0*math.pi)) * 2/3
            + (160.0*math.sin(y/12.0*math.pi) + 320*math.sin(y*math.pi/30.0)) * 2/3)
    dlng = (300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*math.sqrt(abs(x))
            + (20.0*math.sin(6.0*x*math.pi) + 20.0*math.sin(2.0*x*math.pi)) * 2/3
            + (20.0*math.sin(x*math.pi) + 40.0*math.sin(x/3.0*math.pi)) * 2/3
            + (150.0*math.sin(x/12.0*math.pi) + 300.0*math.sin(x/30.0*math.pi)) * 2/3)
    rlat = lat / 180.0 * math.pi
    m = 1 - 0.00669342162296594323 * math.sin(rlat) ** 2
    sm = math.sqrt(m)
    dlat = dlat * 180.0 / ((6378245.0 * (1 - 0.00669342162296594323)) / (m * sm) * math.pi)
    dlng = dlng * 180.0 / (6378245.0 / sm * math.cos(rlat) * math.pi)
    return lng + dlng, lat + dlat


# ── 径距抽稀 ─────────────────────────────────────────────────────────────────

def _simplify(pts: list, tol: float = 10.0) -> list:
    """保留与上一保留点距离 > tol(米) 的点，始终保留首尾。"""
    if len(pts) < 4:
        return pts
    kept = [pts[0]]
    tol2 = tol * tol
    for p in pts[1:-1]:
        dx, dy = p[0] - kept[-1][0], p[1] - kept[-1][1]
        if dx*dx + dy*dy >= tol2:
            kept.append(p)
    kept.append(pts[-1])
    return kept


# ── 主转换 ───────────────────────────────────────────────────────────────────

def convert(name: str, level: float):
    shp_path = SHP_DIR / f"{name}.shp"
    mb = shp_path.stat().st_size / 1e6
    print(f"  {name}.shp  ({mb:.1f} MB) ...", end=" ", flush=True)

    sf = shapefile.Reader(str(shp_path))
    all_rings: list[list] = []
    total_in = total_out = 0

    for sr in sf.iterShapeRecords():
        pts   = sr.shape.points
        parts = list(sr.shape.parts) + [len(pts)]
        for i in range(len(parts) - 1):
            ring = pts[parts[i]: parts[i + 1]]
            if len(ring) < 4:
                continue
            total_in += len(ring)
            ring = _simplify(ring, tol=10.0)
            total_out += len(ring)

            # 投影坐标 → WGS84 → GCJ-02，保留 6 位小数（≈ 10 cm）
            gcj_ring = []
            for px, py in ring:
                wlng, wlat = _proj.transform(px, py)
                glng, glat = _wgs_to_gcj(wlng, wlat)
                gcj_ring.append([round(glng, 6), round(glat, 6)])

            all_rings.append(gcj_ring)

    if not all_rings:
        print("SKIP (无有效环)")
        return

    feature = {
        "type": "Feature",
        "properties": {"level": level, "label": f"{level}m"},
        "geometry": {"type": "Polygon", "coordinates": all_rings},
    }
    out = {"type": "FeatureCollection", "features": [feature]}

    out_path = OUT_DIR / f"{name}.geojson"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

    kb = out_path.stat().st_size / 1024
    ratio = total_in / max(total_out, 1)
    print(f"OK  {total_in:,} → {total_out:,} pts  压缩比 {ratio:.0f}x  ({kb:.0f} KB)")


if __name__ == "__main__":
    print(f"输出目录: {OUT_DIR}\n")
    for name, level in LEVELS:
        convert(name, level)
    print("\n全部完成。")
