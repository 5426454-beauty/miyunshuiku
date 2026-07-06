import asyncio
import base64 as _b64
import io
import json
import math
import traceback
import httpx

try:
    from PIL import Image as _PILImage
    _HAS_PIL = True
except ImportError:
    _HAS_PIL = False

import config as cfg
from screenshot import MapScreenshotTaker

IMG_W, IMG_H   = 2048, 1536   # device_scale_factor=2 后的实际截图分辨率
GRID_ROWS, GRID_COLS = 3, 3
COORD_SCALE    = 1000   # Qwen2.5-VL 原生坐标空间：[0, 1000]


def _annotate_detections(img_b64: str, detections: list) -> str:
    """把检测框画在截图上，用于调试模型输出位置是否正确。"""
    if not _HAS_PIL:
        return img_b64
    from PIL import ImageDraw
    raw = _b64.b64decode(img_b64)
    img = _PILImage.open(io.BytesIO(raw)).convert("RGB")
    draw = ImageDraw.Draw(img)
    w, h = img.size
    for i, det in enumerate(detections):
        box = det.get("box_2d", [])
        if len(box) != 4:
            continue
        x1, y1, x2, y2 = box
        # 模型输出归一化坐标 [0,1000]，转换为像素坐标
        px1 = int(x1 / COORD_SCALE * w)
        py1 = int(y1 / COORD_SCALE * h)
        px2 = int(x2 / COORD_SCALE * w)
        py2 = int(y2 / COORD_SCALE * h)
        draw.rectangle([px1, py1, px2, py2], outline="red", width=3)
        label = f"#{i+1} {det.get('confidence', 0):.0%}"
        draw.text((px1 + 2, max(py1 - 14, 0)), label, fill="red")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return _b64.b64encode(buf.getvalue()).decode()


def _split_for_detect(img_b64: str) -> list[dict]:
    """将图像切成 2×2 带 5% 重叠的分块，用于提升目标检测召回率。"""
    if not _HAS_PIL:
        return []
    raw = _b64.b64decode(img_b64)
    img = _PILImage.open(io.BytesIO(raw)).convert("RGB")
    w, h = img.size
    hw, hh = w // 2, h // 2
    ox = int(w * 0.05)  # ~51px 水平重叠
    oy = int(h * 0.05)  # ~38px 垂直重叠
    regions = [
        (0,      0,       hw+ox, hh+oy),   # 左上
        (hw-ox,  0,       w,     hh+oy),   # 右上
        (0,      hh-oy,   hw+ox, h),       # 左下
        (hw-ox,  hh-oy,   w,     h),       # 右下
    ]
    cells = []
    for x0, y0, x1, y1 in regions:
        crop = img.crop((x0, y0, x1, y1))
        buf  = io.BytesIO()
        crop.save(buf, format="PNG", optimize=True)
        cells.append({
            "b64": _b64.b64encode(buf.getvalue()).decode(),
            "x0": x0, "y0": y0,
            "cw": x1 - x0, "ch": y1 - y0,
        })
    return cells


def _iou(a: list, b: list) -> float:
    """计算两个 [x1,y1,x2,y2] 框的 IoU。"""
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter == 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


def _nms(detections: list, iou_thresh: float = 0.4) -> list:
    """贪心 NMS：按置信度排序，抑制重叠框（IoU > 阈值）。"""
    dets = sorted(detections, key=lambda d: d.get("confidence", 0), reverse=True)
    kept: list = []
    while dets:
        best = dets.pop(0)
        kept.append(best)
        dets = [d for d in dets if _iou(best["box_2d"], d["box_2d"]) < iou_thresh]
    return kept


def _expand_box(box: list, pad: float = 0.06) -> list:
    """将边界框向外扩展，补偿模型预测偏保守（框偏小）的问题。"""
    x1, y1, x2, y2 = box
    pw = (x2 - x1) * pad
    ph = (y2 - y1) * pad
    return [
        max(0.0,         x1 - pw),
        max(0.0,         y1 - ph),
        min(COORD_SCALE, x2 + pw),
        min(COORD_SCALE, y2 + ph),
    ]


def _split_image(img_b64: str) -> list[dict]:
    if not _HAS_PIL:
        return []
    raw  = _b64.b64decode(img_b64)
    img  = _PILImage.open(io.BytesIO(raw)).convert("RGB")
    w, h = img.size
    cw, ch = w // GRID_COLS, h // GRID_ROWS
    cells = []
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            x0, y0 = c * cw, r * ch
            crop = img.crop((x0, y0, x0 + cw, y0 + ch))
            buf  = io.BytesIO()
            crop.save(buf, format="PNG", optimize=True)
            cells.append({
                "b64": _b64.b64encode(buf.getvalue()).decode(),
                "row": r, "col": c,
                "x0": x0, "y0": y0, "cw": cw, "ch": ch,
            })
    return cells


# ── 系统提示词（推理阶段） ──────────────────────────────────────────────────────
_REASON_SYSTEM = """你是一个卫星地图视觉分析智能体，使用"自顶向下渐进式精化"策略完成地理目标识别任务。

每轮分析后只返回一个 JSON 对象（不含任何其他文字或 markdown 代码块）：
{
  "action": "zoom_in" | "zoom_out" | "pan" | "detect" | "done",
  "reason": "本次决策的推理依据（中文）",
  "lat": 目标纬度（仅 pan 时填写，浮点数）,
  "lng": 目标经度（仅 pan 时填写，浮点数）,
  "zoom": 新缩放级别（仅 zoom_in/zoom_out 时填写，整数 3-18）
}

决策策略：
1. 先理解当前区域整体地形与建筑密度
2. 发现疑似目标区域后 zoom_in 放大查看细节
3. 当目标物轮廓已清晰可辨时使用 detect 精确定位
4. 当前视野未找到目标时使用 pan 移动到更高概率区域
5. 任务完成或确认区域内无目标时使用 done"""

# ── 道路标注系统提示（折线模式）──────────────────────────────────────────────────
_ROAD_ANNOTATE_SYSTEM = """你是卫星正射影像道路中心线解译专家。任务：找出所有可见道路，输出中心线折线，禁止输出矩形框。

坐标规则：
- 坐标系 x∈[0,1000]（左→右），y∈[0,1000]（上→下），左上角(0,0)，右下角(1000,1000)
- 折线点必须精确落在道路中心线上；直线段每30单位一点，弯道转角每15单位一点，每条路至少6点
- 每条独立道路（含小巷、支路、便道）单独输出，禁止合并
- 严禁输出 box/rect 矩形作为道路
- 仅返回纯JSON：{"roads": [{"label": "路名/编号", "polyline": [[x,y],...]}]}"""

# ── 建筑物标注系统提示（单栋小框模式）────────────────────────────────────────────
_BUILDING_ANNOTATE_SYSTEM = """你是卫星图像建筑物解译专家。任务：标注每一栋独立建筑物的精确边界框。

坐标规则：
- 坐标系 x∈[0,1000]（左→右），y∈[0,1000]（上→下）
- 每栋建筑单独一个 box，框紧贴建筑完整轮廓
- 单栋建筑的 box 面积不超过图像总面积的 8%（800×800 单位），禁止整体大框
- 同一建筑群中每栋楼独立标注，禁止合并为一个框
- 仅返回纯JSON：{"buildings": [{"label": "楼栋名", "box": [x1,y1,x2,y2]}]}"""

_ROAD_KEYWORDS = {"路", "街", "道", "大道", "公路", "马路", "高速", "快速路", "干道", "街道", "胡同", "巷", "弄"}
_BUILDING_KEYWORDS = {"楼", "建筑", "房", "住宅", "厂房", "仓库", "办公楼", "商场", "宿舍"}

_ROAD_DETECT_TMPL = """在这张卫星截图中，找出所有「{target}」并标注中心线路径。
每条道路单独标注，坐标归一化到[0,1000]。
仅返回JSON：{{"roads": [{{"label": "道路名称或编号", "polyline": [[x,y],...]}}]}}"""


_DETECT_TMPL = """当前地理位置：{geo_context}

在这张高德卫星截图中，找出**所有**"{target}"。

检测要求：
- 逐区域扫描整张图像，不遗漏任何清晰可见的目标（宁多勿少）
- 每个独立目标单独标注，禁止合并相邻目标
- 边界框必须紧贴目标完整轮廓，不可过大或过小
- 坐标系：左上角(0,0)，右下角(1000,1000)，格式 [x_min, y_min, x_max, y_max]

仅返回 JSON，不含任何其他文字：
{{
  "detections": [
    {{
      "box_2d": [x1, y1, x2, y2],
      "confidence": 0.85,
      "description": "简短描述"
    }}
  ]
}}"""

# ── 视野分析系统提示 ────────────────────────────────────────────────────────────
_ANALYZE_SYSTEM = """你是高精度卫星图像空间分析专家。
图像尺寸：1024×768 像素（宽×高）。
坐标系：像素坐标，x∈[0,1024]（从左到右），y∈[0,768]（从上到下），图像左上角为原点(0,0)，右下角为(1024,768)。

【长度测量规则 - 极其重要】
- 每条道路/线段必须单独作为一个独立的 measurement 条目，严禁合并多条道路
- 沿道路/线段中心线从起点到终点标注路径点，格式 [x, y]（x=像素横坐标，y=像素纵坐标）：
  * 直线段：每隔约 30 像素一个点
  * 弯道/转角：每隔约 15 像素一个点
  * 全程至少 8 个点，优先保证准确落在道路中心线上
- 路径点必须精确落在道路中心线上，宁少勿错

【计数规则 - 极其重要】
- 逐一扫描图像中每一个可辨认的目标，逐一标注边界框 [x_min, y_min, x_max, y_max]（像素坐标，左、上、右、下）
- 边界框必须紧贴目标轮廓
- boxes 数组长度必须严格等于 count 值
- 只标注清晰可见的目标；被遮挡超过 50% 的目标可忽略

仅输出 JSON，不含任何其他文字或 markdown 代码块。"""

# ── 视野分析提示词模板 ──────────────────────────────────────────────────────────
_ANALYZE_TMPL = """问题：{question}

请仔细分析这张高德卫星截图（1024×768像素），按以下 JSON 格式回答：
{{
  "answer": "简短说明（长度/计数类写'见测量结果'即可）",
  "measurements": [
    {{
      "type": "length",
      "label": "道路或线段的具体名称",
      "polyline": [[x1,y1],[x2,y2],...]
    }},
    {{
      "type": "count",
      "label": "被计数对象名称",
      "count": 15,
      "boxes": [[x1,y1,x2,y2], ...]
    }}
  ]
}}
注意：
- 所有坐标均为像素坐标，x∈[0,1024] 为横向（左→右），y∈[0,768] 为纵向（上→下）
- polyline 格式为 [[x,y],...] 即 [横坐标像素, 纵坐标像素]
- boxes 格式为 [x_min, y_min, x_max, y_max] 即 [左, 上, 右, 下]（像素）
- 每条道路/线段单独一个 measurement，禁止合并
- boxes 数组每个元素对应一个目标，count 严格等于 boxes 数组长度
- 无需空间测量时 measurements 可为 []"""


# ── 通义千问 API 调用 ──────────────────────────────────────────────────────────

async def _call_qwen(system: str, messages: list) -> str:
    payload = {
        "model": cfg.QWEN_MODEL,
        "messages": [{"role": "system", "content": system}] + messages,
        "enable_thinking": False,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{cfg.QWEN_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {cfg.QWEN_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:800]}")
        data = resp.json()
        if "choices" not in data:
            raise RuntimeError(f"响应中无 choices 字段：{resp.text[:800]}")
        return data["choices"][0]["message"]["content"]


async def _call_qwen_hires(system: str, img_b64: str, prompt: str, thinking: bool = False) -> str:
    """高清视觉 API 调用：detail=high + vl_high_resolution_images，适合道路/建筑精细识别。"""
    payload = {
        "model": cfg.QWEN_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {
                    "url": f"data:image/png;base64,{img_b64}",
                    "detail": "high",
                }},
                {"type": "text", "text": prompt},
            ]},
        ],
        "enable_thinking": thinking,
        "vl_high_resolution_images": True,
    }
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(
            f"{cfg.QWEN_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {cfg.QWEN_API_KEY}", "Content-Type": "application/json"},
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:400]}")
        data = resp.json()
        return data["choices"][0]["message"]["content"]


def _img_message(text: str, img_b64: str) -> dict:
    return {
        "role": "user",
        "content": [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
        ],
    }


# ── 工具函数 ───────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> dict:
    start = text.find("{")
    end   = text.rfind("}") + 1
    if start == -1 or end == 0:
        raise ValueError(f"模型未返回 JSON，原始输出：{text[:300]}")
    return json.loads(text[start:end])


def _y_to_lat(y_norm: float, bounds: dict) -> float:
    """y_norm [0=北, 1=南] → 纬度，使用 Web Mercator 精确换算（修正线性插值误差）。"""
    lat_n = math.radians(bounds["north"])
    lat_s = math.radians(bounds["south"])
    y_n = math.log(math.tan(math.pi / 4 + lat_n / 2))
    y_s = math.log(math.tan(math.pi / 4 + lat_s / 2))
    y_m = y_n - y_norm * (y_n - y_s)
    return math.degrees(2 * math.atan(math.exp(y_m)) - math.pi / 2)


def _px_to_latlng(x: float, y: float, bounds: dict) -> tuple[float, float]:
    """将模型输出的 [0,1000] 归一化坐标转换为经纬度。x=横向(→经度), y=纵向(→纬度)。"""
    lat = _y_to_lat(y / COORD_SCALE, bounds)
    lng = bounds["west"] + (x / COORD_SCALE) * (bounds["east"] - bounds["west"])
    return lat, lng


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlng / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def _polyline_km(points_norm: list, bounds: dict) -> float:
    latlngs = [_px_to_latlng(x, y, bounds) for x, y in points_norm]
    return sum(_haversine_km(*latlngs[i - 1], *latlngs[i]) for i in range(1, len(latlngs)))


def _polyline_to_latlng_list(points_norm: list, bounds: dict) -> list:
    return [list(_px_to_latlng(x, y, bounds)) for x, y in points_norm]


# ── 道路/建筑解析工具 ────────────────────────────────────────────────────────────

def _is_road_target(target: str) -> bool:
    return any(kw in target for kw in _ROAD_KEYWORDS)


def _is_building_target(target: str) -> bool:
    return any(kw in target for kw in _BUILDING_KEYWORDS)


def _parse_road_json(text: str) -> list[dict]:
    """从模型返回中提取 roads 折线列表，过滤无效点。"""
    try:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start == -1 or end == 0:
            return []
        obj = json.loads(text[start:end])
        result = []
        for r in obj.get("roads", []):
            pts = r.get("polyline", [])
            valid = [
                [max(0, min(1000, p[0])), max(0, min(1000, p[1]))]
                for p in pts if len(p) == 2
            ]
            if len(valid) >= 2:
                result.append({"label": r.get("label", "道路"), "polyline": valid})
        return result
    except Exception:
        return []


def _parse_building_json(text: str) -> list[dict]:
    """从模型返回中提取 buildings box 列表，自动过滤超大矩形。"""
    boxes = []
    try:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start == -1 or end == 0:
            return []
        obj = json.loads(text[start:end])
        for b in obj.get("buildings", []):
            box = b.get("box", [])
            if len(box) == 4:
                x1, y1, x2, y2 = [max(0, min(1000, v)) for v in box]
                if x2 > x1 and y2 > y1:
                    boxes.append({"label": b.get("label", "建筑"), "box_2d": [x1, y1, x2, y2]})
    except Exception:
        pass
    return _filter_large_boxes(boxes)


def _filter_large_boxes(boxes: list, max_area_pct: float = 0.08) -> list:
    """过滤面积超过图像 max_area_pct 的矩形（大框通常是误报）。"""
    threshold = COORD_SCALE * COORD_SCALE * max_area_pct  # 默认 80000
    return [
        b for b in boxes
        if len(b.get("box_2d", [])) == 4 and
           (b["box_2d"][2] - b["box_2d"][0]) * (b["box_2d"][3] - b["box_2d"][1]) <= threshold
    ]


def _draw_road_polylines(img_b64: str, roads: list) -> str:
    """在截图上绘制道路中心线折线，返回 base64 PNG。"""
    if not _HAS_PIL:
        return img_b64
    from PIL import ImageDraw

    ROAD_COLORS = [
        (255, 80,  80),
        (80,  160, 255),
        (80,  220, 80),
        (255, 180, 0),
        (220, 80,  255),
        (0,   210, 210),
        (255, 120, 0),
    ]

    raw = _b64.b64decode(img_b64)
    img = _PILImage.open(io.BytesIO(raw)).convert("RGB")
    draw = ImageDraw.Draw(img)
    w, h = img.size

    for i, road in enumerate(roads):
        pts = road.get("polyline", [])
        if len(pts) < 2:
            continue
        rgb = ROAD_COLORS[i % len(ROAD_COLORS)]
        px_pts = [
            (int(p[0] / COORD_SCALE * w), int(p[1] / COORD_SCALE * h))
            for p in pts
        ]
        draw.line(px_pts, fill=rgb, width=4)
        x0, y0 = px_pts[0]
        draw.ellipse([x0 - 4, y0 - 4, x0 + 4, y0 + 4], fill=rgb)
        label = str(road.get("label", ""))
        if label:
            lw = len(label) * 7 + 6
            draw.rectangle([x0, y0 - 16, x0 + lw, y0], fill=rgb)
            draw.text((x0 + 3, y0 - 15), label, fill=(255, 255, 255))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return _b64.b64encode(buf.getvalue()).decode()


def _tile_roads_to_full(tile_roads: list, tile: dict, img_w: int, img_h: int) -> list:
    """把分块坐标（0-1000 局部）映射回全图坐标（0-1000）。"""
    x0, y0, cw, ch = tile["x0"], tile["y0"], tile["cw"], tile["ch"]
    out = []
    for road in tile_roads:
        mapped = [
            [
                max(0.0, min(COORD_SCALE, (x0 + px / COORD_SCALE * cw) / img_w * COORD_SCALE)),
                max(0.0, min(COORD_SCALE, (y0 + py / COORD_SCALE * ch) / img_h * COORD_SCALE)),
            ]
            for px, py in road.get("polyline", [])
        ]
        if len(mapped) >= 2:
            out.append({"label": road.get("label", "道路"), "polyline": mapped})
    return out


def _dedup_roads(roads: list, tol: float = 30.0) -> list:
    """删除起点/终点都在 tol 范围内的重复道路（滑窗重叠区产生）。"""
    deduped: list = []
    for road in roads:
        pts = road["polyline"]
        p0, p1 = pts[0], pts[-1]
        dup = False
        for kept in deduped:
            k = kept["polyline"]
            k0, k1 = k[0], k[-1]
            if ((abs(p0[0]-k0[0]) < tol and abs(p0[1]-k0[1]) < tol and
                 abs(p1[0]-k1[0]) < tol and abs(p1[1]-k1[1]) < tol) or
                (abs(p0[0]-k1[0]) < tol and abs(p0[1]-k1[1]) < tol and
                 abs(p1[0]-k0[0]) < tol and abs(p1[1]-k0[1]) < tol)):
                dup = True
                break
        if not dup:
            deduped.append(road)
    return deduped


async def _annotate_road_sliding_window(img_b64: str, target: str) -> dict:
    """滑动窗口道路识别：2×2 分块（15%重叠）并发识别后合并去重。"""
    prompt = _ROAD_DETECT_TMPL.format(target=target)

    if not _HAS_PIL:
        raw = await _call_qwen_hires(_ROAD_ANNOTATE_SYSTEM, img_b64, prompt)
        roads = _parse_road_json(raw)
        annotated = _draw_road_polylines(img_b64, roads) if roads else None
        return {
            "reply": f"已标注 {len(roads)} 条「{target}」" if roads else f"未识别到「{target}」",
            "annotated_image": annotated,
            "count": len(roads),
        }

    raw_bytes = _b64.b64decode(img_b64)
    img = _PILImage.open(io.BytesIO(raw_bytes)).convert("RGB")
    img_w, img_h = img.size

    hw, hh = img_w // 2, img_h // 2
    ox, oy  = int(img_w * 0.15), int(img_h * 0.15)
    regions = [
        (0,      0,       hw + ox, hh + oy),
        (hw - ox, 0,      img_w,   hh + oy),
        (0,      hh - oy, hw + ox, img_h),
        (hw - ox, hh - oy, img_w,  img_h),
    ]
    tiles = []
    for x0, y0, x1, y1 in regions:
        crop = img.crop((x0, y0, x1, y1))
        buf = io.BytesIO()
        crop.save(buf, format="PNG")
        tiles.append({"b64": _b64.b64encode(buf.getvalue()).decode(),
                      "x0": x0, "y0": y0, "cw": x1 - x0, "ch": y1 - y0})

    results = await asyncio.gather(
        *[_call_qwen_hires(_ROAD_ANNOTATE_SYSTEM, t["b64"], prompt) for t in tiles],
        return_exceptions=True,
    )

    all_roads: list = []
    for tile, raw in zip(tiles, results):
        if isinstance(raw, Exception):
            continue
        all_roads.extend(_tile_roads_to_full(_parse_road_json(raw), tile, img_w, img_h))

    deduped = _dedup_roads(all_roads)
    annotated = _draw_road_polylines(img_b64, deduped) if deduped else None
    return {
        "reply": f"已标注 {len(deduped)} 条「{target}」" if deduped else f"未在视野中识别到「{target}」",
        "annotated_image": annotated,
        "count": len(deduped),
    }

_CHAT_SYSTEM = """你是专业的卫星地图分析助手。每次对话我都会附上当前高德卫星地图截图供你参考。
请结合图像内容，准确、简洁地用中文回答用户的问题。
你擅长：识别建筑、道路、植被、水体、用地类型；分析空间布局与城市规划；估算目标数量与分布；解答地理与规划相关问题。
若问题与地图无关，正常回答即可。"""

_ANNOTATE_SYSTEM = """你是卫星图像目标定位助手。请精确找出图中用户要求的所有目标，逐个输出边界框坐标。

坐标规则：左上角 (0,0)，右下角 (1000,1000)，坐标需紧贴目标边缘。
每行输出一个目标，格式：目标名称 [x1, y1, x2, y2]
有几个输出几个，不遗漏、不重复、不捏造。"""


def _draw_chat_annotations(img_b64: str, annotations: list) -> str:
    """在截图上绘制标注框，返回 base64 PNG。"""
    if not _HAS_PIL:
        return img_b64
    from PIL import ImageDraw

    COLORS = [
        (255, 80,  80),
        (80,  160, 255),
        (80,  220, 80),
        (255, 180, 0),
        (220, 80,  255),
        (0,   210, 210),
        (255, 120, 0),
        (120, 255, 120),
    ]

    raw = _b64.b64decode(img_b64)
    img = _PILImage.open(io.BytesIO(raw)).convert("RGB")
    draw = ImageDraw.Draw(img)
    w, h = img.size

    for i, ann in enumerate(annotations):
        box = ann.get("box_2d", [])
        if len(box) != 4:
            continue
        x1, y1, x2, y2 = [max(0, min(1000, v)) for v in box]
        px1 = int(x1 / COORD_SCALE * w)
        py1 = int(y1 / COORD_SCALE * h)
        px2 = int(x2 / COORD_SCALE * w)
        py2 = int(y2 / COORD_SCALE * h)
        if px2 <= px1 or py2 <= py1:
            continue

        rgb = COLORS[i % len(COLORS)]
        draw.rectangle([px1, py1, px2, py2], outline=rgb, width=2)

        label = str(ann.get("label", ""))
        if label:
            lw = len(label) * 8 + 8
            ly = max(py1 - 18, 0)
            draw.rectangle([px1, ly, px1 + lw, ly + 16], fill=rgb)
            draw.text((px1 + 4, ly + 1), label, fill=(255, 255, 255))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return _b64.b64encode(buf.getvalue()).decode()


def _parse_boxes_from_text(text: str) -> list[dict]:
    """解析 AI 回复中的 bounding box 坐标。
    优先解析 Qwen2.5-VL 原生 grounding 格式：<ref>label</ref><box>[[x1,y1,x2,y2]]</box>
    回退到纯文本格式：label [x1, y1, x2, y2]
    """
    import re
    results = []

    # ── Qwen2.5-VL 原生 grounding 格式 ──────────────────────────────────────
    # <ref>label</ref><box>[[x1,y1,x2,y2]]</box> 或 <box>[[x1,y1,x2,y2]]</box>
    qwen_re = re.compile(
        r'(?:<ref>(.*?)</ref>\s*)?<box>\[\[([\d,\s\]\[]+)\]\]</box>'
    )
    for m in qwen_re.finditer(text):
        label = (m.group(1) or "目标").strip()
        inner = m.group(2)
        # 支持多框：[[x1,y1,x2,y2],[x3,y3,x4,y4]]
        for box_str in re.split(r'\]\s*,\s*\[', inner):
            nums = [int(x) for x in re.findall(r'\d+', box_str)]
            if len(nums) == 4:
                x1, y1, x2, y2 = nums
                if x2 > x1 and y2 > y1:
                    results.append({"label": label, "box_2d": [x1, y1, x2, y2]})

    if results:
        return results

    # ── 回退：纯文本 label [x1, y1, x2, y2] ─────────────────────────────────
    fallback_re = re.compile(
        r'([^\[\n]{0,20}?)\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]'
    )
    for m in fallback_re.finditer(text):
        label = m.group(1).strip().rstrip('：:').strip()
        x1, y1, x2, y2 = int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5))
        if x2 > x1 and y2 > y1:
            results.append({"label": label or "目标", "box_2d": [x1, y1, x2, y2]})
    return results


async def annotate_image(img_b64: str, target: str) -> dict:
    """根据目标类型路由到道路折线识别或建筑/通用边界框识别。"""

    # ── 道路：滑动窗口 + 折线绘制 ───────────────────────────────────────────────
    if _is_road_target(target):
        return await _annotate_road_sliding_window(img_b64, target)

    # ── 建筑：专用 prompt + 单栋小框 ────────────────────────────────────────────
    if _is_building_target(target):
        prompt = f"请找出图中所有独立「{target}」，每栋分别标注一个边界框。"
        raw = await _call_qwen_hires(_BUILDING_ANNOTATE_SYSTEM, img_b64, prompt, thinking=True)
        boxes = _parse_building_json(raw)
        if boxes:
            annotated = _draw_chat_annotations(img_b64, boxes)
            return {"reply": f"已标注 {len(boxes)} 栋「{target}」", "annotated_image": annotated, "count": len(boxes)}
        # fallback 到通用解析
        boxes = _filter_large_boxes(_parse_boxes_from_text(raw))
        if boxes:
            annotated = _draw_chat_annotations(img_b64, boxes)
            return {"reply": f"已标注 {len(boxes)} 个「{target}」", "annotated_image": annotated, "count": len(boxes)}
        return {"reply": f"未识别到「{target}」。AI回复：{raw[:200]}", "annotated_image": None, "count": 0}

    # ── 通用目标：高清模式 + 大框过滤 ───────────────────────────────────────────
    prompt = f"请找出图中所有「{target}」，逐个输出边界框 [x1, y1, x2, y2]。"
    payload = {
        "model": cfg.QWEN_MODEL,
        "messages": [
            {"role": "system", "content": _ANNOTATE_SYSTEM},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {
                    "url": f"data:image/png;base64,{img_b64}",
                    "detail": "high",
                }},
                {"type": "text", "text": prompt},
            ]},
        ],
        "enable_thinking": True,
        "vl_high_resolution_images": True,
    }
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(
            f"{cfg.QWEN_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {cfg.QWEN_API_KEY}", "Content-Type": "application/json"},
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:400]}")
        raw = resp.json()["choices"][0]["message"]["content"]

    boxes = _filter_large_boxes(_parse_boxes_from_text(raw))
    if boxes:
        annotated = _draw_chat_annotations(img_b64, boxes)
        return {"reply": f"已标注 {len(boxes)} 个「{target}」", "annotated_image": annotated, "count": len(boxes)}
    return {"reply": f"图中未找到「{target}」，或无法定位。AI原始回复：{raw[:200]}", "annotated_image": None, "count": 0}



_ANNOTATE_KEYWORDS = {"标记", "标注", "找出", "框出", "圈出", "画出", "标出"}

def _extract_annotate_target(text: str) -> str | None:
    """判断是否为标注请求，若是则返回目标名称，否则返回 None。"""
    import re
    if not any(kw in text for kw in _ANNOTATE_KEYWORDS):
        return None
    # 尝试提取"标记XXX"、"找出XXX"等后面的目标词
    m = re.search(r'(?:标记|标注|找出|框出|圈出|画出|标出)[视野中的、中的、所有、全部的、图中的\s]*(.{1,20}?)(?:[，,。.！!？?]|$)', text)
    if m:
        target = m.group(1).strip()
        if target:
            return target
    return "目标"


async def chat_with_map(
    messages: list,
    img_b64: str,
    *,
    bounds: dict | None = None,
    region: str = "",
    nearby_pois: str = "",
    traverse_context: str = "",
    scene_type: str = "satellite",
) -> dict:
    """带地图截图的对话接口，自动检测标注意图。"""
    last_user = next(
        (m["content"] for m in reversed(messages) if m.get("role") == "user"),
        "",
    )
    if isinstance(last_user, list):
        last_user = " ".join(p.get("text", "") for p in last_user if isinstance(p, dict))

    # 标注模式
    target = _extract_annotate_target(last_user)
    if target:
        return await annotate_image(img_b64, target)

    # 普通对话模式
    system = _CHAT_SYSTEM
    if scene_type == "3d":
        system = "你是密云水库数字孪生系统的AI助手。当前截图是三维场景渲染图，非卫星遥感图。请根据3D场景内容回答用户问题，可描述场景中可见的建筑、地形、水域等要素。"
    extras = []
    if region:
        extras.append(f"当前区域：{region}")
    if nearby_pois:
        extras.append(f"附近POI：{nearby_pois}")
    if traverse_context:
        extras.append(f"遍历摘要：{traverse_context}")
    if extras:
        system = system + "\n\n附加上下文：\n" + "\n".join(extras)

    qwen_msgs = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "user" and m is messages[-1]:
            # 最后一条用户消息附加地图截图
            # 自动检测图片格式（JPEG base64 以 /9j/ 开头）
            img_mime = "image/jpeg" if img_b64.startswith("/9j/") else "image/png"
            qwen_msgs.append({
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{img_mime};base64,{img_b64}"}},
                    {"type": "text", "text": content if isinstance(content, str) else last_user},
                ],
            })
        else:
            qwen_msgs.append({"role": role, "content": content})

    reply = await _call_qwen(system, qwen_msgs)
    return {"reply": reply, "annotated_image": None}


class AgentSession:
    def __init__(
        self,
        session_id: str,
        target: str,
        lat: float,
        lng: float,
        zoom: int,
        mode: str = "search",
        question: str = "",
        north: float = 0.0,
        south: float = 0.0,
        east: float = 0.0,
        west: float = 0.0,
        region: str = "",
        nearby_pois: str = "",
        active_wl: list | None = None,
    ) -> None:
        self.session_id = session_id
        self.target     = target
        self.lat        = lat
        self.lng        = lng
        self.zoom       = zoom
        self.mode       = mode
        self.question   = question
        self.north      = north
        self.south      = south
        self.east       = east
        self.west       = west
        self.region     = region
        self.nearby_pois = nearby_pois
        self.active_wl  = active_wl or []
        self.queue: asyncio.Queue[dict] = asyncio.Queue()

    def _emit(self, event: dict) -> None:
        self.queue.put_nowait(event)

    def _log(self, msg: str) -> None:
        self._emit({"type": "log", "message": msg})

    async def run(self) -> None:
        taker = MapScreenshotTaker()
        try:
            await taker.start()
            if self.mode == "analyze":
                await self._analyze_once(taker)
            else:
                await self._loop(taker)
        except Exception as exc:
            tb = traceback.format_exc()
            self._emit({"type": "error", "message": f"{type(exc).__name__}: {exc}\n{tb}"})
        finally:
            await taker.stop()
            self._emit({"type": "done", "message": "任务结束"})

    # ── 目标搜索（直接检测当前视野，不自动缩放/平移） ──────────────────────────────

    async def _loop(self, taker: MapScreenshotTaker) -> None:
        self._log(f"截取当前视野（zoom={self.zoom}）…")
        result  = await taker.screenshot(self.lat, self.lng, self.zoom, active_wl=self.active_wl)
        img_b64 = result["image"]
        bounds  = result["bounds"]
        self._emit({"type": "screenshot", "image": img_b64, "step": 1})

        self._log("全图检测中…")
        try:
            det_result = await self._detect(img_b64, bounds)
            all_dets   = det_result.get("detections", [])
            self._log(f"  检测到 {len(all_dets)} 个候选")
        except Exception as exc:
            self._log(f"检测失败：{exc}")
            return

        found = [dict(d, box_2d=_expand_box(d["box_2d"])) for d in _nms(all_dets)]
        self._log(f"检测完成，共 {len(found)} 个目标")

        if found:
            annotated = _annotate_detections(img_b64, found)
            self._emit({"type": "annotated_screenshot", "image": annotated})

        cc = self._box_to_coords([500, 500, 500, 500], bounds)
        self._log(f"[CAL] 中心校准: (500,500)→lat={cc['north']:.5f} lng={cc['west']:.5f}  视口中心lat={self.lat:.5f} lng={self.lng:.5f}")

        for det in found:
            raw    = det["box_2d"]
            coords = self._box_to_coords(raw, bounds)
            clat   = (coords["north"] + coords["south"]) / 2
            clng   = (coords["east"]  + coords["west"])  / 2
            self._emit({
                "type":        "add_marker",
                "lat":         clat,
                "lng":         clng,
                "description": det.get("description", self.target),
                "confidence":  det.get("confidence",  0.0),
                "raw_box":     raw,
            })
            self._emit({
                "type":  "add_rect",
                "north": coords["north"],
                "south": coords["south"],
                "east":  coords["east"],
                "west":  coords["west"],
            })

    # ── 视野分析（单次） ────────────────────────────────────────────────────────

    async def _analyze_once(self, taker: MapScreenshotTaker) -> None:
        self._log("截取当前视野…")
        result  = await taker.screenshot(self.lat, self.lng, self.zoom, active_wl=self.active_wl)
        img_b64 = result["image"]
        bounds  = result["bounds"]
        self._emit({"type": "screenshot", "image": img_b64, "step": 1})

        self._log("分析问题中…")
        prompt = _ANALYZE_TMPL.format(question=self.question)
        text = await _call_qwen(_ANALYZE_SYSTEM, [_img_message(prompt, img_b64)])
        data = _extract_json(text)
        measurements = data.get("measurements", [])
        self._log(f"[DEBUG] 视口 N={bounds['north']:.5f} S={bounds['south']:.5f} W={bounds['west']:.5f} E={bounds['east']:.5f}")
        for m in measurements:
            if m.get("type") == "count":
                self._log(f"[DEBUG] count boxes 原始值={m.get('boxes', [])[:3]}")  # 只打前3个
            if m.get("type") == "length":
                pts = m.get("polyline", [])
                self._log(f"[DEBUG] polyline 首末点={pts[:1]+pts[-1:]}")

        for m in measurements:
            if m.get("type") == "length":
                pts = m.get("polyline", [])
                if len(pts) >= 2:
                    km = _polyline_km(pts, bounds)
                    m["km"]      = round(km, 4)
                    m["latlngs"] = _polyline_to_latlng_list(pts, bounds)

        for m in measurements:
            if m.get("type") == "count":
                if _HAS_PIL:
                    self._log("启用九宫格精确计数…")
                    count, rects = await self._count_with_grid(img_b64, bounds)
                    m["count"] = count
                    m["rects"] = rects
                else:
                    boxes = m.get("boxes", [])
                    rects = [self._box_to_coords(b, bounds) for b in boxes if len(b) == 4]
                    m["rects"] = rects
                    m["count"] = len(rects)

        lines    = []
        total_km = 0.0
        for m in measurements:
            if m.get("type") == "length" and "km" in m:
                km = m["km"]
                total_km += km
                dist = f"{km * 1000:.0f} 米" if km < 1 else f"{km:.3f} 公里"
                lines.append(f"{m.get('label', '测量')}：{dist}")
            elif m.get("type") == "count":
                lines.append(f"{m.get('label', '目标')}：{m['count']} 个")

        length_items = [m for m in measurements if m.get("type") == "length" and "km" in m]
        if len(length_items) > 1:
            total = f"{total_km * 1000:.0f} 米" if total_km < 1 else f"{total_km:.3f} 公里"
            lines.append(f"─────────────\n合计：{total}")

        answer = "\n".join(lines) if lines else data.get("answer", "无法获取测量结果")

        self._emit({
            "type":         "analyze_result",
            "answer":       answer,
            "measurements": measurements,
        })
        self._log(f"分析完成：{answer}")

    # ── 道路中心线检测 ──────────────────────────────────────────────────────────

    async def _detect_road(self, img_b64: str, bounds: dict) -> list:
        """检测道路中心线，返回 [{"label":..., "latlngs":[[lat,lng],...]}]"""
        system = _ROAD_DETECT_SYSTEM.format(target=self.target)
        prompt = _ROAD_DETECT_TMPL.format(target=self.target)
        text   = await _call_qwen(system, [_img_message(prompt, img_b64)])
        raw    = _extract_json(text)
        roads  = []
        for road in raw.get("roads", []):
            pts = road.get("polyline", [])
            if len(pts) < 2:
                continue
            latlngs = [list(_px_to_latlng(x, y, bounds)) for x, y in pts]
            roads.append({"label": road.get("label", self.target), "latlngs": latlngs})
        return roads

    # ── 九宫格精确计数 ──────────────────────────────────────────────────────────

    async def _count_with_grid(self, img_b64: str, bounds: dict) -> tuple[int, list]:
        cells = _split_image(img_b64)
        if not cells:
            return 0, []

        cw, ch = cells[0]["cw"], cells[0]["ch"]
        rects = []

        for i, cell in enumerate(cells):
            prompt = (
                f"这是一张卫星图的子图（第{cell['row']+1}行第{cell['col']+1}列）。\n"
                f"请标注图中所有可见的「{self.target}」边界框。\n"
                f"坐标为归一化坐标，左上角(0,0)，右下角(1000,1000)，x∈[0,1000]，y∈[0,1000]。\n"
                f"仅返回 JSON：{{\"boxes\":[[y1,x1,y2,x2],...]}}"
            )
            try:
                text = await _call_qwen(
                    f"你是精确的卫星图像目标标注专家。对图中所有「{self.target}」逐一标注边界框，不遗漏、不重复。坐标归一化到[0,1000]。仅输出 JSON。",
                    [_img_message(prompt, cell["b64"])],
                )
                cell_data = _extract_json(text)
                for box in cell_data.get("boxes", []):
                    if len(box) != 4:
                        continue
                    x1, y1, x2, y2 = box   # Qwen 格式: [左, 上, 右, 下]
                    # 将子图归一化坐标 [0,1000] 转换为全图归一化坐标 [0,1000]
                    x1_full = (x1 / COORD_SCALE * cw + cell["x0"]) / IMG_W * COORD_SCALE
                    y1_full = (y1 / COORD_SCALE * ch + cell["y0"]) / IMG_H * COORD_SCALE
                    x2_full = (x2 / COORD_SCALE * cw + cell["x0"]) / IMG_W * COORD_SCALE
                    y2_full = (y2 / COORD_SCALE * ch + cell["y0"]) / IMG_H * COORD_SCALE
                    rects.append(self._box_to_coords([x1_full, y1_full, x2_full, y2_full], bounds))
            except Exception as exc:
                self._log(f"子图{i}计数失败：{exc}")

        return len(rects), rects

    # ── 模型调用（推理） ────────────────────────────────────────────────────────

    async def _reason(self, img_b64: str, bounds: dict) -> dict:
        user_text = (
            f"当前任务：{self.target}\n"
            f"当前中心：纬度 {self.lat:.6f}，经度 {self.lng:.6f}，缩放级别 {self.zoom}\n"
            f"视口边界：北 {bounds['north']:.6f}，南 {bounds['south']:.6f}，"
            f"东 {bounds['east']:.6f}，西 {bounds['west']:.6f}\n\n"
            "请分析这张卫星截图并决定下一步行动（仅返回 JSON）。"
        )
        text = await _call_qwen(_REASON_SYSTEM, [_img_message(user_text, img_b64)])
        return _extract_json(text)

    # ── 模型调用（检测） ────────────────────────────────────────────────────────

    async def _detect(self, img_b64: str, bounds: dict | None = None) -> dict:
        if bounds:
            geo = (
                f"{'【' + self.region + '】' if self.region else ''}"
                f"北纬{bounds['south']:.4f}°~{bounds['north']:.4f}°，"
                f"东经{bounds['west']:.4f}°~{bounds['east']:.4f}°"
            )
        elif self.north and self.south and self.east and self.west:
            geo = (
                f"{'【' + self.region + '】' if self.region else ''}"
                f"北纬{self.south:.4f}°~{self.north:.4f}°，"
                f"东经{self.west:.4f}°~{self.east:.4f}°"
            )
        else:
            geo = f"中心坐标 {self.lat:.5f}°N, {self.lng:.5f}°E"
        prompt = _DETECT_TMPL.format(target=self.target, geo_context=geo)
        nearby_hint = f"周边地名参考：{self.nearby_pois}\n" if self.nearby_pois else ""
        text = await _call_qwen(
            f"你是专业的卫星遥感图像目标检测系统。{nearby_hint}精确定位图像中所有「{self.target}」，不遗漏、不重复，边界框紧贴目标轮廓。仅输出JSON，不含任何其他文字。",
            [_img_message(prompt, img_b64)],
        )
        return _extract_json(text)

    # ── 坐标转换：归一化 [0,1000] → 经纬度 ─────────────────────────────────────

    @staticmethod
    def _box_to_coords(box_2d: list, bounds: dict, pixel: bool = False) -> dict:
        """box_2d → 经纬度边界框。
        pixel=True: 输入为像素坐标（0~IMG_W, 0~IMG_H），先归一化到 [0,1000]。
        pixel=False: 输入已是 [0,1000] 归一化坐标（旧逻辑）。
        格式 [x_min, y_min, x_max, y_max]，x 向右，y 向下。
        """
        x1, y1, x2, y2 = box_2d
        if pixel:
            x1 = x1 / IMG_W * COORD_SCALE
            y1 = y1 / IMG_H * COORD_SCALE
            x2 = x2 / IMG_W * COORD_SCALE
            y2 = y2 / IMG_H * COORD_SCALE
        W, E = bounds["west"], bounds["east"]
        lng_span = E - W
        return {
            "north": _y_to_lat(y1 / COORD_SCALE, bounds),
            "south": _y_to_lat(y2 / COORD_SCALE, bounds),
            "west":  W + (x1 / COORD_SCALE) * lng_span,
            "east":  W + (x2 / COORD_SCALE) * lng_span,
        }
