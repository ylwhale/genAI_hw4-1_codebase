// Enemy decision making: perception, state transitions, attack wind-up and
// cooldown timing, and blocked-path handling. Brain tests feed synthetic
// perceptions; perception tests use small hand-built worlds.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOB_RULES } from '../src/config.js'
import { BLOCK } from '../src/world/blocks.js'
import { MOB_ANIM, damageMob } from '../src/mobs/mob.js'
import { MOB_AI, notifyBlocked, perceive, updateMobBrain } from '../src/mobs/mobAI.js'
import { MOB_TYPES } from '../src/mobs/mobTypes.js'
import { createFlatWorld } from './helpers.js'
import { GROUND_Y, makeMob, makeTarget, sees } from './mobs-helpers.js'

const DTS = [1 / 30, 1 / 60, 1 / 120, 1 / 144]
const IN_REACH = sees({ distance: 1.2 })

function near(actual, expected, tolerance = 1e-9) {
  return Math.abs(actual - expected) <= tolerance
}

// Runs the brain for `steps` steps; returns the 1-based steps that struck.
function strikeSteps(mob, perception, steps, dt, from = 1) {
  const strikes = []
  for (let i = from; i < from + steps; i++) {
    const seen = typeof perception === 'function' ? perception(i) : perception
    if (updateMobBrain(mob, seen, dt).attack) strikes.push(i)
  }
  return strikes
}

// Steps until the first strike; returns its 1-based step number.
function stepsToFirstStrike(mob, perception, dt) {
  for (let step = 1; step <= 1000; step++) if (updateMobBrain(mob, perception, dt).attack) return step
  throw new Error('no strike within 1000 steps')
}

function wallAcross(world, x, top = GROUND_Y + 2, block = BLOCK.STONE) {
  for (let z = 0; z < world.size; z++) {
    for (let y = GROUND_Y; y <= top; y++) world.setBlock(x, y, z, block)
  }
}

// --- perception ---

test('perceive measures feet-to-feet 3D distance and a unit horizontal direction', () => {
  const world = createFlatWorld()
  const mob = makeMob('mossling', { x: 4.5, y: GROUND_Y, z: 4.5 })
  const flat = perceive(mob, makeTarget(7.5, GROUND_Y, 8.5), world)
  assert.ok(near(flat.distance, 5))
  assert.ok(near(flat.horizontalDistance, 5))
  assert.ok(near(flat.dirX, 0.6) && near(flat.dirZ, 0.8))
  assert.equal(flat.hasLineOfSight, true)
  assert.equal(flat.targetActive, true)

  const raised = perceive(mob, makeTarget(4.5, GROUND_Y + 2, 6), world)
  assert.ok(near(raised.distance, 2.5), 'vertical offset counts toward distance')
  assert.ok(near(raised.horizontalDistance, 1.5))
})

test('perceive reports a zero direction when the target is straight above', () => {
  const world = createFlatWorld()
  const mob = makeMob('mossling', { x: 4.5, y: GROUND_Y, z: 4.5 })
  const seen = perceive(mob, makeTarget(4.5, GROUND_Y + 3, 4.5), world)
  assert.equal(seen.dirX, 0)
  assert.equal(seen.dirZ, 0)
  assert.ok(near(seen.distance, 3))
})

test('solid walls and leaves block line of sight; open air does not', () => {
  const mob = makeMob('mossling', { x: 4.5, y: GROUND_Y, z: 5.5 })
  const target = makeTarget(7.5, GROUND_Y, 5.5)
  const open = createFlatWorld()
  assert.equal(perceive(mob, target, open).hasLineOfSight, true)

  const stone = createFlatWorld()
  wallAcross(stone, 6)
  assert.equal(perceive(mob, target, stone).hasLineOfSight, false)

  const leaves = createFlatWorld()
  wallAcross(leaves, 6, GROUND_Y + 2, BLOCK.LEAVES)
  assert.equal(perceive(mob, target, leaves).hasLineOfSight, false, 'leaves are opaque to sight')
})

test('sight runs from the mob eye, so a low wall hides the target only from a short mob', () => {
  const world = createFlatWorld()
  wallAcross(world, 6, GROUND_Y) // one block high
  const target = makeTarget(7.5, GROUND_Y, 5.5)
  const mossling = makeMob('mossling', { x: 4.5, y: GROUND_Y, z: 5.5 })
  const stoneguard = makeMob('stoneguard', { x: 4.5, y: GROUND_Y, z: 5.5 })
  assert.equal(perceive(mossling, target, world).hasLineOfSight, false)
  assert.equal(perceive(stoneguard, target, world).hasLineOfSight, true)
})

test('perceive flags inactive, missing, and malformed targets as not active', () => {
  const world = createFlatWorld()
  const mob = makeMob()
  const inactive = perceive(mob, makeTarget(6.5, GROUND_Y, 5.5, { active: false }), world)
  assert.equal(inactive.targetActive, false)
  assert.ok(near(inactive.distance, 1), 'geometry is still reported')

  const unspecified = perceive(mob, { position: { x: 6.5, y: GROUND_Y, z: 5.5 }, height: 1.8 }, world)
  assert.equal(unspecified.targetActive, false, 'active must be explicitly true')

  for (const target of [null, undefined, {}, { position: { x: NaN, y: 4, z: 4 }, active: true }]) {
    const seen = perceive(mob, target, world)
    assert.equal(seen.targetActive, false)
    assert.equal(seen.hasLineOfSight, false)
    assert.equal(seen.distance, Infinity)
  }
})

// --- state transitions ---

test('wanders when the target is far: alternating idle pauses and slow walks', () => {
  const mob = makeMob('mossling')
  const far = sees({ distance: 30 })
  const modes = new Set()
  for (let i = 0; i < 20 * 60; i++) {
    const intent = updateMobBrain(mob, far, 1 / 60)
    assert.equal(mob.state, 'wander')
    assert.equal(intent.attack, false)
    modes.add(mob.wander.mode)
    if (intent.speed > 0) {
      assert.equal(intent.speed, MOB_TYPES.mossling.wanderSpeed)
      assert.ok(near(Math.hypot(intent.moveX, intent.moveZ), 1, 1e-6), 'unit walking direction')
      assert.deepEqual([intent.faceX, intent.faceZ], [intent.moveX, intent.moveZ])
    }
  }
  assert.deepEqual([...modes].sort(), ['idle', 'walk'])
})

test('wander timing stays within the configured idle and walk durations', () => {
  const mob = makeMob('stoneguard')
  const far = sees({ distance: 30 })
  const spans = { idle: [], walk: [] }
  let mode = mob.wander.mode
  let since = 0
  for (let i = 0; i < 60 * 120; i++) {
    updateMobBrain(mob, far, 1 / 120)
    since += 1 / 120
    if (mob.wander.mode !== mode) {
      spans[mode].push(since)
      mode = mob.wander.mode
      since = 0
    }
  }
  const [idleMin, idleMax] = MOB_AI.idleTime
  const [walkMin, walkMax] = MOB_AI.walkTime
  assert.ok(spans.walk.length >= 3)
  assert.ok(spans.idle.slice(1).every((span) => span >= idleMin - 0.01 && span <= idleMax + 0.01))
  assert.ok(spans.walk.every((span) => span >= walkMin - 0.01 && span <= walkMax + 0.01))
})

test('chases within detectRange (10) at the type speed and wanders beyond it', () => {
  for (const type of ['mossling', 'stoneguard']) {
    const mob = makeMob(type)
    const intent = updateMobBrain(mob, sees({ distance: 6, dirX: 0.6, dirZ: 0.8 }), 1 / 60)
    assert.equal(mob.state, 'chase')
    assert.deepEqual([intent.moveX, intent.moveZ, intent.speed], [0.6, 0.8, MOB_TYPES[type].speed])
    assert.deepEqual([intent.faceX, intent.faceZ], [0.6, 0.8])
    assert.equal(intent.attack, false)
  }
  const edge = makeMob()
  updateMobBrain(edge, sees({ distance: MOB_RULES.detectRange }), 1 / 60)
  assert.equal(edge.state, 'chase', 'exactly 10 units still chases')
  updateMobBrain(edge, sees({ distance: 10.01 }), 1 / 60)
  assert.equal(edge.state, 'wander', '10.01 units is out of range')
})

test('attack range boundary: 1.74 and 1.75 attack, 1.76 only chases', () => {
  for (const distance of [1.74, MOB_RULES.attackRange]) {
    const mob = makeMob()
    const intent = updateMobBrain(mob, sees({ distance, dirX: 0, dirZ: -1 }), 1 / 60)
    assert.equal(mob.state, 'attack')
    assert.equal(intent.speed, 0, 'stops to attack')
    assert.deepEqual([intent.faceX, intent.faceZ], [0, -1], 'faces the target')
    assert.equal(strikeSteps(mob, sees({ distance }), 60, 1 / 60).length, 1)
  }
  const outside = makeMob()
  assert.deepEqual(strikeSteps(outside, sees({ distance: 1.76 }), 5 * 60, 1 / 60), [])
  assert.equal(outside.state, 'chase')
})

test('never attacks without line of sight, even point blank', () => {
  const mob = makeMob()
  const walled = sees({ distance: 1.2, hasLineOfSight: false })
  assert.deepEqual(strikeSteps(mob, walled, 10 * 60, 1 / 60), [])
  assert.equal(mob.state, 'chase')
})

test('never attacks an inactive target and wanders instead', () => {
  const mob = makeMob()
  const dead = sees({ distance: 0.9, targetActive: false })
  assert.deepEqual(strikeSteps(mob, dead, 10 * 60, 1 / 60), [])
  assert.equal(mob.state, 'wander')
})

test('full cycle of transitions: wander -> chase -> attack -> chase -> wander', () => {
  const mob = makeMob()
  const states = [30, 8, 1.5, 3, 12].map((distance) => {
    updateMobBrain(mob, sees({ distance }), 1 / 60)
    return mob.state
  })
  assert.deepEqual(states, ['wander', 'chase', 'attack', 'chase', 'wander'])
})

test('a dying mob neither moves nor attacks', () => {
  const mob = makeMob()
  updateMobBrain(mob, IN_REACH, 0.2)
  damageMob(mob, 1000)
  for (let i = 0; i < 120; i++) {
    const intent = updateMobBrain(mob, IN_REACH, 1 / 60)
    assert.equal(intent.attack, false)
    assert.equal(intent.speed, 0)
  }
  assert.equal(mob.state, 'dying')
})

test('invalid dt is ignored and a missing perception means wander', () => {
  const mob = makeMob()
  mob.attackCooldown = 1
  for (const dt of [NaN, -1, Infinity, undefined]) {
    const intent = updateMobBrain(mob, IN_REACH, dt)
    assert.equal(intent.attack, false)
    assert.equal(intent.speed, 0)
    assert.equal(mob.state, 'wander', 'state untouched')
    assert.equal(mob.attackCooldown, 1, 'cooldown untouched')
  }
  updateMobBrain(mob, null, 1 / 60)
  assert.equal(mob.state, 'wander')
})

test('chasers stop pressing in once their bodies would touch', () => {
  const mob = makeMob()
  const above = sees({ distance: 3, horizontalDistance: 0.5, hasLineOfSight: false, dirX: 1, dirZ: 0 })
  const intent = updateMobBrain(mob, above, 1 / 60)
  assert.equal(mob.state, 'chase')
  assert.equal(intent.speed, 0)
  assert.deepEqual([intent.faceX, intent.faceZ], [1, 0])
})

test('regression: an airborne mob in range keeps chasing and attacks once it lands', () => {
  const mob = makeMob()
  mob.onGround = false // mid-hop up a ledge toward the target
  const intent = updateMobBrain(mob, sees({ distance: 1.6, dirX: 0, dirZ: -1 }), 1 / 60)
  assert.equal(mob.state, 'chase', 'no attack from mid-air')
  assert.ok(intent.speed > 0, 'keeps moving, so the hop carries it up the step')
  assert.equal(mob.windup, 0)
  mob.onGround = true
  updateMobBrain(mob, sees({ distance: 1.6 }), 1 / 60)
  assert.equal(mob.state, 'attack', 'grounded: engages')
})

test('an attacker knocked off its feet keeps attacking', () => {
  const mob = makeMob()
  updateMobBrain(mob, IN_REACH, 1 / 60)
  assert.equal(mob.state, 'attack')
  mob.onGround = false
  const strikes = strikeSteps(mob, IN_REACH, 60, 1 / 60)
  assert.equal(mob.state, 'attack')
  assert.equal(strikes.length, 1, 'the wind-up still lands')
})

// --- attack wind-up and cooldown timing ---

test('the first strike lands after the ~0.35 s wind-up at every frame rate', () => {
  for (const dt of DTS) {
    const mob = makeMob()
    const strikes = strikeSteps(mob, IN_REACH, Math.round(1 / dt), dt)
    const firstTime = strikes[0] * dt
    assert.ok(firstTime >= MOB_RULES.attackWindup, `dt ${dt}: not before the wind-up (${firstTime})`)
    assert.ok(firstTime <= MOB_RULES.attackWindup + 2 * dt + 1e-9, `dt ${dt}: promptly after it (${firstTime})`)
    assert.equal(strikes.length, 1)
  }
})

test('continuous contact: exactly 1 strike within 1.49 s after the first, 2 by 1.5 s', () => {
  for (const dt of DTS) {
    const mob = makeMob()
    const strikes = strikeSteps(mob, IN_REACH, Math.round(8 / dt), dt)
    const first = strikes[0]
    const after = (seconds) => strikes.filter((step) => step >= first && (step - first) * dt <= seconds + 1e-9).length
    assert.equal(after(1.49), 1, `dt ${dt}: no second strike inside 1.49 s`)
    assert.equal(after(1.5), 2, `dt ${dt}: second strike by 1.5 s`)
    for (let i = 1; i < strikes.length; i++) {
      assert.ok(near((strikes[i] - strikes[i - 1]) * dt, MOB_RULES.attackCooldown, 1e-6), 'steady 1.5 s cadence')
    }
  }
})

test('a strike starts the 1.5 s cooldown, which counts down in every state', () => {
  const mob = makeMob()
  stepsToFirstStrike(mob, IN_REACH, 1 / 60)
  assert.equal(mob.attackCooldown, MOB_RULES.attackCooldown)
  for (let i = 0; i < 30; i++) updateMobBrain(mob, sees({ distance: 30 }), 1 / 60)
  assert.ok(near(mob.attackCooldown, 1, 1e-9), 'counts down while wandering')
  for (let i = 0; i < 30; i++) updateMobBrain(mob, sees({ distance: 5 }), 1 / 60)
  assert.ok(near(mob.attackCooldown, 0.5, 1e-9), 'and while chasing')
  for (let i = 0; i < 60; i++) updateMobBrain(mob, sees({ distance: 5 }), 1 / 60)
  assert.equal(mob.attackCooldown, 0, 'never below zero')
})

test('the wind-up drives the attack animation timer and mob.windup', () => {
  const mob = makeMob()
  updateMobBrain(mob, IN_REACH, 1 / 60)
  assert.equal(mob.state, 'attack')
  assert.ok(near(mob.windup, MOB_RULES.attackWindup))
  // MOB_ANIM.attackDuration was removed (unused by src): the timer spans wind-up + follow-through.
  assert.ok(near(mob.anim.attackTimer, MOB_RULES.attackWindup + MOB_ANIM.strikeRecovery))
  updateMobBrain(mob, IN_REACH, 0.1)
  assert.ok(near(mob.windup, MOB_RULES.attackWindup - 0.1))
})

test('leaving range during the wind-up cancels the strike; returning restarts a full wind-up', () => {
  const dt = 1 / 120
  const mob = makeMob()
  const steps = Math.round(0.3 / dt)
  assert.deepEqual(strikeSteps(mob, IN_REACH, steps, dt), [], 'still winding up after 0.3 s')
  assert.deepEqual(strikeSteps(mob, sees({ distance: 1.9 }), 1, dt), [])
  assert.equal(mob.windup, 0, 'strike cancelled')
  const back = strikeSteps(mob, IN_REACH, Math.round(1 / dt), dt)
  assert.equal(back.length, 1)
  assert.ok(back[0] * dt >= MOB_RULES.attackWindup - 1e-9, 'no instant strike on return')
})

test('a cancelled wind-up also ends the attack animation; a landed strike keeps its follow-through', () => {
  const dt = 1 / 120
  const mob = makeMob()
  strikeSteps(mob, IN_REACH, 10, dt)
  assert.ok(mob.windup > 0 && mob.anim.attackTimer > 0, 'winding up')
  updateMobBrain(mob, sees({ distance: 2.5 }), dt)
  assert.equal(mob.state, 'chase')
  assert.equal(mob.windup, 0)
  assert.equal(mob.anim.attackTimer, 0, 'no stale attack animation')

  const striker = makeMob()
  stepsToFirstStrike(striker, IN_REACH, dt)
  const followThrough = striker.anim.attackTimer
  assert.ok(followThrough > 0, 'follow-through after the strike')
  updateMobBrain(striker, sees({ distance: 2.5 }), dt)
  assert.equal(striker.anim.attackTimer, followThrough, 'leaving range after a strike does not cut it short')
})

test('losing sight or the target going inactive during the wind-up cancels the strike', () => {
  const dt = 1 / 120
  const windupSteps = Math.round(MOB_RULES.attackWindup / dt)
  for (const interruption of [sees({ distance: 1.2, hasLineOfSight: false }), sees({ distance: 1.2, targetActive: false })]) {
    const mob = makeMob()
    const script = (step) => (step === 30 ? interruption : IN_REACH)
    assert.deepEqual(strikeSteps(mob, script, 30 + windupSteps, dt), [], 'the interrupted wind-up never lands')
    assert.equal(mob.state, 'attack')
    assert.deepEqual(strikeSteps(mob, IN_REACH, 1, dt, 31 + windupSteps), [31 + windupSteps], 'a fresh full wind-up lands')
  }
})

test('stepping out and back in never shortens the 1.5 s spacing between strikes', () => {
  const dt = 1 / 120
  const mob = makeMob()
  const first = stepsToFirstStrike(mob, IN_REACH, dt)
  const away = (step) => (step > first + 12 && step <= first + 72 ? sees({ distance: 2.5 }) : IN_REACH)
  const later = strikeSteps(mob, away, 400, dt, first + 1)
  assert.ok(near((later[0] - first) * dt, MOB_RULES.attackCooldown, 1e-6), 'returns mid-cooldown: strikes on schedule')

  const patient = makeMob()
  const start = stepsToFirstStrike(patient, IN_REACH, dt)
  const longAway = (step) => (step <= start + 240 ? sees({ distance: 2.5 }) : IN_REACH)
  const next = strikeSteps(patient, longAway, 400, dt, start + 1)
  assert.ok(near((next[0] - (start + 241)) * dt, MOB_RULES.attackWindup, 1e-6), 'cooled down: full wind-up first')
})

// --- blocked paths ---

test('a blocked wanderer turns away from the wall it hit', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const mob = makeMob('mossling', undefined, seed)
    Object.assign(mob.wander, { mode: 'walk', timer: 2, dirX: 1, dirZ: 0.2 })
    notifyBlocked(mob, { blockedX: true, blockedZ: false })
    assert.equal(mob.wander.mode, 'walk')
    assert.ok(mob.wander.dirX <= 0, `seed ${seed}: heads away from the +X wall`)
    assert.ok(near(Math.hypot(mob.wander.dirX, mob.wander.dirZ), 1, 1e-9))
  }
})

test('a blocked chaser sidesteps perpendicular to the target, then resumes the chase', () => {
  const mob = makeMob()
  const ahead = sees({ distance: 5, dirX: 1, dirZ: 0 })
  updateMobBrain(mob, ahead, 1 / 60)
  notifyBlocked(mob)
  const [minSide, maxSide] = MOB_AI.sidestepTime
  assert.ok(mob.chase.sidestepTimer >= minSide && mob.chase.sidestepTimer <= maxSide)
  const intent = updateMobBrain(mob, ahead, 1 / 60)
  assert.ok(near(intent.moveX, 0, 1e-9) && near(Math.abs(intent.moveZ), 1, 1e-9), 'moves sideways')
  assert.equal(intent.speed, MOB_TYPES.mossling.speed)
  for (let i = 0; i < 60; i++) updateMobBrain(mob, ahead, 1 / 60)
  const resumed = updateMobBrain(mob, ahead, 1 / 60)
  assert.deepEqual([resumed.moveX, resumed.moveZ], [1, 0], 'back on the direct path')
})

test('blocked again mid-sidestep flips the sidestep direction', () => {
  const mob = makeMob()
  const ahead = sees({ distance: 5, dirX: 0, dirZ: 1 })
  updateMobBrain(mob, ahead, 1 / 60)
  notifyBlocked(mob)
  const first = updateMobBrain(mob, ahead, 1 / 60)
  notifyBlocked(mob)
  const flipped = updateMobBrain(mob, ahead, 1 / 60)
  assert.ok(near(flipped.moveX, -first.moveX) && near(flipped.moveZ, -first.moveZ))
})

test('three blocked events within 4 s make the chaser give up and wander for 2-3 s', () => {
  const mob = makeMob()
  const ahead = sees({ distance: 5, dirX: 1, dirZ: 0 })
  updateMobBrain(mob, ahead, 1 / 60)
  for (let i = 0; i < 3; i++) {
    notifyBlocked(mob)
    updateMobBrain(mob, ahead, 0.2)
  }
  assert.equal(mob.state, 'wander', 'gives up although the target is within 10')
  const [minGiveUp, maxGiveUp] = MOB_AI.giveUpTime
  const left = mob.chase.giveUpTimer
  assert.ok(left > minGiveUp - 0.3 && left <= maxGiveUp)
  const intent = updateMobBrain(mob, ahead, 1 / 60)
  assert.ok(intent.moveX < 0, 'backs away from the obstacle')
  let waited = 0
  while (mob.state === 'wander' && waited < 5) {
    updateMobBrain(mob, ahead, 1 / 60)
    waited += 1 / 60
  }
  assert.equal(mob.state, 'chase')
  assert.ok(waited >= minGiveUp - 0.3 && waited <= maxGiveUp + 0.05)
})

test('blocked events older than 4 s are forgotten', () => {
  const mob = makeMob()
  const ahead = sees({ distance: 5, dirX: 1, dirZ: 0 })
  updateMobBrain(mob, ahead, 1 / 60)
  notifyBlocked(mob)
  updateMobBrain(mob, ahead, 0.1)
  notifyBlocked(mob)
  for (let i = 0; i < 41; i++) updateMobBrain(mob, ahead, 0.1)
  assert.equal(mob.chase.recentBlocks.length, 0)
  notifyBlocked(mob)
  updateMobBrain(mob, ahead, 1 / 60)
  assert.equal(mob.state, 'chase')
  assert.ok(mob.chase.sidestepTimer > 0, 'a fresh sidestep instead of giving up')
})

test('giving up never stops a mob from attacking a target within reach', () => {
  const mob = makeMob()
  updateMobBrain(mob, sees({ distance: 5 }), 1 / 60)
  for (let i = 0; i < 3; i++) notifyBlocked(mob)
  assert.ok(mob.chase.giveUpTimer > 0)
  updateMobBrain(mob, IN_REACH, 1 / 60)
  assert.equal(mob.state, 'attack')
})

test('blocked feedback is ignored while attacking or dying', () => {
  const mob = makeMob()
  updateMobBrain(mob, IN_REACH, 1 / 60)
  notifyBlocked(mob)
  assert.equal(mob.chase.sidestepTimer, 0)
  assert.equal(mob.chase.recentBlocks.length, 0)
  damageMob(mob, 1000)
  updateMobBrain(mob, IN_REACH, 1 / 60)
  notifyBlocked(mob, { blockedX: true })
  assert.equal(mob.state, 'dying')
  assert.equal(mob.chase.recentBlocks.length, 0)
})

test('decisions are deterministic for the same seed', () => {
  const a = makeMob('mossling', undefined, 99)
  const b = makeMob('mossling', undefined, 99)
  const script = (i) => sees({ distance: i % 400 < 200 ? 30 : 6, dirX: 0.6, dirZ: 0.8 })
  for (let i = 0; i < 1200; i++) {
    if (i % 97 === 0) {
      notifyBlocked(a, { blockedZ: true })
      notifyBlocked(b, { blockedZ: true })
    }
    assert.deepEqual(updateMobBrain(a, script(i), 1 / 60), updateMobBrain(b, script(i), 1 / 60))
  }
  assert.deepEqual(a.wander, b.wander)
})
