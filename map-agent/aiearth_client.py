"""
AI Earth 建筑物提取客户端
直接使用 alibabacloud_aiearth_engine20220609，不依赖 cv2。
流程：Playwright 截图(PNG) → GeoTIFF → publish_local_tiff → building_extraction → SHP → GeoJSON
"""
import asyncio
import base64
import io
import time
import zipfile
import tempfile
from pathlib import Path

import httpx
from PIL import Image

import config as cfg


# ── PNG → GeoTIFF ─────────────────────────────────────────────────────────────

def _png_to_geotiff(img_b64: str, bounds: dict, output_path: str) -> None:
    """把 base64 PNG + 经纬度范围写成带坐标的 GeoTIFF。"""
    import numpy as np
    import tifffile

    img_bytes = base64.b64decode(img_b64)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(img)
    h, w = arr.shape[:2]

    west  = bounds["west"]
    north = bounds["north"]
    east  = bounds["east"]
    south = bounds["south"]

    px_w = (east  - west)  / w
    px_h = (north - south) / h

    model_pixel_scale = (px_w, px_h, 0.0)
    model_tiepoint    = (0.0, 0.0, 0.0, west, north, 0.0)
    geo_keys = [
        1, 1, 0, 3,
        1024, 0, 1, 2,      # GTModelTypeGeoKey = Geographic
        2048, 0, 1, 4326,   # GeographicTypeGeoKey = WGS84
        1025, 0, 1, 1,      # GTRasterTypeGeoKey = PixelIsArea
    ]

    tifffile.imwrite(
        output_path,
        arr,
        photometric="rgb",
        extratags=[
            (33550, "d", 3, model_pixel_scale, False),
            (33922, "d", 6, model_tiepoint,    False),
            (34735, "H", len(geo_keys), geo_keys, False),
        ],
    )


# ── SHP zip → GeoJSON features ────────────────────────────────────────────────

def _shp_zip_to_features(zip_bytes: bytes) -> list:
    import shapefile  # pyshp
    import shutil

    tmpdir = tempfile.mkdtemp()
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(tmpdir)

        shp_files = list(Path(tmpdir).glob("*.shp"))
        if not shp_files:
            return []

        sf = shapefile.Reader(str(shp_files[0]))
        try:
            field_names = [f[0] for f in sf.fields[1:]]
            features = []
            for sr in sf.shapeRecords():
                geom = sr.shape.__geo_interface__
                props = dict(zip(field_names, sr.record))
                features.append({
                    "type":       "Feature",
                    "geometry":   geom,
                    "properties": {k: (v.strip() if isinstance(v, str) else v)
                                   for k, v in props.items()},
                })
        finally:
            sf.close()
        return features
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ── 同步主流程（在线程池中运行） ───────────────────────────────────────────────

def _sync_extract(img_b64: str, bounds: dict) -> list:
    from aiearth.openapi.models import (
        PublishLocalTiffRequest,
        ListUserRasterDatasRequest,
        CreateAIJobRequest,
        CreateAIJobRequestInputs,
        CreateAIJobRequestInputsSrc,
        GetJobsRequest,
        DownloadDataRequest,
    )
    from aiearth.openapi.enums import UserDataFromType, PublishStatus, JobStatus

    from aiearth import core
    from aiearth.openapi.client import ExtClient
    from alibabacloud_tea_openapi.models import Config as OapiConfig
    from aiearth.core.client.endpoints import Endpoints

    if cfg.AIE_TOKEN:
        core.Authenticate(token=cfg.AIE_TOKEN)
    else:
        core.Authenticate(access_key_id=cfg.AIE_ACCESS_KEY_ID,
                          access_key_secret=cfg.AIE_ACCESS_KEY_SECRET)
    oapi_cfg = OapiConfig(
        access_key_id=cfg.AIE_ACCESS_KEY_ID,
        access_key_secret=cfg.AIE_ACCESS_KEY_SECRET,
        region_id=Endpoints.OPENAPI_REGION_ID,
        endpoint=Endpoints.OPENAPI_ENDPOINT,
    )
    client = ExtClient(oapi_cfg)

    tiff_path = None
    try:
        # ① PNG → GeoTIFF 临时文件
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
            tiff_path = tmp.name
        _png_to_geotiff(img_b64, bounds, tiff_path)

        # ② 上传本地 TIFF
        pub_req = PublishLocalTiffRequest(
            local_file_path=tiff_path,
            name=f"maptile_{int(time.time())}",
        )
        pub_resp = client.publish_local_tiff(pub_req)
        data_id  = pub_resp.body.data_id

        # ③ 等待发布完成（最多 3 分钟）
        for _ in range(60):
            lr = ListUserRasterDatasRequest()
            lr.data_id     = data_id
            lr.from_type   = UserDataFromType.PERSONAL.value
            lr.page_number = 1
            lr.page_size   = 1
            res    = client.list_user_raster_datas(lr)
            status = res.body.list[0].raster.publish_status
            if status == PublishStatus.PUBLISHDONE.value:
                break
            if status == PublishStatus.PUBLISHFAIL.value:
                msg = getattr(res.body.list[0].raster, "publish_msg", "unknown")
                raise RuntimeError(f"影像发布失败: {msg}")
            time.sleep(3)
        else:
            raise RuntimeError("影像发布超时（3分钟）")

        # ④ 创建建筑物提取任务
        src        = CreateAIJobRequestInputsSrc(data_id=data_id)
        inp        = CreateAIJobRequestInputs(idx=1, src=src)
        create_req = CreateAIJobRequest()
        create_req.job_name       = f"building_{int(time.time())}"
        create_req.app            = "building_extraction"
        create_req.confidence     = 25
        create_req.area_threshold = 10
        create_req.inputs         = [inp]
        job_resp   = client.create_aijob(create_req)
        job_id     = job_resp.body.jobs[0].job_id

        # ⑤ 轮询任务状态（最多 10 分钟）
        out_data_id = None
        for _ in range(120):
            jr_resp = client.get_jobs(GetJobsRequest(job_ids=[job_id]))
            stat    = jr_resp.body.list[0].status
            if stat == JobStatus.FINISHED.value:
                out_data_id = jr_resp.body.list[0].job_out_data_id
                break
            if stat == JobStatus.ERROR.value:
                raise RuntimeError("AI 建筑提取任务失败")
            time.sleep(5)
        else:
            raise RuntimeError("AI 任务超时（10分钟）")

        # ⑥ 下载结果 SHP zip
        shp_zip_bytes = None
        for _ in range(30):
            dl_resp = client.download_data(DownloadDataRequest(data_id=out_data_id))
            if dl_resp.body.finished:
                shp_zip_bytes = httpx.get(dl_resp.body.download_url, timeout=30).content
                break
            time.sleep(3)
        else:
            raise RuntimeError("结果下载超时")

        # ⑦ SHP → GeoJSON features
        return _shp_zip_to_features(shp_zip_bytes)

    finally:
        if tiff_path:
            Path(tiff_path).unlink(missing_ok=True)


# ── 异步入口（旧，向后兼容） ────────────────────────────────────────────────────

async def extract_buildings(img_b64: str, bounds: dict) -> list:
    """异步封装：在线程池中运行同步 AI Earth 流程，不阻塞事件循环。"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_extract, img_b64, bounds)


# ── 多类型提取（带 SSE 进度回调） ─────────────────────────────────────────────

def _sync_run(app_type: str, img_b64: str, bounds: dict, text_prompt: str, progress_cb) -> list:
    """支持 building / road / dam / custom 四种类型的同步提取流程。"""
    from aiearth.openapi.models import (
        PublishLocalTiffRequest, ListUserRasterDatasRequest,
        CreateAIJobRequest, CreateAIJobRequestInputs, CreateAIJobRequestInputsSrc,
        GetJobsRequest, DownloadDataRequest,
    )
    from aiearth.openapi.enums import UserDataFromType, PublishStatus, JobStatus
    from aiearth import core
    from aiearth.openapi.client import ExtClient
    from alibabacloud_tea_openapi.models import Config as OapiConfig
    from aiearth.core.client.endpoints import Endpoints

    if cfg.AIE_TOKEN:
        core.Authenticate(token=cfg.AIE_TOKEN)
    else:
        core.Authenticate(access_key_id=cfg.AIE_ACCESS_KEY_ID,
                          access_key_secret=cfg.AIE_ACCESS_KEY_SECRET)
    oapi_cfg = OapiConfig(
        access_key_id=cfg.AIE_ACCESS_KEY_ID,
        access_key_secret=cfg.AIE_ACCESS_KEY_SECRET,
        region_id=Endpoints.OPENAPI_REGION_ID,
        endpoint=Endpoints.OPENAPI_ENDPOINT,
    )
    client = ExtClient(oapi_cfg)

    tiff_path = None
    try:
        # ① PNG → GeoTIFF
        progress_cb("正在生成 GeoTIFF 影像…")
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
            tiff_path = tmp.name
        _png_to_geotiff(img_b64, bounds, tiff_path)

        # ② 上传本地 TIFF
        progress_cb("正在上传影像到 AI Earth…")
        pub_req = PublishLocalTiffRequest(
            local_file_path=tiff_path,
            name=f"maptile_{int(time.time())}",
        )
        pub_resp = client.publish_local_tiff(pub_req)
        data_id  = pub_resp.body.data_id
        progress_cb(f"影像已上传（ID: {str(data_id)[:8]}…），等待发布完成…")

        # ③ 等待发布完成（最多 3 分钟）
        for i in range(60):
            lr = ListUserRasterDatasRequest()
            lr.data_id     = data_id
            lr.from_type   = UserDataFromType.PERSONAL.value
            lr.page_number = 1
            lr.page_size   = 1
            res    = client.list_user_raster_datas(lr)
            status = res.body.list[0].raster.publish_status
            if status == PublishStatus.PUBLISHDONE.value:
                break
            if status == PublishStatus.PUBLISHFAIL.value:
                msg = getattr(res.body.list[0].raster, "publish_msg", "未知原因")
                raise RuntimeError(f"影像发布失败: {msg}")
            if i > 0 and i % 5 == 0:
                progress_cb(f"影像发布中… ({i * 3}s)")
            time.sleep(3)
        else:
            raise RuntimeError("影像发布超时（3分钟）")

        progress_cb("影像发布完成，创建 AI 解译任务…")

        # ④ 创建 AI 任务（按类型分支）
        if app_type in ("building", "road"):
            app_name = "building_extraction" if app_type == "building" else "land_cover_classification"
            src = CreateAIJobRequestInputsSrc(data_id=data_id)
            inp = CreateAIJobRequestInputs(idx=1, src=src)
            create_req = CreateAIJobRequest()
            create_req.job_name       = f"extract_{app_type}_{int(time.time())}"
            create_req.app            = app_name
            create_req.confidence     = 25
            create_req.area_threshold = 5
            create_req.inputs         = [inp]
            job_resp = client.create_aijob(create_req)
            job_id   = job_resp.body.jobs[0].job_id
        else:
            # dam / custom → AIE-SEG 文本提示
            prompt_text = text_prompt if app_type == "custom" else "拦河坝、大坝、堤坝"
            progress_cb(f"SEG 提示词：「{prompt_text}」")
            try:
                from aiearth.openapi.models import CreateAiesegJobRequest, RasterParam
                from aiearth.openapi.enums import AiesegJobType
                seg_req = CreateAiesegJobRequest(
                    aieseg_job_type=AiesegJobType.AIE_SEG_PROMPT,
                    input=RasterParam(data_id=data_id),
                    job_name=f"seg_{int(time.time())}",
                    text_prompt=[prompt_text],
                    pixel_threshold=50,
                )
                seg_resp = client.create_aieseg_job(seg_req)
                job_id   = seg_resp.body.jobs[0].job_id
            except (ImportError, AttributeError):
                progress_cb("SEG API 不可用，降级为通用提取…")
                src = CreateAIJobRequestInputsSrc(data_id=data_id)
                inp = CreateAIJobRequestInputs(idx=1, src=src)
                create_req = CreateAIJobRequest()
                create_req.job_name       = f"seg_fallback_{int(time.time())}"
                create_req.app            = "aie_seg_prompt"
                create_req.confidence     = 25
                create_req.area_threshold = 5
                create_req.inputs         = [inp]
                job_resp = client.create_aijob(create_req)
                job_id   = job_resp.body.jobs[0].job_id

        progress_cb(f"任务已提交（jobId: {str(job_id)[:8]}…），AI 分析中…")

        # ⑤ 轮询任务状态（最多 10 分钟）
        out_data_id = None
        for i in range(120):
            jr_resp = client.get_jobs(GetJobsRequest(job_ids=[job_id]))
            stat    = jr_resp.body.list[0].status
            if stat == JobStatus.FINISHED.value:
                out_data_id = jr_resp.body.list[0].job_out_data_id
                break
            if stat == JobStatus.ERROR.value:
                raise RuntimeError("AI 解译任务执行失败")
            if i > 0 and i % 6 == 0:
                progress_cb(f"AI 分析中… ({i * 5}s)")
            time.sleep(5)
        else:
            raise RuntimeError("AI 任务超时（10分钟）")

        progress_cb("AI 分析完成，正在下载矢量结果…")

        # ⑥ 下载结果 SHP zip
        shp_zip_bytes = None
        for _ in range(30):
            dl_resp = client.download_data(DownloadDataRequest(data_id=out_data_id))
            if dl_resp.body.finished:
                shp_zip_bytes = httpx.get(dl_resp.body.download_url, timeout=60).content
                break
            time.sleep(3)
        else:
            raise RuntimeError("结果下载超时")

        features = _shp_zip_to_features(shp_zip_bytes)
        progress_cb(f"解析完成，共识别 {len(features)} 个要素")
        return features

    finally:
        if tiff_path:
            Path(tiff_path).unlink(missing_ok=True)


async def run_extraction(app_type: str, img_b64: str, bounds: dict,
                         text_prompt: str, queue) -> None:
    """异步封装：在线程池运行提取，进度事件推入 queue（供 SSE 消费）。"""
    loop = asyncio.get_event_loop()

    def _cb(msg: str):
        asyncio.run_coroutine_threadsafe(
            queue.put({"type": "log", "message": msg}), loop
        )

    def _runner():
        try:
            features = _sync_run(app_type, img_b64, bounds, text_prompt, _cb)
            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "aie_result", "features": features,
                           "count": len(features), "app_type": app_type}),
                loop,
            )
        except Exception as exc:
            import traceback
            traceback.print_exc()
            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "error", "message": str(exc)}), loop
            )
        finally:
            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "done"}), loop
            )

    await loop.run_in_executor(None, _runner)
