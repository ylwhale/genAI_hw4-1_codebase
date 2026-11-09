// Melee targeting and cooldown. The caller applies damage to the selected mob.

import { COMBAT } from '../config.js'
import { bodyBox, isFinitePoint, rayBoxDistance } from '../core/geometry.js'

const READY_EPSILON = 1e-9 // absorbs float drift from summing frame times

// Nearest live mob whose (un-inflated) AABB the ray enters within `reach` and
// strictly before `blockDistance` (the first solid block on the same ray), so
// attacks never pass through blocks. Returns { mob, distance } or null.
// An eye inside a mob's box (distance 0) only targets it when looking toward
// its centre; otherwise every direction, even the sky, would hit that mob.
export function findMobTarget(mobs, origin, direction, { reach = COMBAT.playerReach, blockDistance = Infinity } = {}) {
  const ray = normalise(direction)
  const validReach = typeof reach === 'number' && reach > 0
  if (!ray || !validReach || !isFinitePoint(origin) || !isIterable(mobs)) return null
  const limit = blockLimit(blockDistance)
  let best = null
  for (const mob of mobs) {
    if (!isTargetable(mob)) continue
    const distance = rayBoxDistance(origin, ray, bodyBox(mob.position, mob.width, mob.height), reach)
    if (distance === null || !(distance < limit)) continue
    if (distance === 0 && !facesCentre(origin, ray, mob)) continue
    if (!best || distance < best.distance) best = { mob, distance }
  }
  return best
}

// True when the ray points toward the mob's body centre (positive dot product).
function facesCentre(origin, ray, mob) {
  const centreY = mob.position.y + mob.height / 2
  const toCentre = (mob.position.x - origin.x) * ray.x + (centreY - origin.y) * ray.y + (mob.position.z - origin.z) * ray.z
  return toCentre > 0
}

export function createPlayerCombat({ damage = COMBAT.playerDamage, cooldown = COMBAT.playerCooldown } = {}) {
  if (!(Number.isFinite(damage) && damage > 0)) throw new RangeError(`Invalid melee damage: ${String(damage)}`)
  if (!(Number.isFinite(cooldown) && cooldown >= 0)) throw new RangeError(`Invalid melee cooldown: ${String(cooldown)}`)
  let remaining = 0

  function update(dt) {
    if (!(Number.isFinite(dt) && dt > 0)) return
    remaining -= dt
    if (remaining <= READY_EPSILON) remaining = 0
  }

  function isReady() {
    return remaining <= 0
  }

  // applyDamage(mob, amount) → { applied, killed }. A swing always starts the
  // cooldown, even if the mob took no damage; nothing happens while cooling.
  function attack(mob, applyDamage) {
    if (!isReady() || !mob || typeof applyDamage !== 'function') return { attacked: false, applied: 0, killed: false }
    remaining = cooldown
    const result = applyDamage(mob, damage)
    return { attacked: true, applied: appliedAmount(result?.applied), killed: Boolean(result?.killed) }
  }

  function reset() {
    remaining = 0
  }

  return {
    update,
    isReady,
    attack,
    reset,
    get cooldownRemaining() {
      return remaining
    },
    // 1 right after a swing, falling to 0 when ready (HUD recharge indicator).
    get cooldownFraction() {
      return cooldown > 0 ? remaining / cooldown : 0
    },
    get damage() {
      return damage
    },
    get cooldown() {
      return cooldown
    },
  }
}

// applyDamage reports the health points removed; anything else counts as 0.
function appliedAmount(value) {
  return Number.isFinite(value) && value > 0 ? value : 0
}

// A missing (null/undefined) or NaN block distance means no block was hit.
function blockLimit(blockDistance) {
  return typeof blockDistance === 'number' && !Number.isNaN(blockDistance) ? blockDistance : Infinity
}

// Dying mobs (and anything already at 0 health) can no longer be struck.
function isTargetable(mob) {
  return mob != null && isFinitePoint(mob.position) && mob.state !== 'dying' && !(mob.health <= 0)
}

function normalise(vector) {
  if (!isFinitePoint(vector)) return null
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (!(length > 0)) return null
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

function isIterable(value) {
  return value != null && typeof value[Symbol.iterator] === 'function'
}
