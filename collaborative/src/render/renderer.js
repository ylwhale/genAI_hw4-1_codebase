// Draws the world, clears depth, then draws the optional first-person overlay.
// Browser globals are accessed only inside createRenderer.

import { NeutralToneMapping, PCFShadowMap, PerspectiveCamera, SRGBColorSpace, Scene, WebGLRenderer } from 'three'

export const CAMERA = Object.freeze({ fov: 75, near: 0.05, far: 400 })
const MAX_PIXEL_RATIO = 2
const CLEAR_COLOR = 0xc4e0f4 // horizon tint, only visible before the sky draws

// Drawing size: the container when it has a layout, otherwise the window.
export function measureViewport(container, win) {
  const width = container?.clientWidth || win?.innerWidth || 1
  const height = container?.clientHeight || win?.innerHeight || 1
  return { width, height }
}

export function pixelRatioFor(win) {
  return Math.min(win?.devicePixelRatio || 1, MAX_PIXEL_RATIO)
}

export function createRenderer(container) {
  const win = window
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  configure(renderer)
  renderer.domElement.style.display = 'block'
  renderer.domElement.addEventListener('webglcontextlost', preventDefault)
  container.appendChild(renderer.domElement)

  const scene = new Scene()
  const camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far)
  camera.rotation.order = 'YXZ'

  const listeners = new Set()
  let overlay = null
  let size = { width: 1, height: 1 }

  function resize() {
    size = measureViewport(container, win)
    renderer.setPixelRatio(pixelRatioFor(win))
    renderer.setSize(size.width, size.height)
    camera.aspect = size.width / size.height
    camera.updateProjectionMatrix()
    for (const listener of [...listeners]) listener(size.width, size.height)
  }

  // fn(width, height) runs now and after every resize; returns an unsubscribe.
  function onResize(fn) {
    if (typeof fn !== 'function') return () => {}
    listeners.add(fn)
    fn(size.width, size.height)
    return () => listeners.delete(fn)
  }

  function setOverlay(overlayScene, overlayCamera) {
    overlay = overlayScene && overlayCamera ? { scene: overlayScene, camera: overlayCamera } : null
  }

  function render() {
    renderer.clear()
    renderer.render(scene, camera)
    if (!overlay) return
    renderer.clearDepth()
    renderer.render(overlay.scene, overlay.camera)
  }

  function dispose() {
    win.removeEventListener('resize', resize)
    renderer.domElement.removeEventListener('webglcontextlost', preventDefault)
    listeners.clear()
    overlay = null
    renderer.dispose()
    renderer.domElement.remove()
  }

  resize()
  win.addEventListener('resize', resize)

  return {
    renderer,
    scene,
    camera,
    setOverlay,
    onResize,
    render,
    resize,
    dispose,
    get size() {
      return { ...size }
    },
  }
}

function configure(renderer) {
  renderer.autoClear = false // render() clears once, then layers the overlay
  renderer.setClearColor(CLEAR_COLOR, 1)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NeutralToneMapping // keeps the palette's hues, softens highlights
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
}

// Allows the browser to restore a lost WebGL context instead of giving up.
function preventDefault(event) {
  event.preventDefault()
}
