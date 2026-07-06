import asyncio
import base64
import json
from pathlib import Path
from playwright.async_api import async_playwright, Browser, Page

import config as cfg

_STATIC = Path(__file__).parent / "static" / "water_levels"


class MapScreenshotTaker:
    """
    持有一个 Playwright 无头浏览器，加载服务器上的 /map.html 并截图。
    首次调用 screenshot() 会完整加载页面；后续调用直接更新地图视图坐标，
    节省重新导航的开销。
    """

    def __init__(self) -> None:
        self._playwright = None
        self._browser: Browser | None = None
        self._page: Page | None = None
        self._initialized = False

    async def start(self) -> None:
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            channel="msedge",
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        self._page = await self._browser.new_page(
            viewport={"width": 1024, "height": 768},
            device_scale_factor=2,   # 物理分辨率 2048×1536，保证道路纹理清晰
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )

    async def screenshot(self, lat: float, lng: float, zoom: int, active_wl: list | None = None) -> dict:
        assert self._page is not None, "请先调用 start()"

        if not self._initialized:
            url = (
                f"http://localhost:{cfg.SERVER_PORT}/map.html"
                f"?lat={lat}&lng={lng}&zoom={zoom}"
            )
            await self._page.goto(url, wait_until="domcontentloaded")
            # 等待高德地图瓦片初步加载完成（complete 事件 + 800ms 缓冲）
            await self._page.wait_for_function(
                "window.mapReady === true", timeout=30_000
            )
            self._initialized = True
        else:
            # 平移前重置标志，setZoomAndCenter 会触发 movestart 把它清掉
            await self._page.evaluate(
                f"window.amapInstance.setZoomAndCenter({zoom}, [{lng}, {lat}])"
            )
            # 等待卫星瓦片全部加载完成（satLayer.on('complete') 置 true）
            try:
                await self._page.wait_for_function(
                    "window._tilesLoaded === true", timeout=12_000
                )
            except Exception:
                # 超时降级：至少等 3 秒
                await asyncio.sleep(3.0)

        if active_wl:
            await self._inject_water_levels(active_wl)
            await asyncio.sleep(0.6)  # 等待折线渲染

        bounds = await self._page.evaluate("""() => {
            const b = window.amapInstance.getBounds();
            return {
                north: b.getNorthEast().getLat(),
                south: b.getSouthWest().getLat(),
                east:  b.getNorthEast().getLng(),
                west:  b.getSouthWest().getLng()
            };
        }""")

        el = self._page.locator("#map-container")
        png_bytes = await el.screenshot(type="png")

        return {
            "image":  base64.b64encode(png_bytes).decode(),
            "bounds": bounds,
        }

    async def _inject_water_levels(self, active_wl: list) -> None:
        """把已激活的水位线注入到 Playwright 地图页面中。
        每次注入前先清除上一次注入的折线，避免重复叠加。
        """
        levels_data = []
        for item in active_wl:
            name = item.get("name", "")
            path = _STATIC / f"{name}.geojson"
            if not path.exists():
                continue
            with open(path, "r", encoding="utf-8") as f:
                gj = json.load(f)
            levels_data.append({
                "name":  name,
                "color": item.get("color", "#58a6ff"),
                "label": item.get("label", name),
                "geojson": gj,
            })

        if not levels_data:
            return

        await self._page.evaluate("""(levels) => {
            // 清除上一次注入的折线
            if (window._wlLines) {
                window._wlLines.forEach(l => window.amapInstance.remove(l));
            }
            window._wlLines = [];

            for (const lv of levels) {
                for (const feat of lv.geojson.features) {
                    for (const ring of feat.geometry.coordinates) {
                        const path = ring.map(([lng, lat]) => [lng, lat]);
                        const line = new AMap.Polyline({
                            path,
                            strokeColor:   lv.color,
                            strokeWeight:  2.5,
                            strokeOpacity: 0.9,
                            strokeStyle:   'solid',
                            zIndex:        60,
                        });
                        window.amapInstance.add(line);
                        window._wlLines.push(line);
                    }
                }
            }
        }""", levels_data)

    async def screenshot_with_bounds(self, north: float, south: float,
                                     east: float, west: float,
                                     active_wl: list | None = None) -> dict:
        """按给定经纬度范围截图（前端框选区域专用）。"""
        assert self._page is not None, "请先调用 start()"

        if not self._initialized:
            lat_c = (north + south) / 2
            lng_c = (east  + west)  / 2
            url = (
                f"http://localhost:{cfg.SERVER_PORT}/map.html"
                f"?lat={lat_c}&lng={lng_c}&zoom=15"
            )
            await self._page.goto(url, wait_until="domcontentloaded")
            await self._page.wait_for_function(
                "window.mapReady === true", timeout=30_000
            )
            self._initialized = True

        # 重置 tile 加载标志，setBounds 后重新等待
        await self._page.evaluate(f"""() => {{
            window._tilesLoaded = false;
            window.amapInstance.setBounds(
                new AMap.Bounds([{west}, {south}], [{east}, {north}])
            );
        }}""")
        try:
            await self._page.wait_for_function(
                "window._tilesLoaded === true", timeout=15_000
            )
        except Exception:
            await asyncio.sleep(4.0)

        if active_wl:
            await self._inject_water_levels(active_wl)
            await asyncio.sleep(0.6)

        bounds = await self._page.evaluate("""() => {
            const b = window.amapInstance.getBounds();
            return {
                north: b.getNorthEast().getLat(),
                south: b.getSouthWest().getLat(),
                east:  b.getNorthEast().getLng(),
                west:  b.getSouthWest().getLng()
            };
        }""")

        el        = self._page.locator("#map-container")
        png_bytes = await el.screenshot(type="png")
        return {
            "image":  base64.b64encode(png_bytes).decode(),
            "bounds": bounds,
        }

    async def stop(self) -> None:
        self._initialized = False
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
