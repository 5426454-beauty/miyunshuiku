// WDP 数字孪生初始化模块
import WdpApi from 'wdpapi'

// WDP 默认配置（后端不可用时的降级值）
const WDP_CONFIG_DEFAULT = {
  url:   'https://dtp-api.51aes.com',
  order: '5370da1dcb6547214dca7a5a1282a568',
}

// 场景加载超时（秒）
const SCENE_LOAD_TIMEOUT = 90

// 从后端读取配置，失败则降级到默认值
async function _loadConfig() {
  try {
    const res = await fetch('http://localhost:3001/api/config')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const cfg = await res.json()
    return cfg.wdp ?? WDP_CONFIG_DEFAULT
  } catch (e) {
    console.warn('[WDP] 配置服务器不可用，使用默认配置', e.message)
    return WDP_CONFIG_DEFAULT
  }
}

// WDP 实例（全局共享）
let _App = null

// 场景就绪后的回调队列（供其他模块注册）
const _readyCallbacks = []

/**
 * 获取 WDP 实例
 */
export function getApp() {
  return _App
}

/**
 * 注册场景就绪回调（场景 progress >= 100 时触发）
 */
export function onSceneReady(cb) {
  _readyCallbacks.push(cb)
}

/**
 * 更新状态提示
 */
function _setStatus(text, isDone = false, isError = false) {
  const el = document.getElementById('js-scene-status')
  const txt = document.getElementById('js-status-text')
  const spinner = el?.querySelector('.loading-spinner')
  if (txt) txt.textContent = text
  if (isError && txt) txt.style.color = '#ff6432'
  if (isError && spinner) spinner.style.display = 'none'
  if (isDone && el) el.classList.add('hidden')
}

let _timeoutTimer = null
let _firstProgress = false

/**
 * 初始化并启动 WDP 场景
 */
export async function initWdp() {
  try {
    _setStatus('初始化 WDP 场景...')

    const WDP_CONFIG = await _loadConfig()
    console.log('[WDP] 配置:', { url: WDP_CONFIG.url, orderPrefix: WDP_CONFIG.order?.slice(0, 8) + '...' })

    _App = new WdpApi({
      id:    'player',          // 渲染容器 DOM id
      url:   WDP_CONFIG.url,
      order: WDP_CONFIG.order,
    })

    _setStatus('连接云渲染服务...')
    const startRes = await _App.Renderer.Start()
    console.log('[WDP] Renderer.Start 结果:', { success: startRes.success, message: startRes.message })

    if (!startRes.success) {
      _setStatus(`渲染启动失败: ${startRes.message || '口令无效或服务不可用'}`, false, true)
      console.error('[WDP] 渲染启动失败', startRes)
      return
    }

    // 超时检测：超过 SCENE_LOAD_TIMEOUT 秒无进度更新则提示
    _timeoutTimer = setTimeout(() => {
      if (!_firstProgress) {
        _setStatus('场景加载超时 — 请检查网络或刷新重试', false, true)
      }
    }, SCENE_LOAD_TIMEOUT * 1000)

    // 监听场景就绪事件
    await _App.Renderer.RegisterSceneEvent([{
      name: 'OnWdpSceneIsReady',
      func: async (res) => {
        clearTimeout(_timeoutTimer)
        _firstProgress = true
        const progress = res?.result?.progress || 0
        if (Number(progress) >= 100) {
          console.log('[WDP] 场景加载完成')
          _setStatus('场景就绪', true)
          // 通知所有已注册的就绪回调
          _readyCallbacks.forEach(cb => cb(_App))
        } else {
          _setStatus(`场景加载中 ${Number(progress)}%`)
          // 重置超时：每次有进度更新就重新计时
          clearTimeout(_timeoutTimer)
          _timeoutTimer = setTimeout(() => {
            _setStatus(`场景加载卡在 ${Number(progress)}% — 刷新重试`, false, true)
          }, SCENE_LOAD_TIMEOUT * 1000)
        }
      },
    }])

  } catch (err) {
    clearTimeout(_timeoutTimer)
    _setStatus(`初始化异常: ${err.message}`, false, true)
    console.error('[WDP] 初始化异常', err)
  }
}

// ── 坐标探测工具：场景就绪后自动记录 + 全局快捷方法 ──
let _sceneCameraInfo = null
let _sceneClickPoints = []

onSceneReady(async (App) => {
  try {
    const info = await App.CameraControl.GetCameraInfo()
    if (info?.success) {
      _sceneCameraInfo = info.result
      console.log('%c📍 场景相机位姿 %c(复制以下数据作为参考坐标)',
        'font-size:16px;color:#00d4ff', '')
      console.log(JSON.stringify(_sceneCameraInfo, null, 2))
      console.log('%c场景中心 ≈ %c[%s, %s]',
        'color:#ff0', 'color:#0f0;font-weight:bold',
        info.result.location?.[0]?.toFixed(5),
        info.result.location?.[1]?.toFixed(5))
    }
  } catch (_) {}
})

// 全局方法：在浏览器控制台输入 __getSceneCenter() 即可获取当前相机信息
window.__getSceneCenter = async function () {
  const App = getApp()
  if (!App) return console.warn('⚠ 场景尚未就绪')
  const info = await App.CameraControl.GetCameraInfo()
  if (info?.success) {
    console.log('📍 当前相机位姿:', JSON.stringify(info.result, null, 2))
    const loc = info.result.location || info.result.targetPosition
    if (loc) console.log('🎯 中心坐标 ≈ [%s, %s]', loc[0].toFixed(5), loc[1].toFixed(5))
    return info.result
  }
  return null
}

/**
 * 销毁 WDP（页面卸载时调用）
 */
export function destroyWdp() {
  clearTimeout(_timeoutTimer)
  if (_App) {
    _App.Renderer.Stop()
    _App = null
  }
}