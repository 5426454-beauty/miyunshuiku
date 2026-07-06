# 密云水库数字孪生 — 改动记录

## 〇、2026-06-25 DEM 高程系统 + AI 聊天升级 + 降雨修复 + UI 清理

### DEM 高程分析系统
| 文件 | 改动 |
|------|------|
| `query_elevation.py` | 新建：连通区域分析（scipy.ndimage.label）、多模式查询、JSON输出、--post一键推送 |
| `server.js` | 新增 `/api/dem/annotations`（GET/POST/DELETE）、`/api/chat`（LLM+工具调用） |
| `src/_dem.js` | 新建：轮询标注数据、WDP POI标记+矩形框渲染、WGS84→GCJ-02坐标转换 |
| `src/main.js` | 注册 `initDem()` |
| `src/_coordConvert.js` | WGS84↔GCJ-02 坐标转换（DEM分析使用） |

### AI 聊天升级
| 文件 | 改动 |
|------|------|
| `src/_aiChat.js` | 路由改为 `localhost:3001/api/chat`，移除暴露的 API Key |
| `server.js` | `/api/chat`：Qwen3-Max + DEM 工具调用 + Python 执行 + SSE 流式返回 |

### 降雨模拟修复
| 文件 | 改动 |
|------|------|
| `src/_rainfall.js` | 废弃 entity 10016，改为 CustomApi.WaterSurface（setvisibility + lift/setheight） |

### UI 清理
| 文件 | 改动 |
|------|------|
| `src/_amap.js` | 删除 amap-dbg 调试小窗（DOM + console.log 迁移） |
| `src/style.css` | 删除 `.amap-dbg` 样式 |
| `MEMORY.md` | 全面更新：项目路径/场景坐标/模块列表/API 文档 |

### 已知问题
- ~~降雨模拟：WaterSurface API 调用返回 true，但场景中水面高度无视觉变化。placename 可能需调整~~ ✅ 已修复（2026-06-25）
- ~~ECharts 图表主题未适配~~ ✅ 已修复（2026-06-25）：_theme.js 发送 theme-changed 事件，_tabSwitch.js 监听并重渲染所有面板
- ~~热力图/迁徙图颜色硬编码~~ ✅ 已修复（2026-06-25）：改为从 CSS 变量动态读取

---

## 〇·五、2026-06-25 场景适配与功能修复

### 降雨模拟修复
| 文件 | 改动 |
|------|------|
| `src/_rainfall.js` | placename `"密云水库水面"`→`"库区水面"`（用户实测确认有效）；BASE_WATER_LEVEL 126→152；新增 `_flyToWater()` 镜头自动跳转 |

### 相机视角更新
| 文件 | 改动 |
|------|------|
| `src/_camera.js` | RESET_POSE 更新为实测坐标 `[116.8950, 40.4551, 508.54]` |
| `src/_drone.js` | 无人机停止后复位视角同步更新 |

### 闸门+泄洪镜头跳转
| 文件 | 改动 |
|------|------|
| `src/_gate.js` | 开闸时自动 FlyTo 第三溢洪道 `[117.0007, 40.4655, 191.91]` |
| `src/_discharge.js` | 模拟泄洪开始时自动 FlyTo 同一视角 |

### 热力图+迁徙图中心更新
| 文件 | 改动 |
|------|------|
| `src/_heatmap.js` | 热力点坐标+FlyTo 目标更新为 PickPointEvent 实测点 `[117.0226, 40.5019]` |
| `src/_migration.js` | 6 组飞线起终点+FlyTo 目标同步更新 |

### 无人机巡检重写
| 文件 | 改动 |
|------|------|
| `src/_drone.js` | 废弃旧项目 EID；新增 `_findDroneEntity()` 场景自动搜索；无实体时 POI 降级方案；巡检路径改为 7 个坝体实测航点；启动时显示巡检视频窗口；全面添加错误日志 |

### 巡检视频窗口
| 文件 | 改动 |
|------|------|
| `src/_drone.js` | 巡检启动/停止时控制 `inspection-video-box` 显隐 |
| `src/style.css` | 视频框 `left: 300px`（避开左侧面板），`z-index: 15`；主题 B `left: 360px` |

### ECharts 图表主题自适应
| 文件 | 改动 |
|------|------|
| `src/_theme.js` | `switchTheme()` 末尾 dispatch `theme-changed` 事件 |
| `src/_tabSwitch.js` | 监听 `theme-changed`，重渲染左右面板 ECharts 图表 |

### 热力图/迁徙图颜色动态化
| 文件 | 改动 |
|------|------|
| `src/_heatmap.js` | `gradientSetting` 改为 `_getGradientColors()` 从 CSS 变量读取 `--cyan`/`--accent-green`/`--accent-yellow`/`--accent-orange` |
| `src/_migration.js` | 飞线颜色改为 `_getParabolaColor()` 从 `--accent-orange` 读取 |

### 大坝控制面板
| 文件 | 改动 |
|------|------|
| `src/_dam.js` | **新建**：3 坝（白河主坝/潮河主坝/走马庄副坝），显隐+透明+热力图抬升+镜头跳转 |
| `index.html` | 新增 `#panel-dam` 面板（panel-gate 与 panel-curve 之间） |
| `src/_tabSwitch.js` | 进出四管时 showDamPanel()/hideDamPanel() |
| `src/main.js` | 导入 initDam() |
| `src/style.css` | 新增 `.dam-actions`/`.dam-row`/`.dam-btn` 等样式 + 主题 B/C 覆盖 |

### 降雨视角更新
| 文件 | 改动 |
|------|------|
| `src/_rainfall.js` | RAINFALL_CAMERA_POSE 更新为 `[116.9772, 40.4513, 159.12]` |

### 大坝热力图抬升
| 文件 | 改动 |
|------|------|
| `src/_dam.js` | 走马庄副坝新增 🔥 按钮，`liftandshow` API（placename=`走马坝热力图`，高度 200m） |

### 淹没预演切换 WaterSurface API
| 文件 | 改动 |
|------|------|
| `src/_flood.js` | 废弃 `GetByEids(['10016'])` + 手动 `SetLocation()`，改为 `CustomApi.WaterSurface.setheight`；相机目标 `[116.999938, 40.465016]` |

### 视频监控点位迁移
| 文件 | 改动 |
|------|------|
| `src/_surveillance.js` | 4 个监控 POI 从水面移到实测坐标（白河/走马庄/第三溢洪道区域）；周界多边形同步扩大 |

---

## 一、渲染口令替换

| 文件 | 改动 |
|------|------|
| `config.json` | `order` → `5370da1dcb6547214dca7a5a1282a568` |
| `src/_wdp.js` | 默认 fallback 口令同步更新 |

---

## 二、坐标批量换算（CGCS2000 → 新场景）

**旧中心**: `[113.437, 23.305]`（广州铜锣湾水库）
**新中心**: `[116.9653770483, 40.5054633531]`（密云水库）
**偏移量**: Δlng=+3.528377, Δlat=+17.200463

| 文件 | 坐标数 | 说明 |
|------|--------|------|
| `src/_camera.js` | 1 | 复位视角 |
| `src/_heatmap.js` | 9 | 热力点 + 相机焦点 |
| `src/_migration.js` | 14 | 6组飞线起终点 |
| `src/_drone.js` | 6 | 5个路径点 + 复位 |
| `src/_vehicle.js` | 2 | 车辆位置 |
| `src/_inspection.js` | 16 | 3条巡检路线 + 3相机位 |
| `src/_flood.js` | 40 | 4淹没区 + 2流路 + 相机 |
| `src/_surveillance.js` | 9 | 4监控点 + 5周界顶点 |
| `src/_aiChat.js` | 1 | System prompt 场景描述 |

> 共 **98 个坐标**，通过批量脚本一次性换算完成。

---

## 三、实体 EID 更新 & 闸门 API 重写

### 水面 EID
| 文件 | 旧值 | 新值 |
|------|------|------|
| `src/_flood.js` | `836996280512151552` | `10016` |
| `src/_rainfall.js` | `836996280512151552` | `10016` |

### 闸门控制 — 从 EID 实体操控改为 CustomApi.Sluice

**API 格式**（来自项目接口文档 `YK-密云水库流域项目`）：

```javascript
App.Customize.RunCustomizeApi({
  apiClassName: 'CustomApi',
  apiFuncName: 'Sluice',
  args: {
    placename: '第三溢洪道',
    Ids: ['01', '02', '03', '04', '05', '06'],
    action: 'open',         // 'open' | 'close' | 'setvisibility' | 'setdischargeflow'
    moreparameters: {
      openrange: '0.5',     // 开启幅度 0~1
      duration: '2'          // 持续时间
    }
  }
})
```

**Sluice API 功能矩阵**：

| action | 用途 | 参数 |
|--------|------|------|
| `open` | 开闸 | openrange, duration |
| `close` | 关闸 | openrange: '0' |
| `setvisibility` | 水花显隐 | show: 'true'/'false' |
| `setdischargeflow` | 泄流效果 | flowrate: '0'~'8' |

**启闭联动流程**：
- 开闸：水花显示 → 闸门开启 → 泄流效果
- 关闸：泄流归零 → 闸门关闭 → 水花隐藏

**重写文件**：`src/_gate.js`、`src/_discharge.js`、`index.html`（泄洪面板 3→6 闸门）

---

## 四、高德地图 2D 图层叠加

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/_coordConvert.js` | CGCS2000 ↔ GCJ-02 坐标系转换（标准火星坐标算法） |
| `src/_amap.js` | 高德地图完整管理模块 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `index.html` | `<head>` 添加 Amap 安全密钥；标题 → "密云水库管理矩阵" |
| `src/style.css` | 2D/3D 切换按钮样式；Amap 容器样式；淡入淡出动画 |
| `src/main.js` | 引入 `initAmap()` |

### 架构

```
scene-container
├── #player (WDP 3D) — 始终全亮，一直在底层渲染
└── #amap-container (Amap 2D) — 叠加层，显隐由 CSS opacity 过渡控制
    └── [3D] [🛰卫星] [🗺标准] — 顶部切换按钮
```

### 图层模式

| 按钮 | 效果 |
|------|------|
| **3D** | 2D 淡出 (`opacity: 0`)，露出底层 3D 场景 |
| **🛰 卫星** | 3D→2D 对齐位置后淡入；2D↔2D 仅换图层不重定位 |
| **🗺 标准** | 同上 |

### 坐标转换链路

```
3D 场景 (CGCS2000)               Amap 2D (GCJ-02)
      │                                  ▲
      │  CGCS2000≈WGS84 (偏差<0.1m)      │
      ▼                                  │
   WGS84 ──── wgs84ToGcj02() ────→  GCJ-02  (正向)
      ▲                                  │
      │      _gcj02ToWgs84() (迭代)       │
      └──────────────────────────────────┘  (逆向)
```

### 同步逻辑

| 方向 | 触发条件 | 机制 |
|------|---------|------|
| **2D→3D** | 拖拽 2D 地图 (`moveend`) | GCJ→WGS84 → FlyTo(瞬时, flyTime=0) |
| **3D→2D** | 点击卫星/标准按钮 | GetCameraInfo → 眼位推算注视点 → setZoomAndCenter |
| **2D↔2D** | 点击卫星↔标准 | 仅换图层，不重定位 |
| **3D 模式** | 每 1s 轮询 | GetCameraInfo 缓存 `_last3DCam` |

### 视角锁定

```
SYNC_PITCH = -80   // 接近垂直俯视
SYNC_YAW   = -90   // 正北（WDP yaw=0 非正北，需旋转 -90° 对齐）
```

### 缩放映射

| Amap Zoom | 3D 海拔 (×1.4) |
|-----------|----------------|
| 14 | 8960m |
| 15 | 4480m |
| 16 | 2240m |

缩放倍数可通过 Console 调试：`__amapDebug.multiplier = 1.4`

---

## 五、调试工具

- 右下角信息小窗：切 2D 时显示 `_updateLastCam` 的相机数据
- 切换日志：F12 Console 中 `[Amap]` 前缀的所有输出

---

## 六、依赖配置

**高德地图 JS API 2.0**：
- Key: `905dc2961a8e92d89f396ab80f86644a`
- 安全密钥: `03da948a22f287b75010983c555df0d3`
- 已在 `index.html` `<head>` 中预置 `window._AMapSecurityConfig`

**启动命令**：
```bash
npm run dev          # Vite 前端 → localhost:5173
npm run dev:server   # Express 后端 → localhost:3001
```