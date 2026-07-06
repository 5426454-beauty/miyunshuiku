// 相机控制模块：复位按钮 → SetCameraPose 飞行到全景俯视位置
import { onSceneReady, getApp } from './_wdp.js'

// 全景最佳俯视视角参数（从场景中实测获取）
const RESET_POSE = {
  location: [116.93419640732135, 40.510541171558636, 19186.375842320991],
  rotation: {
    pitch: -89,
    yaw:   -90.539474487304688,
  },
  flyTime: 2,  // 平滑飞行 2 秒
}

/**
 * 初始化复位按钮
 * - 场景未就绪前按钮保持 disabled
 * - 就绪后激活，点击触发 SetCameraPose 飞回全景俯视
 */
export function initCameraReset() {
  const btn = document.getElementById('js-btn-reset')
  if (!btn) return

  // 场景就绪时启用按钮
  onSceneReady((App) => {
    btn.disabled = false

    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        await App.CameraControl.SetCameraPose(RESET_POSE)
      } catch (err) {
        console.error('[Camera] 复位失败', err)
      } finally {
        btn.disabled = false
      }
    })
  })
}

// ── 供 AI 模块调用的公开接口 ──────────────────────
export async function cameraReset() {
  const App = getApp()
  if (!App) return
  await App.CameraControl.SetCameraPose(RESET_POSE)
}
