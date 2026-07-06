// POI 取点小工具：StartPickPoint + 轮询 GetPickedPoints + App.Poi 创建
import { getApp, onSceneReady } from './_wdp.js'

const _STORAGE_KEY = 'shuikujuzhen_poi_list'

let _isPicking     = false
let _iconUrl       = ''
let _labelText     = ''    // 用户输入的标注文字
let _poiObjs       = []    // 已添加的 POI 实体
let _counter       = 0
let _countEl       = null  // 计数文本节点
let _pollTimer     = null  // 轮询定时器
let _lastPickCount = 0     // 上次已处理的点数

// ── localStorage 读写 ─────────────────────────────────
function _loadStorage() {
  try { return JSON.parse(localStorage.getItem(_STORAGE_KEY) || '[]') } catch { return [] }
}
function _saveStorage(list) {
  localStorage.setItem(_STORAGE_KEY, JSON.stringify(list))
}

// ── 在拾取坐标处创建 POI 覆盖物 ──────────────────────
async function _createPoi(position, iconUrl, labelText, index) {
  const App = getApp()
  if (!App) return
  const label = labelText || `POI-${index}`
  const poi = new App.Poi({
    location: position,
    poiStyle: {
      markerNormalUrl:   iconUrl,
      markerActivateUrl: iconUrl,
      markerSize:        [48, 48],
      labelVisible:       true,
      labelContent:       [label, 'ffffffff', '18'],
      labelTop:           true,
      labelBgSize:        [160, 36],
      labelBgOffset:      [0, 0],
      textBoxWidth:       160,
    },
    bVisible:   true,
    entityName: `自定义POI-${index}`,
    customId:   `custom-poi-${index}`,
  })
  const res = await App.Scene.Add(poi, {
    calculateCoordZ: { coordZRef: 'surface', coordZOffset: 0 },
  })
  if (res.success) {
    _poiObjs.push(res.result.object)
    if (_countEl) _countEl.textContent = `已添加 ${_poiObjs.length} 个`
  } else {
    console.warn('[PoiTool] POI 创建失败', JSON.stringify(res))
  }
  return res.success
}

// ── 创建新 POI 并持久化 ───────────────────────────────
async function _addPoi(position) {
  _counter++
  const ok = await _createPoi(position, _iconUrl, _labelText, _counter)
  if (ok) {
    const list = _loadStorage()
    list.push({ position, iconUrl: _iconUrl, labelText: _labelText, index: _counter })
    _saveStorage(list)
  } else {
    _counter--
  }
}

// ── 场景 ready 后恢复历史 POI ─────────────────────────
async function _restoreFromStorage() {
  const list = _loadStorage()
  if (!list.length) return
  for (const item of list) {
    const ok = await _createPoi(item.position, item.iconUrl, item.labelText, item.index)
    if (ok) _counter = Math.max(_counter, item.index)
  }
}

// ── 开始取点 ─────────────────────────────────────────
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
        if (pos) await _addPoi(pos)
        _lastPickCount++
      }
    } catch (e) {
      console.warn('[PoiTool] 轮询异常', e)
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
      console.warn('[PoiTool] EndPickPoint 异常', e)
    }
  }
}

// ── 清空所有自定义 POI ────────────────────────────────
async function _clearAll() {
  if (_isPicking) await _stopPicking()
  for (const obj of _poiObjs) {
    try { obj.Delete() } catch (e) {
      console.warn('[PoiTool] 删除异常', e)
    }
  }
  _poiObjs  = []
  _counter  = 0
  localStorage.removeItem(_STORAGE_KEY)
  if (_countEl) _countEl.textContent = '已添加 0 个'
}

// ── 初始化工具 UI，注入到设置下拉面板 ──────────────────
export function initPoiTool() {
  // 面板挂载到 body
  const panel = document.createElement('div')
  panel.className = 'poi-tool__panel tool-float-panel'
  panel.id = 'js-poi-panel'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="tool-float-panel__header">
      <span>📍 POI取点工具</span>
      <button class="tool-float-panel__close" id="js-poi-panel-close">✕</button>
    </div>
    <div class="tool-float-panel__body">
      <div class="poi-tool__row">
        <span class="poi-tool__label">图源</span>
        <input class="poi-tool__input" id="js-poi-icon" type="text"
               placeholder="https:// 公网可访问的图片地址" />
      </div>
      <div class="poi-tool__row">
        <span class="poi-tool__label">文字</span>
        <input class="poi-tool__input" id="js-poi-label" type="text"
               placeholder="POI 标注文字（可留空）" />
      </div>
      <div class="poi-tool__row">
        <button class="poi-tool__btn poi-tool__btn--pick" id="js-poi-pick" disabled>开始取点</button>
        <button class="poi-tool__btn poi-tool__btn--clear" id="js-poi-clear">清空</button>
      </div>
      <div class="poi-tool__count" id="js-poi-count">已添加 0 个</div>
    </div>
  `
  document.body.appendChild(panel)

  // 设置卡片注入到设置下拉面板
  const dropdown = document.getElementById('js-settings-dropdown')
  if (dropdown) {
    const card = document.createElement('button')
    card.className = 'settings-card'
    card.innerHTML = '<span>📍</span><span class="settings-name">POI取点工具</span>'
    card.title = '在地图上点击取点，添加自定义 POI 标注'
    card.addEventListener('click', (e) => {
      e.stopPropagation()
      dropdown.classList.add('hidden')
      const isOpen = panel.style.display === 'block'
      panel.style.display = isOpen ? 'none' : 'block'
      if (!isOpen && _isPicking) {
        // 打开面板，恢复按钮状态
      }
    })
    // 找到工具 section，没有则创建
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
  document.getElementById('js-poi-panel-close').addEventListener('click', () => {
    panel.style.display = 'none'
  })

  const iconInput  = document.getElementById('js-poi-icon')
  const labelInput = document.getElementById('js-poi-label')
  const pickBtn    = document.getElementById('js-poi-pick')
  const clearBtn   = document.getElementById('js-poi-clear')
  _countEl         = document.getElementById('js-poi-count')

  iconInput.addEventListener('input', () => {
    _iconUrl = iconInput.value.trim()
  })

  labelInput.addEventListener('input', () => {
    _labelText = labelInput.value.trim()
  })

  pickBtn.addEventListener('click', async () => {
    if (!_iconUrl) {
      iconInput.classList.add('poi-tool__input--warn')
      iconInput.focus()
      setTimeout(() => iconInput.classList.remove('poi-tool__input--warn'), 1500)
      return
    }
    pickBtn.disabled = true
    if (_isPicking) {
      await _stopPicking()
      _setPickState(pickBtn, false)
    } else {
      await _startPicking()
      _setPickState(pickBtn, true)
    }
    pickBtn.disabled = false
  })

  clearBtn.addEventListener('click', async () => {
    clearBtn.disabled = true
    await _clearAll()
    _setPickState(pickBtn, false)
    clearBtn.disabled = false
  })

  // 场景就绪后恢复历史 POI，再解锁取点按钮
  onSceneReady(async () => {
    await _restoreFromStorage()
    pickBtn.disabled = false
  })
}

function _setPickState(btn, active) {
  btn.textContent = active ? '停止取点' : '开始取点'
  btn.classList.toggle('poi-tool__btn--active', active)
}
