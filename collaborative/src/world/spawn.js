// Search outward from the centre for ground with headroom and a walkable exit.
// Spawn checks also apply to edited worlds.

import { PLAYER } from '../config.js'
import { bodyBox } from '../core/geometry.js'
import { BLOCK } from './blocks.js'
import { boxCollides } from './physics.js'

const GROUND_BLOCKS = new Set([BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE])
const TREE_BLOCKS = new Set([BLOCK.WOOD, BLOCK.LEAVES])
const HEADROOM = 1 // extra free block above the head
const PIT_DEPTH = 2 // climbing this high above the start means the body got out
const PIT_RADIUS = 4 // walking this far (Chebyshev) from the start also counts as out
const MAX_CLIMB = 1 // a jump clears one block, never two
const NEIGHBOURS = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]])

// Natural ground a body may stand on: not a tree top (wood or leaves).
export function isStandableGround(blockId) {
  return GROUND_BLOCKS.has(blockId)
}

function validateBody(width, height) {
  const valid = (value) => Number.isFinite(value) && value > 0
  if (!valid(width) || !valid(height)) throw new RangeError('spawn body width and height must be positive numbers')
}

// Columns ordered ring by ring (Chebyshev distance from the centre), nearest
// first within a ring, skipping the outermost border columns.
function* ringColumns(size) {
  const centre = Math.floor(size / 2)
  const maxRing = Math.max(centre, size - 1 - centre)
  for (let ring = 0; ring <= maxRing; ring++) {
    for (const column of ringCells(centre, ring)) {
      if (isInterior(column, size)) yield column
    }
  }
}

function ringCells(centre, ring) {
  const cells = []
  for (let dz = -ring; dz <= ring; dz++) {
    for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue
      cells.push({ x: centre + dx, z: centre + dz, distance2: dx * dx + dz * dz })
    }
  }
  return cells.sort((a, b) => a.distance2 - b.distance2 || a.z - b.z || a.x - b.x)
}

function isInterior({ x, z }, size) {
  return x >= 1 && x <= size - 2 && z >= 1 && z <= size - 2
}

function bodyFits(world, position, body, headroom = 0) {
  return !boxCollides(world, bodyBox(position, body.width, body.height + headroom))
}

// Any wood or leaves in the 3 x 3 columns around the body, from the feet up
// to one block above the head.
function treeNearby(world, x, z, feetY, bodyHeight) {
  const topY = Math.floor(feetY + bodyHeight) + 1
  for (let y = feetY; y <= topY; y++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (TREE_BLOCKS.has(world.getBlock(x + dx, y, z + dz))) return true
      }
    }
  }
  return false
}

// A hole the body cannot get out of on foot (a dug shaft, trench, or wider
// pit). Searches outward from (x, z) over 4-neighbours within PIT_RADIUS,
// stepping only onto columns at most MAX_CLIMB higher (drops are fine). The
// column is a pit unless the search climbs PIT_DEPTH above the start or
// reaches the edge of the search radius. `surfaceAt(x, z)` may be a cached
// lookup when many columns are tested against the same world.
export function isPitColumn(world, x, z, surfaceAt = world.surfaceHeight) {
  const start = surfaceAt(x, z)
  const visited = new Set([columnKey(world, x, z)])
  const queue = [{ x, z, surface: start }]
  for (let head = 0; head < queue.length; head++) {
    const column = queue[head]
    if (column.surface - start >= PIT_DEPTH || chebyshev(column, x, z) >= PIT_RADIUS) return false
    for (const next of climbableNeighbours(world, column, visited, surfaceAt)) queue.push(next)
  }
  return true
}

// Memoised surfaceHeight for a world that is not edited in the meantime.
export function createSurfaceLookup(world) {
  const cache = new Map()
  return (x, z) => {
    const key = columnKey(world, x, z)
    if (!cache.has(key)) cache.set(key, world.surfaceHeight(x, z))
    return cache.get(key)
  }
}

// Unvisited in-bounds neighbours the body can walk, hop, or drop onto from
// `column`; each is marked visited once queued.
function climbableNeighbours(world, column, visited, surfaceAt) {
  const found = []
  for (const [dx, dz] of NEIGHBOURS) {
    const next = { x: column.x + dx, z: column.z + dz, surface: 0 }
    const key = columnKey(world, next.x, next.z)
    if (visited.has(key) || !world.inBounds(next.x, 0, next.z)) continue
    next.surface = surfaceAt(next.x, next.z)
    if (next.surface - column.surface > MAX_CLIMB) continue
    visited.add(key)
    found.push(next)
  }
  return found
}

// Numeric key of an in-bounds column (out-of-bounds keys are never stored).
function columnKey(world, x, z) {
  return z * world.size + x
}

function chebyshev(column, x, z) {
  return Math.max(Math.abs(column.x - x), Math.abs(column.z - z))
}

// Feet position on top of column (x, z), or null when it is not a safe spawn.
function standingSpot(world, { x, z }, body) {
  const surface = world.surfaceHeight(x, z)
  if (surface < 0 || !isStandableGround(world.getBlock(x, surface, z))) return null
  const spot = { x: x + 0.5, y: surface + 1, z: z + 0.5 }
  if (spot.y + body.height > world.height) return null // keep the body inside the world
  if (!bodyFits(world, spot, body, HEADROOM)) return null
  if (treeNearby(world, x, z, spot.y, body.height) || isPitColumn(world, x, z)) return null
  return spot
}

// First height at or above the column's surface where the body is free.
// Above the world is open air, so this always succeeds for a body narrower
// than the world.
function firstFreeSpot(world, { x, z }, body) {
  const start = Math.max(0, world.surfaceHeight(x, z) + 1)
  for (let y = start; y <= world.height; y++) {
    const spot = { x: x + 0.5, y, z: z + 0.5 }
    if (bodyFits(world, spot, body)) return spot
  }
  return null
}

// Last resort when no column qualifies (e.g. the island is buried in leaves):
// stand on whatever is highest at, or failing that near, the centre.
function fallbackSpawn(world, body) {
  const centre = Math.floor(world.size / 2)
  for (const column of [{ x: centre, z: centre }, ...ringColumns(world.size)]) {
    const spot = firstFreeSpot(world, column, body)
    if (spot) return spot
  }
  return { x: centre + 0.5, y: world.height, z: centre + 0.5 }
}

// Returns the feet position { x, y, z } at a column centre. Deterministic and
// read-only: the same world always gives the same spawn.
export function findPlayerSpawn(world, { width = PLAYER.width, height = PLAYER.height } = {}) {
  validateBody(width, height)
  const body = { width, height }
  for (const column of ringColumns(world.size)) {
    const spot = standingSpot(world, column, body)
    if (spot) return spot
  }
  return fallbackSpawn(world, body)
}
