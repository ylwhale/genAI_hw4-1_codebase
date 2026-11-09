// Presentation glue (src/app/gameView.js): the pure interaction-overlay
// decision, and the real view built on a real Three.js scene and camera with
// a stub renderer (no WebGL), so the camera can be checked against the
// simulation's eye and view direction.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4, PerspectiveCamera, Scene, Vector3 } from 'three'
import { createGameView, interactionVisuals } from '../src/app/gameView.js'
import { createSimulation } from '../src/game/simulation.js'
import { eyePosition, viewDirection } from '../src/player/player.js'
import { WORLD_SIZE } from '../src/config.js'
import { BLOCK } from '../src/world/blocks.js'
import { memoryStorage } from './helpers.js'

const HIT = Object.freeze({ x: 4, y: 7, z: 9, id: 3, normal: { x: 0, y: 1, z: 0 }, point: { x: 4.5, y: 8, z: 9.5 } })
const BREAK = Object.freeze({ kind: 'break', target: { x: 4, y: 7, z: 9 }, blockId: 3, progress: 0.4 })
const PLACE = Object.freeze({ kind: 'place', target: { x: 4, y: 8, z: 9 }, blockId: 2, progress: 0.7 })
const NONE = Object.freeze({ crack: null, preview: null, outline: null })

// Real scene and camera; the renderer only records what it was asked to do.
function fakeGfx({ compile = true, compileThrows = false } = {}) {
  const gfx = {
    scene: new Scene(),
    camera: new PerspectiveCamera(75, 16 / 9, 0.05, 400),
    overlay: null,
    renders: 0,
    compiled: [],
    renderer: { domElement: { tagName: 'CANVAS' } },
    setOverlay(scene, camera) {
      gfx.overlay = { scene, camera }
    },
    onResize(fn) {
      fn(1280, 720)
      return () => {}
    },
    render() {
      gfx.renders++
    },
    dispose() {},
  }
  gfx.camera.rotation.order = 'YXZ'
  if (compile) {
    gfx.renderer.compile = (scene, camera) => {
      const chunks = scene.getObjectByName('world-view')?.children.length ?? 0
      gfx.compiled.push({ scene, camera, visible: scene.visible, chunks })
      if (compileThrows) throw new Error('compile failed')
    }
  }
  return gfx
}

function setup(options) {
  const sim = createSimulation({ storage: memoryStorage() })
  const gfx = fakeGfx(options)
  const view = createGameView({ container: null, sim, gfx })
  return { sim, gfx, view }
}

function assertClose(actual, expected, message, epsilon = 1e-9) {
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(actual[axis] - expected[axis]) <= epsilon, `${message}: ${axis} ${actual[axis]} vs ${expected[axis]}`)
  }
}

// ---------- interactionVisuals ----------

test('interactionVisuals: the outline marks the targeted block only while idle in play', () => {
  assert.deepEqual(interactionVisuals('playing', null, { hit: HIT, mobTarget: null }), { ...NONE, outline: HIT })
  assert.deepEqual(interactionVisuals('playing', null, { hit: HIT, mobTarget: { id: 1 } }), NONE, 'a mob under the crosshair hides it')
  assert.deepEqual(interactionVisuals('playing', null, { hit: null, mobTarget: null }), NONE)
  for (const mode of ['title', 'paused', 'dead']) {
    assert.deepEqual(interactionVisuals(mode, null, { hit: HIT, mobTarget: null }), NONE, `no outline in ${mode}`)
  }
})

test('interactionVisuals: a break shows the crack (with the hit for dust) and hides the outline', () => {
  const visuals = interactionVisuals('playing', BREAK, { hit: HIT, mobTarget: null })
  assert.deepEqual(visuals, { crack: { target: BREAK.target, progress: 0.4, blockId: 3, hit: HIT }, preview: null, outline: null })
  const elsewhere = interactionVisuals('playing', BREAK, { hit: { ...HIT, x: 5 }, mobTarget: null })
  assert.equal(elsewhere.crack.hit, null, 'a hit on another block is not the mining point')
  assert.equal(interactionVisuals('playing', BREAK, null).crack.hit, null, 'no frame yet')
})

test('interactionVisuals: a placement shows the preview; both stay frozen while paused', () => {
  assert.deepEqual(interactionVisuals('playing', PLACE, { hit: HIT, mobTarget: null }), {
    crack: null,
    preview: { target: PLACE.target, progress: 0.7, blockId: 2 },
    outline: null,
  })
  assert.deepEqual(interactionVisuals('paused', PLACE, { hit: null, mobTarget: null }).preview, { target: PLACE.target, progress: 0.7, blockId: 2 })
  assert.equal(interactionVisuals('paused', BREAK, { hit: HIT, mobTarget: null }).crack.progress, 0.4)
  assert.deepEqual(interactionVisuals('title', BREAK, { hit: HIT, mobTarget: null }), NONE)
  assert.deepEqual(interactionVisuals('dead', PLACE, { hit: HIT, mobTarget: null }), NONE)
})

// ---------- camera ----------

test('while playing the camera sits at the eye and looks along the view direction', () => {
  const { sim, gfx, view } = setup()
  sim.player.yaw = 0.7
  sim.player.pitch = -0.3
  view.update(1 / 60, 'playing')
  assertClose(gfx.camera.position, eyePosition(sim.player), 'position')
  assertClose(gfx.camera.getWorldDirection(new Vector3()), viewDirection(sim.player), 'direction', 1e-6)
  assert.equal(gfx.renders, 1)
  assert.equal(gfx.overlay.scene.visible, true, 'the hand is drawn in play')
})

test('a hurt roll tilts the camera without moving the crosshair off the raycast', () => {
  const { sim, gfx, view } = setup()
  sim.player.yaw = -1.1
  sim.player.pitch = 0.2
  const source = { x: sim.player.position.x + 1, y: sim.player.position.y, z: sim.player.position.z }
  sim.events.emit('player:damaged', { amount: 10, health: 90, maxHealth: 100, source })
  view.update(1 / 60, 'playing')
  assert.notEqual(gfx.camera.rotation.z, 0, 'rolled')
  assertClose(gfx.camera.position, eyePosition(sim.player), 'position')
  assertClose(gfx.camera.getWorldDirection(new Vector3()), viewDirection(sim.player), 'direction', 1e-6)
})

test('on the title the camera orbits the island and the hand is hidden', () => {
  const { gfx, view } = setup()
  view.update(1 / 60, 'title')
  const centre = new Vector3(WORLD_SIZE / 2, 8, WORLD_SIZE / 2)
  const toCentre = centre.clone().sub(gfx.camera.position).normalize()
  assertClose(gfx.camera.getWorldDirection(new Vector3()), toCentre, 'looks at the island', 1e-6)
  assert.equal(gfx.overlay.scene.visible, false)
  view.update(1 / 60, 'dead')
  assert.equal(gfx.overlay.scene.visible, false)
})

// ---------- block events ----------

// Live particle positions, read back from the effects' instanced mesh.
function particlePositions(scene) {
  let mesh = null
  scene.getObjectByName('effects').traverse((object) => {
    if (object.isInstancedMesh) mesh = object
  })
  const matrix = new Matrix4()
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, matrix)
    return new Vector3().setFromMatrixPosition(matrix)
  })
}

const insideCell = (p, cell) => p.x > cell.x && p.x < cell.x + 1 && p.y > cell.y && p.y < cell.y + 1 && p.z > cell.z && p.z < cell.z + 1

// Regression: the placement puff was spawned inside the now-solid block,
// where collision froze it out of sight.
test('a placed block puffs debris from outside its faces, never inside the cell', () => {
  const { sim, gfx, view } = setup()
  const cell = { x: 16, y: 20, z: 16 }
  sim.world.setBlock(cell.x, cell.y, cell.z, BLOCK.STONE)
  sim.events.emit('block:placed', { ...cell, blockId: BLOCK.STONE })
  view.update(1 / 60, 'paused') // effects synced but not advanced: birth positions
  const positions = particlePositions(gfx.scene)
  assert.ok(positions.length > 0, 'a puff was emitted')
  assert.deepEqual(positions.filter((p) => insideCell(p, cell)), [])
})

test('a broken block bursts debris from its (now empty) cell', () => {
  const { sim, gfx, view } = setup()
  sim.events.emit('block:broken', { x: 16, y: 20, z: 16, blockId: BLOCK.DIRT })
  view.update(1 / 60, 'paused')
  assert.ok(particlePositions(gfx.scene).length > 0)
})

// ---------- shader warm-up ----------

test('shaders are compiled once at start-up, the hand scene with its own camera while visible', () => {
  const { gfx } = setup()
  assert.equal(gfx.compiled.length, 2)
  assert.equal(gfx.compiled[0].scene, gfx.scene)
  assert.equal(gfx.compiled[0].camera, gfx.camera)
  assert.ok(gfx.compiled[0].chunks > 0, 'the world is meshed first, so its material is compiled too')
  assert.equal(gfx.compiled[1].scene, gfx.overlay.scene)
  assert.equal(gfx.compiled[1].camera, gfx.overlay.camera)
  assert.equal(gfx.compiled[1].visible, true, 'compile() only gathers the lights of a visible scene')
})

test('a failing or missing shader warm-up never breaks start-up', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const failing = setup({ compileThrows: true })
  assert.equal(warn.mock.callCount(), 1)
  assert.equal(failing.gfx.overlay.scene.visible, true, 'hand visibility restored')
  assert.doesNotThrow(() => failing.view.update(1 / 60, 'title'))
  assert.doesNotThrow(() => setup({ compile: false }))
})
