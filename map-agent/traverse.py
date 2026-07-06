import asyncio
import json
import math
import re
import httpx
from pathlib import Path

import config as cfg
from screenshot import MapScreenshotTaker

_STATIC = Path(__file__).parent / "static" / "water_levels"


# ── 水位线多边形过滤 ──────────────────────────────────────────────────────────

def _load_wl_ring(name: str) -> list | None:
    """加载水位线 GeoJSON 外环，下采样到 ≤2000 点以提升检测速度。"""
    path = _STATIC / f"{name}.geojson"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        gj = json.load(f)
    features = gj.get("features", [])
    if not features:
        return None
    ring = features[0]["geometry"]["coordinates"][0]
    step = max(1, len(ring) // 2000)
    return ring[::step]


def _point_in_ring(lat: float, lng: float, ring: list) -> bool:
    """射线法判断 (lat, lng) 是否在多边形内。GeoJSON 坐标为 [lng, lat]。"""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / (yj - yi) + xi
        ):
            inside = not inside
        j = i
    return inside


# ── 视口尺寸计算（Mercator） ──────────────────────────────────────────────────

def _viewport_span(zoom: int, lat_center: float) -> tuple[float, float]:
    """返回 1024×768 viewport 在 zoom 级别、lat_center 纬度处覆盖的 (lng_span, lat_span) 度数。"""
    lng_per_tile = 360.0 / (2 ** zoom)
    lat_per_tile = math.cos(math.radians(lat_center)) * lng_per_tile
    return lng_per_tile * (1024 / 256), lat_per_tile * (768 / 256)


def build_grid(north: float, south: float, east: float, west: float,
               zoom: int, overlap: float = 0.15) -> list[tuple[float, float]]:
    """生成覆盖 bounding box 的格子中心坐标列表（带 overlap 避免边缘漏检）。"""
    mid_lat = (north + south) / 2
    vw, vh  = _viewport_span(zoom, mid_lat)
    step_lng = vw * (1 - overlap)
    step_lat = vh * (1 - overlap)

    centers: list[tuple[float, float]] = []
    lat = north - vh / 2
    while lat >= south - step_lat * 0.5:
        lng = west + vw / 2
        while lng <= east + step_lng * 0.5:
            centers.append((round(lat, 6), round(lng, 6)))
            lng += step_lng
        lat -= step_lat
    return centers


def estimate_tiles(north: float, south: float, east: float, west: float,
                   zoom: int) -> int:
    return len(build_grid(north, south, east, west, zoom))


# ── Qwen API（复用 agent.py 相同模式） ───────────────────────────────────────

async def _call_qwen(system: str, messages: list) -> str:
    payload = {
        "model":          cfg.QWEN_MODEL,
        "messages":       [{"role": "system", "content": system}] + messages,
        "enable_thinking": False,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{cfg.QWEN_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {cfg.QWEN_API_KEY}",
                "Content-Type":  "application/json",
            },
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:400]}")
        data = resp.json()
        if "choices" not in data:
            raise RuntimeError(f"no choices: {resp.text[:400]}")
        return data["choices"][0]["message"]["content"]


def _extract_json(text: str) -> dict:
    m = re.search(r'\{[\s\S]*\}', text)
    if not m:
        raise ValueError(f"no JSON in: {text[:200]}")
    return json.loads(m.group())


# ── 每格分析提示词 ────────────────────────────────────────────────────────────

_SYSTEM = """\
你是卫星图像分析专家，正在对高德卫星图进行网格化遍历分析。
图像分辨率：1024×768 像素。
坐标规范：归一化坐标，左上角 (0,0)，右下角 (1000,1000)。
规则：
- 每个独立目标必须单独占一条 finding，不得合并
- box_2d 必须紧贴该目标的实际轮廓，不得用一个大框覆盖多个目标
- count 固定为 1（已拆分为独立条目）
仅返回纯 JSON，不含任何 markdown 代码块或额外说明文字。"""

_USER_TMPL = """\
【地理范围】北纬 {s:.5f}°—{n:.5f}°，东经 {w:.5f}°—{e:.5f}°（第 {idx}/{total} 格）
【识别需求】{prompt}

请逐个标注图中每一处"{prompt}"，每处单独一条记录，返回 JSON：
{{
  "has_target": true/false,
  "findings": [
    {{
      "type": "目标类型",
      "description": "外观特征（颜色、形状、屋顶材质等）",
      "confidence": 0.85,
      "count": 1,
      "box_2d": [x1, y1, x2, y2]
    }}
  ]
}}
若图中确实没有任何"{prompt}"，返回：{{"has_target": false, "findings": []}}"""


# ── 遍历分析会话 ───────────────────────────────────────────────────────────────

class TileTraverseSession:

    def __init__(self, session_id: str,
                 north: float, south: float, east: float, west: float,
                 zoom: int, prompt: str, active_wl: list, wl_filter: str,
                 queue: asyncio.Queue):
        self.session_id = session_id
        self.north  = north
        self.south  = south
        self.east   = east
        self.west   = west
        self.zoom   = zoom
        self.prompt = prompt
        self.active_wl = active_wl or []
        self.queue  = queue
        self._stop_event = asyncio.Event()          # 共享停止信号（协程安全）
        self._progress_counter = 0                   # 全局进度计数器
        self._progress_lock = asyncio.Lock()         # 保护 _progress_counter
        self._wl_ring        = _load_wl_ring(wl_filter) if wl_filter else None
        self._wl_filter_name = wl_filter

    def stop(self):
        self._stop_event.set()

    @staticmethod
    def _split_list(items: list, n_chunks: int) -> list[list]:
        """将列表均匀分成 n_chunks 份（轮询分配，避免最后一份太小）。"""
        chunks = [[] for _ in range(n_chunks)]
        for i, item in enumerate(items):
            chunks[i % n_chunks].append(item)
        return [c for c in chunks if c]  # 去掉空 chunk

    async def _update_progress(self) -> int:
        """原子递增全局进度计数器，返回当前进度序号。"""
        async with self._progress_lock:
            self._progress_counter += 1
            return self._progress_counter

    async def run(self):
        q = self.queue

        try:
            centers = build_grid(self.north, self.south, self.east, self.west, self.zoom)

            # 水位线过滤：剔除多边形外的格子
            if self._wl_ring:
                centers = [
                    (lat, lng) for lat, lng in centers
                    if _point_in_ring(lat, lng, self._wl_ring)
                ]

            total   = len(centers)
            await q.put({"type": "traverse_start", "total": total})

            if total == 0:
                await q.put({
                    "type": "log",
                    "message": (
                        "⚠ 没有格子需要遍历。可能原因：框选区域与水位线无交叠，"
                        "或水位线多边形内无格子中心点。请扩大框选范围或取消水位过滤。"
                    ),
                })
                await q.put({
                    "type": "traverse_summary",
                    "summary": "未找到需要遍历的格子，请调整框选区域或水位过滤设置。",
                    "findings": [],
                    "total_tiles": 0,
                })
                await q.put({"type": "done"})
                return

            # 按 Worker 数量分片
            workers = max(1, min(cfg.TRAVERSE_WORKERS, total))  # 不超过格子数
            chunks  = self._split_list(centers, workers)

            await q.put({
                "type": "log",
                "message": (
                    f"🚀 启动 {len(chunks)} 个并行 Worker，"
                    f"共 {total} 个格子（每 Worker 约 {len(chunks[0])} 格）"
                ),
            })

            # ── 并行执行所有 Worker ──────────────────────────────────────────
            results = await asyncio.gather(*[
                self._run_worker(worker_id=i, centers=chunk, total=total)
                for i, chunk in enumerate(chunks)
            ], return_exceptions=True)  # 一个 Worker 崩溃不影响其他

            # ── 收集结果 ─────────────────────────────────────────────────────
            all_findings: list[dict] = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    await q.put({
                        "type": "log",
                        "message": f"❌ Worker {i} 异常终止：{result}",
                    })
                elif result:
                    all_findings.extend(result)

            # 按 tile 编号排序（并行导致乱序到达）
            all_findings.sort(key=lambda f: f.get("tile", 0))

            summary = await self._gen_summary(all_findings, total)
            await q.put({
                "type": "traverse_summary",
                "summary":     summary,
                "findings":    all_findings,
                "total_tiles": total,
            })
            await q.put({"type": "done"})

        except Exception as e:
            await q.put({"type": "error", "message": str(e)})
        finally:
            pass  # 各 worker 自行管理 taker 生命周期

    async def _run_worker(self, worker_id: int, centers: list,
                           total: int) -> list[dict]:
        """单个 Worker：独立浏览器实例，串行处理自己分到的格子列表。

        Returns:
            该 Worker 发现的所有 finding 列表。异常时返回空列表。
        """
        taker = MapScreenshotTaker()
        findings: list[dict] = []

        try:
            await taker.start()

            for local_idx, (lat, lng) in enumerate(centers):
                # ── 检查全局停止信号 ──────────────────────────────────────
                if self._stop_event.is_set():
                    await self.queue.put({
                        "type": "log",
                        "message": f"[W{worker_id}] 收到停止信号，已处理 {local_idx} 格",
                    })
                    break

                global_idx = await self._update_progress()

                await self.queue.put({
                    "type": "traverse_progress",
                    "current": global_idx, "total": total,
                    "lat": lat, "lng": lng,
                    "worker": worker_id,
                })

                try:
                    result  = await taker.screenshot(
                        lat, lng, self.zoom,
                        active_wl=self.active_wl or None,
                    )
                    img_b64 = result["image"]
                    bounds  = result["bounds"]

                    await self.queue.put({
                        "type": "screenshot", "image": img_b64,
                        "step": global_idx, "bounds": bounds,
                    })

                    tile_findings = await self._analyze_tile(
                        img_b64, bounds, global_idx, total,
                    )
                    for f in tile_findings:
                        f["tile"] = global_idx
                        f["worker"] = worker_id
                        findings.append(f)
                        event = {k: v for k, v in f.items() if k != "type"}
                        event["type"] = "traverse_finding"
                        event["finding_type"] = f.get("type", "")
                        await self.queue.put(event)

                    n_found = len(tile_findings)
                    if n_found:
                        types = list(dict.fromkeys(
                            f.get("type", "?") for f in tile_findings
                        ))
                        await self.queue.put({
                            "type": "log",
                            "message": (
                                f"[W{worker_id}] 格子 {global_idx}/{total} — "
                                f"发现 {n_found} 处：{', '.join(types[:3])}"
                            ),
                        })
                    else:
                        await self.queue.put({
                            "type": "log",
                            "message": (
                                f"[W{worker_id}] 格子 {global_idx}/{total} — 未发现目标"
                            ),
                        })

                except Exception as e:
                    await self.queue.put({
                        "type": "log",
                        "message": f"[W{worker_id}] 格子 {global_idx} 异常（AI接口报错）：{e}",
                    })

        except Exception as e:
            # Worker 级致命错误（如浏览器启动失败）
            await self.queue.put({
                "type": "log",
                "message": f"❌ Worker {worker_id} 致命错误：{e}",
            })
        finally:
            await taker.stop()

        return findings

    async def _analyze_tile(self, img_b64: str, bounds: dict,
                             tile_idx: int, total: int) -> list[dict]:
        user_text = _USER_TMPL.format(
            n=bounds["north"], s=bounds["south"],
            e=bounds["east"],  w=bounds["west"],
            idx=tile_idx, total=total,
            prompt=self.prompt,
        )
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": user_text},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
            ],
        }]
        text = await _call_qwen(_SYSTEM, messages)
        data = _extract_json(text)
        if not data.get("has_target"):
            return []
        findings = data.get("findings", [])
        for f in findings:
            f["bounds"] = bounds
        return findings

    async def _gen_summary(self, findings: list[dict], total_tiles: int) -> str:
        if not findings:
            return f"遍历完成，共扫描 {total_tiles} 个格子，未发现目标要素。"

        by_type: dict[str, list] = {}
        for f in findings:
            by_type.setdefault(f.get("type", "未知"), []).append(f)

        total_count = sum(f.get("count", 1) for f in findings)
        stat_lines  = [f"共扫描 {total_tiles} 格，发现 {total_count} 处目标："]
        for t, items in by_type.items():
            cnt = sum(i.get("count", 1) for i in items)
            stat_lines.append(f"· {t}：{cnt} 处（{len(items)} 格内）")

        # AI 综合叙述
        try:
            records = "\n".join(
                f'格{f.get("tile","?")} [{f.get("type","?")}] {f.get("description","")}'
                for f in findings[:50]
            )
            ai_text = await _call_qwen(
                "你是地理分析专家，根据网格遍历结果撰写简洁中文汇总（不超过200字，不要JSON）。",
                [{"role": "user",
                  "content": f"识别目标：{self.prompt}\n\n发现记录：\n{records}"}],
            )
            stat_lines += ["", "【AI 综合报告】", ai_text.strip()]
        except Exception:
            pass

        return "\n".join(stat_lines)
