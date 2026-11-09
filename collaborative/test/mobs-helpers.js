// Shared fixtures for the mob test files (AI, movement, spawns, manager).

import { createEventBus } from '../src/core/events.js'
import { createMob } from '../src/mobs/mob.js'
import { createMobManager } from '../src/mobs/mobManager.js'

export const GROUND_Y = 4 // feet height on createFlatWorld({ groundTop: 3 })

// A mob standing on the ground at a fixed seed (deterministic wander).
export function makeMob(type = 'mossling', position = { x: 5.5, y: GROUND_Y, z: 5.5 }, seed = 1) {
  const mob = createMob(type, position, { seed })
  mob.onGround = true
  return mob
}

export function makeTarget(x, y, z, { height = 1.8, active = true } = {}) {
  return { position: { x, y, z }, height, active }
}

// A perception snapshot for brain tests (no world needed).
export function sees({ distance, hasLineOfSight = true, targetActive = true, dirX = 1, dirZ = 0, horizontalDistance } = {}) {
  return { distance, horizontalDistance: horizontalDistance ?? distance, hasLineOfSight, targetActive, dirX, dirZ }
}

// Constant-direction walking intent.
export function walkIntent(dirX, dirZ, speed) {
  return { moveX: dirX, moveZ: dirZ, speed, faceX: dirX, faceZ: dirZ, attack: false }
}

// A manager whose mobs are spawned normally and then moved to exact spots,
// so tests control the geometry. placements: [{ type, x, y, z }] (spawns come
// back in plan order, so mobs[i] belongs to placements[i]).
export function stageManager(world, placements, { seed = 7, events = createEventBus(), farFrom = { x: 0.5, y: 0, z: 0.5 } } = {}) {
  const manager = createMobManager({ world, events, seed, plan: placements.map((placement) => placement.type) })
  manager.spawnAll(farFrom)
  const mobs = manager.mobs
  if (mobs.length !== placements.length) throw new Error('test setup: not enough spawn columns')
  placements.forEach(({ x, y, z }, index) => {
    Object.assign(mobs[index].position, { x, y, z })
    mobs[index].onGround = true
  })
  return { manager, events, mobs }
}

// Records every payload of the given event types: { type: [payload, ...] }.
export function recordEvents(events, types) {
  const log = Object.fromEntries(types.map((type) => [type, []]))
  for (const type of types) events.on(type, (payload) => log[type].push(payload))
  return log
}

// Drives manager.update for `seconds` at a fixed dt and returns the step
// index (1-based) of every strike, plus the total strike list.
export function runManager(manager, seconds, dt, target, each = () => {}) {
  const strikes = []
  const steps = Math.round(seconds / dt)
  for (let i = 1; i <= steps; i++) {
    each(i)
    for (const attack of manager.update(dt, target)) strikes.push({ step: i, ...attack })
  }
  return strikes
}
