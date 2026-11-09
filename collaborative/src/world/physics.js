// Axis-separated AABB vs voxel collision shared by the player, mobs, and spawn checks.
// A body has { position, velocity, width, height, onGround }; position is its feet centre.

import { GRAVITY, TERMINAL_VELOCITY } from '../config.js'
import { bodyBox } from '../core/geometry.js'

export const SKIN = 1e-4 // gap kept between a body and the block it rests against
const MAX_AXIS_STEP = 0.45 // sub-step size that prevents tunnelling

export function applyGravity(body, dt, gravity = GRAVITY) {
  body.velocity.y = Math.max(body.velocity.y - gravity * dt, -TERMINAL_VELOCITY)
}

// True if any solid (or out-of-bounds) voxel overlaps the box.
export function boxCollides(world, box) {
  const x0 = Math.floor(box.minX + SKIN)
  const x1 = Math.floor(box.maxX - SKIN)
  const y0 = Math.floor(box.minY + SKIN)
  const y1 = Math.floor(box.maxY - SKIN)
  const z0 = Math.floor(box.minZ + SKIN)
  const z1 = Math.floor(box.maxZ - SKIN)
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (world.isSolidForCollision(x, y, z)) return true
      }
    }
  }
  return false
}

export function bodyCollides(world, body) {
  return boxCollides(world, bodyBox(body.position, body.width, body.height))
}

// Move along one axis, stopping flush against the first solid voxel.
// Returns true when movement was blocked.
function moveAxis(world, body, axis, delta) {
  if (delta === 0) return false
  const steps = Math.ceil(Math.abs(delta) / MAX_AXIS_STEP)
  const step = delta / steps
  for (let i = 0; i < steps; i++) {
    const before = body.position[axis]
    body.position[axis] = before + step
    if (bodyCollides(world, body)) {
      body.position[axis] = resolveAxis(body, axis, step, before)
      if (bodyCollides(world, body)) body.position[axis] = before
      return true
    }
  }
  return false
}

// Snap the body flush with the voxel boundary it ran into along `axis`.
function resolveAxis(body, axis, step, before) {
  const half = axis === 'y' ? 0 : body.width / 2
  if (step > 0) {
    const extent = axis === 'y' ? body.height : half
    const edge = Math.floor(body.position[axis] + extent - SKIN)
    return Math.max(before, edge - extent - SKIN)
  }
  const edge = Math.floor(body.position[axis] - half + SKIN) + 1
  return Math.min(before, edge + half + SKIN)
}

// Integrate velocity over dt with collision. Updates position, zeroes the
// velocity component of any blocked axis, and sets body.onGround.
// Returns { blockedX, blockedY, blockedZ }.
export function moveBody(world, body, dt) {
  const blockedY = moveAxis(world, body, 'y', body.velocity.y * dt)
  const falling = body.velocity.y <= 0
  if (blockedY) body.velocity.y = 0
  const blockedX = moveAxis(world, body, 'x', body.velocity.x * dt)
  if (blockedX) body.velocity.x = 0
  const blockedZ = moveAxis(world, body, 'z', body.velocity.z * dt)
  if (blockedZ) body.velocity.z = 0
  body.onGround = falling && (blockedY || isSupported(world, body))
  return { blockedX, blockedY, blockedZ }
}

// Recovery for a body found inside blocks (e.g. after loading edits): raise it
// to the first free height in its column. Returns true if it moved.
export function liftOutOfBlocks(world, body, maxLift = world.height) {
  if (!bodyCollides(world, body)) return false
  const startY = body.position.y
  for (let lift = 1; lift <= maxLift; lift++) {
    body.position.y = Math.floor(startY) + lift + SKIN
    if (!bodyCollides(world, body)) {
      body.velocity.y = 0
      return true
    }
  }
  body.position.y = startY
  return false
}

// True when a solid voxel lies directly beneath the body's feet.
export function isSupported(world, body) {
  const box = bodyBox(body.position, body.width, body.height)
  return boxCollides(world, { ...box, minY: box.minY - 0.02, maxY: box.minY })
}
