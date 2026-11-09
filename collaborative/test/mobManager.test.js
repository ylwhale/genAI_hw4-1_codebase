// Mob entities and the mob manager: type stats, entity helpers, damage and
// death, the update loop (wander/chase/attack through real worlds), strike
// cadence at several frame rates, walls, inactive targets, and reset.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOB_RULES } from '../src/config.js'
import { createEventBus } from '../src/core/events.js'
import { horizontalDistance } from '../src/core/geometry.js'
import { BLOCK } from '../src/world/blocks.js'
import { bodyCollides } from '../src/world/physics.js'
import { MOB_ANIM, createMob, damageMob, isMobAlive, mobBox, mobCenter, mobEyePosition } from '../src/mobs/mob.js'
import { createMobManager } from '../src/mobs/mobManager.js'
import { MOB_TYPES, MOB_TYPE_KEYS, getMobType } from '../src/mobs/mobTypes.js'
import { createFlatWorld } from './helpers.js'
import { GROUND_Y, makeMob, makeTarget, recordEvents, runManager, stageManager } from './mobs-helpers.js'

const FRAME_RATES = [1 / 30, 1 / 60, 1 / 144]
const EVENT_TYPES = ['mob:spawned', 'mob:hurt', 'mob:killed', 'mob:attack', 'mob:removed']
const PLAYER_SPAWN = { x: 16.5, y: GROUND_Y, z: 16.5 }

function openWorld() {
  return createFlatWorld({ size: 32, height: 24, groundTop: 3, block: BLOCK.GRASS })
}

function spawnedManager(options = {}) {
  const world = openWorld()
  const events = createEventBus()
  const log = recordEvents(events, EVENT_TYPES)
  const manager = createMobManager({ world, events, ...options })
  manager.spawnAll(PLAYER_SPAWN)
  return { world, events, log, manager }
}

// One mob 1.2 units north of a stationary target in open terrain.
function duel(type = 'mossling', distance = 1.2) {
  const world = createFlatWorld()
  const staged = stageManager(world, [{ type, x: 8.5, y: GROUND_Y, z: 8.5 - distance }], { farFrom: { x: 15.5, z: 15.5 } })
  const log = recordEvents(staged.events, EVENT_TYPES)
  return { world, ...staged, mob: staged.mobs[0], log, target: makeTarget(8.5, GROUND_Y, 8.5) }
}

// --- types and entities ---

test('mob types carry the exact extension stats and are frozen', () => {
  assert.deepEqual(MOB_TYPE_KEYS, ['mossling', 'stoneguard'])
  const stats = (type) => [type.maxHealth, type.damage, type.speed]
  assert.deepEqual(stats(MOB_TYPES.mossling), [40, 10, 1.3])
  assert.deepEqual(stats(MOB_TYPES.stoneguard), [60, 15, 0.8])
  assert.ok(MOB_TYPE_KEYS.every((key) => MOB_TYPES[key].jumpSpeed === 8.4 && MOB_TYPES[key].key === key))
  assert.ok(MOB_TYPES.stoneguard.height > MOB_TYPES.mossling.height, 'stoneguard is the larger one')
  assert.ok(Object.isFrozen(MOB_TYPES) && Object.isFrozen(MOB_TYPES.mossling) && Object.isFrozen(MOB_TYPES.stoneguard))
  assert.equal(getMobType('stoneguard'), MOB_TYPES.stoneguard)
  assert.equal(getMobType('dragon'), null)
  assert.equal(getMobType('toString'), null)
})

test('createMob builds the contracted entity with a copied position', () => {
  const position = { x: 3.5, y: 4, z: 7.5 }
  const mob = createMob('stoneguard', position, { seed: 3 })
  position.x = 99
  assert.deepEqual(mob.position, { x: 3.5, y: 4, z: 7.5 })
  assert.equal(mob.type, 'stoneguard')
  assert.deepEqual(mob.velocity, { x: 0, y: 0, z: 0 })
  assert.deepEqual([mob.width, mob.height, mob.eyeHeight], [0.9, 1.9, 1.55])
  assert.deepEqual([mob.health, mob.maxHealth], [60, 60])
  assert.equal(mob.state, 'wander')
  assert.equal(mob.onGround, false)
  assert.equal(mob.attackCooldown, 0)
  assert.equal(mob.windup, 0)
  assert.equal(mob.wander.mode, 'idle')
  assert.ok(mob.wander.timer > 0)
  assert.deepEqual(mob.anim, { walkCycle: 0, moving: 0, attackTimer: 0, hurtTimer: 0, deathTimer: 0 })
  assert.ok(mob.yaw >= -Math.PI && mob.yaw <= Math.PI)
  assert.equal(typeof mob.rng.next, 'function')
})

test('mob ids are unique for the whole session; explicit ids are honoured', () => {
  const ids = Array.from({ length: 50 }, () => createMob('mossling', { x: 1, y: 1, z: 1 }).id)
  assert.equal(new Set(ids).size, 50)
  assert.ok(ids.every((id, i) => i === 0 || id > ids[i - 1]))
  assert.equal(createMob('mossling', { x: 1, y: 1, z: 1 }, { id: 'custom' }).id, 'custom')
})

test('createMob rejects unknown types and invalid positions', () => {
  assert.throws(() => createMob('dragon', { x: 1, y: 1, z: 1 }), /Unknown mob type/)
  assert.throws(() => createMob('mossling', null), TypeError)
  assert.throws(() => createMob('mossling', { x: 1, y: NaN, z: 1 }), TypeError)
})

test('mob geometry helpers: feet-centred box, eye, and centre', () => {
  const mob = createMob('mossling', { x: 2, y: 4, z: 6 })
  assert.deepEqual(mobBox(mob), { minX: 1.65, minY: 4, minZ: 5.65, maxX: 2.35, maxY: 4.9, maxZ: 6.35 })
  assert.deepEqual(mobEyePosition(mob), { x: 2, y: 4.6, z: 6 })
  assert.deepEqual(mobCenter(mob), { x: 2, y: 4.45, z: 6 })
})

test('damageMob reduces health, clamps at 0, and starts the death animation once', () => {
  const mob = makeMob('mossling')
  mob.velocity = { x: 1, y: 2, z: 3 }
  assert.deepEqual(damageMob(mob, 25), { applied: 25, killed: false })
  assert.equal(mob.health, 15)
  assert.equal(mob.anim.hurtTimer, MOB_ANIM.hurtDuration)
  assert.equal(isMobAlive(mob), true)
  assert.deepEqual(damageMob(mob, 25), { applied: 15, killed: true }, 'only the remaining health is applied')
  assert.equal(mob.health, 0)
  assert.equal(mob.state, 'dying')
  assert.equal(mob.anim.deathTimer, MOB_ANIM.deathDuration)
  assert.deepEqual(mob.velocity, { x: 0, y: 0, z: 0 })
  assert.equal(isMobAlive(mob), false)
  assert.deepEqual(damageMob(mob, 25), { applied: 0, killed: false }, 'dying mobs ignore further hits')
})

test('damageMob ignores non-finite and non-positive amounts', () => {
  const mob = makeMob('stoneguard')
  for (const amount of [NaN, Infinity, -Infinity, 0, -5, undefined, '10']) {
    assert.deepEqual(damageMob(mob, amount), { applied: 0, killed: false })
  }
  assert.equal(mob.health, 60)
  assert.equal(mob.anim.hurtTimer, 0)
})

// --- spawning through the manager ---

test('spawnAll creates 3 Mosslings and 1 Stoneguard in valid spots and announces each', () => {
  const { world, log, manager } = spawnedManager()
  const mobs = manager.mobs
  assert.deepEqual(mobs.map((mob) => mob.type).sort(), ['mossling', 'mossling', 'mossling', 'stoneguard'])
  assert.deepEqual(log['mob:spawned'].map((event) => event.mob), mobs)
  for (const mob of mobs) {
    assert.equal(bodyCollides(world, mob), false)
    assert.ok(horizontalDistance(mob.position, PLAYER_SPAWN) > MOB_RULES.spawnExclusionRadius)
    assert.equal(mob.health, mob.maxHealth)
  }
  manager.mobs.push('junk')
  assert.equal(manager.mobs.length, 4, 'the mobs getter hands out a copy')
})

test('an empty plan yields no mobs and no attacks', () => {
  const { manager } = spawnedManager({ plan: [] })
  assert.deepEqual(manager.mobs, [])
  assert.deepEqual(manager.update(1 / 60, makeTarget(16.5, GROUND_Y, 16.5)), [])
})

// --- behaviour through the manager ---

test('mobs wander when the player is far away', () => {
  const { manager } = spawnedManager()
  const start = manager.mobs.map((mob) => ({ ...mob.position }))
  const strikes = runManager(manager, 20, 1 / 60, makeTarget(-100, GROUND_Y, -100))
  assert.deepEqual(strikes, [])
  assert.ok(manager.mobs.every((mob) => mob.state === 'wander'))
  const moved = manager.mobs.filter((mob, i) => horizontalDistance(mob.position, start[i]) > 0.5)
  assert.ok(moved.length >= 3, 'they roam around')
})

test('mobs chase when the player approaches within 10 units', () => {
  const world = createFlatWorld({ size: 24, height: 16 })
  const { manager, mobs } = stageManager(world, [{ type: 'stoneguard', x: 4.5, y: GROUND_Y, z: 12.5 }], { farFrom: { x: 22.5, z: 22.5 } })
  const target = makeTarget(13.5, GROUND_Y, 12.5) // 9 units away
  manager.update(1 / 60, target)
  assert.equal(mobs[0].state, 'chase')
  runManager(manager, 2, 1 / 60, target)
  assert.ok(Math.abs(mobs[0].position.x - 4.5 - 2 * MOB_TYPES.stoneguard.speed) < 0.1, 'closes in at its speed')
  runManager(manager, 10, 1 / 60, target)
  assert.equal(mobs[0].state, 'attack', 'and attacks on arrival')
  assert.ok(horizontalDistance(mobs[0].position, target.position) <= MOB_RULES.attackRange)
})

test('strikes land only after the wind-up and then every 1.5 s, at 30, 60 and 144 fps', () => {
  for (const dt of FRAME_RATES) {
    const { manager, mob, log, target } = duel('mossling', 1.2)
    const strikes = runManager(manager, 6.5, dt, target)
    const first = strikes[0].step
    assert.ok(first * dt >= MOB_RULES.attackWindup, `dt ${dt}: waits for the wind-up`)
    assert.ok(first * dt <= MOB_RULES.attackWindup + 0.05, `dt ${dt}: lands about 0.35 s after contact`)
    const within = (seconds) => strikes.filter(({ step }) => (step - first) * dt <= seconds + 1e-9).length
    assert.equal(within(1.49), 1, `dt ${dt}: exactly 1 strike within 1.49 s`)
    assert.equal(within(1.5), 2, `dt ${dt}: 2 strikes by 1.5 s`)
    assert.equal(strikes.length, 5)
    assert.ok(strikes.every((strike) => strike.mob === mob && strike.damage === 10))
    assert.deepEqual(log['mob:attack'], strikes.map(({ mob: m, damage }) => ({ mob: m, damage })))
  }
})

test('a Stoneguard strike deals 15 damage', () => {
  const { manager, target } = duel('stoneguard', 1.4)
  const strikes = runManager(manager, 1, 1 / 60, target)
  assert.equal(strikes.length, 1)
  assert.equal(strikes[0].damage, 15)
})

test('attack range boundary through the manager: 1.74 strikes, 1.76 never does', () => {
  // The target hovers straight above an unreachable spot, so the distance stays fixed.
  for (const [height, expected] of [[1.74, true], [1.76, false]]) {
    const { manager, mob } = duel('mossling', 0)
    const target = makeTarget(mob.position.x, GROUND_Y + height, mob.position.z)
    const strikes = runManager(manager, 5, 1 / 60, target)
    assert.equal(strikes.length > 0, expected, `distance ${height}`)
    assert.equal(mob.state, expected ? 'attack' : 'chase')
  }
})

test('never strikes through a straight wall, even when within 1.75', () => {
  const world = createFlatWorld()
  for (let z = 0; z < world.size; z++) {
    for (let y = GROUND_Y; y < GROUND_Y + 3; y++) world.setBlock(5, y, z, BLOCK.STONE)
  }
  const { manager, mobs } = stageManager(world, [{ type: 'mossling', x: 4.65, y: GROUND_Y, z: 8.5 }], { farFrom: { x: 15.5, z: 15.5 } })
  const target = makeTarget(6.3, GROUND_Y, 8.5)
  const strikes = runManager(manager, 10, 1 / 60, target, (i) => {
    if (i === 1) assert.ok(horizontalDistance(mobs[0].position, target.position) < MOB_RULES.attackRange)
  })
  assert.deepEqual(strikes, [])
  assert.ok(mobs[0].position.x < 5, 'stayed on its side of the wall')
})

test('never strikes through a diagonal wall at 1.2 units', () => {
  const world = createFlatWorld()
  for (let x = 0; x <= 11; x++) {
    for (let y = GROUND_Y; y < GROUND_Y + 3; y++) world.setBlock(x, y, 11 - x, BLOCK.STONE)
  }
  const { manager, mobs } = stageManager(world, [{ type: 'mossling', x: 5.55, y: GROUND_Y, z: 5.65 }], { farFrom: { x: 15.5, z: 15.5 } })
  const target = makeTarget(6.45, GROUND_Y, 6.4)
  assert.ok(Math.abs(horizontalDistance(mobs[0].position, target.position) - 1.17) < 0.01)
  assert.equal(bodyCollides(world, mobs[0]), false)
  assert.deepEqual(runManager(manager, 10, 1 / 60, target), [])
  assert.ok(mobs[0].position.x + mobs[0].position.z < 11, 'never got around the wall')
})

test('never strikes an inactive or missing target', () => {
  for (const target of [makeTarget(8.5, GROUND_Y, 8.5, { active: false }), null, undefined]) {
    const { manager, log } = duel('mossling', 1.0)
    assert.deepEqual(runManager(manager, 10, 1 / 60, target), [])
    assert.deepEqual(log['mob:attack'], [])
  }
})

test('a target going inactive mid wind-up gets no strike', () => {
  const { manager, target, log } = duel('mossling', 1.2)
  runManager(manager, 0.25, 1 / 60, target)
  target.active = false
  assert.deepEqual(runManager(manager, 3, 1 / 60, target), [])
  assert.deepEqual(log['mob:attack'], [])
})

test('invalid dt changes nothing; long frames are clamped to MAX_FRAME_DT', () => {
  const { manager, target, mob } = duel('mossling', 3)
  const before = JSON.stringify(manager.mobs.map(({ rng, ...rest }) => rest))
  for (const dt of [NaN, -1, 0, Infinity, undefined]) assert.deepEqual(manager.update(dt, target), [])
  assert.equal(JSON.stringify(manager.mobs.map(({ rng, ...rest }) => rest)), before)

  const clamped = duel('mossling', 3)
  manager.update(5, target)
  clamped.manager.update(0.1, clamped.target)
  assert.deepEqual(mob.position, clamped.mob.position)
})

test('separation pushes crowded mobs apart without entering blocks', () => {
  const world = createFlatWorld()
  const spot = { x: 8.5, y: GROUND_Y, z: 7.3 }
  const { manager, mobs } = stageManager(world, [{ type: 'mossling', ...spot }, { type: 'mossling', ...spot }], { farFrom: { x: 15.5, z: 15.5 } })
  const target = makeTarget(8.5, GROUND_Y, 8.5)
  runManager(manager, 1.5, 1 / 60, target)
  assert.ok(horizontalDistance(mobs[0].position, mobs[1].position) >= 0.6, 'no longer stacked')
  assert.ok(mobs.every((mob) => !bodyCollides(world, mob)))
})

// Player-sized eye inside a mob's AABB (the melee targeting edge case).
function eyeInside(mob, target, eyeHeight = 1.62) {
  const box = mobBox(mob)
  const eye = { x: target.position.x, y: target.position.y + eyeHeight, z: target.position.z }
  return eye.x > box.minX && eye.x < box.maxX && eye.y > box.minY && eye.y < box.maxY && eye.z > box.minZ && eye.z < box.maxZ
}

test('the player body pushes an overlapping mob away through its velocity', () => {
  const world = createFlatWorld()
  const { manager, mobs } = stageManager(world, [{ type: 'stoneguard', x: 8.5, y: GROUND_Y, z: 8.3 }], { farFrom: { x: 15.5, z: 15.5 } })
  const [mob] = mobs
  const target = makeTarget(8.5, GROUND_Y, 8.5)
  let largestStep = 0
  for (let i = 0; i < 90; i++) {
    const before = { ...mob.position }
    manager.update(1 / 60, target)
    largestStep = Math.max(largestStep, horizontalDistance(before, mob.position))
  }
  const apart = horizontalDistance(mob.position, target.position)
  assert.ok(apart >= (mob.width + 0.6) / 2, `bodies no longer overlap (${apart.toFixed(3)})`)
  assert.ok(Math.abs(mob.position.x - 8.5) < 1e-9, 'pushed straight away from the player')
  assert.ok(mob.position.z < 8.3, 'away from the player, not through it')
  assert.ok(largestStep < 0.2, `never a teleport: largest frame step ${largestStep}`)
  assert.equal(bodyCollides(world, mob), false)
})

test('walking into a Stoneguard shoves it instead of putting the eye inside it', () => {
  const world = createFlatWorld({ size: 32, height: 16, groundTop: 3 })
  const { manager, mobs } = stageManager(world, [{ type: 'stoneguard', x: 8.5, y: GROUND_Y, z: 12.5 }], { farFrom: { x: 28.5, z: 28.5 } })
  const [mob] = mobs
  const target = makeTarget(8.5, GROUND_Y, 15.5)
  let inside = 0
  for (let i = 0; i < 120; i++) {
    target.position.z -= 4.3 / 60 // walking speed, straight at the mob
    manager.update(1 / 60, target)
    if (eyeInside(mob, target)) inside++
  }
  assert.equal(inside, 0, 'the eye never ends up inside the mob box')
  assert.ok(mob.position.z < 12.5 - 4, 'the mob was pushed along')
  assert.equal(bodyCollides(world, mob), false)
})

test('a target without a position or width is handled (no push, player-width default)', () => {
  const world = createFlatWorld()
  const { manager, mobs } = stageManager(world, [{ type: 'mossling', x: 8.5, y: GROUND_Y, z: 8.4 }], { farFrom: { x: 15.5, z: 15.5 } })
  assert.doesNotThrow(() => manager.update(1 / 60, { position: null, height: 1.8, active: false }))
  manager.update(1 / 60, { position: { x: 8.5, y: GROUND_Y, z: 8.5 }, height: 1.8, active: true })
  assert.ok(mobs[0].velocity.z < 0, 'default player width still separates')
})

// The review's endless-hop case: a mob flush against a 1-block step, the
// player 1.1 units back from the edge on the upper level.
function ledgeArena() {
  const world = createFlatWorld({ size: 32, height: 16, groundTop: 6 })
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 32; x++) world.setBlock(x, 7, z, BLOCK.STONE)
  }
  return world
}

test('regression: below a 1-block ledge a mob climbs up instead of hopping and striking from mid-air', () => {
  for (const type of ['mossling', 'stoneguard']) {
    for (const dt of FRAME_RATES) {
      const world = ledgeArena()
      const { manager, mobs } = stageManager(world, [{ type, x: 16.5, y: 7, z: 21 }], { farFrom: { x: 1.5, z: 30.5 } })
      const [mob] = mobs
      const target = makeTarget(16.5, 8, 16 - 1.1)
      let hops = 0
      let airStrikes = 0
      let strikes = 0
      let wasGrounded = true
      for (let i = 0; i < Math.round(20 / dt); i++) {
        const attacks = manager.update(dt, target)
        strikes += attacks.length
        if (attacks.length > 0 && !mob.onGround) airStrikes++
        if (wasGrounded && !mob.onGround && mob.velocity.y > 5) hops++
        wasGrounded = mob.onGround
      }
      const label = `${type} at dt ${dt.toFixed(4)}`
      assert.ok(hops <= 1, `${label}: ${hops} hops`)
      assert.equal(airStrikes, 0, `${label}: no strikes from mid-air`)
      assert.ok(strikes >= 8, `${label}: attacks from the ledge (${strikes})`)
      assert.ok(Math.abs(mob.position.y - 8) < 1e-3, `${label}: standing on the upper level`)
      assert.equal(mob.state, 'attack')
    }
  }
})

test('damage emits hurt, applies knockback, and a kill plays out before removal', () => {
  const { manager, mob, log, target } = duel('stoneguard', 2.5)
  const from = { x: 8.5, y: GROUND_Y, z: 8.5 }
  assert.deepEqual(manager.damage(mob, 25, { from }), { applied: 25, killed: false })
  assert.equal(mob.health, 35)
  assert.deepEqual(log['mob:hurt'], [{ mob, amount: 25, position: mobCenter(mob) }])
  assert.ok(mob.knockback.z < -3, 'shoved away from the attacker (-Z)')
  const z = mob.position.z
  runManager(manager, 0.2, 1 / 60, { ...target, active: false })
  assert.ok(mob.position.z < z - 0.1, 'knockback moved the mob')

  assert.deepEqual(manager.damage(mob, 100, { from }), { applied: 35, killed: true })
  assert.equal(log['mob:killed'].length, 1)
  assert.equal(log['mob:killed'][0].mob, mob)
  assert.equal(log['mob:hurt'].at(-1).amount, 35)
  assert.deepEqual(manager.aliveMobs(), [])
  assert.deepEqual(manager.obstacleBoxes(), [])
  assert.deepEqual(manager.damage(mob, 25), { applied: 0, killed: false })

  const steps = runManager(manager, 0.6, 1 / 60, target)
  assert.deepEqual(steps, [], 'a dying mob never strikes')
  assert.ok(manager.mobs.includes(mob), 'still visible during the death animation')
  runManager(manager, 0.15, 1 / 60, target)
  assert.ok(!manager.mobs.includes(mob), 'removed after ~0.7 s')
  assert.deepEqual(log['mob:removed'], [{ mob }])
  assert.equal(log['mob:killed'].length, 1)
})

test('a kill during the wind-up cancels the strike', () => {
  const { manager, mob, target } = duel('mossling', 1.2)
  runManager(manager, 0.2, 1 / 60, target)
  assert.ok(mob.windup > 0)
  manager.damage(mob, 100)
  assert.deepEqual(runManager(manager, 1, 1 / 60, target), [])
})

test('damage ignores invalid amounts and mobs it does not manage', () => {
  const { manager, mob, log } = duel('mossling', 2)
  for (const amount of [NaN, 0, -5, Infinity]) assert.deepEqual(manager.damage(mob, amount), { applied: 0, killed: false })
  const stranger = createMob('mossling', { x: 1, y: 4, z: 1 })
  assert.deepEqual(manager.damage(stranger, 25), { applied: 0, killed: false })
  assert.equal(stranger.health, 40)
  assert.deepEqual(log['mob:hurt'], [])
  assert.equal(mob.health, 40)
})

test('obstacleBoxes are the boxes of the living mobs only', () => {
  const { manager } = spawnedManager()
  const [first, ...rest] = manager.mobs
  manager.damage(first, 1000)
  assert.deepEqual(manager.aliveMobs(), rest)
  assert.deepEqual(manager.obstacleBoxes(), rest.map(mobBox))
})

test('reset brings back fresh full-health mobs at their spawns with new unique ids', () => {
  const { manager, log } = spawnedManager()
  const original = manager.mobs
  const spawnPoints = original.map((mob) => ({ ...mob.position }))
  manager.damage(original[0], 1000)
  manager.damage(original[1], 5)
  manager.damage(original[2], 1000)
  runManager(manager, 0.3, 1 / 60, makeTarget(spawnPoints[3].x + 1, GROUND_Y, spawnPoints[3].z))
  assert.equal(original[2].state, 'dying', 'reset interrupts a death animation')
  const removedBefore = log['mob:removed'].length

  const fresh = manager.reset(PLAYER_SPAWN)
  assert.equal(fresh.length, 4)
  assert.deepEqual(manager.mobs, fresh)
  assert.deepEqual(fresh.map((mob) => mob.position), spawnPoints, 'same deterministic spawn points')
  for (const mob of fresh) {
    assert.equal(mob.health, mob.maxHealth)
    assert.equal(mob.state, 'wander')
    assert.equal(mob.attackCooldown, 0)
    assert.equal(mob.windup, 0)
    assert.deepEqual(mob.anim, { walkCycle: 0, moving: 0, attackTimer: 0, hurtTimer: 0, deathTimer: 0 })
  }
  const oldIds = new Set(original.map((mob) => mob.id))
  assert.ok(fresh.every((mob) => !oldIds.has(mob.id)), 'no id is reused')
  assert.equal(new Set(fresh.map((mob) => mob.id)).size, 4)
  assert.equal(log['mob:spawned'].length, 8)
  assert.equal(log['mob:removed'].length, removedBefore, 'reset replaces mobs without fake removal events')
  assert.ok(!manager.mobs.includes(original[2]), 'the dying mob is gone')

  const other = spawnedManager()
  assert.ok(other.manager.mobs.every((mob) => !fresh.some((m) => m.id === mob.id)), 'unique across managers')
})

test('reset respects the exclusion rule around a new player spawn', () => {
  const { manager } = spawnedManager()
  const newSpawn = { x: 5.5, y: GROUND_Y, z: 26.5 }
  const fresh = manager.reset(newSpawn)
  assert.equal(fresh.length, 4)
  assert.ok(fresh.every((mob) => horizontalDistance(mob.position, newSpawn) >= MOB_RULES.spawnMinDistance))
})

test('two managers with the same seed evolve identically', () => {
  const a = spawnedManager({ seed: 11 })
  const b = spawnedManager({ seed: 11 })
  const script = (i) => makeTarget(10 + (i % 300) / 30, GROUND_Y, 16.5, { active: i % 500 < 400 })
  for (let i = 0; i < 1200; i++) {
    const attacksA = a.manager.update(1 / 60, script(i))
    const attacksB = b.manager.update(1 / 60, script(i))
    assert.equal(attacksA.length, attacksB.length)
  }
  const snapshot = (manager) => manager.mobs.map((mob) => [mob.type, mob.position, mob.state, mob.health])
  assert.deepEqual(snapshot(a.manager), snapshot(b.manager))
})
