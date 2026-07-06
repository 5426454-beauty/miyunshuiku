# 五一水库数字孪生管理矩阵 — 三套主题重设计方案

> 基于 UI UX Pro Max 技能分析 · 2026-05-29
> **最后实施**：2026-06-08
> 项目路径：`C:\shuikujuzhen-borrow-scene`
> 运行地址：`http://localhost:5173`

## ⚠️ 实施偏离说明 (2026-06-08)

| 项目 | 原计划 | 实际实施 |
|------|--------|----------|
| 主题 B 方向 | 自然绿洲（生态绿调） | **深蓝科技**（珠江蓝·数字孪生指挥中心风格） |
| 参考源 | UI UX Pro Max 配色推荐 | 珠江项目 `C:\Users\51world\Documents\WXWork\...\zhujiang\` |
| 主题 B 边框 | 大圆角无边线 | 渐变边框 `::before` + `mask-composite: exclude`（珠江 card-outer 风格） |
| 主题 B 侧面板宽 | 默认 280px | 340px（加宽） |
| 全局布局 | flex 三列 | 场景绝对定位全宽 + 面板浮动覆盖（三主题统一） |
| 面板透明度 | `--bg-panel` CSS 变量 | JS 运行时 `document.documentElement.style.setProperty()` 动态覆盖 |

---

## 现有架构

```
style.css (2660 行)
├── :root       (12 个 CSS 变量)     ← 主题 A（科技蓝 / 默认）
├── [data-theme="B"] (200 行)       ← 当前党政红
├── [data-theme="C"] (470 行)       ← 当前华为极简
└── 无前缀全局样式                   ← 所有主题共享
```

### 当前 CSS 变量体系

```css
--bg-deep       背景底色
--bg-panel      面板背景
--bg-panel2     面板次级背景
--border-cyan   边框色
--glow-cyan     内发光色
--cyan          主强调色
--cyan-dim      次强调色
--text-primary  主文字色
--text-muted    次文字色
--accent-green  绿色强调
--accent-yellow 黄色强调
--accent-orange 橙色强调
--top-h         顶部导航栏高度（固定52px）
```

### 当前组件覆盖清单（每套主题需覆盖）

| 区域 | 选择器 | 说明 |
|------|--------|------|
| CSS 变量 | `[data-theme]` | 12 个变量重定义 |
| 基础层 | `html`, `body` | 背景色、字体、字号 |
| 顶部导航栏 | `.top-bar` | 背景渐变、边框、阴影 |
| 导航项 | `.nav-item`, `.nav-item--active`, `.nav-item--custom` | 颜色、hover、激活态 |
| 导航标题 | `.top-bar__title`, `.top-bar__time` | 标题和时间颜色 |
| 侧面板 | `.side-panel` | 面板容器背景 |
| 面板 | `.panel`, `.panel__header`, `.panel__body`, `.panel__icon` | 卡片、标题栏、图标 |
| 统计卡片 | `.stat-item`, `.stat-value`, `.stat-label` | KPI 卡片 |
| 水库介绍 | `.intro-desc` | 文字描述 |
| 闸坝统计 | `.gate-stat-item`, `.val-cyan` | 闸坝数据行 |
| 安全评分 | `.score-num`, `.safety-score-wrap`, `.safety-metric-item`, `.sm-value` | 评分卡片 |
| 水质网格 | `.wq-item`, `.wq-value`, `.quality-badge` | 水质数据卡片 |
| 事件列表 | `.invest-item`, `.invest-rate` | 安全事件 |
| 进度条 | `.progress-track`, `.progress-fill` | 进度指示 |
| 状态标签 | `.status-tag-item` | 状态网格 |
| 预警列表 | `.alert-item` | 预警提醒 |
| 加载动画 | `.loading-spinner`, `.scene-status` | WDP 加载状态 |
| 相机按钮 | `.reset-btn` | 复位按钮 |
| POI 工具 | `.poi-tool__toggle`, `.poi-tool__btn--pick`, `.poi-tool__panel`, `.poi-tool__input` | 取点工具 |
| 天气工具 | `.weather-tool__btn`, `.weather-tool__select`, `.weather-tool__slider`, `.weather-tool__preset-btn`, `.weather-tool__time-display`, `.weather-tool__panel`, `.weather-tool__header` | 天气控制 |
| 视频监控 | `.surveillance-btn`, `.surveillance-btn--active` | 监控按钮 |
| 悬浮球 | `.heatmap-tool__btn`, `.migration-tool__btn`, `.viewshed-tool__btn` 及其 `--active` / `--tip` 态 | 四管工具 |
| 热力图面板 | `.viewshed-tool__panel`, `.viewshed-tool__panel-title`, `.viewshed-tool__row` | 可视域 |
| 闸门面板 | `.gate-tool__panel`, `.gate-tool__panel-title`, `.gate-tool__gate-btn` 及其 `--active` | 闸门控制 |
| 降雨面板 | `.rainfall-tool__panel`, `.rainfall-tool__panel-title`, `.rainfall-tool__action-btn`, `.rainfall-tool__row`, `.rainfall-tool__rise-val`, `.rainfall-tool__progress-fill` | 降雨模拟 |
| 无人机 | `.drone-tool__btn` 及其 `--active` / `--tip` | 无人机巡检 |
| AI 聊天 | `.ai-chat__toggle`, `.ai-chat__window`, `.ai-chat__header`, `.ai-chat__msg--user`, `.ai-chat__msg--assistant`, `.ai-chat__input-row`, `.ai-chat__input`, `.ai-chat__send`, `.ai-chat__mic` | AI 助手 |
| 巡检路线 | `.inspection-route`, `.inspection-route--active`, `.inspection-video-box`, `.inspection-video-title` | 机器人巡检 |
| 动态面板 | `.dyn-list-item`, `.dyn-list-value` | 自定义面板 |

---

## 三套新主题设计

### 概览

| | 主题 A：霓虹科技 | 主题 B：深蓝科技 | 主题 C：极简暗黑 |
|---|---|---|---|
| **设计关键词** | HUD、科幻、指挥中心 | 数字孪生、珠江指挥中心 | 专业、干净、企业级 |
| **场景联想** | 钢铁侠控制台 | 水利数字孪生大屏 | Bloomberg 终端 |
| **参考来源** | 原项目默认主题 | 珠江项目 UI 复制 | UI UX Pro Max Dark Mode OLED |
| **底色** | 纯黑 `#000000` | 深蓝 `#0a0e1a` | 纯黑 `#000000` |
| **主色调** | 霓虹青 `#00FFFF` | 蓝灰 `#A9BCEB` | 纯白 `#FFFFFF` |
| **辅助色** | 全息蓝 `#0080FF` | 浅蓝 `#3FB3FF` | 暗灰 `#121212` |
| **强调色1** | 警报红 `#FF0000` | 青绿 `#00FFDD` | 午夜蓝 `#0A0E27` |
| **强调色2** | 霓虹紫 `#BF5AF2` | 暖橙 `#FC9C42` | 冷灰 `#2D3748` |
| **发光** | 强霓虹 `text-shadow` | 零发光 | 零发光 |
| **边框** | 1px 细线 + 角标装饰 | 渐变边框 `::before` + `mask-composite` | 无边线卡片 |
| **字体** | 等宽 `JetBrains Mono` | OPPOSans 系统无衬线 | 系统无衬线 |
| **圆角** | `0px` 直角 | `10px` 面板 / `6px` 卡片 | `8px` 微圆角 |
| **侧面板宽** | 280px | 340px | 280px |
| **面板背景** | 透明 + 细线描边 | `linear-gradient(301deg, ...)` 渐变 | 浅灰卡片 + 毛玻璃 |
| **导航栏** | 半透明黑 + 扫描线动画 | 半透明深蓝 + 扫描线 + blur(10px) | 极简毛玻璃 |

---

### 主题 A：霓虹科技 —「水库指挥中心」

#### CSS 变量

```css
[data-theme="A"] {
  --bg-deep:       #000000;
  --bg-panel:      rgba(0, 10, 20, 0.75);
  --bg-panel2:     rgba(0, 15, 30, 0.55);
  --border-cyan:   rgba(0, 255, 255, 0.45);
  --glow-cyan:     rgba(0, 255, 255, 0.12);
  --cyan:          #00FFFF;
  --cyan-dim:      #0080FF;
  --text-primary:  #E0F7FF;
  --text-muted:    rgba(180, 230, 255, 0.72);
  --accent-green:  #00FF88;
  --accent-yellow: #FFD700;
  --accent-orange: #FF4500;
}
```

#### 视觉特征

| 元素 | 设计 |
|------|------|
| **背景** | 纯黑 `#000`，OLED 优化 |
| **面板** | 1px 霓虹青描边，透明背景，四角装饰 `┌ ┐ └ ┘` 线框 |
| **面板标题** | 等宽字体 + `letter-spacing: 3px` + 微发光 `text-shadow: 0 0 8px rgba(0,255,255,0.4)` |
| **导航栏** | 半透明黑底 + 底部扫描线动画（`repeating-linear-gradient` 移动） |
| **Tab 激活** | 霓虹青底 + 外侧发光光晕 |
| **按钮** | 1px 细线描边，hover 时 `background: rgba(0,255,255,0.12)` + 发光边框 |
| **数据数字** | 等宽字体 `JetBrains Mono` / `Consolas`，青色发光 |
| **悬浮球** | 六边形或菱形替代圆形，1px 描边 |
| **滚动条** | 1px 宽，青色拖柄 |
| **AI 聊天** | 暗底 + 细线边框 + 消息气泡直角 |

#### 新增动画

```css
/* 扫描线动画 */
@keyframes scanline {
  0%   { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}
[data-theme="A"] .top-bar::after {
  content: '';
  position: absolute; bottom: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, #00FFFF, transparent);
  animation: scanline 2s linear infinite;
}
```

#### 参考色板

```
主场景:  #000000 (纯黑底)
面板:    rgba(0,10,20,0.75) + 1px #00FFFF 描边
主色:    #00FFFF (霓虹青)
辅色:    #0080FF (全息蓝)
警报:    #FF0000 (警报红)
成功:    #00FF88 (霓虹绿)
警告:    #FFD700 (黄)
```

---

### 主题 B：深蓝科技 —「数字孪生指挥中心」（实际实施）

> **偏离原计划**：原设计"自然绿洲"（生态绿调），实施时改为复制珠江项目 deep blue/cyan command center 风格。

#### CSS 变量（实际值）

```css
[data-theme="B"] {
  --bg-deep:       #0a0e1a;
  --bg-panel:      rgba(10, 14, 26, 0.88);
  --bg-panel2:     rgba(47, 98, 99, 0.35);
  --border-cyan:   rgba(169, 188, 235, 0.40);
  --glow-cyan:     rgba(169, 188, 235, 0.08);
  --cyan:          #A9BCEB;
  --cyan-dim:      #3FB3FF;
  --text-primary:  #ffffff;
  --text-muted:    rgba(173, 187, 231, 0.78);
  --accent-green:  #00FFDD;
  --accent-yellow: #FC9C42;
  --accent-orange: #FC4E42;
}
```

#### 视觉特征（实际）

| 元素 | 设计 |
|------|------|
| **背景** | `radial-gradient` 双光斑 + 深蓝底色 `#0a0e1a` |
| **面板** | `::before` 伪元素渐变边框（121° 从 #3e897d 渐隐），`border-radius: 10px`，`mask-composite: exclude` |
| **面板标题** | OPPOSans 系统无衬线，白色，标题装饰线 `linear-gradient(90deg, transparent, #A9BCEB)` |
| **导航栏** | 深蓝半透明 `rgba(10,14,26,0.94)` + `backdrop-filter: blur(10px)` + 底边细线 + 扫描线动画 |
| **Tab 激活** | 深蓝底 + 青白文字，`border-radius: 4px` |
| **按钮** | 深蓝底 + 1px 蓝灰边框 + hover 增亮 |
| **数据数字** | 大字号（20px/42px/16px），无发光 |
| **侧面板** | 340px 宽度 + 6px 间距 + `overflow-y: auto` 浮动滚动 |
| **弹窗面板** | 实色 1px 边框 `rgba(169,188,235,0.32)` + `border-radius: 10px` + 渐变背景 |
| **AI 聊天** | 渐变背景窗口 + 细线边框 + 微圆角气泡 |

---

### 主题 C：极简暗黑 —「专业数据看板」

#### CSS 变量

```css
[data-theme="C"] {
  --bg-deep:       #000000;
  --bg-panel:      rgba(25, 25, 25, 0.50);
  --bg-panel2:     rgba(35, 35, 35, 0.35);
  --border-cyan:   rgba(255, 255, 255, 0.08);
  --glow-cyan:     transparent;
  --cyan:          #FFFFFF;
  --cyan-dim:      rgba(255, 255, 255, 0.70);
  --text-primary:  #F5F5F5;
  --text-muted:    rgba(200, 200, 200, 0.65);
  --accent-green:  #4ADE80;
  --accent-yellow: #A0A0A0;
  --accent-orange: #6B7280;
}
```

#### 视觉特征

| 元素 | 设计 |
|------|------|
| **背景** | OLED 纯黑 `#000` |
| **面板** | 暗灰卡片 `rgba(25,25,25,0.5)`，`border-radius: 8px`，无边框无发光 |
| **面板标题** | 纯白粗体 `#FFF`，`font-weight: 600`，`letter-spacing: 0.5px` |
| **导航栏** | 毛玻璃 `rgba(15,15,15,0.6)` + `backdrop-filter: blur(20px)`，无边线 |
| **Tab 激活** | 白色底 + 黑色文字翻转，`border-radius: 6px` |
| **按钮** | 灰底白字 `rgba(255,255,255,0.08)`，hover 变亮至 `0.15` |
| **数据数字** | 纯白粗体，细等宽数字，零发光 |
| **悬浮球** | 纯文字按钮替代圆形悬浮球，36px 高 |
| **图表配色** | 单色白 + 微妙的灰色阶，仅关键数据用 `#4ADE80` 强调 |
| **AI 聊天** | 深灰底 + 细边框气泡 + 无圆角 |

#### 参考色板

```
主场景:  #000000 (OLED 纯黑)
面板:    rgba(25,25,25,0.5) + 无边线 8px 圆角
主色:    #FFFFFF (纯白)
辅色:    rgba(255,255,255,0.70) (浅灰)
强调:    #4ADE80 (极少量绿色)
```

---

## 实施记录

### 已完成 (2026-06-08)

| 步骤 | 描述 | 状态 |
|------|------|------|
| 主题 B 重写 | 复制珠江项目 UI 风格 → 深蓝科技指挥中心 | ✅ 完成 |
| 主题 B 渐变边框 | `::before` + `mask-composite: exclude` 技术（珠江 card-outer 风格） | ✅ 完成 |
| 全局布局 | flex 三列 → 场景全宽 + 面板浮动覆盖（三主题统一） | ✅ 完成 |
| 主题名更新 | `_theme.js` B 改为"深蓝科技"，PANEL_COLORS B 改为 `'10, 14, 26'` | ✅ 完成 |
| 弹窗修复 | 去除弹窗面板的 `position: relative` 覆盖，保留原生 absolute/fixed | ✅ 完成 |
| 顶栏溢出修复 | 主题 B `.top-bar` 设 `overflow: visible` 允许下拉面板显示 | ✅ 完成 |
| 布局记忆 | `MEMORY.md` 更新布局变更 + 主题 B 实现细节 | ✅ 完成 |
| Skill 安装 | `ui-ux-pro-max` v2.5.0 安装到 `.claude/skills/` | ✅ 完成 |

### 未完成 / 保持原样

| 项目 | 说明 |
|------|------|
| **ECharts 图表** | CSS 变量无法穿透到 Canvas 图表，需通过 `_leftPanel.js` 中传入主题配色。本次暂不调整 |
| **WDP 3D 场景** | 云渲染场景完全由 WDP API 控制，不受 CSS 影响 |
| **热力图/迁徙图** | 由 WDP JS API 创建，颜色参数在 JS 中固定 |
| **浏览器兼容** | `backdrop-filter` + `mask-composite` 在 Chrome/Edge 完美支持 |

### 文件大小
CSS 实际约 4200 行（含 3 套主题完整覆盖），gzip 约 12KB

---

## 成果预期

| 交互 | 效果 |
|------|------|
| 刷新页面 | 默认加载主题 A（霓虹科技） |
| AI 说"切换为自然绿洲" | 主题 B 水生态风格 |
| AI 说"切换为极简暗黑" | 主题 C 企业专业风格 |
| AI 说"换回霓虹科技" | 回到主题 A |
| 关闭浏览器再打开 | localStorage 记住上次选择 |
| `data-theme` 属性 | 始终在 `<html>` 上，切换零延迟 |

---

## 附录：UI UX Pro Max 搜索记录

### 产品匹配
```
Smart Home/IoT Dashboard → Glassmorphism + Dark Mode (OLED) + Real-Time Monitoring
Analytics Dashboard → Data-Dense + Drill-Down Analytics
Agriculture/Farm Tech → Organic Biophilic + Flat Design + IoT Sensor Dashboard
```

### 风格匹配
```
HUD / Sci-Fi FUI (0.96) → 主题 A 霓虹科技
Dark Mode OLED (0.91)  → 主题 C 极简暗黑
Glassmorphism (0.88)    → 主题 C 毛玻璃面板
Minimalism & Swiss Style (0.85) → 主题 C 极简
Cyberpunk UI (0.82) → 主题 A 色彩灵感
Organic Biophilic + Flat Design → 主题 B 自然绿洲
```

### 配色匹配
```
Smart Home/IoT: #1E293B bg + #22C55E accent + #F8FAFC text → 主题 C
Agriculture: #15803D + #0891B2 + #CA8A04 → 主题 B
Climate Tech: #059669 + #10B981 + #FBBF24 → 主题 B
Financial Dashboard: #0F172A bg + #22C55E → 主题 C 参考
```