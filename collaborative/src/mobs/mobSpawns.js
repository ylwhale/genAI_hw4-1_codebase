// Seeded spawn placement, preferring sites far from the player spawn and each other.

import { MOB_RULES, WORLD_SEED } from '../config.js'
import { bodyBox, horizontalDistance } from '../core/geometry.js'
import { createRng, deriveSeed } from '../core/rng.js'
import { boxCollides } from '../world/physics.js'
import { createSurfaceLookup, isPitColumn, isStandableGround } from '../world/spawn.js'
import { getMobType } from './mobTypes.js'

const DISTINCT_COLUMNS = 1 // bodies are narrower than a block, so distinct columns never overlap

// Returns [{ type, x, y, z }] (feet positions at column centres), one per plan
// entry that could be placed, in plan order. Distance from the player spawn
// is a hard rule (strictly beyond exclusionRadius and at least minDistance);
// only the spacing between mobs is relaxed when the world is crowded.
export function findMobSpawns(world, playerSpawn, plan, options = {}) {
  const {
    seed = WORLD_SEED,
    exclusionRadius = MOB_RULES.spawnExclusionRadius,
    minSpacing = 3,
    minDistance = MOB_RULES.spawnMinDistance,
    preferredDistance = MOB_RULES.spawnPreferredDistance,
  } = options
  const types = resolvePlan(plan)
  requireSpawnPoint(playerSpawn)
  const farEnough = (distance) => distance > exclusionRadius && distance >= minDistance
  const columns = candidateColumns(world, playerSpawn, farEnough)
  const ordered = createRng(deriveSeed(seed, 'mob-spawns')).shuffle(columns)
  const tiers = spawnTiers(ordered, preferredDistance, minSpacing)
  const chosen = types.map(() => null)
  for (const index of placementOrder(types)) chosen[index] = pickSpawn(world, types[index], tiers, chosen)
  return chosen.filter(Boolean)
}

function resolvePlan(plan) {
  if (!Array.isArray(plan)) throw new TypeError('Spawn plan must be an array of mob type keys')
  return plan.map((key) => {
    const type = getMobType(key)
    if (!type) throw new Error(`Unknown mob type in spawn plan: ${key}`)
    return type
  })
}

function requireSpawnPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
    throw new TypeError('Player spawn must have finite x and z')
  }
}

// Type-independent checks: inside the 1-block margin, far enough away, a
// natural standable top block, and not at the bottom of a pit (the same
// rules the player spawn uses, from world/spawn.js).
function candidateColumns(world, playerSpawn, farEnough) {
  const surfaceAt = createSurfaceLookup(world)
  const columns = []
  for (let z = 1; z < world.size - 1; z++) {
    for (let x = 1; x < world.size - 1; x++) {
      const column = describeColumn(world, x, z, playerSpawn, surfaceAt)
      if (column && farEnough(column.distance) && !isPitColumn(world, x, z, surfaceAt)) columns.push(column)
    }
  }
  return columns
}

function describeColumn(world, x, z, playerSpawn, surfaceAt) {
  const surface = surfaceAt(x, z)
  if (surface < 0 || !isStandableGround(world.getBlock(x, surface, z))) return null
  const column = { x: x + 0.5, y: surface + 1, z: z + 0.5 }
  return { ...column, distance: horizontalDistance(column, playerSpawn) }
}

// Search order: preferred-distance columns, then nearer ones, both with full
// spacing; finally anything left with spacing relaxed to distinct columns.
function spawnTiers(ordered, preferredDistance, minSpacing) {
  const spacing = Number.isFinite(minSpacing) ? Math.max(minSpacing, DISTINCT_COLUMNS) : DISTINCT_COLUMNS
  const preferred = ordered.filter((column) => column.distance >= preferredDistance)
  const nearer = ordered.filter((column) => column.distance < preferredDistance)
  return [
    { pool: preferred, spacing },
    { pool: nearer, spacing },
    { pool: [...preferred, ...nearer], spacing: DISTINCT_COLUMNS },
  ]
}

// Larger bodies are placed first because fewer columns can hold them.
function placementOrder(types) {
  return types.map((_, index) => index).sort((a, b) => types[b].height - types[a].height || a - b)
}

function pickSpawn(world, type, tiers, chosen) {
  for (const { pool, spacing } of tiers) {
    const column = pool.find((candidate) => fitsBody(world, candidate, type) && isSpaced(candidate, chosen, spacing))
    if (column) return { type: type.key, x: column.x, y: column.y, z: column.z }
  }
  return null
}

// The whole body must be free of solid voxels and below the world ceiling.
function fitsBody(world, column, type) {
  if (column.y + type.height > world.height) return false
  return !boxCollides(world, bodyBox(column, type.width, type.height))
}

function isSpaced(column, chosen, spacing) {
  return chosen.every((other) => !other || horizontalDistance(column, other) >= spacing)
}
