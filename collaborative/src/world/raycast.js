// Amanatides & Woo DDA traversal to the first solid cell.
// Distances are measured from `origin`, usually the camera.

import { isSolidBlock } from './blocks.js'

// Returns null on a miss, otherwise
// { x, y, z, id, normal: {x,y,z}, distance, point: {x,y,z} }.
// `normal` points out of the hit face toward the ray origin; a ray that starts
// inside a solid block reports that block with a zero normal.
export function raycastBlocks(world, origin, direction, maxDistance) {
  const length = Math.hypot(direction.x, direction.y, direction.z)
  if (!(length > 0) || !(maxDistance > 0)) return null
  const dx = direction.x / length
  const dy = direction.y / length
  const dz = direction.z / length

  let x = Math.floor(origin.x)
  let y = Math.floor(origin.y)
  let z = Math.floor(origin.z)
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0
  const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dx)
  const deltaY = stepY === 0 ? Infinity : Math.abs(1 / dy)
  const deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz)
  let maxX = stepX === 0 ? Infinity : (stepX > 0 ? x + 1 - origin.x : origin.x - x) * deltaX
  let maxY = stepY === 0 ? Infinity : (stepY > 0 ? y + 1 - origin.y : origin.y - y) * deltaY
  let maxZ = stepZ === 0 ? Infinity : (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * deltaZ

  let distance = 0
  let normal = { x: 0, y: 0, z: 0 }
  const leaving = createExitTest(world, stepX, stepY, stepZ)

  while (distance <= maxDistance && !leaving(x, y, z)) {
    const id = world.getBlock(x, y, z)
    if (isSolidBlock(id)) {
      return {
        x,
        y,
        z,
        id,
        normal,
        distance,
        point: { x: origin.x + dx * distance, y: origin.y + dy * distance, z: origin.z + dz * distance },
      }
    }
    if (maxX < maxY && maxX < maxZ) {
      x += stepX
      distance = maxX
      maxX += deltaX
      normal = { x: -stepX, y: 0, z: 0 }
    } else if (maxY < maxZ) {
      y += stepY
      distance = maxY
      maxY += deltaY
      normal = { x: 0, y: -stepY, z: 0 }
    } else {
      z += stepZ
      distance = maxZ
      maxZ += deltaZ
      normal = { x: 0, y: 0, z: -stepZ }
    }
  }
  return null
}

// Once the ray is outside the world box and moving away from it, no solid
// block can follow; this also makes an infinite maxDistance safe.
function createExitTest(world, stepX, stepY, stepZ) {
  const { size, height } = world
  return (x, y, z) =>
    (x < 0 && stepX <= 0) ||
    (x >= size && stepX >= 0) ||
    (z < 0 && stepZ <= 0) ||
    (z >= size && stepZ >= 0) ||
    (y < 0 && stepY <= 0) ||
    (y >= height && stepY >= 0)
}

// True when no solid block lies on the segment from `from` to `to`.
// Used for line-of-sight checks (mob attacks, melee through walls).
export function segmentIsClear(world, from, to) {
  const direction = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
  const length = Math.hypot(direction.x, direction.y, direction.z)
  if (length === 0) return !world.isSolid(Math.floor(from.x), Math.floor(from.y), Math.floor(from.z))
  return raycastBlocks(world, from, direction, length) === null
}
