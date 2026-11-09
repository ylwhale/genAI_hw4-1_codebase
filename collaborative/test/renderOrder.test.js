// Transparent draw order of the main scene, checked with three.js's own
// render-list sort: interaction overlays write no depth, so the sea must be
// drawn before them or it blends over them near the shore.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4, PerspectiveCamera, Scene, Vector4 } from 'three'
import { WebGLRenderLists } from 'three/src/renderers/webgl/WebGLRenderLists.js'
import { TERRAIN, WORLD_SIZE } from '../src/config.js'
import { createEffects } from '../src/render/effects.js'
import { createEnvironment } from '../src/render/environment.js'
import { RENDER_ORDER } from '../src/render/renderOrder.js'
import { BLOCK } from '../src/world/blocks.js'

// Mirrors WebGLRenderer.projectObject: a Group's renderOrder becomes the
// groupOrder of everything below it; z is the projected bounding-sphere centre.
function transparentDrawOrder(scene, camera) {
  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)
  const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  const list = new WebGLRenderLists().get(scene, 0)
  list.init()
  const visit = (object, groupOrder) => {
    if (!object.visible) return
    const order = object.isGroup ? object.renderOrder : groupOrder
    if ((object.isMesh || object.isLine) && object.material.transparent) {
      if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere()
      const centre = new Vector4().copy(object.geometry.boundingSphere.center)
      const z = centre.applyMatrix4(object.matrixWorld).applyMatrix4(projection).z
      list.push(object, object.geometry, object.material, order, z, null, camera)
    }
    for (const child of object.children) visit(child, order)
  }
  visit(scene, 0)
  list.sort(null, null)
  return list.transparent.map((item) => item.object.name)
}

// The player stands near the east shore looking out to sea, with the outline
// and a construction preview on the edge blocks in front of them.
function shoreScene() {
  const scene = new Scene()
  createEnvironment(scene)
  const effects = createEffects(scene)
  const camera = new PerspectiveCamera(75, 16 / 9, 0.05, 400)
  camera.rotation.order = 'YXZ'
  camera.position.set(WORLD_SIZE - 3.5, TERRAIN.seaLevel + 4, WORLD_SIZE / 2)
  camera.rotation.set(-0.35, -Math.PI / 2, 0)
  effects.setHighlight({ x: WORLD_SIZE - 1, y: 4, z: WORLD_SIZE / 2 - 1 })
  effects.setPlacementPreview({ x: WORLD_SIZE - 1, y: 5, z: WORLD_SIZE / 2 }, BLOCK.STONE, 0.5)
  return { scene, camera }
}

test('three draws the sea before the block highlight and every preview part', () => {
  const { scene, camera } = shoreScene()
  const order = transparentDrawOrder(scene, camera)
  const overlays = ['effects:highlight', 'preview:ghost', 'preview:fill', 'preview:frame', 'preview:ring']
  for (const name of ['sea-water', 'sea-foam', ...overlays]) assert.ok(order.includes(name), `${name} is drawn`)
  const lastSea = Math.max(order.indexOf('sea-water'), order.indexOf('sea-foam'))
  for (const name of overlays) assert.ok(order.indexOf(name) > lastSea, `${name} after the sea (${order.join(' -> ')})`)
  assert.ok(order.indexOf('sea-foam') > order.indexOf('sea-water'), 'foam over the water')
})

test('the documented layer numbers keep backdrop < sea < overlays', () => {
  assert.ok(RENDER_ORDER.backdrop < RENDER_ORDER.seaWater)
  assert.ok(RENDER_ORDER.seaWater < RENDER_ORDER.seaFoam)
  assert.ok(RENDER_ORDER.seaFoam < RENDER_ORDER.overlay)
})
