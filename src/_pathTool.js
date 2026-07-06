// 路径绘制工具：PickerPoint 取点 → App.Path 生成路径
import { getApp, onSceneReady } from './_wdp.js'

// 借用监控模块已知可用的图标
const _DOT_ICON = 'https://wdp5-api-debug.51aes.com/static/newMarker.png'

let _isPicking     = false
let _points        = []      // 已收集的坐标列表
let _dotObjs       = []      // 取点时的临时标记 POI 列表
let _pathObj       = null    // 当前路径实体
let _pathWidth     = 30      // 路径宽度
let _pollTimer     = null
let _lastPickCount = 0
let _countEl       = null

// ── 在取点位置添加临时标记 ────────────────────────────
async function _addDotMarker(position, index) {
  const App = getApp()
  if (!App) return
  const poi = new App.Poi({
    location: position,
    poiStyle: {
      markerNormalUrl:   _DOT_ICON,
      markerActivateUrl: _DOT_ICON,
      markerSize:        [24, 24],
      labelVisible:      true,
      labelContent:      [`P${index}`, '00d4ffff', '14'],
      labelTop:          true,
      labelBgSize:       [40, 24],
      labelBgOffset:     [0, 0],
      textBoxWidth:      40,
    },
    bVisible:   true,
    entityName: `path-dot-${index}`,
    customId:   `path-dot-${index}`,
  })
  const res = await App.Scene.Add(poi, {
    calculateCoordZ: { coordZRef: 'surface', coordZOffset: 0 },
  })
  if (res.success) _dotObjs.push(res.result.object)
}

// ── 清除所有临时标记 ──────────────────────────────────
async function _clearDots() {
  for (const obj of _dotObjs) {
    try { await obj.Delete() } catch (_) {}
  }
  _dotObjs = []
}

// ── 开始取点 ──────────────────────────────────────────
async function _startPicking() {
  const App = getApp()
  if (!App) return
  _isPicking     = true
  _lastPickCount = 0

  await App.Tools.PickerPoint.StartPickPoint(false, false, 'surface')

  _pollTimer = setInterval(async () => {
    if (!_isPicking) return
    try {
      const res = await App.Tools.PickerPoint.GetPickedPoints('surface')
      if (!res?.success) return
      const pp = res.result?.pickedPoints
      if (!Array.isArray(pp) || pp.length === 0) return
      const allPts = (typeof pp[0] === 'number') ? [pp] : pp
      while (_lastPickCount < allPts.length) {
        const pos = allPts[_lastPickCount]
        if (pos) {
          _points.push(pos)
          await _addDotMarker(pos, _points.length)
          if (_countEl) _countEl.textContent = `已取 ${_points.length} 个点`
        }
        _lastPickCount++
      }
    } catch (e) {
      console.warn('[PathTool] 轮询异常', e)
    }
  }, 500)
}

// ── 停止取点 ──────────────────────────────────────────
async function _stopPicking() {
  _isPicking = false
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null }
  _lastPickCount = 0
  const App = getApp()
  if (App) {
    try { await App.Tools.PickerPoint.EndPickPoint() } catch (e) {
      console.warn('[PathTool] EndPickPoint 异常', e)
    }
  }
}

// ── 生成路径 ──────────────────────────────────────────
async function _generatePath() {
  const App = getApp()
  if (!App) return false
  if (_points.length < 2) {
    console.warn('[PathTool] 至少需要 2 个点')
    return false
  }

  // 删除旧路径
  if (_pathObj) {
    try { await _pathObj.Delete() } catch (_) {}
    _pathObj = null
  }

  const path = new App.Path({
    polyline: { coordinates: _points },
    pathStyle: {
      type:      'arrow',
      width:     _pathWidth,
      color:     '00d4ffcc',
      passColor: '00d4ff44',
    },
    entityName: 'custom-path',
    customId:   'custom-path-001',
  })

  const res = await App.Scene.Add(path, {
    calculateCoordZ: { coordZRef: 'surface', coordZOffset: 2 },
  })

  console.log('[PathTool] App.Scene.Add 回调：', JSON.stringify(res))

  if (res.success) {
    _pathObj = res.result.object
    await _clearDots()  // 路径生成成功后清除临时点标记
    return true
  } else {
    console.warn('[PathTool] 路径创建失败', res)
    return false
  }
}

// ── 清空路径和点位 ────────────────────────────────────
async function _clearAll() {
  if (_isPicking) await _stopPicking()
  if (_pathObj) {
    try { await _pathObj.Delete() } catch (_) {}
    _pathObj = null
  }
  await _clearDots()
  _points = []
  if (_countEl) _countEl.textContent = '已取 0 个点'
}

// ── 初始化 UI，注入到设置下拉面板 ──────────────────
export function initPathTool() {
  // 面板挂载到 body
  const panel = document.createElement('div')
  panel.className = 'poi-tool__panel tool-float-panel'
  panel.id = 'js-path-panel'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="tool-float-panel__header">
      <span>🛤️ 路径绘制工具</span>
      <button class="tool-float-panel__close" id="js-path-panel-close">✕</button>
    </div>
    <div class="tool-float-panel__body">
      <div class="poi-tool__row">
        <span class="poi-tool__label">宽度</span>
        <input class="poi-tool__input" id="js-path-width" type="number"
               value="30" min="1" max="500" style="width:70px" />
        <span class="poi-tool__label" style="margin-left:4px">m</span>
      </div>
      <div class="poi-tool__row">
        <button class="poi-tool__btn poi-tool__btn--pick" id="js-path-pick" disabled>开始取点</button>
        <button class="poi-tool__btn poi-tool__btn--clear" id="js-path-clear">清空</button>
      </div>
      <div class="poi-tool__row">
        <button class="poi-tool__btn" id="js-path-gen" style="width:100%;opacity:0.4" disabled>生成路径</button>
      </div>
      <div class="poi-tool__count" id="js-path-count">已取 0 个点</div>
    </div>
  `
  document.body.appendChild(panel)

  // 设置卡片注入到设置下拉面板
  const dropdown = document.getElementById('js-settings-dropdown')
  if (dropdown) {
    const card = document.createElement('button')
    card.className = 'settings-card'
    card.innerHTML = '<span>🛤️</span><span class="settings-name">路径绘制工具</span>'
    card.title = '在地图上点击取点，自动生成路径'
    card.addEventListener('click', (e) => {
      e.stopPropagation()
      dropdown.classList.add('hidden')
      const isOpen = panel.style.display === 'block'
      panel.style.display = isOpen ? 'none' : 'block'
    })
    // 找到工具 section
    let section = dropdown.querySelector('.settings-section--tools')
    if (!section) {
      section = document.createElement('div')
      section.className = 'settings-section settings-section--tools'
      section.innerHTML = '<div class="settings-section-title">🔧 工具</div><div class="settings-cards" id="js-tools-cards"></div>'
      dropdown.appendChild(section)
    }
    const cards = section.querySelector('.settings-cards') || section
    cards.appendChild(card)
  }

  // 关闭按钮
  document.getElementById('js-path-panel-close').addEventListener('click', () => {
    panel.style.display = 'none'
  })

  const widthInput = document.getElementById('js-path-width')
  const pickBtn    = document.getElementById('js-path-pick')
  const clearBtn   = document.getElementById('js-path-clear')
  const genBtn     = document.getElementById('js-path-gen')
  _countEl         = document.getElementById('js-path-count')

  // 宽度输入
  widthInput.addEventListener('change', () => {
    const v = parseInt(widthInput.value, 10)
    if (v > 0) _pathWidth = v
  })

  // 开始/停止取点
  pickBtn.addEventListener('click', async () => {
    pickBtn.disabled = true
    if (_isPicking) {
      await _stopPicking()
      _setPickState(pickBtn, false)
    } else {
      await _startPicking()
      _setPickState(pickBtn, true)
    }
    pickBtn.disabled = false
    _updateGenBtn(genBtn)
  })

  // 生成路径
  genBtn.addEventListener('click', async () => {
    if (_isPicking) {
      await _stopPicking()
      _setPickState(pickBtn, false)
    }
    genBtn.disabled    = true
    genBtn.textContent = '生成中...'
    const ok = await _generatePath()
    genBtn.textContent = ok ? '重新生成' : '生成路径'
    _updateGenBtn(genBtn)
  })

  // 清空
  clearBtn.addEventListener('click', async () => {
    clearBtn.disabled = true
    await _clearAll()
    _setPickState(pickBtn, false)
    _updateGenBtn(genBtn)
    clearBtn.disabled = false
  })

  onSceneReady(() => { pickBtn.disabled = false })
}

function _setPickState(btn, active) {
  btn.textContent = active ? '停止取点' : '开始取点'
  btn.classList.toggle('poi-tool__btn--active', active)
}

function _updateGenBtn(btn) {
  const enough = _points.length >= 2
  btn.disabled      = !enough
  btn.style.opacity = enough ? '1' : '0.4'
  if (!btn.textContent.includes('重新')) btn.textContent = '生成路径'
}
