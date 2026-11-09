// Enemy spawning: valid columns only, the 9-unit hard floor (beyond the
// 8-unit exclusion radius), preference for >= 12, spacing, determinism, and
// behaviour on crowded or heavily modified worlds.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOB_RULES } from '../src/config.js'
import { bodyBox, horizontalDistance } from '../src/core/geometry.js'
import { createRng } from '../src/core/rng.js'
import { BLOCK } from '../src/world/blocks.js'
import { boxCollides } from '../src/world/physics.js'
import { findMobSpawns } from '../src/mobs/mobSpawns.js'
import { findPlayerSpawn, isPitColumn } from '../src/world/spawn.js'
import { generateWorld } from '../src/world/generator.js'
import { createWorld } from '../src/world/world.js'
import { MOB_TYPES } from '../src/mobs/mobTypes.js'
import { createFlatWorld } from './helpers.js'

const PLAN = MOB_RULES.spawnPlan
const STANDABLE = [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE]

function openWorld({ size = 32, height = 24 } = {}) {
  return createFlatWorld({ size, height, groundTop: 3, block: BLOCK.GRASS })
}

// Every column's top turns to WOOD (same height) except the listed ones, so
// only those columns can host a mob while neighbour heights stay flat.
function onlyColumns(columns, { size = 16, height = 16 } = {}) {
  const world = openWorld({ size, height })
  const keep = new Set(columns.map(([x, z]) => `${x},${z}`))
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) if (!keep.has(`${x},${z}`)) world.setBlock(x, 3, z, BLOCK.WOOD)
  }
  return world
}

const FAR_CORNER = { x: 1.5, y: 4, z: 1.5 }

// Re-checks every contracted rule for one spawn.
function assertValidSpawn(world, spawn, playerSpawn) {
  const type = MOB_TYPES[spawn.type]
  const cx = spawn.x - 0.5
  const cz = spawn.z - 0.5
  assert.ok(Number.isInteger(cx) && Number.isInteger(cz), 'column centre')
  assert.ok(cx >= 1 && cx <= world.size - 2 && cz >= 1 && cz <= world.size - 2, 'at least 1 from the edge')
  const surface = world.surfaceHeight(cx, cz)
  assert.equal(spawn.y, surface + 1, 'standing on the surface')
  assert.ok(STANDABLE.includes(world.getBlock(cx, surface, cz)), 'natural standable top')
  assert.equal(boxCollides(world, bodyBox(spawn, type.width, type.height)), false, 'body is free')
  assert.ok(spawn.y + type.height <= world.height, 'fits under the world ceiling')
  const distance = horizontalDistance(spawn, playerSpawn)
  assert.ok(distance > MOB_RULES.spawnExclusionRadius, 'outside the 8-unit exclusion radius')
  assert.ok(distance >= MOB_RULES.spawnMinDistance, 'at least the 9-unit floor')
}

test('places 3 Mosslings and 1 Stoneguard on valid, well-spaced columns beyond 12 units', () => {
  const world = openWorld()
  const playerSpawn = { x: 16.5, y: 4, z: 16.5 }
  const spawns = findMobSpawns(world, playerSpawn, PLAN)
  assert.deepEqual(spawns.map((spawn) => spawn.type), ['mossling', 'mossling', 'mossling', 'stoneguard'])
  for (const spawn of spawns) {
    assertValidSpawn(world, spawn, playerSpawn)
    assert.ok(horizontalDistance(spawn, playerSpawn) >= MOB_RULES.spawnPreferredDistance, 'preferred distance available')
  }
  for (let i = 0; i < spawns.length; i++) {
    for (let j = i + 1; j < spawns.length; j++) assert.ok(horizontalDistance(spawns[i], spawns[j]) >= 3, 'spaced apart')
  }
})

test('is deterministic, and the seed changes the layout', () => {
  const world = openWorld()
  const playerSpawn = { x: 16.5, y: 4, z: 16.5 }
  assert.deepEqual(findMobSpawns(world, playerSpawn, PLAN), findMobSpawns(world, playerSpawn, PLAN))
  assert.deepEqual(findMobSpawns(world, playerSpawn, PLAN, { seed: 5 }), findMobSpawns(world, playerSpawn, PLAN, { seed: 5 }))
  const layouts = new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(findMobSpawns(world, playerSpawn, PLAN, { seed }))))
  assert.ok(layouts.size >= 4, 'different seeds pick different columns')
})

test('falls back toward 9 units when nothing at 12+ is free, but never closer than 9', () => {
  const world = openWorld()
  const playerSpawn = { x: 16.5, y: 4, z: 16.5 }
  for (let z = 0; z < world.size; z++) {
    for (let x = 0; x < world.size; x++) {
      if (horizontalDistance({ x: x + 0.5, z: z + 0.5 }, playerSpawn) >= 12) world.setBlock(x, 4, z, BLOCK.LEAVES)
    }
  }
  const spawns = findMobSpawns(world, playerSpawn, PLAN)
  assert.equal(spawns.length, 4)
  for (const spawn of spawns) {
    assertValidSpawn(world, spawn, playerSpawn)
    assert.ok(horizontalDistance(spawn, playerSpawn) < 12)
  }
})

test('returns nothing when every free column is closer than 9 units', () => {
  const world = openWorld({ size: 14, height: 16 }) // centre (7, 7): farthest column centre is ~7.8 away
  assert.deepEqual(findMobSpawns(world, { x: 7, y: 4, z: 7 }, PLAN), [])
})

test('distance boundary: exactly 9.0 is allowed, 8.99 is not; the exclusion radius is strict', () => {
  const world = onlyColumns([[10, 5]])
  assert.equal(findMobSpawns(world, { x: 1.5, y: 4, z: 5.5 }, ['mossling']).length, 1, '9.00 units')
  assert.deepEqual(findMobSpawns(world, { x: 1.51, y: 4, z: 5.5 }, ['mossling']), [], '8.99 units')
  assert.deepEqual(findMobSpawns(world, { x: 1.5, y: 4, z: 5.5 }, ['mossling'], { exclusionRadius: 9 }), [], 'strictly beyond the radius')
  const wider = findMobSpawns(openWorld(), { x: 16.5, y: 4, z: 16.5 }, PLAN, { exclusionRadius: 13 })
  assert.equal(wider.length, 4)
  assert.ok(wider.every((spawn) => horizontalDistance(spawn, { x: 16.5, z: 16.5 }) > 13))
})

test('accepts grass, dirt, and stone tops but never tree tops, edge columns, or empty columns', () => {
  const column = [12, 12]
  const accepted = (setup) => {
    const world = onlyColumns([column])
    setup(world)
    return findMobSpawns(world, FAR_CORNER, ['mossling']).length === 1
  }
  assert.ok(accepted(() => {}), 'grass')
  assert.ok(accepted((world) => world.setBlock(12, 3, 12, BLOCK.DIRT)), 'dirt')
  assert.ok(accepted((world) => world.setBlock(12, 3, 12, BLOCK.STONE)), 'stone')
  assert.ok(!accepted((world) => world.setBlock(12, 3, 12, BLOCK.WOOD)), 'trunk top')
  assert.ok(!accepted((world) => world.setBlock(12, 4, 12, BLOCK.LEAVES)), 'canopy top')
  assert.ok(!accepted((world) => {
    for (let y = 0; y < world.height; y++) world.setBlock(12, y, 12, BLOCK.AIR)
  }), 'empty column')
  for (const [x, z] of [[0, 12], [15, 12], [12, 0], [12, 15]]) {
    assert.deepEqual(findMobSpawns(onlyColumns([[x, z]]), FAR_CORNER, ['mossling']), [], `edge column ${x},${z}`)
  }
  assert.equal(findMobSpawns(onlyColumns([[14, 12]]), FAR_CORNER, ['mossling']).length, 1, 'one in from the edge is fine')
})

test('rejects pits (2+ below all four neighbours) but accepts a shallow dip', () => {
  const pit = onlyColumns([[12, 12]])
  pit.setBlock(12, 3, 12, BLOCK.AIR)
  pit.setBlock(12, 2, 12, BLOCK.AIR)
  assert.deepEqual(findMobSpawns(pit, FAR_CORNER, ['mossling']), [])

  const dip = onlyColumns([[12, 12]])
  dip.setBlock(12, 3, 12, BLOCK.AIR)
  dip.setBlock(12, 2, 12, BLOCK.GRASS)
  assert.deepEqual(findMobSpawns(dip, FAR_CORNER, ['mossling']), [{ type: 'mossling', x: 12.5, y: 3, z: 12.5 }])
})

test('regression: wider holes are pits too, using the same rule as the player spawn', () => {
  // 1 x 2 and 2 x 2 holes 3 deep: every column has a level neighbour, which
  // the old 4-neighbour rule mistook for a way out.
  for (const [x1, z1] of [[12, 13], [13, 12], [13, 13]]) {
    const world = openWorld({ size: 16, height: 16 })
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const inHole = x >= 12 && x <= x1 && z >= 12 && z <= z1
        if (!inHole) world.setBlock(x, 3, z, BLOCK.WOOD) // only hole columns may host a mob
        else for (let y = 1; y <= 3; y++) world.setBlock(x, y, z, BLOCK.AIR)
      }
    }
    for (let z = 12; z <= z1; z++) {
      for (let x = 12; x <= x1; x++) {
        world.setBlock(x, 0, z, BLOCK.GRASS) // a grass floor 3 below the rim
        assert.equal(isPitColumn(world, x, z), true)
      }
    }
    assert.deepEqual(findMobSpawns(world, FAR_CORNER, ['mossling']), [], `${x1},${z1}: no spawn in the hole`)
  }
})

test('seed-42 player and mob spawns are pinned (unchanged by the shared pit rule)', () => {
  const world = generateWorld(createWorld(), 42)
  const playerSpawn = findPlayerSpawn(world)
  assert.deepEqual(playerSpawn, { x: 16.5, y: 8, z: 16.5 })
  assert.deepEqual(findMobSpawns(world, playerSpawn, PLAN, { seed: 42 }), [
    { type: 'mossling', x: 20.5, y: 8, z: 3.5 },
    { type: 'mossling', x: 30.5, y: 5, z: 29.5 },
    { type: 'mossling', x: 3.5, y: 8, z: 18.5 },
    { type: 'stoneguard', x: 29.5, y: 5, z: 18.5 },
  ])
})

test('the body must fit under the world ceiling, checked per mob type', () => {
  const low = onlyColumns([[12, 12]], { height: 5 }) // feet at y = 4: 0.9 fits, 1.9 does not
  assert.equal(findMobSpawns(low, FAR_CORNER, ['mossling']).length, 1)
  assert.deepEqual(findMobSpawns(low, FAR_CORNER, ['stoneguard']), [], 'would poke out of the world')
  const roomy = onlyColumns([[12, 12]], { height: 6 })
  assert.equal(findMobSpawns(roomy, FAR_CORNER, ['stoneguard']).length, 1)
})

test('relaxes spacing to distinct columns when crowded and returns as many as possible', () => {
  const block = [[11, 11], [12, 11], [11, 12], [12, 12]]
  const four = findMobSpawns(onlyColumns(block), FAR_CORNER, PLAN)
  assert.equal(four.length, 4)
  assert.equal(new Set(four.map((spawn) => `${spawn.x},${spawn.z}`)).size, 4, 'distinct columns')
  four.forEach((spawn) => assertValidSpawn(onlyColumns(block), spawn, FAR_CORNER))

  const three = findMobSpawns(onlyColumns(block.slice(0, 3)), FAR_CORNER, PLAN)
  assert.equal(three.length, 3)
  assert.equal(new Set(three.map((spawn) => `${spawn.x},${spawn.z}`)).size, 3)
})

test('the Stoneguard is placed first so it gets the only column tall enough for it', () => {
  const columns = [[10, 10], [13, 10], [10, 13], [13, 13]]
  const world = onlyColumns(columns, { height: 7 })
  // Raise three columns by two blocks: a Mossling still fits under the ceiling there, a Stoneguard does not.
  for (const [x, z] of columns.slice(0, 3)) {
    world.setBlock(x, 4, z, BLOCK.DIRT)
    world.setBlock(x, 5, z, BLOCK.STONE)
  }
  const spawns = findMobSpawns(world, FAR_CORNER, PLAN)
  assert.deepEqual(spawns.map((spawn) => spawn.type), PLAN, 'all four placed, in plan order')
  assert.deepEqual([spawns[3].x, spawns[3].y, spawns[3].z], [13.5, 4, 13.5])
  spawns.forEach((spawn) => assertValidSpawn(world, spawn, FAR_CORNER))
})

test('heavily modified worlds still yield only valid spawns, deterministically', () => {
  const rng = createRng(77)
  const world = openWorld()
  for (let i = 0; i < 700; i++) {
    const x = rng.int(0, 31)
    const z = rng.int(0, 31)
    const top = world.surfaceHeight(x, z)
    world.setBlock(x, top + 1, z, rng.pick([BLOCK.STONE, BLOCK.WOOD, BLOCK.LEAVES, BLOCK.DIRT]))
  }
  const playerSpawn = { x: 16.5, y: 10, z: 16.5 }
  const spawns = findMobSpawns(world, playerSpawn, PLAN)
  assert.ok(spawns.length >= 1)
  spawns.forEach((spawn) => assertValidSpawn(world, spawn, playerSpawn))
  assert.deepEqual(findMobSpawns(world, playerSpawn, PLAN), spawns)
})

test('rejects malformed plans and player spawns', () => {
  const world = openWorld()
  const spawn = { x: 16.5, y: 4, z: 16.5 }
  assert.throws(() => findMobSpawns(world, spawn, 'mossling'), TypeError)
  assert.throws(() => findMobSpawns(world, spawn, ['mossling', 'dragon']), /Unknown mob type/)
  assert.throws(() => findMobSpawns(world, spawn, ['toString']), /Unknown mob type/)
  assert.throws(() => findMobSpawns(world, null, PLAN), TypeError)
  assert.throws(() => findMobSpawns(world, { x: NaN, y: 4, z: 3 }, PLAN), TypeError)
  assert.deepEqual(findMobSpawns(world, spawn, []), [])
})
