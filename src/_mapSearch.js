// 地图搜索定位模块 — 移植自 map-agent 的搜索功能
// 功能：正向地理编码 + AutoComplete 联想 + 搜索历史 + 多候选结果
// 仅在 2D 地图模式（卫星/标准）下可见

import { getMapInstance } from './_mapScreenshot.js'
import { getMapMode } from './_amap.js'

const HISTORY_KEY = 'miyun_map_search_history'
const MAX_HISTORY = 12

let _searchGeocoder = null
let _autoComplete = null
let _acTimer = null
let _searchMarker = null
let _searchHistory = []
let _dropdownEl = null
let _searchWrapEl = null

// ── 拼音首字母表（用于模糊匹配） ──────────────────────────────────
const _PI = {};
[
  ['a','啊阿哀哎唉挨爱碍安按暗岸案昂奥澳'],
  ['b','吧芭巴坝把百白摆拜搬半帮宝保报抱贝北备背被奔本比鼻边标别冰丙并波博不布步渤滨'],
  ['c','擦菜蚕仓藏草层差茶产长常超车陈程城赤冲出处川穿传窗春村丛昌'],
  ['d','大达打代带丹淡当岛道德灯低地电店甸定东洞都斗度断堆多垛'],
  ['e','鄂恩额峨鹅尔'],
  ['f','发法帆飞分丰逢佛福扶副富府番泛肥峰'],
  ['g','甘感港高葛格各弓公功贡沟姑鼓关管光广贵滚郭岗古谷'],
  ['h','哈海含寒汉杭好合和河黑洪红后壶湖虎花华怀黄灰回汇惠浑呼浩徽'],
  ['j','基吉积极济加甲尖间江将交焦角界节金京经井静旧巨举绝疆建街家'],
  ['k','卡开凯坎康库宽昆口克喀'],
  ['l','拉来兰狼浪老乐雷冷梨里离历利连林陵岭刘流龙陇楼路庐鹿洛泸鲁'],
  ['m','马麻买曼茂猫梅门蒙弥密面苗岷明名摩沫木牧'],
  ['n','那纳南难内宁农诺'],
  ['o','哦'],
  ['p','盆盘平坪普濮坡'],
  ['q','气齐棋秦青清泉群桥区'],
  ['r','然饶热仁人荣日'],
  ['s','萨三山陕上少绍深沈生圣石市寿蜀水顺松苏宿穗沙肃四'],
  ['t','塔台谭唐桃天田铁通图土太特吐'],
  ['w','洼湾万汪王威微文渭吴无武乌'],
  ['x','西峡仙湘香雪宣新忻邢徐喜夏县厦'],
  ['y','鸦哑延扬阳洋耀沂宜义阴迎银营永幽越云豫亚原伊'],
  ['z','泽扎章张赵浙镇正郑中周朱珠竹庄州壮'],
].forEach(([k, v]) => v.split('').forEach(c => _PI[c] = k))

function _getInitials(str) {
  return str.split('').map(c => _PI[c] || (c.toLowerCase ? c.toLowerCase()[0] : c[0]) || '').join('')
}

function _isSubsequence(query, target) {
  let qi = 0
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (query[qi] === target[ti]) qi++
  }
  return qi === query.length
}

// ── 历史管理 ────────────────────────────────────────────────────────

function _loadHistory() {
  try {
    _searchHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
  } catch { _searchHistory = [] }
}

function _saveHistory(q) {
  if (!q) return
  _searchHistory = [q, ..._searchHistory.filter(h => h !== q)].slice(0, MAX_HISTORY)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(_searchHistory))
}

// ── UI 创建 ──────────────────────────────────────────────────────────

function _createUI() {
  // 直接挂到 body，避免被 .scene-container 的 overflow:hidden + z-index 限制
  if (document.getElementById('js-map-search-wrap')) return

  _searchWrapEl = document.createElement('div')
  _searchWrapEl.id = 'js-map-search-wrap'
  _searchWrapEl.className = 'map-search-wrap'
  _searchWrapEl.style.display = 'none'
  _searchWrapEl.innerHTML = `
    <div class="map-search-row">
      <input id="js-map-search-input" class="map-search-input" type="text"
             placeholder="搜索地名、地址…" autocomplete="off">
      <button id="js-map-search-btn" class="map-search-btn">定位</button>
      <button id="js-map-detect-btn" class="map-search-btn map-detect-btn" title="智能检测">🔍</button>
    </div>
    <div id="js-map-search-dropdown" class="map-search-dropdown"></div>
  `
  document.body.appendChild(_searchWrapEl)
  _dropdownEl = document.getElementById('js-map-search-dropdown')

  // 绑定事件
  document.getElementById('js-map-search-btn').addEventListener('click', _doSearch)
  document.getElementById('js-map-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') _doSearch()
  })
  document.getElementById('js-map-search-input').addEventListener('focus', function () {
    if (_searchHistory.length) _showHistoryDropdown(this.value.trim() || null)
  })
  document.getElementById('js-map-search-input').addEventListener('input', function () {
    const q = this.value.trim()
    clearTimeout(_acTimer)
    if (!q) { _showHistoryDropdown(null); return }
    _acTimer = setTimeout(() => _autocompleteSearch(q), 250)
  })

  // 点击外部关闭下拉
  document.addEventListener('click', function (e) {
    if (!_searchWrapEl.contains(e.target)) _closeDropdown()
  })
}

// ── 下拉框操作 ───────────────────────────────────────────────────────

function _closeDropdown() {
  if (_dropdownEl) _dropdownEl.classList.remove('open')
}

// 下拉框定位由 CSS position:absolute + top:100% 处理，无需 JS

function _showHistoryDropdown(filter) {
  if (!_dropdownEl) return
  let items
  if (!filter) {
    items = _searchHistory.map(h => ({ text: h }))
  } else {
    const lq = filter.toLowerCase()
    items = _searchHistory
      .map(h => {
        const lh = h.toLowerCase()
        const ini = _getInitials(h)
        let score = 0
        if (lh.includes(lq)) score = 3
        else if (ini.includes(lq)) score = 2
        else if (_isSubsequence(lq, lh)) score = 1
        return { text: h, score }
      })
      .filter(i => i.score > 0)
      .sort((a, b) => b.score - a.score)
  }
  if (!items.length) { _closeDropdown(); return }

  _dropdownEl.innerHTML = ''

  const sep = document.createElement('div')
  sep.className = 'map-sdrop-sep'
  sep.innerHTML = `<span>历史记录</span><button class="map-sdrop-clear">清除全部</button>`
  sep.querySelector('button').addEventListener('click', e => {
    e.stopPropagation()
    _searchHistory = []
    localStorage.removeItem(HISTORY_KEY)
    _closeDropdown()
  })
  _dropdownEl.appendChild(sep)

  items.forEach(({ text }) => {
    const item = document.createElement('div')
    item.className = 'map-sdrop-item'
    item.innerHTML = `<span class="map-sdrop-icon">🕒</span><span>${_escHtml(text)}</span>`
    item.addEventListener('click', () => {
      document.getElementById('js-map-search-input').value = text
      _closeDropdown()
      _doSearch()
    })
    _dropdownEl.appendChild(item)
  })
  _dropdownEl.classList.add('open')
}

function _showCandidatesDropdown(geocodes) {
  if (!_dropdownEl) return
  _dropdownEl.innerHTML = ''

  const sep = document.createElement('div')
  sep.className = 'map-sdrop-sep'
  sep.textContent = `找到 ${geocodes.length} 个结果，请选择`
  _dropdownEl.appendChild(sep)

  geocodes.forEach(geo => {
    const item = document.createElement('div')
    item.className = 'map-sdrop-item'
    const level = geo.level || ''
    item.innerHTML = `
      <span class="map-sdrop-icon">📍</span>
      <div>
        <div>${_escHtml(geo.formattedAddress || '未知地址')}</div>
        ${level ? `<div class="map-sdrop-sub">${level}</div>` : ''}
      </div>
    `
    item.addEventListener('click', () => {
      _closeDropdown()
      _navigateToGeocode(geo)
      _saveHistory(document.getElementById('js-map-search-input').value.trim())
    })
    _dropdownEl.appendChild(item)
  })
  _dropdownEl.classList.add('open')
}

function _showAutocompleteDropdown(tips) {
  if (!_dropdownEl) return
  _dropdownEl.innerHTML = ''

  tips.slice(0, 8).forEach(tip => {
    if (!tip.name) return
    const item = document.createElement('div')
    item.className = 'map-sdrop-item'
    const district = tip.district || ''
    const addr = typeof tip.address === 'string' ? tip.address : ''
    const subText = [district, addr].filter(s => s && s !== tip.name).join(' · ')
    item.innerHTML = `
      <span class="map-sdrop-icon">📍</span>
      <div>
        <div>${_escHtml(tip.name)}</div>
        ${subText ? `<div class="map-sdrop-sub">${_escHtml(subText)}</div>` : ''}
      </div>
    `
    item.addEventListener('click', () => {
      document.getElementById('js-map-search-input').value = tip.name
      _closeDropdown()
      _saveHistory(tip.name)
      if (tip.location) {
        _flyToLocation(tip.location.getLng(), tip.location.getLat(), addr ? 16 : 13)
      } else {
        _doSearch()
      }
    })
    _dropdownEl.appendChild(item)
  })
  _dropdownEl.classList.add('open')
}

// ── 搜索逻辑 ─────────────────────────────────────────────────────────

function _autocompleteSearch(q) {
  if (!_autoComplete) { _showHistoryDropdown(q); return }
  _autoComplete.search(q, function (status, result) {
    if (status === 'complete' && result.tips && result.tips.length) {
      _showAutocompleteDropdown(result.tips)
    } else {
      _showHistoryDropdown(q)
    }
  })
}

function _doSearch() {
  const map = getMapInstance()
  if (!map || !_searchGeocoder) return

  const inp = document.getElementById('js-map-search-input')
  const btn = document.getElementById('js-map-search-btn')
  const q = inp.value.trim()
  if (!q) return

  btn.disabled = true
  inp.classList.remove('err')
  _closeDropdown()

  _searchGeocoder.getLocation(q, function (status, result) {
    btn.disabled = false
    if (status === 'complete' && result.geocodes && result.geocodes.length) {
      if (result.geocodes.length === 1) {
        _navigateToGeocode(result.geocodes[0])
        _saveHistory(q)
      } else {
        _showCandidatesDropdown(result.geocodes)
      }
    } else {
      inp.classList.add('err')
      setTimeout(() => inp.classList.remove('err'), 2000)
    }
  })
}

function _navigateToGeocode(geo) {
  const loc = geo.location
  const lvl = geo.level || ''
  let zoom = 15
  if (/国家/.test(lvl)) zoom = 5
  else if (/省|自治区/.test(lvl)) zoom = 8
  else if (/市/.test(lvl)) zoom = 11
  else if (/区|县|镇/.test(lvl)) zoom = 13
  else if (/村|路|街道|小区/.test(lvl)) zoom = 16

  _flyToLocation(loc.getLng(), loc.getLat(), zoom)
}

function _flyToLocation(lng, lat, zoom) {
  const map = getMapInstance()
  if (!map) return

  map.setZoomAndCenter(zoom, [lng, lat], false, 300)

  // 蓝色标记点，4s 自动消失
  _clearSearchMarker()
  _searchMarker = new AMap.Marker({
    position: new AMap.LngLat(lng, lat),
    anchor: 'center',
    content: '<div style="width:16px;height:16px;background:#58a6ff;border:3px solid #fff;' +
             'border-radius:50%;box-shadow:0 0 0 5px rgba(88,166,255,0.3)"></div>',
    zIndex: 200,
  })
  map.add(_searchMarker)
  setTimeout(() => _clearSearchMarker(), 4000)
}

function _clearSearchMarker() {
  if (!_searchMarker) return
  const map = getMapInstance()
  if (map) map.remove(_searchMarker)
  _searchMarker = null
}

function _escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── 公开 API ──────────────────────────────────────────────────────────

/**
 * 初始化搜索模块（在 AMap 插件加载完成后调用）
 */
export function initMapSearch() {
  _loadHistory()
  _createUI()

  // 需要 AMap.Geocoder 和 AMap.AutoComplete 插件
  if (window.AMap) {
    AMap.plugin(['AMap.Geocoder', 'AMap.AutoComplete'], function () {
      _searchGeocoder = new AMap.Geocoder({ city: '全国' })
      _autoComplete = new AMap.AutoComplete({ city: '全国' })
      console.log('[MapSearch] 搜索模块就绪')
    })
  }
}

/**
 * 设置搜索框可见性（仅在 2D 模式下显示）
 * @param {boolean} visible
 */
export function setSearchVisible(visible) {
  if (_searchWrapEl) {
    _searchWrapEl.style.display = visible ? 'block' : 'none'
    if (!visible) _closeDropdown()
  }
}

/**
 * 暴露搜索标记清理（外部调用）
 */
export { _clearSearchMarker as clearSearchMarker }