import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SKIN } from '../src/world/physics.js'
import { evaluateBreak, evaluatePlace, isPlaceableBlock, placementCell } from '../src/interaction/blockRules.js'
import { BLOCK, HOTBAR_BLOCKS } from '../src/world/blocks.js'
import { raycastBlocks } from '../src/world/raycast.js'
import { bodyBox } from '../src/core/geometry.js'
import { REACH } from '../src/config.js'
import { createFlatWorld } from './helpers.js'

// 16x16x16 world, stone ground at y = 0..3, so the walkable surface is y = 4.
function setup() {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  const eye = { x: 8.5, y: 5.62, z: 8.5 }
  return { world, eye }
}

// A lone stone pillar block at (10, 4, 8); an eye on the same row at
// x = 10 - distance is exactly `distance` from the block's nearest face.
function pillarScene(distance) {
  const { world } = setup()
  world.setBlock(10, 4, 8, BLOCK.STONE)
  return { world, hit: { x: 10, y: 4, z: 8 }, eye: { x: 10 - distance, y: 4.5, z: 8.5 } }
}

test('evaluateBreak accepts a solid, reachable block above the floor', () => {
  const { world, eye } = setup()
  assert.deepEqual(evaluateBreak(world, { x: 8, y: 3, z: 8 }, { eye }), { ok: true })
})

test('evaluateBreak reports no-target for a missing hit', () => {
  const { world, eye } = setup()
  assert.deepEqual(evaluateBreak(world, null, { eye }), { ok: false, reason: 'no-target' })
  assert.equal(evaluateBreak(world, undefined, { eye }).reason, 'no-target')
})

test('evaluateBreak rejects cells outside the world or with non-integer coordinates', () => {
  const { world, eye } = setup()
  const cells = [
    { x: -1, y: 3, z: 8 },
    { x: 16, y: 3, z: 8 },
    { x: 8, y: 3, z: 16 },
    { x: 8, y: 3, z: -1 },
    { x: 8, y: -1, z: 8 },
    { x: 8, y: 16, z: 8 },
    { x: 8.5, y: 3, z: 8 },
    { x: '8', y: 3, z: 8 },
    { y: 3, z: 8 },
  ]
  for (const cell of cells) assert.equal(evaluateBreak(world, cell, { eye }).reason, 'out-of-bounds', JSON.stringify(cell))
})

test('evaluateBreak rejects air, trusting the world over the hit id', () => {
  const { world, eye } = setup()
  assert.equal(evaluateBreak(world, { x: 8, y: 4, z: 8 }, { eye }).reason, 'air')
  world.setBlock(8, 3, 8, BLOCK.AIR)
  assert.equal(evaluateBreak(world, { x: 8, y: 3, z: 8, id: BLOCK.STONE }, { eye }).reason, 'air')
})

test('evaluateBreak protects the y = 0 world floor even when it is in reach', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 0 })
  const eye = { x: 8.5, y: 2.62, z: 8.5 }
  assert.deepEqual(evaluateBreak(world, { x: 8, y: 0, z: 8 }, { eye }), { ok: false, reason: 'protected-floor' })
  assert.equal(evaluateBreak(world, { x: 8, y: 0, z: 8 }, { eye: { x: 8.5, y: 30, z: 8.5 } }).reason, 'protected-floor')
})

test('break reach boundary: 5.99 is allowed, exactly 6 is allowed, 6.01 is out of reach', () => {
  const near = pillarScene(5.99)
  assert.ok(evaluateBreak(near.world, near.hit, { eye: near.eye }).ok)
  const exact = pillarScene(6)
  assert.ok(evaluateBreak(exact.world, exact.hit, { eye: exact.eye }).ok)
  const far = pillarScene(6.01)
  assert.deepEqual(evaluateBreak(far.world, far.hit, { eye: far.eye }), { ok: false, reason: 'out-of-reach' })
})

test('break reach is measured to the nearest point of the block, diagonals included', () => {
  const { world } = pillarScene(1)
  const hit = { x: 10, y: 4, z: 8 }
  // Offset diagonally from the block's top-west edge.
  assert.ok(evaluateBreak(world, hit, { eye: { x: 10 - 4.24, y: 5 + 4.24, z: 8.5 } }).ok) // 5.996
  assert.equal(evaluateBreak(world, hit, { eye: { x: 10 - 4.25, y: 5 + 4.25, z: 8.5 } }).reason, 'out-of-reach') // 6.010
})

test('a raycast hit distance beyond reach is rejected even if the box is close', () => {
  const { world, hit, eye } = pillarScene(2)
  assert.ok(evaluateBreak(world, { ...hit, distance: 5.99 }, { eye }).ok)
  assert.equal(evaluateBreak(world, { ...hit, distance: 6.01 }, { eye }).reason, 'out-of-reach')
  assert.equal(evaluateBreak(world, { ...hit, distance: Number.NaN }, { eye }).reason, 'out-of-reach')
  assert.ok(evaluateBreak(world, { ...hit, distance: null }, { eye }).ok, 'null distance means "not provided"')
})

test('break honours a custom reach and falls back to REACH for malformed values', () => {
  const { world, hit, eye } = pillarScene(4)
  assert.equal(evaluateBreak(world, hit, { eye, reach: 3 }).reason, 'out-of-reach')
  assert.ok(evaluateBreak(world, hit, { eye, reach: 4 }).ok)
  const far = pillarScene(6.01)
  for (const reach of [Number.NaN, -1, '10', null]) {
    assert.equal(evaluateBreak(far.world, far.hit, { eye: far.eye, reach }).reason, 'out-of-reach', String(reach))
    assert.ok(evaluateBreak(world, hit, { eye, reach }).ok, `fallback reach ${String(reach)} still allows 4 units`)
  }
  assert.equal(REACH, 6)
})

test('break without a valid eye fails closed', () => {
  const { world } = setup()
  const hit = { x: 8, y: 3, z: 8 }
  assert.equal(evaluateBreak(world, hit).reason, 'out-of-reach')
  assert.equal(evaluateBreak(world, hit, {}).reason, 'out-of-reach')
  assert.equal(evaluateBreak(world, hit, { eye: { x: Number.NaN, y: 5, z: 8 } }).reason, 'out-of-reach')
})

test('a real crosshair raycast produces a breakable hit', () => {
  const { world, eye } = setup()
  const hit = raycastBlocks(world, eye, { x: 0, y: -1, z: 0 }, REACH)
  assert.deepEqual([hit.x, hit.y, hit.z], [8, 3, 8])
  assert.ok(evaluateBreak(world, hit, { eye }).ok)
})

test('placementCell steps out of the hit face for all six normals', () => {
  const base = { x: 5, y: 5, z: 5 }
  const cases = [
    [{ x: 1, y: 0, z: 0 }, { x: 6, y: 5, z: 5 }],
    [{ x: -1, y: 0, z: 0 }, { x: 4, y: 5, z: 5 }],
    [{ x: 0, y: 1, z: 0 }, { x: 5, y: 6, z: 5 }],
    [{ x: 0, y: -1, z: 0 }, { x: 5, y: 4, z: 5 }],
    [{ x: 0, y: 0, z: 1 }, { x: 5, y: 5, z: 6 }],
    [{ x: 0, y: 0, z: -1 }, { x: 5, y: 5, z: 4 }],
  ]
  for (const [normal, expected] of cases) assert.deepEqual(placementCell({ ...base, normal }), expected)
})

test('placementCell returns null without a usable face', () => {
  assert.equal(placementCell(null), null)
  assert.equal(placementCell(undefined), null)
  assert.equal(placementCell({ x: 1, y: 1, z: 1 }), null)
  assert.equal(placementCell({ x: 1, y: 1, z: 1, normal: { x: 0, y: 0, z: 0 } }), null, 'ray started inside a block')
  assert.equal(placementCell({ x: 1, y: 1, z: 1, normal: { x: 1, y: 1, z: 0 } }), null)
  assert.equal(placementCell({ x: 1, y: 1, z: 1, normal: { x: 0.5, y: 0, z: 0 } }), null)
  assert.equal(placementCell({ x: 1, y: 1, z: 1, normal: { x: 2, y: 0, z: 0 } }), null)
  assert.equal(placementCell({ x: 1.5, y: 1, z: 1, normal: { x: 1, y: 0, z: 0 } }), null)
})

test('evaluatePlace accepts every hotbar block in a free, reachable cell', () => {
  const { world, eye } = setup()
  for (const blockId of HOTBAR_BLOCKS) {
    assert.deepEqual(evaluatePlace(world, { x: 10, y: 4, z: 8 }, { eye, blockId }), { ok: true })
  }
})

test('evaluatePlace reports no-target before anything else', () => {
  const { world, eye } = setup()
  assert.deepEqual(evaluatePlace(world, null, { eye, blockId: 99 }), { ok: false, reason: 'no-target' })
})

test('evaluatePlace rejects blocks that are not placeable', () => {
  const { world, eye } = setup()
  for (const blockId of [BLOCK.AIR, 99, -1, 1.5, '1', undefined, null]) {
    assert.equal(evaluatePlace(world, { x: 10, y: 4, z: 8 }, { eye, blockId }).reason, 'invalid-block', String(blockId))
    assert.equal(isPlaceableBlock(blockId), false)
  }
  assert.ok(HOTBAR_BLOCKS.every(isPlaceableBlock))
})

test('evaluatePlace never edits outside the world', () => {
  const { world } = setup()
  const blockId = BLOCK.DIRT
  const cells = [
    { x: -1, y: 4, z: 8 },
    { x: 16, y: 4, z: 8 },
    { x: 8, y: 4, z: -1 },
    { x: 8, y: 4, z: 16 },
    { x: 8, y: 16, z: 8 },
    { x: 8, y: -1, z: 8 },
    { x: 8, y: 4.5, z: 8 },
  ]
  for (const cell of cells) {
    const eye = { x: cell.x + 0.5, y: 5, z: cell.z + 0.5 }
    assert.equal(evaluatePlace(world, cell, { eye, blockId }).reason, 'out-of-bounds', JSON.stringify(cell))
  }
})

test('evaluatePlace rejects occupied cells', () => {
  const { world, eye } = setup()
  assert.equal(evaluatePlace(world, { x: 8, y: 3, z: 8 }, { eye, blockId: BLOCK.DIRT }).reason, 'occupied')
})

test('place reach boundary: 5.99 allowed, 6.01 out of reach, no eye fails closed', () => {
  const { world } = setup()
  const cell = { x: 10, y: 4, z: 8 }
  assert.ok(evaluatePlace(world, cell, { eye: { x: 4.01, y: 4.5, z: 8.5 }, blockId: BLOCK.STONE }).ok)
  assert.equal(evaluatePlace(world, cell, { eye: { x: 3.99, y: 4.5, z: 8.5 }, blockId: BLOCK.STONE }).reason, 'out-of-reach')
  assert.equal(evaluatePlace(world, cell, { blockId: BLOCK.STONE }).reason, 'out-of-reach')
  assert.ok(evaluatePlace(world, cell, { eye: { x: 2, y: 4.5, z: 8.5 }, reach: 8, blockId: BLOCK.STONE }).ok)
})

// Obstacle box flush against the +X side of cell (9, 4, 8), or intruding by `overlap`.
function boxTouchingCellWest(overlap) {
  return { minX: 8.4, minY: 4, minZ: 8.2, maxX: 9 + overlap, maxY: 5.8, maxZ: 8.8 }
}

test('placing flush against the player is allowed; real overlap is blocked (physics contact tolerance)', () => {
  const { world, eye } = setup()
  const cell = { x: 9, y: 4, z: 8 }
  const place = (obstacles) => evaluatePlace(world, cell, { eye, blockId: BLOCK.WOOD, obstacles })
  assert.ok(place([boxTouchingCellWest(0)]).ok)
  assert.ok(place([boxTouchingCellWest(SKIN / 2)]).ok, 'contact within the physics skin counts as flush')
  assert.deepEqual(place([boxTouchingCellWest(1e-3)]), { ok: false, reason: 'blocked-by-entity' })
  assert.equal(place([boxTouchingCellWest(SKIN * 2)]).reason, 'blocked-by-entity')
})

test('regression: a player resting slightly inside the ground skin can still place beside their feet', () => {
  // Tiny browser frames let a resting body settle up to SKIN below a block top.
  // The player straddles the edge of a ledge: half of the body hangs over the
  // empty cell (9, 4, 8) and the feet sit 0.9 * SKIN below its top face.
  const { world, eye } = setup()
  const feetBox = bodyBox({ x: 9.2, y: 5 - SKIN * 0.9, z: 8.5 }, 0.6, 1.8)
  const cellBelowFeet = { x: 9, y: 4, z: 8 }
  assert.equal(world.getBlock(9, 4, 8), BLOCK.AIR)
  assert.ok(evaluatePlace(world, cellBelowFeet, { eye, blockId: BLOCK.DIRT, obstacles: [feetBox] }).ok)
  const sunk = bodyBox({ x: 9.2, y: 5 - SKIN * 3, z: 8.5 }, 0.6, 1.8)
  assert.equal(evaluatePlace(world, cellBelowFeet, { eye, blockId: BLOCK.DIRT, obstacles: [sunk] }).reason, 'blocked-by-entity')
})

test('a block may go directly under a jumping player but not into their feet', () => {
  const { world } = setup()
  const cell = { x: 8, y: 4, z: 8 }
  const eye = { x: 8.5, y: 6.62, z: 8.5 }
  const airborne = (feetY) => [bodyBox({ x: 8.5, y: feetY, z: 8.5 }, 0.6, 1.8)]
  assert.ok(evaluatePlace(world, cell, { eye, blockId: BLOCK.DIRT, obstacles: airborne(5) }).ok)
  assert.equal(evaluatePlace(world, cell, { eye, blockId: BLOCK.DIRT, obstacles: airborne(4.999) }).reason, 'blocked-by-entity')
})

test('mob boxes block placement the same way (flush ok, 1e-3 overlap blocked)', () => {
  const { world, eye } = setup()
  const cell = { x: 10, y: 4, z: 8 }
  // A Mossling (0.7 wide, 0.9 tall) standing just east of the cell.
  const flush = bodyBox({ x: 11.35, y: 4, z: 8.5 }, 0.7, 0.9)
  const intruding = { ...flush, minX: flush.minX - 1e-3 }
  assert.ok(Math.abs(flush.minX - 11) < 1e-12)
  const mobFlush = { ...flush, minX: 11 }
  assert.ok(evaluatePlace(world, cell, { eye, blockId: BLOCK.STONE, obstacles: [mobFlush] }).ok)
  assert.equal(evaluatePlace(world, cell, { eye, blockId: BLOCK.STONE, obstacles: [intruding] }).reason, 'blocked-by-entity')
  // A Stoneguard right inside the cell.
  const stoneguard = bodyBox({ x: 10.5, y: 4, z: 8.5 }, 0.9, 1.9)
  assert.equal(evaluatePlace(world, cell, { eye, blockId: BLOCK.STONE, obstacles: [stoneguard] }).reason, 'blocked-by-entity')
})

test('every obstacle is checked and malformed entries are ignored', () => {
  const { world, eye } = setup()
  const cell = { x: 10, y: 4, z: 8 }
  const far = bodyBox({ x: 2.5, y: 4, z: 2.5 }, 0.6, 1.8)
  const inside = bodyBox({ x: 10.5, y: 4, z: 8.5 }, 0.6, 1.8)
  const options = (obstacles) => ({ eye, blockId: BLOCK.STONE, obstacles })
  assert.equal(evaluatePlace(world, cell, options([far, inside])).reason, 'blocked-by-entity')
  assert.ok(evaluatePlace(world, cell, options([null, undefined, {}, { minX: 'a' }, far])).ok)
  assert.ok(evaluatePlace(world, cell, options(null)).ok)
  assert.ok(evaluatePlace(world, cell, options('player')).ok)
  assert.ok(evaluatePlace(world, cell, { eye, blockId: BLOCK.STONE }).ok, 'obstacles default to none')
})

test('evaluatePlace checks occupancy and reach before entities', () => {
  const { world } = setup()
  const inside = bodyBox({ x: 8.5, y: 3, z: 8.5 }, 0.6, 1.8)
  const eye = { x: 8.5, y: 5.62, z: 8.5 }
  assert.equal(evaluatePlace(world, { x: 8, y: 3, z: 8 }, { eye, blockId: BLOCK.DIRT, obstacles: [inside] }).reason, 'occupied')
  const farEye = { x: 0.5, y: 4.5, z: 8.5 }
  const blocker = bodyBox({ x: 10.5, y: 4, z: 8.5 }, 0.6, 1.8)
  assert.equal(evaluatePlace(world, { x: 10, y: 4, z: 8 }, { eye: farEye, blockId: BLOCK.DIRT, obstacles: [blocker] }).reason, 'out-of-reach')
})

test('regression: looking straight down, the placement cell is the player’s own feet and is rejected', () => {
  const { world } = setup()
  const player = { x: 8.5, y: 4 + 1e-4, z: 8.5 }
  const eye = { x: player.x, y: player.y + 1.62, z: player.z }
  const hit = raycastBlocks(world, eye, { x: 0, y: -1, z: 0 }, REACH)
  const cell = placementCell(hit)
  assert.deepEqual(cell, { x: 8, y: 4, z: 8 })
  const verdict = evaluatePlace(world, cell, { eye, blockId: BLOCK.GRASS, obstacles: [bodyBox(player, 0.6, 1.8)] })
  assert.deepEqual(verdict, { ok: false, reason: 'blocked-by-entity' })
})

test('a real raycast against a wall face yields a valid placement in front of it', () => {
  const { world } = setup()
  world.setBlock(11, 5, 8, BLOCK.STONE)
  const eye = { x: 8.5, y: 5.62, z: 8.5 }
  const hit = raycastBlocks(world, eye, { x: 1, y: 0, z: 0 }, REACH)
  const cell = placementCell(hit)
  assert.deepEqual(cell, { x: 10, y: 5, z: 8 })
  const player = bodyBox({ x: 8.5, y: 4, z: 8.5 }, 0.6, 1.8)
  assert.ok(evaluatePlace(world, cell, { eye, blockId: BLOCK.LEAVES, obstacles: [player] }).ok)
})

test('rule results do not modify the world', () => {
  const { world, eye } = setup()
  const before = world.snapshot()
  evaluateBreak(world, { x: 8, y: 3, z: 8 }, { eye })
  evaluatePlace(world, { x: 9, y: 4, z: 8 }, { eye, blockId: BLOCK.STONE })
  evaluatePlace(world, { x: -1, y: 4, z: 8 }, { eye, blockId: BLOCK.STONE })
  assert.deepEqual(world.snapshot(), before)
})
