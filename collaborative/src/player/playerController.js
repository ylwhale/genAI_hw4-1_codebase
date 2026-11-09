// Movement and jumping through shared voxel physics. Input is supplied by the caller;
// dt is in seconds.

import { MAX_FRAME_DT, PHYSICS_STEP, PLAYER } from '../config.js'
import { clamp } from '../core/math.js'
import { applyGravity, bodyCollides, liftOutOfBlocks, moveBody } from '../world/physics.js'

export const EMBED_MAX_LIFT = 3 // blocks an embedded player may be raised per step
const IDLE_CONTROLS = Object.freeze({ wish: Object.freeze({ x: 0, z: 0 }), jump: false })

// Advance the player by dt seconds. Long calls are split into sub-steps no
// larger than PHYSICS_STEP (and frames are capped at MAX_FRAME_DT), so the
// result does not depend on how the caller slices time.
// input: { forward, backward, left, right, jump } booleans. Returns { jumped }.
export function updatePlayer(player, world, input, dt) {
  if (!(Number.isFinite(dt) && dt > 0)) return { jumped: false }
  const total = Math.min(dt, MAX_FRAME_DT)
  const steps = Math.max(1, Math.ceil(total / PHYSICS_STEP - 1e-6))
  const controls = readControls(player, input)
  let jumped = false
  for (let i = 0; i < steps; i++) {
    if (stepPlayer(player, world, controls, total / steps)) jumped = true
  }
  return { jumped }
}

// Unit wish direction on the XZ plane relative to the camera yaw. Opposite
// keys cancel and diagonals are normalised so they are not faster.
export function wishDirection(yaw, input) {
  const forward = keyAxis(input?.forward, input?.backward)
  const strafe = keyAxis(input?.right, input?.left)
  const length = Math.hypot(forward, strafe)
  if (length === 0 || !Number.isFinite(yaw)) return { x: 0, z: 0 }
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  // Camera forward is (-sin, -cos) and camera right is (cos, -sin).
  return {
    x: (-sin * forward + cos * strafe) / length,
    z: (-cos * forward - sin * strafe) / length,
  }
}

// Horizontal speed as a 0..1 fraction of walking speed (drives the hand bob).
export function movementAmount(player) {
  return clamp(Math.hypot(player.velocity.x, player.velocity.z) / PLAYER.walkSpeed, 0, 1)
}

// A dead player keeps falling under gravity but ignores all movement keys.
function readControls(player, input) {
  if (player.health?.isDead) return IDLE_CONTROLS
  return { wish: wishDirection(player.yaw, input), jump: Boolean(input?.jump) }
}

function keyAxis(positive, negative) {
  return (positive ? 1 : 0) - (negative ? 1 : 0)
}

function stepPlayer(player, world, controls, dt) {
  if (bodyCollides(world, player)) liftOutOfBlocks(world, player, EMBED_MAX_LIFT)
  const jumped = controls.jump && tryJump(player)
  steer(player, controls.wish, dt)
  applyGravity(player, dt)
  moveBody(world, player, dt)
  return jumped
}

// Jumping needs ground contact from the previous step, so holding Space can
// never jump again in mid-air; it simply re-jumps on landing. A body already
// launched upward this step (e.g. a knockback hop) counts as airborne.
function tryJump(player) {
  if (!player.onGround || player.velocity.y > 0) return false
  player.velocity.y = PLAYER.jumpSpeed
  player.onGround = false
  return true
}

// Move the horizontal velocity toward the wish velocity by at most accel * dt:
// snappy on the ground, gentler steering in the air. Because the change is
// capped rather than snapped, knockback added by the game bleeds off smoothly.
function steer(player, wish, dt) {
  const velocity = player.velocity
  const targetX = wish.x * PLAYER.walkSpeed
  const targetZ = wish.z * PLAYER.walkSpeed
  const gapX = targetX - velocity.x
  const gapZ = targetZ - velocity.z
  const gap = Math.hypot(gapX, gapZ)
  const maxChange = (player.onGround ? PLAYER.groundAccel : PLAYER.airAccel) * dt
  if (gap <= maxChange) {
    velocity.x = targetX
    velocity.z = targetZ
    return
  }
  velocity.x += (gapX / gap) * maxChange
  velocity.z += (gapZ / gap) * maxChange
}
