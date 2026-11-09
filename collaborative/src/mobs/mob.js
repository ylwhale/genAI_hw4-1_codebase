// Mob state and animation timers. Decisions live in mobAI.js, movement in mobMovement.js.

import { WORLD_SEED } from '../config.js'
import { bodyBox, isFinitePoint } from '../core/geometry.js'
import { createRng, deriveSeed } from '../core/rng.js'
import { getMobType } from './mobTypes.js'

// Animation lengths in seconds. Every anim timer counts DOWN to 0, so a view
// can derive progress as 1 - timer / duration.
//
// Attack animation: views read `mob.windup` (seconds until the pending strike
// lands, 0 when none) for the wind-up pose, and the 'mob:attack' event for the
// strike itself. `anim.attackTimer` spans wind-up + strikeRecovery and drops
// to 0 whenever a wind-up is cancelled or the mob starts dying.
export const MOB_ANIM = Object.freeze({
  hurtDuration: 0.3,
  deathDuration: 0.7,
  strikeRecovery: 0.25, // follow-through after the strike lands
})

// Session-wide id counter: never reset, so views can never confuse a fresh
// mob with a stale model from before a respawn.
let lastMobId = 0

function nextMobId() {
  lastMobId += 1
  return lastMobId
}

export function createMob(typeKey, position, { id = nextMobId(), seed } = {}) {
  const type = requireMobType(typeKey)
  requirePosition(position)
  const rng = createRng(seed ?? deriveSeed(WORLD_SEED, `mob:${id}`))
  return {
    id,
    type: type.key,
    position: { x: position.x, y: position.y, z: position.z },
    velocity: { x: 0, y: 0, z: 0 },
    width: type.width,
    height: type.height,
    eyeHeight: type.eyeHeight,
    onGround: false,
    yaw: rng.range(-Math.PI, Math.PI),
    health: type.maxHealth,
    maxHealth: type.maxHealth,
    state: 'wander',
    attackCooldown: 0, // seconds until the next strike may land
    windup: 0, // seconds until the pending strike lands (0 = none pending)
    wander: { mode: 'idle', timer: rng.range(0.3, 1.5), dirX: 0, dirZ: 0 },
    chase: { aimX: 0, aimZ: 0, sidestepTimer: 0, sideX: 0, sideZ: 0, recentBlocks: [], giveUpTimer: 0 },
    knockback: { x: 0, z: 0 }, // decaying horizontal velocity from hits
    anim: { walkCycle: 0, moving: 0, attackTimer: 0, hurtTimer: 0, deathTimer: 0 },
    rng,
  }
}

export function mobType(mob) {
  return requireMobType(mob.type)
}

// Applies melee damage. Returns { applied, killed }; invalid amounts and mobs
// that are already dying are ignored.
export function damageMob(mob, amount) {
  if (!Number.isFinite(amount) || amount <= 0 || !isMobAlive(mob)) return { applied: 0, killed: false }
  const applied = Math.min(amount, mob.health)
  mob.health -= applied
  mob.anim.hurtTimer = MOB_ANIM.hurtDuration
  if (mob.health > 0) return { applied, killed: false }
  startDying(mob)
  return { applied, killed: true }
}

function startDying(mob) {
  mob.health = 0
  mob.state = 'dying'
  mob.windup = 0
  mob.velocity.x = mob.velocity.y = mob.velocity.z = 0
  mob.anim.attackTimer = 0
  mob.anim.deathTimer = MOB_ANIM.deathDuration
}

export function isMobAlive(mob) {
  return mob.state !== 'dying' && mob.health > 0
}

export function mobBox(mob) {
  return bodyBox(mob.position, mob.width, mob.height)
}

export function mobEyePosition(mob) {
  return { x: mob.position.x, y: mob.position.y + mob.eyeHeight, z: mob.position.z }
}

export function mobCenter(mob) {
  return { x: mob.position.x, y: mob.position.y + mob.height / 2, z: mob.position.z }
}

function requireMobType(key) {
  const type = getMobType(key)
  if (!type) throw new Error(`Unknown mob type: ${key}`)
  return type
}

function requirePosition(position) {
  if (!isFinitePoint(position)) throw new TypeError('Mob position must have finite x, y and z')
}
