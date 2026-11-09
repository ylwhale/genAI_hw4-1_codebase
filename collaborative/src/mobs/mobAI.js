// Turns perception into movement intent. Movement and damage are applied elsewhere.
//
//   wander --target within detectRange--> chase --within attackRange + sight--> attack
//      ^                                     |          (+ on the ground)        |
//      +---- target far / inactive ----------+------ out of range or sight -------+
//   any --health reaches 0--> dying (terminal)

import { MOB_RULES } from '../config.js'
import { distance3, horizontalDirection, horizontalDistance, isFinitePoint } from '../core/geometry.js'
import { TAU } from '../core/math.js'
import { segmentIsClear } from '../world/raycast.js'
import { MOB_ANIM, isMobAlive, mobEyePosition, mobType } from './mob.js'

export const MOB_AI = Object.freeze({
  chestHeight: 0.6, // fraction of the target's height used as the line-of-sight aim point
  idleTime: [1, 3],
  walkTime: [1.5, 3.5],
  sidestepTime: [0.6, 1.0],
  giveUpTime: [2, 3],
  blockMemory: 4, // seconds a blocked chase step is remembered
  blockLimit: 3, // blocked events within that memory that make a chaser give up
  chaseStopDistance: 0.9, // horizontal distance at which a chaser stops pressing in
})

const EPSILON = 1e-9

const UNAWARE = Object.freeze({
  distance: Infinity,
  horizontalDistance: Infinity,
  hasLineOfSight: false,
  targetActive: false,
  dirX: 0,
  dirZ: 0,
})

// target = { position (feet), height, active }. Sight runs from the mob's eye
// to the target's chest, through the same voxel ray used everywhere else.
// dirX/dirZ are (0, 0) when the target is straight above or below.
export function perceive(mob, target, world) {
  if (!isFinitePoint(target?.position)) return { ...UNAWARE }
  const { position } = target
  const toward = horizontalDirection(mob.position, position)
  const height = Number.isFinite(target.height) ? target.height : 0
  const chest = { x: position.x, y: position.y + MOB_AI.chestHeight * height, z: position.z }
  return {
    distance: distance3(mob.position, position),
    horizontalDistance: horizontalDistance(mob.position, position),
    hasLineOfSight: segmentIsClear(world, mobEyePosition(mob), chest),
    targetActive: target.active === true,
    dirX: toward.x,
    dirZ: toward.z,
  }
}

// Returns intent { moveX, moveZ, speed, faceX, faceZ, attack }. attack is true
// only on the step a wound-up strike lands. Invalid dt changes nothing.
export function updateMobBrain(mob, perception, dt) {
  if (!Number.isFinite(dt) || dt < 0) return createIntent()
  const seen = perception ?? UNAWARE
  tickTimers(mob, dt)
  const next = selectState(mob, seen)
  if (next !== mob.state) enterState(mob, next)
  return BEHAVIOURS[mob.state](mob, seen, dt)
}

// Movement feedback: the body was stopped by a wall it could not hop.
// `contact` = { blockedX, blockedZ } lets a wanderer turn away from the wall.
export function notifyBlocked(mob, contact = {}) {
  if (mob.state === 'wander') redirectWander(mob, contact)
  else if (mob.state === 'chase') chaseBlocked(mob)
}

// A mob only starts an attack with its feet on the ground (an attacker that
// is knocked airborne keeps attacking). Otherwise a mob hopping up to a
// player on a ledge would come into range mid-jump, stop dead, fall back out
// of range, and hop again forever instead of climbing.
function selectState(mob, seen) {
  if (!isMobAlive(mob)) return 'dying'
  if (!seen.targetActive) return 'wander'
  const canEngage = mob.onGround || mob.state === 'attack'
  if (seen.distance <= MOB_RULES.attackRange && seen.hasLineOfSight && canEngage) return 'attack'
  if (seen.distance <= MOB_RULES.detectRange && mob.chase.giveUpTimer <= 0) return 'chase'
  return 'wander'
}

function enterState(mob, next) {
  // Leaving the attack state (range or sight lost) cancels a pending strike.
  if (mob.state === 'attack') cancelWindup(mob)
  // Every engagement opens with a full, visible wind-up.
  if (next === 'attack') mob.attackCooldown = Math.max(mob.attackCooldown, MOB_RULES.attackWindup)
  if (next === 'chase') clearSidestep(mob.chase)
  mob.state = next
}

// Only the brain counts the attack cooldown down; the manager handles anims.
function tickTimers(mob, dt) {
  const { chase } = mob
  mob.attackCooldown = Math.max(0, mob.attackCooldown - dt)
  chase.giveUpTimer = Math.max(0, chase.giveUpTimer - dt)
  if (chase.recentBlocks.length > 0) {
    chase.recentBlocks = chase.recentBlocks.map((left) => left - dt).filter((left) => left > 0)
  }
}

// state behaviours (one function per state)

function wander(mob, seen, dt) {
  const state = mob.wander
  state.timer -= dt
  if (state.timer <= 0) toggleWander(mob)
  if (state.mode !== 'walk') return createIntent()
  return moveIntent(state.dirX, state.dirZ, mobType(mob).wanderSpeed)
}

function chase(mob, seen, dt) {
  const state = mob.chase
  const { speed } = mobType(mob)
  state.aimX = seen.dirX
  state.aimZ = seen.dirZ
  if (state.sidestepTimer > 0) {
    state.sidestepTimer = Math.max(0, state.sidestepTimer - dt)
    return moveIntent(state.sideX, state.sideZ, speed)
  }
  if (seen.horizontalDistance <= MOB_AI.chaseStopDistance) return faceIntent(seen.dirX, seen.dirZ)
  return moveIntent(seen.dirX, seen.dirZ, speed)
}

// Stand, face the target, wind up, strike. The wind-up starts once the
// cooldown is within attackWindup and ends exactly when it expires, so
// continuous contact strikes every attackCooldown seconds.
function attack(mob, seen, dt) {
  const intent = faceIntent(seen.dirX, seen.dirZ)
  if (mob.windup > 0) mob.windup -= dt
  else if (mob.attackCooldown <= MOB_RULES.attackWindup) beginWindup(mob)
  else return intent // still recovering from the previous strike
  if (mob.windup <= EPSILON) {
    strike(mob)
    intent.attack = true
  }
  return intent
}

function dying() {
  return createIntent()
}

const BEHAVIOURS = Object.freeze({ wander, chase, attack, dying })

// helpers

function beginWindup(mob) {
  mob.windup = mob.attackCooldown
  mob.anim.attackTimer = mob.windup + MOB_ANIM.strikeRecovery
}

function strike(mob) {
  mob.windup = 0
  mob.attackCooldown = MOB_RULES.attackCooldown
}

// A pending strike is called off: the wind-up animation ends with it. The
// follow-through of a strike that already landed (windup 0) plays on.
function cancelWindup(mob) {
  if (!(mob.windup > 0)) return
  mob.windup = 0
  mob.anim.attackTimer = 0
}

// Alternate idle pauses with slow walks in rng-chosen directions.
function toggleWander(mob) {
  const { wander: state, rng } = mob
  if (state.mode === 'walk') {
    state.mode = 'idle'
    state.timer = rng.range(...MOB_AI.idleTime)
    return
  }
  const angle = rng.range(0, TAU)
  startWalk(state, Math.cos(angle), Math.sin(angle), rng.range(...MOB_AI.walkTime))
}

// New random heading, flipped on any axis that points back into the wall.
function redirectWander(mob, { blockedX = false, blockedZ = false }) {
  const { wander: state, rng } = mob
  const angle = rng.range(0, TAU)
  let dirX = Math.cos(angle)
  let dirZ = Math.sin(angle)
  if (blockedX && Math.sign(dirX) === Math.sign(state.dirX)) dirX = -dirX
  if (blockedZ && Math.sign(dirZ) === Math.sign(state.dirZ)) dirZ = -dirZ
  startWalk(state, dirX, dirZ, rng.range(...MOB_AI.walkTime))
}

// Blocked while chasing: sidestep perpendicular to the target (flipping if
// that is blocked too); after repeated failures give up and wander a while.
function chaseBlocked(mob) {
  const state = mob.chase
  state.recentBlocks.push(MOB_AI.blockMemory)
  if (state.recentBlocks.length >= MOB_AI.blockLimit) giveUpChase(mob)
  else if (state.sidestepTimer > 0) flipSidestep(state)
  else startSidestep(mob)
}

function startSidestep(mob) {
  const { chase: state, rng } = mob
  const [aimX, aimZ] = headingOr(state.aimX, state.aimZ, rng)
  const side = rng.chance(0.5) ? 1 : -1
  state.sideX = -aimZ * side
  state.sideZ = aimX * side
  state.sidestepTimer = rng.range(...MOB_AI.sidestepTime)
}

function flipSidestep(state) {
  state.sideX = -state.sideX
  state.sideZ = -state.sideZ
}

// Back away from the obstacle (roughly opposite the target) for 2-3 s.
function giveUpChase(mob) {
  const { chase: state, rng } = mob
  const [aimX, aimZ] = headingOr(state.aimX, state.aimZ, rng)
  clearSidestep(state)
  state.recentBlocks = []
  state.giveUpTimer = rng.range(...MOB_AI.giveUpTime)
  const angle = Math.atan2(-aimZ, -aimX) + rng.range(-1, 1)
  startWalk(mob.wander, Math.cos(angle), Math.sin(angle), state.giveUpTimer)
}

function clearSidestep(state) {
  state.sidestepTimer = 0
  state.sideX = 0
  state.sideZ = 0
}

function startWalk(state, dirX, dirZ, timer) {
  state.mode = 'walk'
  state.dirX = dirX
  state.dirZ = dirZ
  state.timer = timer
}

// A unit heading; a random one when the target is straight above or below.
function headingOr(x, z, rng) {
  if (Math.hypot(x, z) > EPSILON) return [x, z]
  const angle = rng.range(0, TAU)
  return [Math.cos(angle), Math.sin(angle)]
}

function createIntent({ moveX = 0, moveZ = 0, speed = 0, faceX = 0, faceZ = 0 } = {}) {
  return { moveX, moveZ, speed, faceX, faceZ, attack: false }
}

function moveIntent(dirX, dirZ, speed) {
  return createIntent({ moveX: dirX, moveZ: dirZ, speed, faceX: dirX, faceZ: dirZ })
}

function faceIntent(dirX, dirZ) {
  return createIntent({ faceX: dirX, faceZ: dirZ })
}
