// Owns mob spawning, updates, damage, and removal after death animations.
// Views read `mobs` and subscribe to events.

import { MAX_FRAME_DT, MOB_RULES, PHYSICS_STEP, PLAYER, WORLD_SEED } from '../config.js'
import { horizontalDirection, isFinitePoint } from '../core/geometry.js'
import { finiteOr } from '../core/math.js'
import { deriveSeed } from '../core/rng.js'
import { createMob, damageMob, isMobAlive, mobBox, mobCenter, mobType } from './mob.js'
import { findMobSpawns } from './mobSpawns.js'
import { notifyBlocked, perceive, updateMobBrain } from './mobAI.js'
import { applyKnockback, moveMob } from './mobMovement.js'

const MOB_SEPARATION = Object.freeze({
  margin: 0.15, // extra gap kept between neighbouring bodies
  speed: 2.5, // push speed at full overlap, units per second
  // The player's body pushes harder than walking speed, so walking into a
  // mob shoves it aside instead of ending up inside it (eye in its box).
  playerSpeed: 10,
})

const STILL = Object.freeze({ moveX: 0, moveZ: 0, speed: 0, faceX: 0, faceZ: 0, attack: false })
const NO_TARGET = Object.freeze({ position: null, height: 0, active: false })

export function createMobManager({ world, events = null, seed = WORLD_SEED, plan = MOB_RULES.spawnPlan } = {}) {
  let mobs = []

  function emit(type, payload) {
    events?.emit(type, payload)
  }

  // Replaces the population with fresh mobs (full health, cleared timers, new
  // session-unique ids) at deterministic spawns for this player spawn.
  function spawnAll(playerSpawn) {
    const spawns = findMobSpawns(world, playerSpawn, plan, { seed })
    mobs = spawns.map((spawn, index) => createMob(spawn.type, spawn, { seed: deriveSeed(seed, `mob:${index}`) }))
    for (const mob of mobs) emit('mob:spawned', { mob })
    return mobs.slice()
  }

  function reset(playerSpawn) {
    return spawnAll(playerSpawn)
  }

  // Advances every mob by dt (clamped, sub-stepped to PHYSICS_STEP) and
  // returns the strikes that landed: [{ mob, damage }]. The caller applies
  // them to the player. An inactive or missing target never takes strikes.
  function update(dt, target) {
    const attacks = []
    if (!Number.isFinite(dt) || dt <= 0) return attacks
    const frame = Math.min(dt, MAX_FRAME_DT)
    const steps = Math.max(1, Math.ceil(frame / PHYSICS_STEP - 1e-6))
    for (let i = 0; i < steps; i++) step(frame / steps, target ?? NO_TARGET, attacks)
    return attacks
  }

  function step(dt, target, attacks) {
    const alive = aliveMobs()
    const pushes = separationPushes(alive)
    addTargetSeparation(alive, target, pushes)
    for (const mob of mobs) {
      if (isMobAlive(mob)) updateLiving(mob, dt, target, pushes.get(mob), attacks)
      else moveMob(world, mob, STILL, dt) // a dying body still falls and slides
      advanceAnimation(mob, dt)
    }
    removeFinished()
  }

  function updateLiving(mob, dt, target, push, attacks) {
    const perception = perceive(mob, target, world)
    const intent = updateMobBrain(mob, perception, dt)
    const motion = moveMob(world, mob, intent, dt, { push })
    if (motion.blocked) notifyBlocked(mob, motion)
    if (intent.attack && perception.targetActive) {
      const attack = { mob, damage: mobType(mob).damage }
      attacks.push(attack)
      emit('mob:attack', attack)
    }
  }

  function removeFinished() {
    if (!mobs.some(isFinished)) return
    const finished = mobs.filter(isFinished)
    mobs = mobs.filter((mob) => !isFinished(mob))
    for (const mob of finished) emit('mob:removed', { mob })
  }

  // `from` (optional, e.g. the player's position) shoves the mob away from it.
  function damage(mob, amount, { from = null } = {}) {
    if (!mobs.includes(mob)) return { applied: 0, killed: false }
    const result = damageMob(mob, amount)
    if (result.applied <= 0) return result
    if (from) applyKnockback(mob, from)
    emit('mob:hurt', { mob, amount: result.applied, position: mobCenter(mob) })
    if (result.killed) emit('mob:killed', { mob, position: mobCenter(mob) })
    return result
  }

  function aliveMobs() {
    return mobs.filter(isMobAlive)
  }

  function obstacleBoxes() {
    return aliveMobs().map(mobBox)
  }

  return {
    get mobs() {
      return mobs.slice()
    },
    spawnAll,
    reset,
    update,
    damage,
    aliveMobs,
    obstacleBoxes,
  }
}

// Only animation timers advance here; the attack cooldown belongs to the brain.
function advanceAnimation(mob, dt) {
  const { anim } = mob
  anim.attackTimer = Math.max(0, anim.attackTimer - dt)
  anim.hurtTimer = Math.max(0, anim.hurtTimer - dt)
  if (mob.state === 'dying') anim.deathTimer = Math.max(0, anim.deathTimer - dt)
}

function isFinished(mob) {
  return mob.state === 'dying' && mob.anim.deathTimer <= 0
}

// Gentle pairwise push so mobs that crowd the same spot drift apart instead
// of stacking. Returns Map(mob -> {x, z}) of velocity contributions.
function separationPushes(alive) {
  const pushes = new Map()
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) addSeparation(alive[i], alive[j], pushes)
  }
  return pushes
}

function addSeparation(a, b, pushes) {
  const push = separationPush(a, b, MOB_SEPARATION.speed)
  if (!push) return
  addPush(pushes, a, -push.x, -push.z)
  addPush(pushes, b, push.x, push.z)
}

// The target (the player) is a separation source too: it pushes overlapping
// mobs away through their velocity, never by writing positions, and is not
// pushed back itself. target = { position, width?, height } (player-sized
// defaults when missing).
function addTargetSeparation(alive, target, pushes) {
  if (!isFinitePoint(target.position)) return
  const body = {
    position: target.position,
    width: finiteOr(target.width, PLAYER.width),
    height: finiteOr(target.height, PLAYER.height),
  }
  for (const mob of alive) {
    const push = separationPush(body, mob, MOB_SEPARATION.playerSpeed)
    if (push) addPush(pushes, mob, push.x, push.z)
  }
}

// Velocity that pushes `to` horizontally away from `from` when their bodies
// (plus the margin) overlap: `speed` at full overlap, fading to 0 at contact.
// Returns { x, z } or null when they are apart.
function separationPush(from, to, speed) {
  if (!overlapVertically(from, to)) return null
  const reach = (from.width + to.width) / 2 + MOB_SEPARATION.margin
  const away = horizontalDirection(from.position, to.position)
  if (away.length >= reach) return null
  // Exactly coincident bodies split along +X so the result stays deterministic.
  const [nx, nz] = away.length > 0 ? [away.x, away.z] : [1, 0]
  const strength = speed * (1 - away.length / reach)
  return { x: nx * strength, z: nz * strength }
}

function overlapVertically(a, b) {
  return a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height
}

function addPush(pushes, mob, x, z) {
  const push = pushes.get(mob)
  if (push) {
    push.x += x
    push.z += z
  } else {
    pushes.set(mob, { x, z })
  }
}
