# 项目交接备忘 — 借用同事场景测试三项功能

**创建日期**:2026-05-21
**状态**:🟢 已完成

---

## 🎯 本次任务目标

把同事 `C:\shuikujuzhen\AI demo\` 里的三个亮点功能移植到我的项目:

1. **闸门启闭 + 水花联动**(三闸门独立控制 + 高度可调)
2. **降雨量 → 水位联动**(滑块控制水面 Z 抬升 + 自动切换天气)
3. **无人机巡检**(骨骼动画 + 路径飞行 + 相机跟随)

由于本地工程 (order `5370da1dcb6547214dca7a5a1282a568`) **暂无闸门/水花/无人机/水面等场景资产**,
决定先**借用同事工程的场景** (order `81a65f148cdf78a73ee795e30826ac7e`) 做联调验证。

---

## 🔑 关键信息

| 项目 | 值 |
|---|---|
| 我的工程 order | `5370da1dcb6547214dca7a5a1282a568`(漳河水库,保留) |
| 同事工程 order | `81a65f148cdf78a73ee795e30826ac7e`(借用,测试) |
| WDP 服务地址 | `https://dtp-api.51aes.com` |
| 原项目目录 | `C:\shuikujuzhen\`(❗保持原样不动) |
| 新分支目录 | `C:\shuikujuzhen-borrow-scene\`(待创建) |
| 备份压缩包 | `C:\shuikujuzhen-backup-20260521.zip`(待创建) |

### 同事工程里现成可用的 EID

```js
// 闸门(Static)+ 水花(Effects)
const GATE_CONFIGS = [
  { label: '1号', gateEid: "842689664719519744", waterEid: "844158235551203328" },
  { label: '2号', gateEid: "837014958498643968", waterEid: "837021086729109504" },
  { label: '3号', gateEid: "842689118667276288", waterEid: "844158079737004032" }
]

// 水面(降雨水位用)
const WATER_SURFACE_EID = "836996280512151552"

// 无人机(Skeletal,带骨骼动画)
const DRONE_EID = "840945068910051328"

// 无人机巡检路径(同事 demo 用的,广州一带)
const PATH_COORDINATES = [
  [113.437751, 23.306834, 100],
  [113.441966, 23.304840, 100],
  [113.437426, 23.304002, 100],
  [113.434274, 23.305188, 100],
  [113.437751, 23.306834, 100],
]
```

---

## 🛡️ 回退方案(三层保险)

1. **原目录不动**:所有改动都在新目录,删掉新目录即回退
2. **打包快照**:`C:\shuikujuzhen-backup-20260521.zip`(排除 node_modules/dist/.wdp-cache)
3. **order 一键切换**:改 `config.json` 的 order 字段即可切回漳河水库场景

---

## 📋 待执行步骤(共 9 步)

| # | 任务 | 涉及文件 | 状态 |
|---|---|---|---|
| 1 | 创建回退备份 zip | `C:\shuikujuzhen-backup-20260521.zip` | ✅ 已完成 |
| 2 | 复制项目到新目录 | `C:\shuikujuzhen-borrow-scene\` | ✅ 已完成 |
| 3 | 切换 order 到同事工程 | `config.json`、`src/_wdp.js` | ✅ 已完成 |
| 4 | 移植闸门启闭模块 | 新建 `src/_gate.js` | ✅ 已完成 |
| 5 | 移植降雨水位模块 | 新建 `src/_rainfall.js` | ✅ 已完成 |
| 6 | 移植无人机巡检模块 | 新建 `src/_drone.js` | ✅ 已完成 |
| 7 | 挂载四管 Tab UI 入口 | 改 `_tabSwitch.js`、`style.css` | ✅ 已完成 |
| 8 | 扩展 AI 助手指令 | 改 `_aiChat.js` | ✅ 已完成 |
| 9 | 构建并验证 | npm install + vite build | ✅ 已完成 |

---

## ⚠️ 已知坑(同事踩过 + MEMORY.md 记录)

1. 闸门停止时必须强制复位:`s.entity.location = [...s.origin]`
2. 水花初始隐藏,只在闸门启动时 `bVisible: true`
3. `Delete()` 必须 `await`
4. 相机跟随必须用 `App.CameraControl.Stop()` 解锁,`Focus()` 不能覆盖 `Follow` 锁
5. `Focus.entity` 必须传数组:`entity: [obj]`,不是 `entity: obj`
6. SDK 调用建议每步独立 try-catch,避免一处异常跳过后续清理
7. `RegisterSceneEvent`(单数) 用于渲染器事件,`RegisterSceneEvents`(复数) 用于交互事件
8. 不存在的 API 禁用:`App.Camera.FlyTo()` / `App.Scene.SetWeather()` / `App.Interaction.PickPoint()` / `StopFollow()`

---

## 🚀 下次继续时的指令

> "继续 HANDOFF.md 的任务,从 Task #1 开始执行"

或如果跳过备份直接做:

> "继续 HANDOFF.md,直接从 Task #2 开始(我手动备份过了)"

---

## 📌 当前对话已确认的决策

- ✅ 方案 B:换场景 + 移植代码(完整效果)
- ✅ 新目录名:`shuikujuzhen-borrow-scene`
- ✅ 备份位置:`C:\shuikujuzhen-backup-20260521.zip`(待最终确认或改桌面)
- ✅ 三个功能挂在四管 Tab
- ❓ AI demo 文件夹是否复制到新目录:**建议不复制**(待你确认)
- ❓ node_modules 是否复制:**建议不复制,新目录重新 npm install**(待你确认)

---

## 📂 参考文件位置

- 同事 demo 源码:`C:\shuikujuzhen\AI demo\AI demo\demo_helloworld\demo_helloworld\index.html`
- 同事经验复盘:`C:\shuikujuzhen\AI demo\AI demo\AI前端代码编写复盘.txt`
- 闸门骨骼动画参考:`C:\shuikujuzhen\AI demo\AI demo\骨骼动画.txt`
- 项目记忆文档:`C:\shuikujuzhen\MEMORY.md`
