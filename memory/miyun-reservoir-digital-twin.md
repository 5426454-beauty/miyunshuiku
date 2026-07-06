---
name: miyun-reservoir-digital-twin
description: Overview of the Miyun Reservoir Digital Twin Matrix Management System — a comprehensive 3D digital twin platform for dam safety and flood management
metadata:
  type: project
---

# 密云水库数字孪生现代化水库矩阵管理系统

## Tech Stack
- Frontend: Vanilla JS + ECharts (no framework for main page), React + Ant Design (admin panel)
- Build: Vite
- 3D Engine: 51WORLD WDP API (cloud rendering via WebRTC)
- Backend: Express.js (localhost:3001)
- 2D Map: AMap (高德地图 JS API 2.0)
- AI: Claude API for chat + Vision analysis

## Architecture
- `src/main.js` — bootstrap entry: initializes WDP cloud rendering + all modules
- `src/_wdp.js` — WDP initialization, scene ready callbacks, config loading (with fallback)
- `src/_leftPanel.js` / `src/_rightPanel.js` — ECharts dashboard panels (dual-gauge, radar, area-line, vbar, hbar, plan-list, inspection-legend)
- `src/mockData.js` — All tab data (home, 四全, 四制, 四预, 四管)
- `src/_flood.js` — 3D flood evolution simulation (4 phases, 4 scenarios, WaterSurface API, heatmap zones)
- `src/_floodHeatmap.js` — DEM grid-based flood depth heatmap (96 time-step playback, 3D colored rectangles)
- `src/_discharge.js` — Discharge scheduling (hydraulic calculation: Q=Cd×b×h×√(2gΔH), forward/reverse planning)
- `src/_gate.js` — 6 sluice gates independent control with splash effects (Sluice API)
- `src/_aiChat.js` — Natural language AI assistant controlling all scene functions
- `src/_dem.js` — DEM elevation annotations (polls backend, renders markers/rectangles in 3D)
- `src/_demoBar.js` — Demo presentation stepper (预警→评估→决策→执行→验证 5-stage workflow)
- `src/_mapAnalysisTab.js` — 3D scene screenshot + Vision AI analysis with result annotation
- `src/_mapAgent.js` — iframe-based map intelligent analysis panel (localhost:8000)
- `admin/` — React+Ant Design admin panel (WDP config, panel config, custom API list)
- Data: Shapefiles for Miyun reservoir water levels (155m-160m), DEM TIFF files

## Key Features
1. 5 Tabs: 首页/四全/四制/四预/四管 (matrix management framework)
2. Flood simulation: 4 scenarios (normal, 20yr, 50yr, 100yr flood), 24h timeline, 4 visual phases
3. Flood depth heatmap: 96-step temporal playback from DEM grid computation
4. Gate control: 6 sluice gates with real-time splash/discharge effects
5. Discharge planning: forward calculation + reverse optimization
6. AI assistant: natural language control of weather, camera, flood, gates, etc.
7. Map intelligence: screenshot + Vision model analysis → 3D annotation
8. Robot inspection, drone patrol, rainfall simulation, migration maps, viewshed analysis

**Why:** Digital twin technology addresses the critical need for dam safety in the context of increasing extreme weather. The "四预" (forecast/warning/pre-plan/pre-rehearsal) capabilities transform flood management from reactive to proactive.

**How to apply:** This is a demo/presentation system. The demo bar stepper (`_demoBar.js`) provides a 5-stage guided presentation flow ideal for roadshows.
