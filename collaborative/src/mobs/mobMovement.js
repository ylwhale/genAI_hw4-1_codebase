// Mob movement through shared voxel physics, including hops, knockback, and separation.

import { PHYSICS_STEP } from '../config.js'
import { horizontalDirection } from '../core/geometry.js'
import { TAU, approach, clamp, finiteOr, wrapAngle, yawFromDirection } from '../core/math.js'
import { applyGravity, bodyCollides, boxCollides, liftOutOfBlocks, moveBody } from '../world/physics.js'
import { mobBox, mobType } from './mob.js'

export const MOB_MOVEMENT = Object.freeze({
  turnRate: 10, // 1/s, exponential approach of yaw toward the facing direction
  stepProbe: 0.3, // look-ahead distance used to spot a one-block step
  stepHeight: 1,
  knockbackSpeed: 3.5, // initial shove from a melee hit, units per second
  knockbackDecay: 12, // 1/s; about 5 % of the shove is left after 0.25 s
  maxLift: 2, // how far an embedded mob may be raised to free it
  strideRadians: TAU / 1.2, // walk cycle advance per unit travelled
  movingRate: 8, // 1/s, smoothing of anim.moving
  blockedProgress: 0.5, // below this fraction of the intended travel a wall stopped us
})

const EPSILON = 1e-9
const NO_PUSH = Object.freeze({ x: 0, z: 0 })
const STILL = Object.freeze({ moveX: 0, moveZ: 0, speed: 0, faceX: 0, faceZ: 0, attack: false })

// Moves the mob for dt seconds (sub-stepped to PHYSICS_STEP). Returns
// { blocked, jumped, blockedX, blockedZ }; blocked means a wall stopped the
// intended walk while on the ground (never while airborne or mid-hop).
export function moveMob(world, mob, intent, dt, { push } = {}) {
  const result = { blocked: false, jumped: false, blockedX: false, blockedZ: false }
  if (!Number.isFinite(dt) || dt <= 0) return result
  const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP - 1e-6))
  const walk = intent ?? STILL
  const extra = push ?? NO_PUSH
  for (let i = 0; i < steps; i++) mergeStep(result, stepMob(world, mob, walk, dt / steps, extra))
  return result
}

// A short horizontal shove away from `from` (the attacker's position). An
// attacker standing exactly on the mob shoves it straight backwards from the
// way it faces.
export function applyKnockback(mob, from, speed = MOB_MOVEMENT.knockbackSpeed) {
  if (!from || !Number.isFinite(from.x) || !Number.isFinite(from.z) || !Number.isFinite(speed)) return false
  const away = horizontalDirection(from, mob.position)
  const [dx, dz] = away.length > 0 ? [away.x, away.z] : [Math.sin(mob.yaw), Math.cos(mob.yaw)]
  mob.knockback.x = dx * speed
  mob.knockback.z = dz * speed
  return true
}

function stepMob(world, mob, intent, dt, push) {
  if (!ensureFree(world, mob)) return holdStill(mob)
  const move = desiredMove(intent)
  decayKnockback(mob.knockback, dt)
  mob.velocity.x = move.x + mob.knockback.x + push.x
  mob.velocity.z = move.z + mob.knockback.z + push.z
  turnToward(mob, facing(intent, move), dt)

  const grounded = mob.onGround
  const jumped = grounded && move.speed > 0 && canStepUp(world, mob, move)
  if (jumped) mob.velocity.y = mobType(mob).jumpSpeed
  const start = { x: mob.position.x, z: mob.position.z }
  applyGravity(mob, dt)
  const hit = moveBody(world, mob, dt)
  animateWalk(mob, start, dt)

  const stopped = (hit.blockedX || hit.blockedZ) && littleProgress(mob, start, move, dt)
  const blocked = grounded && !jumped && move.speed > 0 && stopped
  return { blocked, jumped, blockedX: hit.blockedX, blockedZ: hit.blockedZ }
}

function mergeStep(result, step) {
  result.blocked ||= step.blocked
  result.jumped ||= step.jumped
  result.blockedX ||= step.blockedX
  result.blockedZ ||= step.blockedZ
}

// Embedded (e.g. the world changed around it): rise to the nearest free
// space a little above; if there is none, stay put rather than teleporting.
function ensureFree(world, mob) {
  return !bodyCollides(world, mob) || liftOutOfBlocks(world, mob, MOB_MOVEMENT.maxLift)
}

function holdStill(mob) {
  mob.velocity.x = 0
  mob.velocity.z = 0
  return { blocked: false, jumped: false, blockedX: false, blockedZ: false }
}

function desiredMove(intent) {
  const x = finiteOr(intent.moveX, 0)
  const z = finiteOr(intent.moveZ, 0)
  const length = Math.hypot(x, z)
  const speed = finiteOr(intent.speed, 0)
  if (length < EPSILON || speed <= 0) return { x: 0, z: 0, dirX: 0, dirZ: 0, speed: 0 }
  const dirX = x / length
  const dirZ = z / length
  return { x: dirX * speed, z: dirZ * speed, dirX, dirZ, speed }
}

function decayKnockback(knockback, dt) {
  knockback.x = approach(knockback.x, 0, MOB_MOVEMENT.knockbackDecay, dt)
  knockback.z = approach(knockback.z, 0, MOB_MOVEMENT.knockbackDecay, dt)
  if (Math.hypot(knockback.x, knockback.z) < 0.01) knockback.x = knockback.z = 0
}

// Explicit facing wins (attacking stands still but faces the target);
// otherwise face the walking direction; idle keeps the current yaw.
function facing(intent, move) {
  const x = finiteOr(intent.faceX, 0)
  const z = finiteOr(intent.faceZ, 0)
  if (Math.hypot(x, z) > EPSILON) return { x, z }
  return move.speed > 0 ? { x: move.dirX, z: move.dirZ } : null
}

// Ease yaw toward the facing direction along the shorter way round (yaw 0
// faces -Z, the camera convention).
function turnToward(mob, direction, dt) {
  if (!direction) return
  const gap = wrapAngle(yawFromDirection(direction.x, direction.z) - mob.yaw)
  mob.yaw = wrapAngle(mob.yaw + gap * (1 - Math.exp(-MOB_MOVEMENT.turnRate * dt)))
}

// A hop is worth taking when something blocks the way at foot level, the
// same footprint one block higher is free, and there is headroom to rise.
// boxCollides uses the collision view, so the world's outer walls never
// count as free space.
function canStepUp(world, mob, move) {
  const { stepProbe, stepHeight } = MOB_MOVEMENT
  const box = mobBox(mob)
  const ahead = shiftBox(box, move.dirX * stepProbe, 0, move.dirZ * stepProbe)
  if (!boxCollides(world, ahead)) return false // nothing in the way
  const stepIsClear = !boxCollides(world, shiftBox(ahead, 0, stepHeight, 0))
  const hasHeadroom = !boxCollides(world, shiftBox(box, 0, stepHeight, 0))
  return stepIsClear && hasHeadroom
}

function littleProgress(mob, start, move, dt) {
  const progress = (mob.position.x - start.x) * move.dirX + (mob.position.z - start.z) * move.dirZ
  return progress < MOB_MOVEMENT.blockedProgress * move.speed * dt
}

// Legs follow the distance actually covered; `moving` eases toward 0..1.
function animateWalk(mob, start, dt) {
  const { anim } = mob
  const travelled = Math.hypot(mob.position.x - start.x, mob.position.z - start.z)
  anim.walkCycle = (anim.walkCycle + travelled * MOB_MOVEMENT.strideRadians) % TAU
  const target = clamp(travelled / dt / mobType(mob).wanderSpeed, 0, 1)
  anim.moving = approach(anim.moving, target, MOB_MOVEMENT.movingRate, dt)
}

function shiftBox(box, dx, dy, dz) {
  return {
    minX: box.minX + dx,
    minY: box.minY + dy,
    minZ: box.minZ + dz,
    maxX: box.maxX + dx,
    maxY: box.maxY + dy,
    maxZ: box.maxZ + dz,
  }
}
