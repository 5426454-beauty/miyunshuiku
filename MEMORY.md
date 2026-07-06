# 项目记忆文档

**项目路径**：`C:\jiangli\miyunshuiku`
**更新日期**：2026-06-25（场景适配+功能修复）
**技术栈**：Vite 5.x + ES Module + WDP API 2.3.0 + ECharts + Express + Python DEM 分析
**已安装 Skill**：`ui-ux-pro-max` (v2.5.0)

---

## 项目概述

密云水库数字孪生大屏管理系统。左右侧面板 + 中间 WDP 3D 场景，顶部 Tab 切换（首页/四全/四制/四预/四管）。

**核心功能**：AI 自然语言助手（底部悬浮窗），可通过对话控制场景和面板、分析 DEM 高程数据并在 3D 地图上标注。

场景中心坐标：**[116.965, 40.505]**（北京密云水库）

---

## 文件结构

```
├── index.html          — 主页面
├── config.json         — 运行时配置（WDP连接、面板布局、API数据源）
├── server.js           — Express 后端 API 服务（端口 3001）
├── query_elevation.py  — DEM 高程分析脚本（Python + scipy）
├── 高程5米.tif          — DEM 数据（9422×17767, 7.6m分辨率, EPSG:4326）
│
src/
  main.js           — 主入口，_bootstrap() 初始化所有模块
  _wdp.js           — WDP 初始化，getApp() / onSceneReady()
  _leftPanel.js     — 左侧三个面板
  _rightPanel.js    — 右侧三个面板，条件显隐
  _dynPanel.js      — 动态面板渲染器
  _tabSwitch.js     — Tab 切换逻辑
  _discharge.js     — 泄洪调度预演面板（四预）
  _flood.js         — 淹没预演面板（四预）：4 方案 + 水面抬升 + 4阶段演进
  _camera.js        — 相机复位按钮
  _surveillance.js  — 视频监控模块
  _poiTool.js       — POI 取点工具
  _pathTool.js      — 路径绘制工具
  _inspection.js    — 机器人巡检模块
  _weather.js       — 天气与时间控制
  _theme.js         — UI 主题切换（A/B/C 三套风格）
  _heatmap.js       — 场景热力图（四管悬浮球）
  _migration.js     — 迁徙图飞线（四管悬浮球）
  _viewshed.js      — 可视域分析（四管悬浮球）
  _gate.js          — 闸门启闭 + 水花联动（四管悬浮球）
  _rainfall.js      — 降雨量 → 水位联动（CustomApi.WaterSurface）🌧
  _drone.js         — 无人机巡检（自动搜实体/POI降级/视频窗）🤖
  _dam.js           — 大坝控制面板（CustomApi.Dam：显隐/透明/热力）🏗
  _vehicle.js       — 静态车辆放置
  _aiChat.js        — AI 自然语言助手（→ Express /api/chat）✨
  _dem.js           — DEM 高程标注（轮询 + POI/矩形框渲染）🗺️
  _amap.js          — 高德 2D 地图图层
  _coordConvert.js  — WGS84 ↔ GCJ-02 坐标转换
  mockData.js       — 各 Tab Mock 数据
  style.css         — 全局样式（3套主题变量 + 组件样式）
```

---

## WDP 配置

```javascript
// config.json
{
  "wdp": {
    "url": "https://dtp-api.51aes.com",
    "order": "5370da1dcb6547214dca7a5a1282a568"
  }
}
```

场景中心坐标：**[116.965, 40.505]**（密云水库）
场景加载超时：90 秒

### 关键镜头位姿（2026-06-25 实测更新）

| 用途 | location | pitch | yaw |
|------|----------|-------|-----|
| 复位/初始 | `[116.8950, 40.4551, 508.54]` | -33.46° | -50.21° |
| 闸门+泄洪 | `[117.0007, 40.4655, 191.91]` | -13.81° | -83.19° |
| 降雨模拟 | `[116.9772, 40.4513, 159.12]` | -25.39° | -1.85° |
| 无人机巡检 | `[116.96646, 40.50792, 213.95]` | -23.80° | 174.02° |
| 热力/迁徙图 | `FlyTo targetPosition: [117.0226, 40.5019]` | - | - |
| 白河主坝 | `[116.8250, 40.4760, 835.44]` | -33.42° | -37.05° |
| 潮河主坝 | `[116.9875, 40.4513, 655.20]` | -35.13° | 171.03° |
| 走马庄副坝 | `[116.8542, 40.4747, 524.15]` | -35.30° | -93.62° |

---

## 全局布局

场景 `position: absolute; inset: 0; z-index: 1` 覆盖全宽，左右面板 `position: absolute; z-index: 10` 浮动在场景上方。

```css
.main-layout        { display: block; }
.scene-container    { position: absolute; inset: 0; z-index: 1; }
.side-panel         { position: absolute; top: 0; bottom: 0; z-index: 10; }
.side-panel--left   { left: 0; width: 280px; }
.side-panel--right  { right: 0; width: 280px; }
```

主题 B 面板宽度 340px。

---

## AI 自然语言助手（_aiChat.js + server.js）✨

### 架构
```
用户输入 → 前端 _aiChat.js → POST /api/chat (Express)
  → Qwen3-Max (OpenRouter) + DEM 工具调用
  → Express 执行 Python DEM 分析
  → SSE 流式返回
```

### 后端 /api/chat（server.js）
- 模型：`qwen/qwen3-max`（通过 OpenRouter）
- 工具调用：`analyze_dem` 函数（自动调用 Python 脚本）
- 返回格式：SSE 流（`data: {"choices":[{"delta":{"content":"..."}}]}\n\n`）
- 对话历史：前端保留最近 10 条

### DEM 工具定义
```javascript
analyze_dem({ query_type, lon, lat, n, threshold, radius_km })
// query_type: point | lowest | highest | areas_below | areas_below_near
```

### 可执行场景操作（<actions> JSON）
| 指令 | cmd | 说明 |
|------|-----|------|
| 天气 | `setWeather` | Sunny/Cloudy/ModerateRain/ModerateSnow |
| 时间 | `setTime` | hour: 0-24 |
| 相机飞行 | `flyTo` | lng, lat, pitch, distance |
| 切换标签 | `switchTab` | 首页/四全/四制/四预/四管 |
| 热力图 | `showHeatmap` / `hideHeatmap` | |
| 淹没预演 | `startFlood` / `stopFlood` / `resetFlood` | scenario: normal/20yr/50yr/100yr |
| 无人机 | `toggleDrone` | |
| 闸门 | `toggleGate` | idx: 0-5 |
| 降雨 | `setRainfall` / `resetRainfall` | mm: 0-300 |
| 主题 | `switchTheme` | A/B/C |
| DEM标注 | `demAnnotate` / `demClear` | 推送/清除 DEM 标注 |

---

## DEM 高程分析系统 🗺️

### 数据源
- 文件：`高程5米.tif`（GeoTIFF, EPSG:4326）
- 分辨率：17767×9422 像素，~7.6m/像素
- 覆盖：经度 116.17~117.39，纬度 40.30~40.89
- 高程范围：-26.2m ~ 1748.7m

### Python 分析脚本（query_elevation.py）
```bash
# 单点查询
python query_elevation.py 116.965 40.505

# 找最低N个点
python query_elevation.py --find-lowest 10

# 找低于阈值的连通区域（scipy.ndimage.label）
python query_elevation.py --areas-below -20 30

# 指定位置附近低于阈值
python query_elevation.py --areas-below-near 116.965 40.505 5 143

# 生成标注JSON并POST到后端
python query_elevation.py --post --annotate-areas-near 116.965 40.505 5 143
python query_elevation.py --post --annotate-areas-below -20
python query_elevation.py --post --annotate-lowest 10
```

### 前端标注（_dem.js）
- 每 2 秒轮询 `GET /api/dem/annotations`
- 渲染：`App.Poi` 标记点 + `App.Path` 矩形框
- 坐标转换：WGS84 → GCJ-02（通过 `_coordConvert.js`）
- 带版本号机制，避免重复渲染

### 标注 API（server.js）
- `GET /api/dem/annotations` — 获取当前标注
- `POST /api/dem/annotations` — 推送标注数据
- `DELETE /api/dem/annotations` — 清除标注

---

## _rainfall.js — 降雨量 → 水位联动 🌧

### 关键变化（2026-06-25 最终版）
- **废弃 entity 10016**：不再使用 `GetByEids`
- **改为 CustomApi.WaterSurface**：`App.Customize.RunCustomizeApi()`
- **placename 修正**：`"密云水库水面"` → `"库区水面"`（用户实测确认有效）
- **基准水位调整**：126m → 152m（复位基准）

### WaterSurface API 用法
```javascript
// 显隐
App.Customize.RunCustomizeApi({
  apiClassName: 'CustomApi',
  apiFuncName: 'WaterSurface',
  args: {
    placename: '库区水面',
    action: 'setvisibility',
    moreparameters: { show: 'true' }
  }
})

// 设置绝对高度（用户实测确认有效）
App.Customize.RunCustomizeApi({
  apiClassName: 'CustomApi',
  apiFuncName: 'WaterSurface',
  args: {
    placename: '库区水面',      // 高度范围 126-158.5m
    action: 'setheight',
    moreparameters: { height: '158.5', duration: '5' }
  }
})
```

### 参数
```javascript
PLACE_WATER = '库区水面'        // 126-158.5m（用户实测确认有效）
PLACE_DYNAMIC = '库区可变水面'   // 155-160m（expand/setTransitionZoneColor 专用）
BASE_WATER_LEVEL = 152          // 复位基准水位（米）
MAX_WATER_LEVEL = 158.5         // 最高水面高度（米）
MM_PER_METER_RISE = 10          // 降雨→水位换算
```

### 动画
- 一次调用 setheight/lift + duration 参数，让 WDP API 自己处理动画过渡
- 不复用逐帧循环方式

### 公开接口
```javascript
export function startRainfall(mm)     // 启动（mm: 0-300）
export function resetWaterLevel()     // 复位 + 天气恢复
export function initRainfallScene()   // 场景就绪初始化
```

---

## _drone.js — 无人机巡检 🤖

### 关键变化（2026-06-25 重写）
- **废弃旧 EID** `"840945068910051328"`（同事项目移植，当前场景不存在）
- **自动搜索实体**：`_findDroneEntity()` 按名称匹配场景中无人机
- **POI 降级方案**：无实体时创建蓝色标记沿路径移动
- **巡检视频窗口**：启动时左上角显示视频，停止时隐藏（`left: 300px` 避开面板）
- **巡检路径**：沿密云水库坝体 7 个实测航点

### 巡检路径
```js
const PATH_COORDINATES = [
  [116.9440, 40.4419, 100], [116.9458, 40.4414, 100],
  [116.9493, 40.4404, 100], [116.9515, 40.4397, 100],
  [116.9518, 40.4396, 100], [116.9526, 40.4391, 100],
  [116.9551, 40.4374, 100],
]
```

---

## _dam.js — 大坝控制 🏗

### 功能（2026-06-25 新建）
- 四管 Tab 左侧面板，位于面板2和面板3之间
- **3 个坝体**：白河主坝、潮河主坝、走马庄副坝
- **操作**：👁 显隐 / 🔍 透明/实体 / 🔥 热力图抬升（仅走马庄）
- **批量**：全部显示/隐藏/实体/透明

### API
```javascript
// CustomApi.Dam
// 显隐：setvisibility + { show: 'true'/'false' }
// 透明：maketransparent + { appearance: 'normal'/'transparent' }
// 热力：liftandshow + { height: '200', show: 'true'/'false' } // placename: '走马坝热力图'
```

---

## _flood.js — 淹没预演 🌊

### 关键变化（2026-06-25）
- **废弃 EID 10016**：改为 `CustomApi.WaterSurface.setheight`（placename=`库区水面`）
- **基准水位**：152m（与降雨模块一致），最高 158.5m
- **相机**：FlyTo `[116.999938, 40.465016, 2000]`

### 4 阶段演进
```
阶段0 (T+0~6h)  → 降雨积蓄
阶段1 (T+6~12h) → 水位上涨
阶段2 (T+12~18h)→ 低洼漫溢
阶段3 (T+18~24h)→ 淹没峰值
```

---

## WDP API 重要参考

### 相机飞行
```javascript
await App.CameraControl.FlyTo({
  targetPosition: [lng, lat, alt],
  rotation: { pitch, yaw },
  distance: 8000,
  flyTime: 2,
})
```

### 天气与时间
```javascript
App.Environment.SetSceneWeather('Sunny', 1, false)   // Sunny/Cloudy/ModerateRain/ModerateSnow
App.Environment.SetSkylightTime('14:30', 1, false)
```

### 坐标转换
```javascript
// WGS84 → GCJ-02（火星坐标，前端地图使用）
import { wgs84ToGcj02 } from './_coordConvert.js'
const [gcjLng, gcjLat] = wgs84ToGcj02(wgs84Lng, wgs84Lat)
```

### 实体操作
```javascript
// 获取
const r = await App.Scene.GetByEids([eid])
const entity = r.result[0]

// 位置（二选一）
entity.location = [x, y, z]              // 直接赋值
await entity.SetLocation([x, y, z])      // API 方法

// 数据
const data = entity.GetData()

// 清理
await entity.Delete()
```

### 自定义 API
```javascript
await App.Customize.RunCustomizeApi({
  apiClassName: 'CustomApi',
  apiFuncName: 'Sluice',      // 闸门
  args: { placename, Ids, action, moreparameters }
})

await App.Customize.RunCustomizeApi({
  apiClassName: 'CustomApi',
  apiFuncName: 'WaterSurface', // 水面
  args: { placename, action, moreparameters }
})
```

---

## 样式规范

- 主色：`--cyan: #00d4ff`（默认主题A）
- 暗背景：`--bg-deep: #060e1f`（默认）
- 四管悬浮球：`z-index: 9999`
- 右侧面板：`z-index: 10`，宽度 280px（B主题340px）
- AI聊天窗：底部居中，`z-index: 9998`
- 文档查看器：`z-index: 100`

---

## 构建命令

```bash
cd C:\jiangli\miyunshuiku

# 后端
npm run dev:server     # node server.js（端口 3001）

# 前端
npm run dev            # vite（端口 5173）

# 构建
npx vite build
```
