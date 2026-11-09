// Block-face helpers behind chips, dust and the placement puff.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRng } from '../src/core/rng.js'
import { TOP_FACE, emitFromFaces, exposedFaces, sameCell } from '../src/render/blockFaces.js'
import { createParticleSystem } from '../src/render/particles.js'
import { BLOCK } from '../src/world/blocks.js'
import { createFlatWorld } from './helpers.js'
import { livePositions, overlapsCell } from './render-helpers.js'

const RECIPE = Object.freeze({
  outset: 0.02,
  margin: 0.1,
  push: [1, 2],
  scatter: 0.5,
  lift: [1, 2],
  life: [0.4, 0.6],
  size: [0.05, 0.15],
  brightness: 0.1,
  gravity: 16,
})

test('exposedFaces lists the faces open to the air; without a world, the sides and top', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  assert.deepEqual(exposedFaces(world, { x: 8, y: 3, z: 8 }), [TOP_FACE])
  assert.deepEqual(exposedFaces(world, { x: 8, y: 2, z: 8 }), [])
  world.setBlock(8, 4, 8, BLOCK.STONE)
  world.setBlock(9, 4, 8, BLOCK.STONE)
  const open = exposedFaces(world, { x: 8, y: 4, z: 8 })
  assert.equal(open.length, 4, 'top, -x, +z and -z')
  assert.ok(!open.some(([x, y]) => x === 1 || y === -1))
  const free = exposedFaces(null, { x: 0, y: 0, z: 0 })
  assert.equal(free.length, 5)
  assert.ok(free.every(([, y]) => y >= 0))
})

test('emitFromFaces starts every cube outside the cell, moving out of its face', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  const cell = { x: 8, y: 3, z: 8 }
  for (const faces of [exposedFaces(world, cell), exposedFaces(null, cell)]) {
    const particles = createParticleSystem(200)
    assert.equal(emitFromFaces(particles, createRng(5), cell, faces, 0x888888, 150, RECIPE), 150)
    for (const p of livePositions(particles)) assert.ok(!overlapsCell(p, cell, 0), JSON.stringify(p))
  }
  const particles = createParticleSystem(8)
  assert.equal(emitFromFaces(particles, createRng(1), cell, [], 0x888888, 5, RECIPE), 0, 'no open face, no debris')
  assert.equal(emitFromFaces(particles, createRng(1), cell, [TOP_FACE], 0x888888, 99, RECIPE), 8, 'clamped to capacity')
  assert.equal(emitFromFaces(particles, createRng(1), cell, [TOP_FACE], 0x888888, Number.NaN, RECIPE), 0)
})

test('sameCell compares integer cells and tolerates missing ones', () => {
  assert.equal(sameCell({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3, id: 4 }), true)
  assert.equal(sameCell({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 4 }), false)
  assert.equal(sameCell(null, { x: 1, y: 2, z: 3 }), false)
})
