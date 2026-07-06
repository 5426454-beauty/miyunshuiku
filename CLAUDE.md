# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

密云水库数字孪生管理系统 — 基于 WDP（51Aes 数字孪生平台）的 3D 场景 + 高德 2D 地图叠加的水库管理大屏。纯前端 vanilla JS 项目，无框架（admin 子目录除外），Vite 打包。

## 常用命令

```bash
npm run dev           # 启动前端开发服务器 (Vite, 默认 5173)
npm run dev:server    # 启动后端 API 服务 (Express, 端口 3001)
npm run build         # 生产构建

# map-agent 地图智能分析服务（Python FastAPI，端口 8000）
cd map-agent && python main.py
```

三个服务需**同时运行**：前端 + 后端 + map-agent（2D 检测依赖）。

## 大模型配置

| 用途 | 模型 | 服务商 |
|------|------|------|
| AI 对话（纯文本） | Qwen3-Max | OpenRouter |
| AI 对话（带图片） | Qwen3.7-Plus | 阿里云百炼 DashScope |
| /api/detect 检测 | Qwen3.7-Plus | 阿里云百炼 DashScope |
| map-agent 检测 | Qwen3-VL-Plus | 阿里云百炼 DashScope |

## 架构

### 入口与初始化

`index.html` → `src/main.js` → `_bootstrap()` 按顺序初始化各模块。每个模块是独立的 `_*.js` 文件，通过 `init*()` 导出函数注册到主流程。模块间通过 `getApp()` / `onSceneReady()` 共享 WDP 场景实例。

### WDP 场景层

- **`_wdp.js`** — 核心：加载 WDP SDK、创建场景、暴露 `getApp()` 和 `onSceneReady(cb)`。场景就绪前所有按钮 disabled，就绪后回调执行。配置从 `localhost:3001/api/config` 拉取，不可用时降级到内置默认值。
- 默认水面高度：**155m**（`_flood.js` / `_rainfall.js` 中 `BASE_WATER_LEVEL = 155`）
- 坐标系统：CGCS2000（≈ WGS84）。`PickWorldPointByScreenPos([x, y])` 可做屏幕→世界坐标转换，原点在左上角。

### UI 布局（`index.html` + `src/style.css`）

- **顶部栏 `.top-bar`**：左侧（时间 + nav tabs）、居中标题、右侧（2D/3D 地图切换 + 复位 + ⚙ 设置下拉）。所有右栏按钮统一 `min-height:44px` 保证触控可及
- **左侧面板 `.side-panel--left`**：可折叠 panel 卡片（水库介绍、闸坝管理、库容曲线等）
- **右侧面板 `.side-panel--right`**：供水监测、安全监测、安全事件
- **中间 `.scene-container`**：WDP 3D 渲染区 + 高德 2D 叠加层。2D 模式下**不显示**搜索栏
- **右下角 `.floating-toolbar`**：四管场景下的垂直工具栏（热力/迁徙/可视域）
- **设置下拉 `.settings-dropdown`**：🌍 环境控制（天气/时间）+ 🎨 UI 主题（A/B/C）+ 🔧 工具入口（POI取点/路径绘制），点击工具卡片弹出 `.tool-float-panel` 浮动操作面板

### 主题系统（`_theme.js`）

三套主题通过 `data-theme` 属性切换：A（霓虹科技/默认）、B（自然绿洲）、C（极简暗黑）。CSS 变量（`--bg-panel`, `--border-cyan`, `--cyan` 等）定义在 `:root`，各主题用 `[data-theme="X"]` 覆盖。

### Tab 系统（`_tabSwitch.js`）

五个内置 Tab（首页/四全/四制/四预/四管）+ 动态"地图分析"Tab。切换时触发 `updateLeftPanels()` / `updateRightPanels()` 重新渲染面板数据（ECharts 图表等）。AI 可通过 `createCustomTab()` / `removeCustomTab()` 动态创建/删除标签。

- 进入地图分析 Tab：保留当前 2D/3D 模式，不强制切换
- 离开地图分析 Tab：自动清除检测标注

### 2D/3D 地图切换（`_amap.js`）

高德 JS API 2.0 卫星/标准图层与 WDP 3D 场景叠加切换。`setMapMode('3d'|'satellite'|'standard')` 控制。切换时自动对齐相机位置。

- 眼位高度↔缩放级别：线性插值，支持小数 zoom
- `_altMultiplier` 默认 1.0，运行时 `__setAltMultiplier(v)` 可调
- 3D→2D 切换时从当前 3D 相机推导 zoom，保持视野一致
- 坐标转换使用 `_coordConvert.js`（CGCS2000 ↔ GCJ-02 ↔ WGS84）

### 功能模块

| 模块 | 说明 |
|------|------|
| `_poiTool.js` | POI 取点，PickerPoint → App.Poi 创建，入口在设置面板 🔧 工具中 |
| `_pathTool.js` | 路径绘制，取点 → App.Path 生成箭头路径，入口在设置面板 🔧 工具中 |
| `_dem.js` | DEM 高程标注，轮询后端 `/api/dem/annotations`。首次轮询不同步旧数据，仅新数据触发渲染。标注使用 `App.Range`（loop_line+透明填充） |
| `_aiChat.js` | AI 助手，流式 SSE → 场景/面板操作。支持 setText 修改面板文字、DEM 分析、淹没预演等 |
| `_weather.js` | 天气/时间控制，调 Environment API |
| `_gate.js` | 闸门开关控制，第三溢洪道 6 闸门，位置约 [117.0007, 40.4655] |
| `_rainfall.js` | 降雨模拟，滑块控制 24h 降雨量 → 水面抬升。基准水位 155m |
| `_flood.js` | 淹没预演。4 个 HeatMap 淹没区域（Clip 多边形）+ 2 条水流箭头。48 帧逐帧渐变，6 位 HEX 颜色。4 区域从外到内依次显现（绿→黄→橙→红） |
| `_floodHeatmap.js` | 淹没水深热力图，96 步时序 DEM 格点计算。稀疏采样 thinFactor=200，cellSizeM=600。左下角按钮已移除，仅保留底部控制条 |
| `_discharge.js` | 泄洪调度预演，正向计算（孔口出流公式）+ 逆行推演（反算闸门开度） |
| `_dam.js` | 大坝控制面板（四管 Tab），白河/潮河/走马庄 3 座大坝 |
| `_heatmap.js` | 场景 3D 热力图 |
| `_migration.js` | 迁徙图（Parabola 飞线） |
| `_viewshed.js` | 可视域分析 |
| `_drone.js` | 无人机巡检，沿路径飞行 + 视频窗口 |
| `_vehicle.js` | 车辆放置模拟 |
| `_inspection.js` | 机器人巡检路线 |
| `_surveillance.js` | 监控摄像头（App.Range 周界 + POI + Window 视频） |
| `_mapAnalysisTab.js` | 地图分析 Tab 面板。**2D 检测走 map-agent**（Playwright截图+NMS去重），**3D 检测走 PickWorldPointByScreenPos**。右下角悬浮 AI 对话球（`position: fixed, z-index: 9999`）。检测标注可清除（✕ 按钮） |
| `_mapAgent.js` | iframe 嵌入地图智能分析系统（顶部按钮已移除，overlay 保留） |
| `_mapSearch.js` | 地图搜索定位（正向地理编码 + AutoComplete，已从 2D 模式中隐藏） |
| `_mapScreenshot.js` | 2D 地图截图（html2canvas） |
| `_mapDetect.js` | 地图视觉检测（boxToCoords 坐标转换 + 2D/3D 标注同步） |
| `_demoBar.js` | 路演步骤指示器 + 快速操作条 |
| `_chartTheme.js` | ECharts 图表主题适配 |
| `_leftPanel.js` / `_rightPanel.js` | 左右面板数据渲染（ECharts + 数据卡片） |
| `_dynPanel.js` | 动态面板列表 |
| `_tabSwitch.js` | Tab 切换 + 自定义标签管理 |

### 面板数据流

`mockData.js` → `tabData` 对象，key 为 tab 名（home/siQuan/siZhi/siYu/siGuan），每个包含 `left`/`right` 数组描述面板结构。`_leftPanel.js` 和 `_rightPanel.js` 根据描述渲染 ECharts 图表或数据卡片。

## CSS 架构

单文件 `src/style.css`（约 4800 行），按区块分段注释。关键变量在 `:root`：`--top-h: 52px`（顶栏高度）、`--bg-panel`、`--border-cyan`、`--cyan` 等。主题 B/C 覆盖在文件后半部分 `[data-theme="B"]` / `[data-theme="C"]` 区块。所有按钮统一使用 `min-height: 44px` 保证触控可及。

## map-agent 地图智能分析服务（端口 8000）

独立的 Python FastAPI 服务，使用 Playwright 无头浏览器渲染 AMap 截图。

### 启动

```bash
cd map-agent
python main.py  # 端口 8000，需安装 Playwright Chromium
```

### 依赖

- Playwright + Chromium（`playwright install chromium`）
- 阿里云百炼 DashScope（Qwen3-VL-Plus）
- 高德 JS API 2.0

### 两个模式

| 模式 | 端点 | 功能 |
|------|------|------|
| 普通模式 `search` | POST /api/start | 单次目标检测 + NMS 去重 → 返回标记点+矩形框 |
| 专业模式 `analyze` | POST /api/start | 九宫格分块计数 + 道路中心线测量 + Haversine 算距 |

### API

- `POST /api/start` — 启动检测任务，返回 session_id
- `GET /api/stream/{session_id}` — SSE 流式接收结果（add_marker / add_rect / log / done / error）
- `POST /api/chat` — 多轮对话（附带地图截图）

### 与主项目集成

`_mapAnalysisTab.js` 的 2D 检测分支调用 map-agent：获取 AMap 中心+zoom → POST /api/start → SSE 流 → 收集 markers → 标注到 2D 地图 + 3D 场景。

## 后端 API（server.js，端口 3001）

- `GET /api/config` — 读取 WDP + 面板配置
- `PUT /api/config/wdp` — 更新 WDP 连接参数
- `PUT /api/config/panels` — 更新面板配置
- `GET/POST/DELETE /api/dem/annotations` — DEM 标注 CRUD
- `GET /api/dem/kml` — KML 导出（`?threshold=150&area=白河主坝`）
- `POST /api/chat` — AI 对话（OpenRouter qwen3-max，SSE 流式，支持 tool calling + setText 前端修改）
- `POST /api/detect` — 卫星图目标检测（阿里云百炼 qwen3.7-plus 视觉版，JSON 多层容错）
- `GET /api/flood/steps` — 淹没时间步列表
- `GET /api/flood/grid/:step` — 指定时间步格点水深数据
- `GET /api/flood/cells/near` — 按经纬度查找最近格点 + 完整时间序列
- `GET /api/flood/compare` — 两个时间步淹没差异对比
- `GET /api/flood/summary` — 淹没统计摘要

### DEM 高程分析（query_elevation.py）

5 米分辨率 DEM（dem5.tif，9422×17767 格点，高程范围 -26~1748m）。Python 脚本自动搜索多个路径。

- 连通区域分析（scipy.ndimage.label）
- 相邻矩形合并（间距<300m + 大小比例<10×）
- 地理命名（匹配最近地标：白河主坝/潮河主坝/走马庄副坝/第三溢洪道等）
- KML 导出（`--export-kml` 命令）
- 过滤 <0.1 km² 噪点

**AI 系统提示词**定义在 `AI_SYSTEM_PROMPT` 常量中，包含完整的前端面板 CSS 选择器参考表，支持 `setText` 命令修改任意面板文字。DEM 分析提示词引导使用 `areas_below`（划片）而非 `lowest`（散点）。

## Admin 子项目

`admin/` 目录是 React + Ant Design 的配置管理后台，独立入口，通过 Vite 多页面构建。页面包括：API 列表、WDP 配置、面板配置。

## Vite 配置

`vite.config.js` 已排除 `.tif`、`.tiff`、`淹没水深计算系统V2.0/`、`data/flood/` 目录，避免大文件导致文件监听器崩溃。