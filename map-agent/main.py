import asyncio
import sys
import json
import uuid
from pathlib import Path

# Playwright 在 Windows 上需要 ProactorEventLoop 才能启动子进程
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, FileResponse
from pydantic import BaseModel

import config as cfg
from agent import AgentSession, chat_with_map
from traverse import TileTraverseSession, estimate_tiles

app = FastAPI(title="地图智能体")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

sessions: dict[str, AgentSession] = {}
traverse_sessions: dict[str, TileTraverseSession] = {}

TEMPLATES = Path(__file__).parent / "templates"
STATIC    = Path(__file__).parent / "static"


# ── 模板渲染（注入 AMap Key） ──────────────────────────────────────────────────

def _render(name: str) -> str:
    text = (TEMPLATES / name).read_text(encoding="utf-8")
    text = text.replace("__AMAP_KEY__", cfg.AMAP_KEY)
    if cfg.AMAP_SECURITY_CODE:
        text = text.replace(
            "/* __AMAP_SECURITY__ */",
            f"window._AMapSecurityConfig = {{ securityJsCode: '{cfg.AMAP_SECURITY_CODE}' }};",
        )
    return text


# ── 页面路由 ───────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return _render("index.html")


@app.get("/map.html", response_class=HTMLResponse)
async def map_page():
    """Playwright 专用无头地图页面。"""
    return _render("map.html")


_WL_ALLOWED = {"155", "156", "157", "157d5", "158d5", "160"}


@app.get("/api/water-level/{name}/bbox")
async def water_level_bbox(name: str):
    """返回指定水位线多边形的 bounding box（用于无框选时的遍历范围）。"""
    if name not in _WL_ALLOWED:
        return JSONResponse({"error": "not found"}, status_code=404)
    path = STATIC / "water_levels" / f"{name}.geojson"
    if not path.exists():
        return JSONResponse({"error": "file not found"}, status_code=404)
    gj = json.loads(path.read_text(encoding="utf-8"))
    features = gj.get("features", [])
    if not features:
        return JSONResponse({"error": "empty"}, status_code=404)
    ring = features[0]["geometry"]["coordinates"][0]
    lngs = [p[0] for p in ring]
    lats  = [p[1] for p in ring]
    return {"north": max(lats), "south": min(lats), "east": max(lngs), "west": min(lngs)}


@app.get("/api/water-level/{name}")
async def water_level_geojson(name: str):
    """返回指定水位线的 GeoJSON（GCJ-02）。"""
    if name not in _WL_ALLOWED:
        return JSONResponse({"error": "not found"}, status_code=404)
    path = STATIC / "water_levels" / f"{name}.geojson"
    if not path.exists():
        return JSONResponse({"error": "未转换，请先运行 shp_to_geojson.py"}, status_code=404)
    return FileResponse(str(path), media_type="application/geo+json")


# ── API ────────────────────────────────────────────────────────────────────────

class StartRequest(BaseModel):
    target: str = ""
    lat: float
    lng: float
    zoom: int
    mode: str = "search"   # "search" | "analyze"
    question: str = ""
    north: float = 0.0
    south: float = 0.0
    east: float = 0.0
    west: float = 0.0
    region: str = ""
    nearby_pois: str = ""
    active_wl: list = []


@app.post("/api/start")
async def start(req: StartRequest):
    session_id = str(uuid.uuid4())
    session = AgentSession(
        session_id=session_id,
        target=req.target,
        lat=req.lat,
        lng=req.lng,
        zoom=req.zoom,
        mode=req.mode,
        question=req.question,
        north=req.north,
        south=req.south,
        east=req.east,
        west=req.west,
        region=req.region,
        nearby_pois=req.nearby_pois,
        active_wl=req.active_wl,
    )
    sessions[session_id] = session
    asyncio.create_task(session.run())
    return {"session_id": session_id}


@app.get("/api/stream/{session_id}")
async def stream(session_id: str):
    session = sessions.get(session_id)

    async def _gen():
        if session is None:
            yield f'data: {json.dumps({"type": "error", "message": "Session not found"})}\n\n'
            return
        while True:
            try:
                event = await asyncio.wait_for(session.queue.get(), timeout=30.0)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in ("done", "error"):
                    break
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


class ChatRequest(BaseModel):
    messages: list
    lat: float
    lng: float
    zoom: int
    region: str = ""
    nearby_pois: str = ""
    active_wl: list = []
    traverse_context: str = ""   # 最近遍历分析摘要，供 AI 参考
    screenshot_b64: str = ""     # 外部截图（3D 场景等），有值时跳过 Playwright
    scene_type: str = "satellite"  # satellite / standard / 3d


@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    if req.screenshot_b64:
        # 使用前端传入的截图（3D 场景等）
        img_b64 = req.screenshot_b64
        bounds  = None
    else:
        from screenshot import MapScreenshotTaker
        taker = MapScreenshotTaker()
        await taker.start()
        try:
            result = await taker.screenshot(req.lat, req.lng, req.zoom, active_wl=req.active_wl or None)
            img_b64 = result["image"]
            bounds  = result["bounds"]
        finally:
            await taker.stop()
    reply = await chat_with_map(req.messages, img_b64, bounds=bounds, region=req.region,
                                nearby_pois=req.nearby_pois, traverse_context=req.traverse_context,
                                scene_type=req.scene_type)
    return JSONResponse(reply)


# ── 区域遍历分析 ──────────────────────────────────────────────────────────────

class TraverseRequest(BaseModel):
    north: float
    south: float
    east:  float
    west:  float
    zoom:  int   = 17
    prompt: str  = ""
    active_wl: list = []
    wl_filter: str  = ""   # 水位线名称，如 "158d5"，空字符串表示不过滤


@app.post("/api/traverse/estimate")
async def traverse_estimate(req: TraverseRequest):
    n = estimate_tiles(req.north, req.south, req.east, req.west, req.zoom)
    return {"tiles": n}


@app.post("/api/traverse")
async def traverse_start(req: TraverseRequest):
    session_id = str(uuid.uuid4())
    q = asyncio.Queue()
    session = TileTraverseSession(
        session_id=session_id,
        north=req.north, south=req.south,
        east=req.east,   west=req.west,
        zoom=req.zoom,   prompt=req.prompt,
        active_wl=req.active_wl,
        wl_filter=req.wl_filter,
        queue=q,
    )
    traverse_sessions[session_id] = session
    sessions[session_id] = session   # 复用同一 SSE 流
    asyncio.create_task(session.run())
    return {"session_id": session_id}


@app.post("/api/traverse/{session_id}/stop")
async def traverse_stop(session_id: str):
    s = traverse_sessions.get(session_id)
    if s:
        s.stop()
    return {"ok": True}


# ── AI Earth 建筑物提取（旧接口，向后兼容） ──────────────────────────────────────

class AIERequest(BaseModel):
    lat: float
    lng: float
    zoom: int = 17
    active_wl: list = []

@app.post("/api/aiearth/extract")
async def aiearth_extract(req: AIERequest):
    from screenshot import MapScreenshotTaker
    from aiearth_client import extract_buildings

    taker = MapScreenshotTaker()
    await taker.start()
    try:
        result = await taker.screenshot(req.lat, req.lng, req.zoom,
                                        active_wl=req.active_wl or None)
    finally:
        await taker.stop()

    try:
        features = await extract_buildings(result["image"], result["bounds"])
    except Exception as e:
        msg = str(e)
        if "24240004" in msg:
            detail = "AI Earth Engine 鉴权失败（24240004）：请确认 AccessKey 对应的账号已开通 AI Earth Engine 服务，且 RAM 子账号已授权 AliyunAIEarthEngineFullAccess 策略。"
        else:
            detail = f"AI Earth Engine 调用失败：{msg}"
        return JSONResponse({"error": detail}, status_code=503)

    return JSONResponse({
        "type":     "FeatureCollection",
        "features": features,
        "bounds":   result["bounds"],
        "count":    len(features),
    })


# ── AI Earth 专业模式（SSE 流式，支持多类型 + 自定义范围） ─────────────────────

class AIEStartRequest(BaseModel):
    app_type:    str        = "building"  # building | road | dam | custom
    bounds_mode: str        = "viewport"  # viewport | custom
    lat:         float      = 0.0
    lng:         float      = 0.0
    zoom:        int        = 17
    north:       float | None = None
    south:       float | None = None
    east:        float | None = None
    west:        float | None = None
    text_prompt: str        = ""
    active_wl:   list       = []


class _AIESession:
    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()


@app.post("/api/aiearth/start")
async def aie_start(req: AIEStartRequest):
    from screenshot import MapScreenshotTaker
    from aiearth_client import run_extraction

    session_id = str(uuid.uuid4())
    sess = _AIESession()
    sessions[session_id] = sess
    q = sess.queue

    async def _run():
        try:
            await q.put({"type": "log", "message": "正在启动截图服务…"})
            taker = MapScreenshotTaker()
            await taker.start()
            try:
                use_custom = (
                    req.bounds_mode == "custom"
                    and all(v is not None for v in [req.north, req.south, req.east, req.west])
                )
                if use_custom:
                    await q.put({"type": "log", "message": "正在截取自定义框选范围截图…"})
                    result = await taker.screenshot_with_bounds(
                        req.north, req.south, req.east, req.west,
                        active_wl=req.active_wl or None,
                    )
                else:
                    await q.put({"type": "log", "message": "正在截取当前视野截图…"})
                    result = await taker.screenshot(
                        req.lat, req.lng, req.zoom,
                        active_wl=req.active_wl or None,
                    )
            finally:
                await taker.stop()

            await run_extraction(
                req.app_type, result["image"], result["bounds"],
                req.text_prompt, q,
            )
        except Exception as exc:
            await q.put({"type": "error", "message": str(exc)})
            await q.put({"type": "done"})

    asyncio.create_task(_run())
    return {"session_id": session_id}


# ── 启动入口 ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    config = uvicorn.Config(app, host="0.0.0.0", port=cfg.SERVER_PORT)
    server = uvicorn.Server(config)
    asyncio.run(server.serve())
