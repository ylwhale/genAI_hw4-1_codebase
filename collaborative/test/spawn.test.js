import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSurfaceLookup, findPlayerSpawn, isPitColumn, isStandableGround } from '../src/world/spawn.js'
import { generateWorld } from '../src/world/generator.js'
import { createWorld } from '../src/world/world.js'
import { BLOCK } from '../src/world/blocks.js'
import { bodyBox } from '../src/core/geometry.js'
import { boxCollides } from '../src/world/physics.js'
import { PLAYER } from '../src/config.js'
import { createFlatWorld } from './helpers.js'

const CENTRE = 16
const TREE_BLOCKS = new Set([BLOCK.WOOD, BLOCK.LEAVES])
const GROUND_BLOCKS = new Set([BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE])

function islandWorld(seed = 42) {
  return generateWorld(createWorld(), seed)
}

function collides(world, spawn, { width = PLAYER.width, height = PLAYER.height } = {}) {
  return boxCollides(world, bodyBox(spawn, width, height))
}

function columnOf(spawn) {
  return { x: Math.floor(spawn.x), z: Math.floor(spawn.z) }
}

// The full contract for a regular (non-fallback) spawn.
function assertSafeSpawn(world, spawn, label = '') {
  const { x, z } = columnOf(spawn)
  assert.equal(spawn.x, x + 0.5, `${label} column centre x`)
  assert.equal(spawn.z, z + 0.5, `${label} column centre z`)
  assert.ok(x >= 1 && x <= world.size - 2 && z >= 1 && z <= world.size - 2, `${label} away from the edge`)
  const surface = world.surfaceHeight(x, z)
  assert.equal(spawn.y, surface + 1, `${label} stands on the surface`)
  assert.ok(GROUND_BLOCKS.has(world.getBlock(x, surface, z)), `${label} on natural ground`)
  assert.equal(collides(world, spawn), false, `${label} body is free`)
  assert.equal(collides(world, spawn, { height: PLAYER.height + 1 }), false, `${label} has headroom`)
  assert.equal(isPitColumn(world, x, z), false, `${label} not in a pit`)
  for (let y = spawn.y; y <= Math.floor(spawn.y + PLAYER.height) + 1; y++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        assert.ok(!TREE_BLOCKS.has(world.getBlock(x + dx, y, z + dz)), `${label} no tree at ${x + dx},${y},${z + dz}`)
      }
    }
  }
}

function fill(world, x0, x1, y0, y1, z0, z1, id) {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) world.setBlock(x, y, z, id)
    }
  }
}

test('seed 42 spawns the player on the grass at the centre of the clearing', () => {
  const world = islandWorld()
  const before = world.snapshot()
  const spawn = findPlayerSpawn(world)
  const surface = world.surfaceHeight(CENTRE, CENTRE)
  assert.deepEqual(spawn, { x: CENTRE + 0.5, y: surface + 1, z: CENTRE + 0.5 })
  assert.equal(world.getBlock(CENTRE, surface, CENTRE), BLOCK.GRASS)
  assertSafeSpawn(world, spawn)
  assert.deepEqual(findPlayerSpawn(world), spawn, 'deterministic')
  assert.deepEqual(world.snapshot(), before, 'read-only')
})

test('spawns are safe on every generated island', () => {
  for (const seed of [0, 1, 7, 99, 1234, 31337]) {
    const world = islandWorld(seed)
    assertSafeSpawn(world, findPlayerSpawn(world), `seed ${seed}`)
  }
})

test('flat worlds spawn on the centre column', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  assert.deepEqual(findPlayerSpawn(world), { x: 8.5, y: 4, z: 8.5 })
})

test('a tower built up to the ceiling over the centre is avoided', () => {
  const world = islandWorld()
  const surface = world.surfaceHeight(CENTRE, CENTRE)
  fill(world, CENTRE, CENTRE, surface + 1, world.height - 1, CENTRE, CENTRE, BLOCK.STONE)
  const spawn = findPlayerSpawn(world)
  assertSafeSpawn(world, spawn, 'tower')
  assert.notDeepEqual(columnOf(spawn), { x: CENTRE, z: CENTRE })
  assert.ok(spawn.y + PLAYER.height <= world.height, 'inside the world, not on the tower top')
  const { x, z } = columnOf(spawn)
  assert.equal(Math.max(Math.abs(x - CENTRE), Math.abs(z - CENTRE)), 1, 'right next to it')
})

test('a shaft dug down to the floor at the centre is avoided', () => {
  const world = islandWorld()
  const surface = world.surfaceHeight(CENTRE, CENTRE)
  fill(world, CENTRE, CENTRE, 1, surface, CENTRE, CENTRE, BLOCK.AIR)
  assert.equal(world.surfaceHeight(CENTRE, CENTRE), 0)
  assert.equal(isPitColumn(world, CENTRE, CENTRE), true)
  const spawn = findPlayerSpawn(world)
  assertSafeSpawn(world, spawn, 'shaft')
  assert.equal(spawn.y, surface + 1, 'on the surrounding ground')
})

test('pit boundary: a 1-deep dip is fine, a 2-deep hole is rejected', () => {
  const shallow = createFlatWorld({ size: 16, height: 16, groundTop: 5 })
  shallow.setBlock(8, 5, 8, BLOCK.AIR)
  assert.equal(isPitColumn(shallow, 8, 8), false)
  assert.deepEqual(findPlayerSpawn(shallow), { x: 8.5, y: 5, z: 8.5 })

  const deep = createFlatWorld({ size: 16, height: 16, groundTop: 5 })
  fill(deep, 8, 8, 4, 5, 8, 8, BLOCK.AIR)
  assert.equal(isPitColumn(deep, 8, 8), true)
  const spawn = findPlayerSpawn(deep)
  assert.notDeepEqual(columnOf(spawn), { x: 8, z: 8 })
  assert.equal(spawn.y, 6)
})

// Updated deliberately (review logic-bugs:L3): widening a hole used to make
// it "not a pit" because one neighbour was level. A pit is now any hole the
// body cannot walk or hop out of within 4 columns, however wide.
test('a widened hole is still a pit; a trench that runs 4 columns out is not', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 5 })
  fill(world, 8, 8, 3, 5, 8, 8, BLOCK.AIR) // 3-deep hole
  assert.equal(isPitColumn(world, 8, 8), true)
  fill(world, 9, 9, 3, 5, 8, 8, BLOCK.AIR) // widen it east: still no way out
  assert.equal(isPitColumn(world, 8, 8), true)
  assert.equal(isPitColumn(world, 9, 8), true)
  fill(world, 10, 12, 3, 5, 8, 8, BLOCK.AIR) // a trench reaching 4 columns from (8, 8)
  assert.equal(isPitColumn(world, 8, 8), false, 'reaches the search radius')
  assert.equal(isPitColumn(world, 9, 8), true, 'only 3 columns of trench east of (9, 8), 1 west')
})

test('a hole with a staircase of 1-block steps is not a pit; a 2-block step is no way out', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 5 })
  fill(world, 8, 8, 3, 5, 8, 8, BLOCK.AIR) // floor at y = 2, 3 below the ground
  fill(world, 9, 9, 4, 5, 8, 8, BLOCK.AIR) // a step at y = 3 next to it
  assert.equal(isPitColumn(world, 8, 8), true, 'from the step the ground is still 2 up')
  world.setBlock(10, 5, 8, BLOCK.AIR) // a second step at y = 4
  assert.equal(isPitColumn(world, 8, 8), false, '2 -> 3 -> 4 -> 5 climbs out')
})

test('pillar tops and slopes are never pits; drops are allowed', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  fill(world, 8, 8, 4, 8, 8, 8, BLOCK.STONE) // a 5-high pillar
  assert.equal(isPitColumn(world, 8, 8), false, 'jumping down is a way out')
  const slope = createFlatWorld({ size: 16, height: 16, groundTop: 1 })
  for (let x = 0; x < 16; x++) fill(slope, x, x, 2, 2 + Math.floor(x / 2), 0, 15, BLOCK.DIRT)
  for (let x = 1; x < 15; x++) assert.equal(isPitColumn(slope, x, 8), false, `slope column ${x}`)
})

test('the pit search stays inside the world near the border', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 5 })
  fill(world, 1, 2, 2, 5, 1, 2, BLOCK.AIR) // a 2 x 2 hole in the corner
  assert.equal(isPitColumn(world, 1, 1), true)
  assert.equal(isPitColumn(world, 0, 0), false, 'the border column itself walks along the edge')
})

test('a cached surface lookup gives the same answers', () => {
  const world = islandWorld()
  fill(world, CENTRE, CENTRE + 1, 3, world.surfaceHeight(CENTRE, CENTRE), CENTRE, CENTRE + 1, BLOCK.AIR)
  const surfaceAt = createSurfaceLookup(world)
  for (let z = 10; z < 22; z++) {
    for (let x = 10; x < 22; x++) assert.equal(isPitColumn(world, x, z, surfaceAt), isPitColumn(world, x, z), `${x},${z}`)
  }
  assert.equal(surfaceAt(CENTRE, CENTRE), 2)
})

test('regression: 1 x 2 and 2 x 2 holes dug 5 deep at the centre are never the spawn', () => {
  const holes = [
    { label: '1x2', x1: CENTRE, z1: CENTRE + 1 },
    { label: '2x1', x1: CENTRE + 1, z1: CENTRE },
    { label: '2x2', x1: CENTRE + 1, z1: CENTRE + 1 },
  ]
  for (const { label, x1, z1 } of holes) {
    const world = islandWorld()
    const surface = world.surfaceHeight(CENTRE, CENTRE)
    const floor = surface - 5
    fill(world, CENTRE, x1, floor + 1, surface, CENTRE, z1, BLOCK.AIR)
    assert.equal(world.surfaceHeight(CENTRE, CENTRE), floor)
    assert.equal(isPitColumn(world, CENTRE, CENTRE), true, `${label}: the hole floor is a pit`)
    const spawn = findPlayerSpawn(world)
    assertSafeSpawn(world, spawn, label)
    assert.ok(spawn.y > floor + 1, `${label}: not at the bottom of the hole (y ${spawn.y})`)
    const { x, z } = columnOf(spawn)
    const inHole = x >= CENTRE && x <= x1 && z >= CENTRE && z <= z1
    assert.equal(inHole, false, `${label}: outside the hole`)
  }
})

test('isStandableGround accepts grass, dirt and stone only', () => {
  assert.deepEqual(
    [BLOCK.AIR, BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.WOOD, BLOCK.LEAVES, 99].map(isStandableGround),
    [false, true, true, true, false, false, false],
  )
})

test('a roof built over the centre: the player spawns on top of it', () => {
  const world = islandWorld()
  const roofY = world.surfaceHeight(CENTRE, CENTRE) + 3
  fill(world, CENTRE - 4, CENTRE + 4, roofY, roofY, CENTRE - 4, CENTRE + 4, BLOCK.STONE)
  const spawn = findPlayerSpawn(world)
  assertSafeSpawn(world, spawn, 'roof')
  assert.deepEqual(spawn, { x: CENTRE + 0.5, y: roofY + 1, z: CENTRE + 0.5 })
})

test('trees next to the centre push the spawn away from them', () => {
  const world = islandWorld()
  const surface = world.surfaceHeight(CENTRE, CENTRE)
  fill(world, CENTRE + 1, CENTRE + 1, surface + 1, surface + 4, CENTRE, CENTRE, BLOCK.WOOD)
  fill(world, CENTRE - 1, CENTRE + 3, surface + 3, surface + 4, CENTRE - 2, CENTRE + 2, BLOCK.LEAVES)
  world.setBlock(CENTRE + 1, surface + 3, CENTRE, BLOCK.WOOD) // leaves filled over the trunk; restore it
  world.setBlock(CENTRE + 1, surface + 4, CENTRE, BLOCK.WOOD)
  const spawn = findPlayerSpawn(world)
  assertSafeSpawn(world, spawn, 'tree')
  const { x, z } = columnOf(spawn)
  assert.ok(Math.abs(x - (CENTRE + 1)) >= 2 || Math.abs(z - CENTRE) >= 2, 'not touching the trunk')
})

test('tree tops are never a spawn surface', () => {
  const world = islandWorld()
  const surface = world.surfaceHeight(CENTRE, CENTRE)
  fill(world, CENTRE - 2, CENTRE + 2, surface + 1, surface + 1, CENTRE - 2, CENTRE + 2, BLOCK.LEAVES)
  const spawn = findPlayerSpawn(world)
  assertSafeSpawn(world, spawn, 'leaves')
  const { x, z } = columnOf(spawn)
  assert.ok(Math.max(Math.abs(x - CENTRE), Math.abs(z - CENTRE)) >= 3, 'outside the leaf patch')
})

test('the search prefers the nearest valid column (rings, then distance)', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  world.setBlock(8, 4, 8, BLOCK.LEAVES) // a bush blocks only the centre column
  // Its neighbours are rejected too (a leaf next to the body), so the first
  // free column is two blocks out along an axis.
  const spawn = findPlayerSpawn(world)
  assert.deepEqual(spawn, { x: 8.5, y: 4, z: 6.5 })
})

test('wide bodies need headroom across every column they overlap', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  // Feet at y=4, head at 5.8: cell y=6 is the extra headroom block.
  world.setBlock(9, 6, 8, BLOCK.STONE) // floating block in the headroom of a wide body
  assert.deepEqual(findPlayerSpawn(world), { x: 8.5, y: 4, z: 8.5 }, 'a 0.6-wide player is unaffected')
  const wide = findPlayerSpawn(world, { width: 1.2, height: 1.8 })
  assert.notDeepEqual(columnOf(wide), { x: 8, z: 8 })
  assert.equal(collides(world, wide, { width: 1.2, height: 2.8 }), false)

  world.setBlock(9, 6, 8, BLOCK.AIR)
  world.setBlock(9, 7, 8, BLOCK.STONE) // one block higher clears the headroom
  assert.deepEqual(findPlayerSpawn(world, { width: 1.2, height: 1.8 }), { x: 8.5, y: 4, z: 8.5 })
})

test('border columns are never chosen', () => {
  const world = createFlatWorld({ size: 3, height: 8, groundTop: 1 })
  assert.deepEqual(findPlayerSpawn(world), { x: 1.5, y: 2, z: 1.5 })

  // Only the border ring is open ground; the interior is walled up to the
  // ceiling, so the fallback stands on top of it rather than on the edge.
  const walled = createFlatWorld({ size: 5, height: 8, groundTop: 1 })
  fill(walled, 1, 3, 2, 7, 1, 3, BLOCK.STONE)
  const spawn = findPlayerSpawn(walled)
  assert.deepEqual(spawn, { x: 2.5, y: 8, z: 2.5 })
  assert.equal(collides(walled, spawn), false)
})

test('fallback: an island buried under leaves still yields a free spot at the centre', () => {
  const world = islandWorld()
  for (let z = 0; z < world.size; z++) {
    for (let x = 0; x < world.size; x++) world.setBlock(x, world.surfaceHeight(x, z) + 1, z, BLOCK.LEAVES)
  }
  const spawn = findPlayerSpawn(world)
  assert.equal(spawn.x, CENTRE + 0.5)
  assert.equal(spawn.z, CENTRE + 0.5)
  assert.equal(spawn.y, world.surfaceHeight(CENTRE, CENTRE) + 1)
  assert.equal(collides(world, spawn), false)
})

test('fallback: a world filled to the ceiling spawns on top, above the world', () => {
  const world = createFlatWorld({ size: 8, height: 8, groundTop: 7 })
  const spawn = findPlayerSpawn(world)
  assert.deepEqual(spawn, { x: 4.5, y: 8, z: 4.5 })
  assert.equal(collides(world, spawn), false)
})

test('fallback: an empty world spawns on the floor of the collision view', () => {
  const world = createWorld()
  const spawn = findPlayerSpawn(world)
  assert.deepEqual(spawn, { x: CENTRE + 0.5, y: 0, z: CENTRE + 0.5 })
  assert.equal(collides(world, spawn), false)
})

test('invalid body dimensions are rejected', () => {
  const world = createFlatWorld()
  for (const body of [{ width: 0 }, { height: -1 }, { width: NaN }, { height: Infinity }, { width: '0.6' }]) {
    assert.throws(() => findPlayerSpawn(world, body), RangeError, JSON.stringify(body))
  }
})
