// Animates mob models from state and events without changing the mobs.
// Hits and deaths emit particles through the effects module.

import { Group } from 'three'
import { MAX_FRAME_DT, MOB_RULES } from '../config.js'
import { isFinitePoint, lookDirection } from '../core/geometry.js'
import { TAU, approach, clamp, clamp01, finiteOr } from '../core/math.js'
import { hash3 } from '../core/rng.js'
import { MOB_ANIM } from '../mobs/mob.js'
import { createMobModel, disposeMobGeometries, hasMobModel, mobPalette } from './mobModels.js'

const WINDUP_RESPONSE = 18 // 1/s: how quickly the wind-up pose follows its target
const BLINK_TIME = 0.14 // seconds the eyes stay shut

const DEFAULT_MOTION = Object.freeze({ breathRate: 2, breath: 0.03, bob: 0.04, stride: 0.5, sway: 0.08, blinkEvery: 0 })

// Particle recipes for effects.burst(position, color, count, options).
const BURSTS = Object.freeze({
  spark: { count: 6, options: { speed: 3.4, size: 0.06, lifetime: 0.35, gravity: 9, spread: 0.15, upward: 1.6 } },
  chip: { count: 5, options: { speed: 2.4, size: 0.09, lifetime: 0.55, gravity: 16, spread: 0.2, upward: 2 } },
  death: { count: 8, options: { speed: 3.6, size: 0.14, lifetime: 0.9, gravity: 15, spread: 0.35, upward: 2.6 } },
  poof: { count: 12, options: { speed: 1.3, size: 0.11, lifetime: 0.7, gravity: 1.5, spread: 0.3, upward: 1.2 } },
  strike: { count: 6, options: { speed: 1.8, size: 0.08, lifetime: 0.45, gravity: 6, spread: 0.2, upward: 1.4 } },
})

export function createMobView({ scene, events = null, effects = null } = {}) {
  const group = new Group()
  group.name = 'mobs'
  scene?.add(group)
  const entries = new Map() // mob object -> { model, timers }
  let time = 0
  let disposed = false

  // A world reset or respawn replaces every mob, so stale models (even ones
  // mid-death) vanish at once instead of puffing where the old mobs stood.
  const unsubscribers = events
    ? [
        events.on('mob:hurt', onHurt),
        events.on('mob:killed', onKilled),
        events.on('mob:attack', onAttack),
        events.on('world:reset', clear),
        events.on('player:respawned', clear),
      ]
    : []

  function burst(recipe, position, color) {
    if (color === undefined || typeof effects?.burst !== 'function') return
    effects.burst(position, color, recipe.count, { ...recipe.options })
  }

  function onHurt(event) {
    const mob = event?.mob
    if (!isDrawable(mob)) return
    const palette = mobPalette(mob.type)
    burst(BURSTS.spark, bodyPoint(mob, 0.6), palette.spark)
    burst(BURSTS.chip, bodyPoint(mob, 0.55), palette.chip)
  }

  function onKilled(event) {
    const mob = event?.mob
    if (!isDrawable(mob)) return
    for (const color of mobPalette(mob.type).death) burst(BURSTS.death, bodyPoint(mob, 0.5), color)
  }

  // The strike itself is only animated when the logic confirms it landed, so a
  // cancelled wind-up simply relaxes back to rest.
  function onAttack(event) {
    const mob = event?.mob
    if (!isDrawable(mob)) return
    const entry = entries.get(mob)
    if (entry) entry.strikeLeft = MOB_ANIM.strikeRecovery
    burst(BURSTS.strike, frontPoint(mob), mobPalette(mob.type).strike)
  }

  function addEntry(mob) {
    const variant = variantOf(mob)
    const model = createMobModel(mob.type, { variant })
    group.add(model.root)
    const entry = { mob, model, phase: variant * TAU, windup: 0, strikeLeft: 0, death: 0, finished: false }
    entries.set(mob, entry)
    return entry
  }

  // A death cut short by removal still ends in a puff rather than a pop.
  function removeEntry(entry) {
    if (entry.death > 0) finishDeath(entry)
    entry.model.dispose()
    entries.delete(entry.mob)
  }

  function finishDeath(entry) {
    if (entry.finished) return
    entry.finished = true
    entry.model.root.visible = false
    burst(BURSTS.poof, bodyPoint(entry.mob, 0.25), entry.model.palette.dust)
  }

  function animate(entry, dt) {
    const { mob, model } = entry
    syncTransform(model.root, mob)
    advanceTimers(entry, dt)
    const pose = computeMobPose(
      {
        time,
        phase: entry.phase,
        walkCycle: mob.anim?.walkCycle,
        moving: mob.anim?.moving,
        windup: entry.windup,
        strike: strikeWeight(entry),
        hurt: hurtAmount(mob),
        death: entry.death,
      },
      model.motion,
    )
    model.applyPose(pose)
    model.setHurt(pose.hurt)
    if (entry.death >= 1) finishDeath(entry)
  }

  // Keeps exactly one model per mob in `mobs` (the manager's list, dying mobs
  // included): new mobs get a model, mobs that left the list lose theirs.
  function update(mobs, dt) {
    if (disposed) return
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_FRAME_DT) : 0
    time += step
    const present = new Set()
    for (const mob of asIterable(mobs)) {
      if (!isDrawable(mob) || present.has(mob)) continue
      present.add(mob)
      animate(entries.get(mob) ?? addEntry(mob), step)
    }
    for (const entry of [...entries.values()]) if (!present.has(entry.mob)) removeEntry(entry)
  }

  // Drops every model immediately (world reset, respawn); no particles.
  function clear() {
    for (const entry of entries.values()) entry.model.dispose()
    entries.clear()
  }

  function dispose() {
    if (disposed) return
    disposed = true
    clear()
    for (const unsubscribe of unsubscribers) unsubscribe()
    group.removeFromParent()
    disposeMobGeometries()
  }

  return {
    group,
    update,
    clear,
    dispose,
    get modelCount() {
      return entries.size
    },
    modelFor(mob) {
      return entries.get(mob)?.model ?? null
    },
  }
}

// Turns animation inputs into one renderable pose. Inputs: time (s), phase
// (per-mob offset), walkCycle (radians), moving 0..1, and the 0..1 weights
// windup, strike, hurt and death. `motion` holds the type's amplitudes.
export function computeMobPose(input = {}, motion = DEFAULT_MOTION) {
  const time = finiteOr(input.time, 0)
  const phase = finiteOr(input.phase, 0)
  const cycle = finiteOr(input.walkCycle, 0)
  const death = clamp01(input.death)
  const alive = 1 - death
  const walk = clamp01(input.moving) * alive
  const idle = (1 - walk) * alive
  const breath = Math.sin(time * motion.breathRate + phase) * idle * motion.breath
  const step = Math.sin(cycle)
  return {
    breathe: breath,
    bob: breath * 0.5 + Math.abs(Math.cos(cycle)) * walk * motion.bob,
    stride: step * walk * motion.stride,
    sway: step * walk * motion.sway,
    flutter: Math.sin(time * 3.3 + phase * 2) * 0.1 * idle + Math.cos(cycle) * 0.25 * walk,
    blink: blinkAt(time + phase * 7, motion.blinkEvery) * alive,
    pulse: 0.5 + 0.5 * Math.sin(time * 2.4 + phase),
    windup: clamp01(input.windup) * alive,
    strike: clamp01(input.strike) * alive,
    hurt: clamp01(input.hurt),
    death,
  }
}

// Strike follow-through for elapsed fraction t: snaps to the impact pose
// almost immediately, then eases back to rest by t = 1.
export function strikeEnvelope(t) {
  return Math.max(0, Math.sin(Math.PI * Math.pow(clamp01(t), 0.35)))
}

function advanceTimers(entry, dt) {
  entry.windup = approach(entry.windup, windupTarget(entry.mob), WINDUP_RESPONSE, dt)
  entry.strikeLeft = Math.max(0, entry.strikeLeft - dt)
  entry.death = Math.max(entry.death, deathProgress(entry.mob))
}

// Wind-up weight from mob.windup, the time left until the strike lands (0
// once the strike lands or the brain cancels it, so a cancelled wind-up
// relaxes at once). The strike itself comes from the 'mob:attack' event.
function windupTarget(mob) {
  if (mob.state === 'dying' || !(mob.windup > 0)) return 0
  const t = clamp01(1 - mob.windup / MOB_RULES.attackWindup)
  return t * (2 - t)
}

function strikeWeight(entry) {
  if (entry.strikeLeft <= 0) return 0
  return strikeEnvelope(1 - entry.strikeLeft / MOB_ANIM.strikeRecovery)
}

function hurtAmount(mob) {
  return clamp01(finiteOr(mob.anim?.hurtTimer, 0) / MOB_ANIM.hurtDuration)
}

function deathProgress(mob) {
  if (mob.state !== 'dying') return 0
  const remaining = clamp(finiteOr(mob.anim?.deathTimer, 0), 0, MOB_ANIM.deathDuration)
  return 1 - remaining / MOB_ANIM.deathDuration
}

function blinkAt(time, every) {
  if (!(every > 0)) return 0
  const t = ((time % every) + every) % every
  return t < BLINK_TIME ? Math.sin((t / BLINK_TIME) * Math.PI) : 0
}

function syncTransform(root, mob) {
  root.position.set(mob.position.x, mob.position.y, mob.position.z)
  root.rotation.y = finiteOr(mob.yaw, 0)
}

function isDrawable(mob) {
  return Boolean(mob) && typeof mob === 'object' && hasMobModel(mob.type) && isFinitePoint(mob.position)
}

function asIterable(mobs) {
  return mobs && typeof mobs[Symbol.iterator] === 'function' ? mobs : []
}

// Stable 0..1 per-mob value from its id, so each individual looks and
// breathes a little differently.
function variantOf(mob) {
  return Number.isInteger(mob.id) ? hash3(mob.id, 17, 5, 0x6d0b) : 0
}

// A point on the mob's vertical axis, `fraction` of the way up its body.
function bodyPoint(mob, fraction) {
  return { x: mob.position.x, y: mob.position.y + finiteOr(mob.height, 1) * fraction, z: mob.position.z }
}

// Where a strike lands: just in front of the mob, low on its body.
function frontPoint(mob) {
  const forward = lookDirection(finiteOr(mob.yaw, 0), 0)
  const reach = finiteOr(mob.width / 2, 0.4) + 0.35
  const point = bodyPoint(mob, 0.35)
  return { x: point.x + forward.x * reach, y: point.y, z: point.z + forward.z * reach }
}
