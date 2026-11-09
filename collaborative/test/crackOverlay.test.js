// Mining cracks: the pure crack pattern, the overlay, and its chips and dust.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CRACK_SIZE,
  CRACK_STAGES,
  crackStage,
  crackThresholds,
  createCrackOverlay,
  generateCrackPixels,
} from '../src/render/crackOverlay.js'
import { createParticleSystem } from '../src/render/particles.js'
import { BLOCK, getBlockType } from '../src/world/blocks.js'
import { createFlatWorld } from './helpers.js'
import { livePositions, overlapsCell } from './render-helpers.js'

test('crackStage maps progress onto at least six stages', () => {
  assert.ok(CRACK_STAGES >= 6)
  assert.equal(crackStage(0), 0)
  assert.equal(crackStage(1 / CRACK_STAGES - 1e-6), 0)
  assert.equal(crackStage(1 / CRACK_STAGES), 1)
  assert.equal(crackStage(0.5), CRACK_STAGES / 2)
  assert.equal(crackStage(0.999), CRACK_STAGES - 1)
  assert.equal(crackStage(1), CRACK_STAGES - 1)
  assert.equal(crackStage(5), CRACK_STAGES - 1)
  assert.equal(crackStage(-1), 0)
  assert.equal(crackStage(Number.NaN), 0)
})

function crackCells(stage) {
  const pixels = generateCrackPixels(stage)
  const cells = new Set()
  for (let i = 0; i < CRACK_SIZE * CRACK_SIZE; i++) if (pixels[i * 4 + 3] >= 200) cells.add(i)
  return cells
}

test('cracks grow progressively: each stage contains the previous one and adds more', () => {
  let previous = crackCells(0)
  assert.ok(previous.size >= 1, 'the first impact already shows a crack')
  for (let stage = 1; stage < CRACK_STAGES; stage++) {
    const current = crackCells(stage)
    for (const cell of previous) assert.ok(current.has(cell), `stage ${stage} keeps earlier cracks`)
    assert.ok(current.size >= previous.size)
    previous = current
  }
  const last = crackCells(CRACK_STAGES - 1)
  assert.ok(last.size > crackCells(0).size * 5, 'the final stage is heavily cracked')
  assert.ok(last.size < CRACK_SIZE * CRACK_SIZE * 0.5, 'but still reads as cracks, not a solid blot')
})

test('crack patterns are deterministic, translucent and soft-edged', () => {
  assert.deepEqual(generateCrackPixels(4), generateCrackPixels(4))
  assert.deepEqual(crackThresholds(), crackThresholds())
  const pixels = generateCrackPixels(CRACK_STAGES - 1)
  const alphas = new Set()
  for (let i = 3; i < pixels.length; i += 4) alphas.add(pixels[i])
  assert.ok(alphas.has(0), 'untouched pixels stay transparent')
  assert.ok([...alphas].some((a) => a > 0 && a < 200), 'a soft halo surrounds the cracks')
  assert.equal(generateCrackPixels(99).length, CRACK_SIZE * CRACK_SIZE * 4, 'out-of-range stages clamp')
})

// --- overlay: mining dust ---------------------------------------------------------

function dustRig({ world = createFlatWorld({ size: 16, height: 16, groundTop: 3 }) } = {}) {
  const particles = createParticleSystem(256, { world })
  const spawned = []
  const spawn = particles.spawn
  particles.spawn = (p) => {
    spawned.push(p)
    return spawn(p)
  }
  const crack = createCrackOverlay({ particles, world })
  return { world, particles, crack, spawned }
}

// A crosshair hit on the +X face of block (8, 3, 8) in a flat world whose
// ground top is y = 3, so that face and the top face are open to the air.
function sideHit(world) {
  world.setBlock(8, 4, 8, BLOCK.STONE) // a block standing on the ground
  return { x: 8, y: 4, z: 8, normal: { x: 1, y: 0, z: 0 }, point: { x: 9, y: 4.4, z: 8.6 } }
}

test('mining dust starts outside the hit face, in front of the crosshair point', () => {
  const { world, crack, spawned } = dustRig()
  const hit = sideHit(world)
  crack.set(hit, 0, BLOCK.STONE, hit)
  crack.update(1 / 60)
  assert.equal(spawned.length, 4, 'one puff on the first mining frame')
  for (const p of spawned) {
    assert.ok(!overlapsCell(p, hit), 'the cube starts outside the mined block')
    assert.ok(p.x - p.size / 2 > 9, 'in front of the hit face')
    assert.ok(Math.hypot(p.x - 9.06, p.y - 4.4, p.z - 8.6) <= 0.04 + 1e-9, 'at hit.point + normal * 0.06')
    assert.ok(p.vx >= 0, 'flies away from the face')
    assert.equal(p.color, getBlockType(BLOCK.STONE).particle)
  }
})

test('mining dust never ends up inside the mined block while it falls', () => {
  const { world, crack, particles } = dustRig()
  const hit = sideHit(world)
  for (let frame = 0; frame < 60; frame++) {
    crack.set(hit, 0, BLOCK.STONE, hit)
    crack.update(1 / 60)
    particles.step(1 / 60)
    for (const p of livePositions(particles)) assert.ok(!overlapsCell(p, hit), `frame ${frame}`)
  }
})

test('mining dust comes on its own ~0.22 s clock, and never while paused', () => {
  const { world, crack, spawned } = dustRig()
  const hit = sideHit(world)
  for (let frame = 0; frame < 60; frame++) {
    crack.set(hit, 0, BLOCK.STONE, hit)
    crack.update(1 / 60)
  }
  assert.equal(spawned.length, 5 * 4, 'puffs at 0, 0.22, 0.44, 0.66 and 0.88 s')
  for (let frame = 0; frame < 120; frame++) {
    crack.set(hit, 0.5, BLOCK.STONE, hit)
    crack.update(0) // a paused game renders with dt = 0
  }
  const chips = spawned.length - 20
  assert.ok(chips > 0, 'the impact chips still fly when progress jumps')
  for (let frame = 0; frame < 15; frame++) crack.update(1 / 60)
  assert.equal(spawned.length, 20 + chips + 4, 'dust resumes once frames run again')
  const before = spawned.length
  crack.set(null)
  for (let frame = 0; frame < 30; frame++) crack.update(1 / 60)
  assert.equal(spawned.length, before, 'no dust once the crack is hidden')
})

test('without a usable hit the dust leaves the centre of an open face', () => {
  const { world, crack, spawned } = dustRig()
  const block = { x: 8, y: 3, z: 8 } // in the ground: only the top face is open
  crack.set(block, 0, BLOCK.STONE, null)
  crack.update(1 / 60)
  assert.equal(spawned.length, 4)
  for (const p of spawned) {
    assert.ok(p.y - p.size / 2 > 4, 'above the open top face')
    assert.ok(Math.hypot(p.x - 8.5, p.y - 4.06, p.z - 8.5) <= 0.04 + 1e-9)
  }
  spawned.length = 0
  const otherBlock = { x: 3, y: 3, z: 3, normal: { x: 0, y: 1, z: 0 }, point: { x: 3.5, y: 4, z: 3.5 } }
  crack.set(null)
  crack.set(block, 0, BLOCK.STONE, otherBlock)
  crack.update(1 / 60)
  assert.ok(spawned.every((p) => Math.abs(p.x - 8.5) < 0.1), 'a hit on another block is ignored')
  assert.ok(world.isSolid(8, 3, 8))
})

test('no dust when the block colour is unknown or the block is enclosed', () => {
  const particles = createParticleSystem(32)
  const silent = createCrackOverlay({ particles })
  silent.set({ x: 1, y: 1, z: 1 }, 0)
  silent.update(0.5)
  assert.equal(silent.stage, 0, 'the crack still shows')
  assert.equal(particles.count, 0, 'no colour known (no blockId, no world), no dust')

  const { crack, spawned } = dustRig()
  crack.set({ x: 8, y: 2, z: 8 }, 0, BLOCK.STONE) // below the ground top: no open face
  crack.update(1 / 60)
  assert.equal(spawned.length, 0)
})
