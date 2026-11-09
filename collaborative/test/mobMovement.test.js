// Enemy movement: walking, turning, step hopping, walls, world edges,
// gravity, embedded recovery, knockback, and a long randomized soak test
// proving mobs never enter blocks or leave the world.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boxesOverlap, blockBox } from '../src/core/geometry.js'
import { createRng } from '../src/core/rng.js'
import { BLOCK } from '../src/world/blocks.js'
import { bodyCollides } from '../src/world/physics.js'
import { mobBox } from '../src/mobs/mob.js'
import { MOB_MOVEMENT, applyKnockback, moveMob } from '../src/mobs/mobMovement.js'
import { createMobManager } from '../src/mobs/mobManager.js'
import { MOB_TYPES } from '../src/mobs/mobTypes.js'
import { createFlatWorld } from './helpers.js'
import { GROUND_Y, makeMob, makeTarget, stageManager, walkIntent } from './mobs-helpers.js'

const STILL = walkIntent(0, 0, 0)
const FRAME_RATES = [1 / 30, 1 / 60, 1 / 144]

// Calls moveMob for `seconds`; returns the per-call results.
function drive(world, mob, intent, seconds, dt = 1 / 60, options = {}) {
  const results = []
  for (let i = 0; i < Math.round(seconds / dt); i++) results.push(moveMob(world, mob, intent, dt, options))
  return results
}

// Ground at y = 0..3 everywhere, plus a one-block step for x >= 8.
function stepWorld() {
  const world = createFlatWorld()
  for (let z = 0; z < world.size; z++) {
    for (let x = 8; x < world.size; x++) world.setBlock(x, GROUND_Y, z, BLOCK.STONE)
  }
  return world
}

function wallAt(world, x, height, block = BLOCK.STONE) {
  for (let z = 0; z < world.size; z++) {
    for (let y = GROUND_Y; y < GROUND_Y + height; y++) world.setBlock(x, y, z, block)
  }
}

function onTopOfStep(mob) {
  return mob.onGround && Math.abs(mob.position.y - (GROUND_Y + 1)) < 1e-3 && mob.position.x > 8
}

test('walks at the intent speed and stays on flat ground', () => {
  const world = createFlatWorld()
  for (const type of ['mossling', 'stoneguard']) {
    const mob = makeMob(type, { x: 3.5, y: GROUND_Y, z: 8.5 })
    const results = drive(world, mob, walkIntent(1, 0, MOB_TYPES[type].speed), 1)
    assert.ok(Math.abs(mob.position.x - 3.5 - MOB_TYPES[type].speed) < 0.02, `${type} covers speed x 1 s`)
    assert.ok(Math.abs(mob.position.y - GROUND_Y) < 1e-3)
    assert.equal(mob.onGround, true)
    assert.ok(results.every((result) => !result.blocked && !result.jumped))
  }
})

test('walking normalises the direction so diagonals are not faster', () => {
  const world = createFlatWorld()
  const mob = makeMob('mossling', { x: 3.5, y: GROUND_Y, z: 3.5 })
  drive(world, mob, walkIntent(3, 3, 1), 2)
  assert.ok(Math.abs(Math.hypot(mob.position.x - 3.5, mob.position.z - 3.5) - 2) < 0.03)
})

test('movement is frame-rate independent', () => {
  const finals = FRAME_RATES.map((dt) => {
    const world = stepWorld()
    const mob = makeMob('mossling', { x: 5.5, y: GROUND_Y, z: 8.5 })
    drive(world, mob, walkIntent(1, 0, 1.3), 3, dt)
    return mob.position
  })
  for (const position of finals) {
    assert.ok(Math.abs(position.x - finals[0].x) < 0.02, `x ${position.x} vs ${finals[0].x}`)
    assert.ok(Math.abs(position.y - finals[0].y) < 1e-3)
  }
})

test('turns smoothly toward the walking or facing direction (yaw 0 faces -Z)', () => {
  const world = createFlatWorld()
  const mob = makeMob('mossling', { x: 8.5, y: GROUND_Y, z: 8.5 })
  mob.yaw = 0
  moveMob(world, mob, walkIntent(1, 0, 0.5), 1 / 60)
  assert.ok(mob.yaw < 0 && mob.yaw > -Math.PI / 2, 'eases rather than snaps')
  drive(world, mob, walkIntent(1, 0, 0.5), 1)
  assert.ok(Math.abs(mob.yaw + Math.PI / 2) < 0.01, 'walking +X ends at yaw -PI/2')

  drive(world, mob, { ...STILL, faceX: 0, faceZ: 1 }, 1)
  assert.ok(Math.abs(Math.abs(mob.yaw) - Math.PI) < 0.01, 'explicit facing toward +Z')
  const before = mob.yaw
  drive(world, mob, STILL, 0.5)
  assert.equal(mob.yaw, before, 'idle keeps its heading')
})

test('turning takes the short way around and keeps yaw within [-PI, PI]', () => {
  const world = createFlatWorld()
  const mob = makeMob('mossling', { x: 8.5, y: GROUND_Y, z: 8.5 })
  mob.yaw = Math.PI - 0.1
  drive(world, mob, { ...STILL, faceX: -Math.sin(-Math.PI + 0.1), faceZ: -Math.cos(-Math.PI + 0.1) }, 0.05)
  assert.ok(Math.abs(mob.yaw) > Math.PI - 0.1, 'crosses the +-PI seam instead of spinning')
  for (let i = 0; i < 200; i++) {
    moveMob(world, mob, { ...STILL, faceX: Math.cos(i), faceZ: Math.sin(i * 1.7) }, 1 / 60)
    assert.ok(mob.yaw >= -Math.PI - 1e-9 && mob.yaw <= Math.PI + 1e-9)
  }
})

test('both mob types hop a one-block step within 2 s at 30, 60 and 144 fps', () => {
  for (const type of ['mossling', 'stoneguard']) {
    for (const dt of FRAME_RATES) {
      const world = stepWorld()
      const mob = makeMob(type, { x: 6.8, y: GROUND_Y, z: 8.5 })
      let climbedAt = null
      for (let i = 1; i <= Math.round(2 / dt) && climbedAt === null; i++) {
        const result = moveMob(world, mob, walkIntent(1, 0, MOB_TYPES[type].speed), dt)
        assert.equal(result.blocked, false, 'a hop-able step is never reported as blocked')
        assert.equal(bodyCollides(world, mob), false)
        if (onTopOfStep(mob)) climbedAt = i * dt
      }
      assert.ok(climbedAt !== null, `${type} at dt ${dt.toFixed(4)} climbs within 2 s`)
    }
  }
})

test('mobManager-driven chasers climb a one-block step within 2 s at 30, 60 and 144 fps', () => {
  for (const type of ['mossling', 'stoneguard']) {
    for (const dt of FRAME_RATES) {
      const world = stepWorld()
      const { manager, mobs } = stageManager(world, [{ type, x: 6.8, y: GROUND_Y, z: 8.5 }], { farFrom: { x: 15.5, z: 15.5 } })
      const target = makeTarget(12.5, GROUND_Y + 1, 8.5)
      let climbedAt = null
      for (let i = 1; i <= Math.round(2 / dt) && climbedAt === null; i++) {
        manager.update(dt, target)
        if (onTopOfStep(mobs[0])) climbedAt = i * dt
      }
      assert.ok(climbedAt !== null, `${type} at dt ${dt.toFixed(4)} climbs within 2 s`)
      assert.equal(mobs[0].state, 'chase')
    }
  }
})

test('a two-block wall stops the mob, is reported as blocked, and is never entered', () => {
  const world = createFlatWorld()
  wallAt(world, 8, 2)
  for (const type of ['mossling', 'stoneguard']) {
    const mob = makeMob(type, { x: 6.5, y: GROUND_Y, z: 8.5 })
    const results = drive(world, mob, walkIntent(1, 0, MOB_TYPES[type].speed), 3)
    assert.ok(mob.position.x <= 8 - mob.width / 2 + 1e-3, `${type} stops at the wall face`)
    assert.ok(mob.position.x > 8 - mob.width / 2 - 0.01, 'and is flush against it')
    assert.ok(results.some((result) => result.blocked), 'blocked is reported')
    assert.ok(results.every((result) => !result.jumped), 'no pointless hopping at a tall wall')
    assert.equal(bodyCollides(world, mob), false)
    assert.ok(Math.abs(mob.position.y - GROUND_Y) < 1e-3)
  }
})

test('trees (trunks and leaves) are walls', () => {
  const world = createFlatWorld()
  for (let y = GROUND_Y; y < GROUND_Y + 3; y++) world.setBlock(8, y, 8, BLOCK.WOOD)
  world.setBlock(8, GROUND_Y, 5, BLOCK.LEAVES)
  world.setBlock(8, GROUND_Y + 1, 5, BLOCK.LEAVES)
  const trunk = makeMob('mossling', { x: 6.5, y: GROUND_Y, z: 8.5 })
  drive(world, trunk, walkIntent(1, 0, 1.3), 3)
  assert.ok(trunk.position.x <= 8 - trunk.width / 2 + 1e-3)
  const leafy = makeMob('mossling', { x: 6.5, y: GROUND_Y, z: 5.5 })
  drive(world, leafy, walkIntent(1, 0, 1.3), 3)
  assert.ok(leafy.position.x <= 8 - leafy.width / 2 + 1e-3)
})

test('no hop without headroom above the mob, nor when its body would not fit on the step', () => {
  const lowCeiling = stepWorld()
  for (let x = 5; x < 8; x++) lowCeiling.setBlock(x, GROUND_Y + 1, 8, BLOCK.STONE) // just above a mossling's head
  const cramped = makeMob('mossling', { x: 6.8, y: GROUND_Y, z: 8.5 })
  const crampedResults = drive(lowCeiling, cramped, walkIntent(1, 0, 1.3), 2)
  assert.ok(crampedResults.every((result) => !result.jumped))
  assert.ok(crampedResults.some((result) => result.blocked))
  assert.ok(cramped.position.x < 8)

  // Overhang two blocks above the step: a short Mossling fits under it, a tall Stoneguard does not.
  const overhang = stepWorld()
  for (let x = 8; x < 11; x++) overhang.setBlock(x, GROUND_Y + 2, 8, BLOCK.STONE)
  const short = makeMob('mossling', { x: 6.8, y: GROUND_Y, z: 8.5 })
  drive(overhang, short, walkIntent(1, 0, 1.3), 2)
  assert.ok(onTopOfStep(short), 'mossling hops under the overhang')
  const tall = makeMob('stoneguard', { x: 6.8, y: GROUND_Y, z: 8.5 })
  const tallResults = drive(overhang, tall, walkIntent(1, 0, 0.8), 3)
  assert.ok(tallResults.every((result) => !result.jumped))
  assert.ok(tall.position.x < 8, 'stoneguard is stopped')
  assert.equal(bodyCollides(overhang, tall), false)
})

test('the world edge is a wall, never a step: mobs stay inside the island', () => {
  const world = createFlatWorld()
  const corners = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (const [dirX, dirZ] of corners) {
    const mob = makeMob('stoneguard', { x: 8.5 + dirX * 6, y: GROUND_Y, z: 8.5 + dirZ * 6 })
    const results = drive(world, mob, walkIntent(dirX, dirZ, 3), 3)
    const half = mob.width / 2
    assert.ok(mob.position.x >= half - 1e-6 && mob.position.x <= world.size - half + 1e-6)
    assert.ok(mob.position.z >= half - 1e-6 && mob.position.z <= world.size - half + 1e-6)
    assert.ok(results.every((result) => !result.jumped), 'the outer wall is never treated as free space')
    assert.ok(results.some((result) => result.blocked))
  }
})

test('wall contact while airborne is not reported as blocked', () => {
  const world = createFlatWorld()
  wallAt(world, 8, 6)
  const mob = makeMob('mossling', { x: 7.6, y: GROUND_Y + 2, z: 8.5 })
  mob.onGround = false
  const results = []
  while (!mob.onGround) results.push(moveMob(world, mob, walkIntent(1, 0, 1.3), 1 / 120))
  assert.ok(results.length > 10)
  assert.ok(results.every((result) => !result.blocked), 'falling along the wall is not "blocked"')
  assert.ok(results.some((result) => result.blockedX), 'even though it touched the wall')
})

test('gravity is sub-stepped: one large dt matches many small ones and never tunnels', () => {
  const world = createFlatWorld({ groundTop: 0 })
  const big = makeMob('mossling', { x: 4.5, y: 12, z: 4.5 })
  const small = makeMob('mossling', { x: 4.5, y: 12, z: 4.5 })
  big.onGround = small.onGround = false
  moveMob(world, big, STILL, 0.5)
  drive(world, small, STILL, 0.5, 1 / 120)
  assert.ok(Math.abs(big.position.y - small.position.y) < 1e-9)
  assert.ok(Math.abs(big.velocity.y - small.velocity.y) < 1e-9)
  moveMob(world, big, STILL, 2)
  assert.ok(Math.abs(big.position.y - 1) < 1e-3, 'lands on the one-block floor')
  assert.equal(big.onGround, true)
})

test('a mob falls when the ground under it is removed', () => {
  const world = createFlatWorld()
  const mob = makeMob('mossling', { x: 4.5, y: GROUND_Y, z: 4.5 })
  drive(world, mob, STILL, 0.2)
  world.setBlock(4, GROUND_Y - 1, 4, BLOCK.AIR)
  drive(world, mob, STILL, 1)
  assert.ok(Math.abs(mob.position.y - (GROUND_Y - 1)) < 1e-3)
  assert.equal(bodyCollides(world, mob), false)
})

test('an embedded mob is lifted to the nearest free space; a buried one is left in place', () => {
  const world = createFlatWorld()
  const mob = makeMob('mossling', { x: 4.5, y: GROUND_Y, z: 4.5 })
  world.setBlock(4, GROUND_Y, 4, BLOCK.DIRT)
  assert.equal(bodyCollides(world, mob), true)
  moveMob(world, mob, walkIntent(1, 0, 1), 1 / 60)
  assert.equal(bodyCollides(world, mob), false)
  assert.ok(Math.abs(mob.position.y - (GROUND_Y + 1)) < 0.01)

  const buried = makeMob('mossling', { x: 9.5, y: GROUND_Y, z: 9.5 })
  for (let y = GROUND_Y; y < GROUND_Y + 4; y++) world.setBlock(9, y, 9, BLOCK.STONE)
  const results = drive(world, buried, walkIntent(1, 0, 1), 0.5)
  assert.deepEqual(buried.position, { x: 9.5, y: GROUND_Y, z: 9.5 }, 'no teleporting onto the pillar')
  assert.equal(buried.velocity.x, 0)
  assert.ok(results.every((result) => !result.blocked && !result.jumped))
})

test('knockback shoves the mob away from the hit and fades within ~0.25 s', () => {
  const world = createFlatWorld()
  const mob = makeMob('mossling', { x: 8.5, y: GROUND_Y, z: 8.5 })
  assert.equal(applyKnockback(mob, { x: 7.5, y: GROUND_Y, z: 8.5 }), true)
  assert.ok(Math.abs(mob.knockback.x - MOB_MOVEMENT.knockbackSpeed) < 1e-9)
  assert.equal(mob.knockback.z, 0)
  drive(world, mob, STILL, 0.25)
  assert.ok(Math.hypot(mob.knockback.x, mob.knockback.z) < 0.2, 'mostly faded')
  const pushed = mob.position.x - 8.5
  assert.ok(pushed > 0.2 && pushed < 0.35, `pushed ${pushed}`)
  drive(world, mob, STILL, 0.5)
  assert.deepEqual(mob.knockback, { x: 0, z: 0 })
})

test('knockback goes through collision and cannot push a mob into a wall', () => {
  const world = createFlatWorld()
  wallAt(world, 9, 2)
  const mob = makeMob('mossling', { x: 8.5, y: GROUND_Y, z: 8.5 })
  applyKnockback(mob, { x: 7, y: GROUND_Y, z: 8.5 }, 20)
  drive(world, mob, STILL, 0.5)
  assert.ok(mob.position.x <= 9 - mob.width / 2 + 1e-3)
  assert.equal(bodyCollides(world, mob), false)
})

test('applyKnockback validates its input and handles a hit from directly overhead', () => {
  const mob = makeMob('mossling', { x: 8.5, y: GROUND_Y, z: 8.5 })
  assert.equal(applyKnockback(mob, null), false)
  assert.equal(applyKnockback(mob, { x: NaN, y: 0, z: 1 }), false)
  assert.equal(applyKnockback(mob, { x: 1, y: 0, z: 1 }, Infinity), false)
  assert.deepEqual(mob.knockback, { x: 0, z: 0 })
  mob.yaw = 0 // facing -Z
  applyKnockback(mob, { x: 8.5, y: GROUND_Y + 2, z: 8.5 })
  assert.ok(Math.abs(mob.knockback.x) < 1e-9 && mob.knockback.z > 3, 'pushed backwards (+Z)')
})

test('a separation push moves an idle mob through the same collision path', () => {
  const world = createFlatWorld()
  wallAt(world, 10, 2)
  const mob = makeMob('mossling', { x: 7.5, y: GROUND_Y, z: 8.5 })
  drive(world, mob, STILL, 1, 1 / 60, { push: { x: 1, z: 0 } })
  assert.ok(Math.abs(mob.position.x - 8.5) < 0.02)
  drive(world, mob, STILL, 3, 1 / 60, { push: { x: 1, z: 0 } })
  assert.ok(mob.position.x <= 10 - mob.width / 2 + 1e-3)
  drive(world, mob, STILL, 0.2, 1 / 60, { push: null })
  assert.equal(bodyCollides(world, mob), false)
})

test('walk animation follows the distance travelled and eases to rest', () => {
  const world = createFlatWorld()
  const mob = makeMob('mossling', { x: 3.5, y: GROUND_Y, z: 8.5 })
  drive(world, mob, walkIntent(1, 0, MOB_TYPES.mossling.wanderSpeed), 1)
  assert.ok(mob.anim.moving > 0.95, `moving ${mob.anim.moving}`)
  const cycles = []
  for (let i = 0; i < 120; i++) {
    moveMob(world, mob, walkIntent(1, 0, 1.3), 1 / 60)
    cycles.push(mob.anim.walkCycle)
  }
  assert.ok(new Set(cycles).size > 100, 'the cycle advances while walking')
  assert.ok(cycles.every((cycle) => cycle >= 0 && cycle < Math.PI * 2))
  drive(world, mob, STILL, 1)
  assert.ok(mob.anim.moving < 0.01)
  const resting = mob.anim.walkCycle
  drive(world, mob, STILL, 0.5)
  assert.equal(mob.anim.walkCycle, resting)
})

test('invalid dt and malformed intents are harmless', () => {
  const world = createFlatWorld()
  const mob = makeMob('mossling', { x: 4.5, y: GROUND_Y, z: 4.5 })
  drive(world, mob, STILL, 0.2)
  const settled = { ...mob.position }
  for (const dt of [NaN, -1, 0, Infinity, undefined]) {
    assert.deepEqual(moveMob(world, mob, walkIntent(1, 0, 1), dt), { blocked: false, jumped: false, blockedX: false, blockedZ: false })
  }
  assert.deepEqual(mob.position, settled)
  drive(world, mob, { moveX: NaN, moveZ: 1, speed: Infinity, faceX: NaN, faceZ: NaN }, 0.5)
  drive(world, mob, null, 0.5)
  drive(world, mob, { moveX: 1, moveZ: 0, speed: -2 }, 0.5)
  assert.ok(Math.abs(mob.position.x - settled.x) < 1e-9 && Math.abs(mob.position.z - settled.z) < 1e-9)
})

// --- soak test ---

function buildObstacleCourse(rng) {
  const world = createFlatWorld({ size: 24, height: 20 })
  for (let i = 0; i < 14; i++) addWall(world, rng)
  for (let i = 0; i < 5; i++) addTree(world, rng.int(3, 20), rng.int(3, 20))
  for (let i = 0; i < 8; i++) addPillar(world, rng.int(1, 22), rng.int(1, 22), rng.int(1, 5))
  for (let i = 0; i < 5; i++) digHole(world, rng.int(2, 20), rng.int(2, 20), rng.int(1, 2))
  return world
}

function addWall(world, rng) {
  const alongX = rng.chance(0.5)
  const [x0, z0, length, height] = [rng.int(1, 20), rng.int(1, 20), rng.int(3, 7), rng.int(1, 3)]
  for (let i = 0; i < length; i++) {
    for (let y = GROUND_Y; y < GROUND_Y + height; y++) world.setBlock(alongX ? x0 + i : x0, y, alongX ? z0 : z0 + i, BLOCK.STONE)
  }
}

function addTree(world, x, z) {
  for (let y = GROUND_Y; y < GROUND_Y + 4; y++) world.setBlock(x, y, z, BLOCK.WOOD)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let y = GROUND_Y + 2; y < GROUND_Y + 5; y++) if (dx || dz || y >= GROUND_Y + 4) world.setBlock(x + dx, y, z + dz, BLOCK.LEAVES)
    }
  }
}

function addPillar(world, x, z, height) {
  for (let y = GROUND_Y; y < GROUND_Y + height; y++) world.setBlock(x, y, z, BLOCK.STONE)
}

function digHole(world, x, z, depth) {
  for (let dx = 0; dx < 2; dx++) {
    for (let dz = 0; dz < 2; dz++) {
      for (let y = GROUND_Y - depth; y < GROUND_Y; y++) world.setBlock(x + dx, y, z + dz, BLOCK.AIR)
    }
  }
}

// Random edit that, like the game's placement rule, never builds into a mob.
function randomEdit(world, rng, mobs) {
  const x = rng.int(0, world.size - 1)
  const z = rng.int(0, world.size - 1)
  const surface = world.surfaceHeight(x, z)
  if (rng.chance(0.5) && surface > 1) return world.setBlock(x, surface, z, BLOCK.AIR)
  const y = surface + 1
  if (y >= world.height || mobs.some((mob) => boxesOverlap(blockBox(x, y, z), mobBox(mob), 0))) return false
  return world.setBlock(x, y, z, rng.pick([BLOCK.STONE, BLOCK.DIRT, BLOCK.LEAVES]))
}

function assertMobInsideFreeSpace(world, mob, context) {
  const { x, y, z } = mob.position
  const half = mob.width / 2
  assert.ok([x, y, z].every(Number.isFinite), `${context}: finite position`)
  assert.ok(x >= half - 1e-6 && x <= world.size - half + 1e-6, `${context}: x ${x} inside the world`)
  assert.ok(z >= half - 1e-6 && z <= world.size - half + 1e-6, `${context}: z ${z} inside the world`)
  assert.ok(y >= 1 - 1e-6 && y < world.height, `${context}: y ${y} above the floor`)
  assert.equal(bodyCollides(world, mob), false, `${context}: mob ${mob.id} (${mob.type}) is not inside a block`)
}

test('soak: mobs never enter blocks or leave the world across random terrain, edits and frame rates', () => {
  for (const seed of [1, 2, 3]) {
    const rng = createRng(1000 + seed)
    const world = buildObstacleCourse(rng)
    const manager = createMobManager({ world, seed, plan: ['mossling', 'stoneguard', 'mossling', 'stoneguard', 'mossling', 'mossling'] })
    manager.spawnAll({ x: 2.5, y: GROUND_Y, z: 2.5 })
    assert.equal(manager.mobs.length, 6)
    const target = makeTarget(12.5, GROUND_Y, 12.5)
    const seen = { states: new Set(), travelled: 0, levels: new Set() }
    let elapsed = 0
    for (let frame = 0; frame < 2400; frame++) {
      if (frame % 90 === 0) moveTarget(world, rng, target)
      if (frame % 7 === 0) randomEdit(world, rng, manager.mobs)
      const dt = rng.range(1 / 240, 1 / 15)
      const before = manager.mobs.map((mob) => ({ ...mob.position }))
      elapsed += dt
      manager.update(dt, target)
      manager.mobs.forEach((mob, i) => {
        assertMobInsideFreeSpace(world, mob, `seed ${seed} frame ${frame}`)
        seen.travelled += Math.hypot(mob.position.x - before[i].x, mob.position.z - before[i].z)
        seen.states.add(mob.state)
        if (mob.onGround) seen.levels.add(Math.round(mob.position.y))
      })
    }
    assert.ok(elapsed > 60, 'simulated more than a minute')
    assert.ok(seen.travelled > 150, `mobs actually roamed the course (${seen.travelled.toFixed(1)} units)`)
    assert.ok(seen.states.has('chase') && seen.states.has('wander'), 'both chasing and wandering happened')
    assert.ok(seen.levels.size >= 3, 'mobs stood at several terrain heights (hops and drops)')
  }
})

function moveTarget(world, rng, target) {
  const x = rng.int(1, world.size - 2)
  const z = rng.int(1, world.size - 2)
  target.position = { x: x + 0.5, y: world.surfaceHeight(x, z) + 1, z: z + 0.5 }
  target.active = rng.chance(0.85)
}
