# 地图智能分析系统 · 项目状态文档

> 最后更新：2026-06-30
> 工程目录：`C:\Users\张轩\map-agent`

---

## 一、项目概述

基于高德卫星地图 + 大模型的地图智能分析系统，支持：

- **AI 搜索分析**：自动截图 → Qwen VL 识别目标 → 地图标注
- **区域遍历分析**：网格化扫描指定区域，汇总发现目标
- **专业模式（AI Earth）**：调用阿里云 AI Earth 遥感引擎，提取建筑物/路网/拦河坝/自定义目标矢量轮廓
- **视野分析**：对当前地图视野进行问答分析
- **AI 对话（含标注）**：悬浮对话框，截图辅助，多轮对话；输入"标记道路/建筑"等关键词可返回标注图片
- **水位线图层**：密云水库多条水位线叠加显示，支持遍历过滤
- **测量工具**：测距、测面积

---

## 二、技术架构

```
浏览器前端（index.html）
    ↕ SSE / REST
FastAPI 后端（main.py）
    ├── agent.py          AI 搜索分析 Agent + 对话标注
    ├── traverse.py       区域遍历分析
    ├── screenshot.py     Playwright 无头截图（2048×1536 高清）
    ├── aiearth_client.py AI Earth 遥感提取
    └── config.py         环境变量配置
```

**主要依赖：**

| 库 | 用途 |
|---|---|
| FastAPI + Uvicorn | HTTP 服务 / SSE 流式推送 |
| Playwright (msedge) | 无头浏览器截图 |
| httpx | 调用 Qwen API |
| aie-sdk[openapi] | AI Earth OpenAPI SDK |
| tifffile + numpy | PNG → GeoTIFF 转换 |
| pyshp (shapefile) | SHP → GeoJSON 解析 |
| Pillow | 图像处理（标注框/折线绘制） |
| python-dotenv | 环境变量加载 |

---

## 三、文件结构

```
map-agent/
├── main.py                # FastAPI 路由入口
├── agent.py               # AI 搜索/分析 Agent（AgentSession）+ 对话标注
├── traverse.py            # 区域遍历分析（TileTraverseSession）
├── screenshot.py          # Playwright 截图（MapScreenshotTaker）
├── aiearth_client.py      # AI Earth 提取客户端
├── config.py              # 配置（从 .env 读取）
├── shp_to_geojson.py      # SHP 转 GeoJSON 工具脚本
├── templates/
│   ├── index.html         # 主页面（全部前端逻辑）
│   └── map.html           # Playwright 专用无头地图页
├── static/
│   └── water_levels/      # 水位线 GeoJSON 文件
│       ├── 155.geojson … 160.geojson
├── .env                   # 密钥配置（不提交 git）
├── PROJECT_STATUS.md      # 本文档
└── server_err.log         # 运行日志
```

---

## 四、环境变量（.env）

```env
AMAP_KEY=xxx                  # 高德地图 JS API Key
AMAP_SECURITY_CODE=xxx        # 高德安全码（可选）
QWEN_API_KEY=xxx              # 通义千问 API Key
QWEN_MODEL=qwen-vl-max        # 当前使用模型（视觉理解）
SERVER_PORT=8000
MAX_STEPS=20                  # AI 分析最大步骤数

AIE_ACCESS_KEY_ID=xxx         # 阿里云 AccessKey ID
AIE_ACCESS_KEY_SECRET=xxx     # 阿里云 AccessKey Secret
AIE_TOKEN=xxx                 # AI Earth Token（优先使用，可替代 AK）
```

---

## 五、API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 主页面 |
| GET | `/map.html` | Playwright 专用无头地图页 |
| POST | `/api/start` | 启动 AI 搜索/分析任务 |
| GET | `/api/stream/{session_id}` | SSE 事件流（通用） |
| POST | `/api/chat` | AI 对话（截图+问答，支持标注返图） |
| POST | `/api/traverse` | 启动区域遍历分析 |
| POST | `/api/traverse/estimate` | 估算格子数量 |
| POST | `/api/traverse/{id}/stop` | 停止遍历 |
| GET | `/api/water-level/{name}` | 获取水位线 GeoJSON |
| GET | `/api/water-level/{name}/bbox` | 获取水位线 bbox |
| POST | `/api/aiearth/start` | 启动专业模式提取（SSE 流式） |
| POST | `/api/aiearth/extract` | 旧版建筑提取（向后兼容） |

---

## 六、页面布局

```
+------------------+---------------------------+----------------+
| 左侧栏 (340px)   |      地图（中间）         | 右侧栏 (310px) |
|                  |                           |                |
| - 搜索定位       |  高德卫星图               | 专业模式       |
| - 分析目标       |  + 截图预览框（黄框）     |                |
| - 视口信息       |  + 水位线叠加             | - 提取范围     |
| - 精准测量       |  + AI 标注点              |   视野/框选/多边形 |
| - 区域遍历分析   |  + AI Earth 矢量要素      | - 提取类型     |
| - 视野分析       |                           |   建筑/路网/坝/自定义 |
| - 状态栏         |                           | - 开始提取     |
| - 运行日志       |                           | - 运行日志     |
| - 最新截图预览   |                           | - 提取结果     |
+------------------+---------------------------+----------------+
  水位线浮动面板（地图右上角）
  AI 对话悬浮按钮（地图右下角）
```

---

## 七、AI 对话标注功能

在右下角聊天框输入含标注关键词的消息，AI 会自动截图当前视野并返回标注图片。

**触发关键词：** 标记 / 标注 / 找出 / 框出 / 圈出 / 画出 / 标出

**使用示例：**
```
标记视野中的道路    → 折线标注，滑动窗口 2×2 分块识别
标注所有建筑        → 单栋边界框，自动过滤大片矩形
找出停车场          → 通用目标识别
```

**道路识别管线（`_annotate_road_sliding_window`）：**
```
截图（2048×1536）
    → 切 2×2 分块（15% 重叠）
    → 4 块并发调用 _call_qwen_hires（detail=high + vl_high_resolution_images=True）
    → 每块输出 {"roads": [{"label", "polyline": [[x,y],...]}]}
    → _tile_roads_to_full 映射回全图坐标
    → _dedup_roads 去重（起终点在 30 单位内视为同一条）
    → _draw_road_polylines 绘制彩色折线
    → 返回标注图到聊天气泡
```

**建筑识别管线：**
```
截图（2048×1536）
    → _call_qwen_hires + _BUILDING_ANNOTATE_SYSTEM
    → 输出 {"buildings": [{"label", "box": [x1,y1,x2,y2]}]}
    → _filter_large_boxes 过滤（面积 > 8% 丢弃）
    → _draw_chat_annotations 绘制单栋色框
    → 返回标注图到聊天气泡
```

**截图分辨率：** `screenshot.py` 中 `device_scale_factor=2`，viewport 1024×768，物理截图 2048×1536

---

## 八、专业模式（AI Earth）完整流程

```
用户点击"开始提取"
    → POST /api/aiearth/start
    → 后端创建 _AIESession，注册 session_id
    → Playwright 截图（当前视野 or 自定义框选/多边形范围）
    → PNG → GeoTIFF（tifffile 写入 GCJ-02 坐标，标注为 WGS-84）
    → publish_local_tiff 上传影像
    → 轮询 list_user_raster_datas，等待 PUBLISHDONE
    → 按类型创建任务：
        building  → create_aijob(app="building_extraction")
        road      → create_aijob(app="land_cover_classification")
        dam       → create_aieseg_job(text_prompt="拦河坝、大坝、堤坝")
        custom    → create_aieseg_job(text_prompt=用户输入)
    → 轮询 get_jobs，等待 FINISHED
    → download_data 下载 SHP zip
    → pyshp 解析 SHP → GeoJSON features
    → SSE 推送 aie_result 事件（含 features 数组）
    → 前端按类型颜色渲染 AMap.Polygon 到地图
```

| type | AI Earth App | 地图颜色 |
|---|---|---|
| building | building_extraction | 橙色 #f0883e |
| road | land_cover_classification | 蓝色 #58a6ff |
| dam | CreateAiesegJobRequest | 绿色 #3fb950 |
| custom | CreateAiesegJobRequest | 红色 #da3633 |

---

## 九、坐标系说明

- 高德地图使用 **GCJ-02**（火星坐标系）
- AI Earth 上传影像标注为 WGS-84，实际传入 GCJ-02（差异约 100~500m）
- 前端 `gcj02ToWgs84()` 仅用于信息面板显示 CGCS2000 坐标，不影响截图/提取流程
- AI Earth 返回的矢量结果叠加地图时存在坐标偏移（TODO：WGS-84 转 GCJ-02）
- agent.py 所有坐标归一化到 [0,1000]，`COORD_SCALE = 1000`

---

## 十、启动方式

```bash
# 必须使用真实 Python（非 Windows Store 存根）
C:\Users\张轩\AppData\Local\Programs\Python\Python313\python.exe main.py
```

**建议写入 ~/.bashrc：**
```bash
alias py313="/c/Users/张轩/AppData/Local/Programs/Python/Python313/python.exe"
alias start-map="cd /c/Users/张轩/map-agent && py313 main.py > server_err.log 2>&1 &"
```

> 警告：Git Bash 中 `python` 指向 Windows Store 存根，运行任何 py 脚本均返回 exit code 49，不可用。

---

## 十一、已知问题 & 修复记录

| 日期 | 问题 | 根因 | 修复 |
|---|---|---|---|
| 2026-06 | AI Earth 鉴权失败 24240004 | 子账号未授权 | 改为 Token 优先：core.Authenticate(token=AIE_TOKEN) |
| 2026-06 | 'int' object is not subscriptable | SDK 返回 job_id/data_id 是 int，直接 [:8] 切片 | 改为 str(job_id)[:8] |
| 2026-06 | /api/aiearth/start 404 | 重启时用了 Windows Store Python 存根 | 用完整路径 Python313/python.exe 启动 |
| 2026-06 | 对话标注只返回文字无图片 | 去掉格式指令后模型不输出坐标 | 恢复 _ANNOTATE_SYSTEM 格式说明 + enable_thinking=True |
| 2026-06 | 道路标注返回大片矩形 | 模型倾向输出包围框而非折线 | 专用 _ROAD_ANNOTATE_SYSTEM 强制折线 + _filter_large_boxes |

---

## 十二、待完善功能（TODO）

- [ ] 坐标系校正：AI Earth 矢量结果 WGS-84 转 GCJ-02，消除地图叠加偏移
- [ ] 结果图层管理：按批次/类型管理，可单独开关、删除
- [ ] GeoJSON 导出：提取结果提供下载链接
- [ ] 多边形精确裁剪：polygon 绘制模式取真实多边形范围，而非外接矩形
- [ ] 遍历 + AI Earth 联动：遍历发现目标后，对该格一键调用 AI Earth 精确提取
- [ ] 启动脚本：start.bat 用完整 Python 路径启动，双击即可
- [ ] favicon：补充 favicon.ico 消除浏览器 404 警告
- [ ] AI Earth 任务进度条：轮询阶段显示进度百分比
- [ ] 水位线范围用于专业模式：选择水位线后直接作为 AI Earth 提取范围
- [ ] 标注结果叠加到地图：折线/边界框从聊天图片同步到地图图层

---

## 十三、前端关键 JS 变量

```javascript
// 全局变量
map               // AMap.Map 实例
mouseTool         // AMap.MouseTool（测量 + 框选共用，注意互斥）
nearbyPois        // 当前视野周边 POI 字符串，供 AI 参考
_traverseContext  // 最近一次遍历摘要，供 AI 对话引用
chatHistory       // 对话历史数组 [{role, content}]

// 专业模式（pro-panel IIFE 内部）
_ppAreaMode       // 'viewport' | 'rect' | 'poly'
_ppBounds         // {north,south,east,west} 用户绘制范围
_ppOverlays       // AI Earth 提取结果的地图图层数组
_ppDrawShape      // 用户绘制的临时覆盖物
_ppEs             // 当前专业模式 EventSource

// 区域遍历（traverse IIFE 内部）
_tvBounds         // 框选范围 {north,south,east,west}
_tvRect           // 框选矩形覆盖物
_tvMarkers        // 遍历发现的黄色标记点数组
_tvEs             // 遍历 EventSource
_lastSummaryData  // 最后一次报告数据（供重新打开弹窗）
```

---

## 十四、SSE 事件类型完整列表

| type | 来源 | 说明 |
|---|---|---|
| log | 所有 | 日志文字 |
| screenshot | Agent/Traverse | base64 截图 + step |
| annotated_screenshot | Agent | 带红色检测框的截图 |
| set_zoom | Agent | 地图缩放指令 |
| fly_to | Agent | 地图飞行到指定坐标 |
| add_marker | Agent | 添加红点标记 + 标签 |
| add_rect | Agent | 添加矩形高亮区域 |
| add_polyline | Agent | 添加折线（道路标注） |
| analyze_result | Agent | 视野分析结果 + 测量数据 |
| traverse_start | Traverse | 遍历开始，含总格数 |
| traverse_progress | Traverse | 当前进度 current/total |
| traverse_finding | Traverse | 单条发现记录（含 bounds、box_2d） |
| traverse_summary | Traverse | 遍历完成汇总报告 |
| aie_result | AIEarth | 提取完成，含 features/count/app_type |
| error | 所有 | 错误消息字符串 |
| done | 所有 | 任务结束信号 |
