// Break/place checks shared by action start, progress, and completion.

import { REACH } from '../config.js'
import { blockBox, boxesOverlap, distanceToBox, isCell, isFinitePoint } from '../core/geometry.js'
import { SKIN } from '../world/physics.js'
import { BLOCK, HOTBAR_BLOCKS, isSolidBlock } from '../world/blocks.js'

const OK = Object.freeze({ ok: true })
const FLOOR_Y = 0 // the bottom stone layer is the unbreakable world floor
const PLACEABLE = new Set(HOTBAR_BLOCKS.filter(isSolidBlock))

function reject(reason) {
  return { ok: false, reason }
}

// A malformed reach falls back to the game rule instead of disabling the check.
function resolveReach(reach) {
  return typeof reach === 'number' && reach >= 0 ? reach : REACH
}

// Reach is measured from the camera to the nearest point of the block. A
// missing or invalid eye fails closed: nothing is reachable without a camera.
function withinReach(eye, box, reach) {
  return isFinitePoint(eye) && distanceToBox(eye, box) <= reach
}

// A raycast hit also carries the distance at which the ray entered the block.
function hitWithinReach(hit, reach) {
  return hit.distance == null || hit.distance <= reach
}

export function isPlaceableBlock(blockId) {
  return PLACEABLE.has(blockId)
}

export function evaluateBreak(world, hit, { eye, reach = REACH } = {}) {
  if (!hit) return reject('no-target')
  if (!isCell(hit) || !world.inBounds(hit.x, hit.y, hit.z)) return reject('out-of-bounds')
  if (!world.isSolid(hit.x, hit.y, hit.z)) return reject('air')
  if (hit.y === FLOOR_Y) return reject('protected-floor')
  const limit = resolveReach(reach)
  const box = blockBox(hit.x, hit.y, hit.z)
  if (!withinReach(eye, box, limit) || !hitWithinReach(hit, limit)) return reject('out-of-reach')
  return OK
}

// The empty cell in front of the hit face, or null when there is no usable
// face (no hit, or a ray that started inside a block and has a zero normal).
export function placementCell(hit) {
  if (!isCell(hit) || !isUnitAxis(hit.normal)) return null
  return { x: hit.x + hit.normal.x, y: hit.y + hit.normal.y, z: hit.z + hit.normal.z }
}

function isUnitAxis(normal) {
  return isCell(normal) && Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z) === 1
}

export function evaluatePlace(world, cell, { eye, reach = REACH, blockId, obstacles = [] } = {}) {
  if (!cell) return reject('no-target')
  if (!isPlaceableBlock(blockId)) return reject('invalid-block')
  if (!isCell(cell) || !world.inBounds(cell.x, cell.y, cell.z)) return reject('out-of-bounds')
  if (world.getBlock(cell.x, cell.y, cell.z) !== BLOCK.AIR) return reject('occupied')
  const box = blockBox(cell.x, cell.y, cell.z)
  if (!withinReach(eye, box, resolveReach(reach))) return reject('out-of-reach')
  if (overlapsAnyObstacle(box, obstacles)) return reject('blocked-by-entity')
  return OK
}

// A block may sit flush against an entity (directly under its feet or against
// its side) but must not intrude into it. "Flush" uses the physics contact
// tolerance: a resting body can settle up to SKIN into the block below it, and
// the collision code ignores overlaps that small, so they cannot trap anyone.
function overlapsAnyObstacle(box, obstacles) {
  if (!Array.isArray(obstacles)) return false
  return obstacles.some((obstacle) => isBox(obstacle) && boxesOverlap(box, obstacle, SKIN))
}

function isBox(value) {
  return Boolean(value) && ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'].every((key) => typeof value[key] === 'number')
}
