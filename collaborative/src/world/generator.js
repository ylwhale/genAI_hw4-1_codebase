// Seeded island terrain and trees, with a flat spawn clearing.
// Returns a Uint8Array indexed by voxelIndex.

import { TERRAIN, WORLD_HEIGHT, WORLD_SEED, WORLD_SIZE } from '../config.js'
import { createRng, deriveSeed, hash3 } from '../core/rng.js'
import { TAU, clamp, lerp, smoothstep } from '../core/math.js'
import { BLOCK } from './blocks.js'
import { voxelIndex } from './world.js'
import { createFractalNoise2D, createNoise2D } from './noise.js'

// Terrain tuning, in blocks unless noted. Radii marked "normalised" are
// fractions of half the world size (1 = the middle of an edge).
export const TERRAIN_SHAPE = Object.freeze({
  baseLevel: 7.6, // mean inland surface before hills
  hillAmplitude: 4.5, // rolling-hill relief from the fBm
  hillFrequency: 1 / 11, // fBm cycles per block
  octaves: 3,
  peakHeight: 6.5, // extra height of the landmark hill
  peakRadius: 7, // footprint radius of the landmark hill
  peakDistance: 0.5, // normalised distance of its summit from the centre
  clearingRadius: 3.2, // fully flat spawn plateau around the centre column
  clearingBlend: 3, // distance over which the hills rise out of it
  coastStart: 0.55, // normalised radius where the land starts sloping to sea
  coastEnd: 1.1, // normalised radius where it reaches the lowest surface
  coastWobble: 0.14, // noise on the coastline so it is not a perfect circle
  coastFrequency: 1 / 7,
  squareness: 3, // superellipse exponent: 2 = round island, higher = squarer
  rockLevel: 12, // surfaces at or above this may be bare stone
})

export const TREE_SHAPE = Object.freeze({
  minCount: 6,
  maxCount: 10,
  minTrunk: 4,
  maxTrunk: 6,
  canopyRadius: 2, // 5 x 5 lower canopy layers
  edgeMargin: 3, // trunk distance from the world edge (canopies never clipped)
  clearingRadius: 4.5, // no canopy column this close to the centre column (spawn clearing)
  minSpacing: 6, // trunk-to-trunk distance: canopies never overlap
  freeLayers: 8, // empty layers always kept above the tallest tree
})

const CEILING_KNEE = 2 // blocks below maxSurface where height compression starts

function validateOptions(seed, size, height) {
  if (!Number.isFinite(seed)) throw new RangeError('seed must be a finite number')
  if (!Number.isInteger(size) || size < 1) throw new RangeError('size must be a positive integer')
  if (!Number.isInteger(height) || height < 2) throw new RangeError('height must be an integer >= 2')
}

// The spawn clearing is centred on this column ((16, 16) in a 32-wide world),
// the same column findPlayerSpawn searches outward from.
function centreColumn(size) {
  return Math.floor(size / 2)
}

function surfaceRange(height) {
  const max = Math.min(TERRAIN.maxSurface, height - 1)
  return { min: Math.min(TERRAIN.minSurface, max), max }
}

// Compresses heights approaching the ceiling so summits round off instead of
// being sliced into flat plateaus by the clamp.
function softCeiling(level, max) {
  const knee = max - CEILING_KNEE
  if (level <= knee) return level
  // Asymptote half a block above max so the rounded summit can still reach it.
  const span = CEILING_KNEE + 0.5
  return knee + span * (1 - Math.exp(-(level - knee) / span))
}

// Smooth dome of the landmark hill; 1 at its summit, 0 beyond its radius.
function peakBump(x, z, peak) {
  const d = Math.hypot(x - peak.x, z - peak.z) / TERRAIN_SHAPE.peakRadius
  if (d >= 1) return 0
  const t = 1 - d * d
  return t * t
}

// The landmark hill sits at a seeded bearing, part-way to the coast.
function placePeak(seed, size) {
  const rng = createRng(deriveSeed(seed, 'peak'))
  const angle = rng.range(0, TAU)
  const distance = TERRAIN_SHAPE.peakDistance * (size / 2)
  const centre = centreColumn(size)
  return { x: centre + Math.cos(angle) * distance, z: centre + Math.sin(angle) * distance }
}

// Normalised superellipse distance from the island's geometric centre,
// wobbled by noise so the coastline meanders instead of tracing a ring.
function coastRadius(x, z, size, coastNoise) {
  const half = size / 2
  const p = TERRAIN_SHAPE.squareness
  const dx = Math.abs(x + 0.5 - half) / half
  const dz = Math.abs(z + 0.5 - half) / half
  const wobble = coastNoise(x * TERRAIN_SHAPE.coastFrequency, z * TERRAIN_SHAPE.coastFrequency)
  return (dx ** p + dz ** p) ** (1 / p) + wobble * TERRAIN_SHAPE.coastWobble
}

// Shore factor: 1 inland, easing to 0 where the land meets the sea.
function createCoastField(seed, size) {
  const coastNoise = createNoise2D(deriveSeed(seed, 'coast'))
  const { coastStart, coastEnd } = TERRAIN_SHAPE
  return (x, z) => 1 - smoothstep(coastStart, coastEnd, coastRadius(x, z, size, coastNoise))
}

// Unclamped inland height: base level + rolling fBm hills + the landmark hill.
function createInlandField(seed, size) {
  const hills = createFractalNoise2D(deriveSeed(seed, 'hills'), { octaves: TERRAIN_SHAPE.octaves })
  const peak = placePeak(seed, size)
  const { baseLevel, hillAmplitude, hillFrequency: f, peakHeight } = TERRAIN_SHAPE
  return (x, z) => baseLevel + hills(x * f, z * f) * hillAmplitude + peakBump(x, z, peak) * peakHeight
}

// 0 on the flat spawn plateau around the centre column, easing to 1 outside it.
function clearingRise(dx, dz) {
  const { clearingRadius, clearingBlend } = TERRAIN_SHAPE
  return smoothstep(clearingRadius, clearingRadius + clearingBlend, Math.hypot(dx, dz))
}

// Builds the per-column surface function for one seed and world size.
function createSurfaceField(seed, size, height) {
  const inland = createInlandField(seed, size)
  const coast = createCoastField(seed, size)
  const range = surfaceRange(height)
  const centre = centreColumn(size)
  const clearingLevel = clamp(Math.round(inland(centre, centre)), range.min + 2, range.max - 4)

  return function surfaceAt(x, z) {
    const land = lerp(clearingLevel, inland(x, z), clearingRise(x - centre, z - centre))
    const level = range.min + Math.max(0, land - range.min) * coast(x, z)
    return clamp(Math.round(softCeiling(level, range.max)), range.min, range.max)
  }
}

// Surface y (top terrain block) of every column, indexed z * size + x.
export function generateHeightMap({ seed = WORLD_SEED, size = WORLD_SIZE, height = WORLD_HEIGHT } = {}) {
  validateOptions(seed, size, height)
  const surfaceAt = createSurfaceField(seed, size, height)
  const surfaces = new Uint8Array(size * size)
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) surfaces[z * size + x] = surfaceAt(x, z)
  }
  return surfaces
}

// Peaks lose their soil: everything above rockLevel, and roughly half of the
// columns exactly at it, are bare stone.
function isRockyColumn(surface, x, z, seed) {
  if (surface > TERRAIN_SHAPE.rockLevel) return true
  return surface === TERRAIN_SHAPE.rockLevel && hash3(x, z, 1, deriveSeed(seed, 'rock')) < 0.5
}

function dirtDepth(x, z, seed) {
  return hash3(x, z, 2, deriveSeed(seed, 'soil')) < 0.5 ? 3 : 4
}

// Fill one column: stone floor at y = 0, stone body, 3-4 dirt, grass top
// (or bare stone all the way up on rocky peaks).
function fillColumn(data, size, x, z, surface, seed) {
  const rocky = isRockyColumn(surface, x, z, seed)
  const dirtFrom = rocky ? surface + 1 : Math.max(1, surface - dirtDepth(x, z, seed))
  data[voxelIndex(size, x, 0, z)] = BLOCK.STONE
  for (let y = 1; y <= surface; y++) {
    const soil = y === surface ? BLOCK.GRASS : BLOCK.DIRT
    data[voxelIndex(size, x, y, z)] = y >= dirtFrom ? soil : BLOCK.STONE
  }
}

function fillTerrain(data, surfaces, { seed, size }) {
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) fillColumn(data, size, x, z, surfaces[z * size + x], seed)
  }
}

// Highest y a tree may reach while keeping `freeLayers` empty layers above it.
function treeCeiling(height) {
  return height - 1 - TREE_SHAPE.freeLayers
}

// Level enough for a tree: no ground in the 5 x 5 canopy footprint rises above
// the trunk base + 1 (leaves never cut into a hillside), and the trunk is not
// perched on a ledge above its immediate neighbours.
function hasLevelFootprint(surfaces, size, x, z, base) {
  const r = TREE_SHAPE.canopyRadius
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const ground = surfaces[(z + dz) * size + x + dx]
      const near = Math.abs(dx) <= 1 && Math.abs(dz) <= 1
      if (ground > base + 1 || (near && ground < base - 1)) return false
    }
  }
  return true
}

// True when the whole 5 x 5 canopy footprint stays out of the spawn clearing.
function clearsSpawn(x, z, size) {
  const centre = centreColumn(size)
  const r = TREE_SHAPE.canopyRadius
  const gapX = Math.max(Math.abs(x - centre) - r, 0)
  const gapZ = Math.max(Math.abs(z - centre) - r, 0)
  return Math.hypot(gapX, gapZ) >= TREE_SHAPE.clearingRadius
}

function isTreeSite(surfaces, { seed, size, height }, x, z) {
  const base = surfaces[z * size + x]
  if (!clearsSpawn(x, z, size)) return false
  // Grass only, and not on the lowest shoreline ring.
  if (base <= surfaceRange(height).min || isRockyColumn(base, x, z, seed)) return false
  if (base + TREE_SHAPE.minTrunk + 1 > treeCeiling(height)) return false
  return hasLevelFootprint(surfaces, size, x, z, base)
}

function treeSites(surfaces, options) {
  const margin = Math.max(TREE_SHAPE.edgeMargin, TREE_SHAPE.canopyRadius)
  const sites = []
  for (let z = margin; z < options.size - margin; z++) {
    for (let x = margin; x < options.size - margin; x++) {
      if (isTreeSite(surfaces, options, x, z)) sites.push({ x, z })
    }
  }
  return sites
}

function spacedFrom(trees, site) {
  return trees.every((tree) => Math.hypot(tree.x - site.x, tree.z - site.z) >= TREE_SHAPE.minSpacing)
}

// Deterministic tree layout: shuffle every valid site and greedily keep those
// far enough from the trees already chosen (a simple Poisson-disc sampling).
// Returns [{ x, z, base, trunkHeight, top }] where top is the highest leaf y.
export function planTrees(surfaces, { seed = WORLD_SEED, size = WORLD_SIZE, height = WORLD_HEIGHT } = {}) {
  validateOptions(seed, size, height)
  const options = { seed, size, height }
  const rng = createRng(deriveSeed(seed, 'trees'))
  const target = rng.int(TREE_SHAPE.minCount + 1, TREE_SHAPE.maxCount - 1)
  const trees = []
  for (const site of rng.shuffle(treeSites(surfaces, options))) {
    if (trees.length >= target) break
    if (!spacedFrom(trees, site)) continue
    const base = surfaces[site.z * size + site.x]
    const tallest = Math.min(TREE_SHAPE.maxTrunk, treeCeiling(height) - base - 1)
    const trunkHeight = rng.int(TREE_SHAPE.minTrunk, tallest)
    trees.push({ x: site.x, z: site.z, base, trunkHeight, top: base + trunkHeight + 1 })
  }
  return trees
}

// Canopy layers relative to the trunk top: two 5 x 5 skirts (corners trimmed,
// some lower corners kept at random), a 3 x 3 crown, and a plus-shaped cap.
function canopyLayers(tree, seed) {
  const cornerSeed = deriveSeed(seed, 'canopy')
  const keepCorner = (dx, dz) => hash3(tree.x * 8 + dx, tree.z * 8 + dz, 3, cornerSeed) < 0.4
  return [
    { dy: -2, radius: 2, include: (dx, dz) => !isCorner(dx, dz, 2) || keepCorner(dx, dz) },
    { dy: -1, radius: 2, include: (dx, dz) => !isCorner(dx, dz, 2) },
    { dy: 0, radius: 1, include: () => true },
    { dy: 1, radius: 1, include: (dx, dz) => dx === 0 || dz === 0 },
  ]
}

function isCorner(dx, dz, radius) {
  return Math.abs(dx) === radius && Math.abs(dz) === radius
}

function placeTree(data, tree, { seed, size }) {
  const trunkTop = tree.base + tree.trunkHeight
  for (let y = tree.base + 1; y <= trunkTop; y++) data[voxelIndex(size, tree.x, y, tree.z)] = BLOCK.WOOD
  for (const layer of canopyLayers(tree, seed)) {
    const y = trunkTop + layer.dy
    for (let dz = -layer.radius; dz <= layer.radius; dz++) {
      for (let dx = -layer.radius; dx <= layer.radius; dx++) {
        if (!layer.include(dx, dz)) continue
        const i = voxelIndex(size, tree.x + dx, y, tree.z + dz)
        if (data[i] === BLOCK.AIR) data[i] = BLOCK.LEAVES // leaves never replace wood
      }
    }
  }
}

// Same arguments => byte-identical output; different seeds give different islands.
export function generateWorldData({ seed = WORLD_SEED, size = WORLD_SIZE, height = WORLD_HEIGHT } = {}) {
  const options = { seed, size, height }
  const surfaces = generateHeightMap(options)
  const data = new Uint8Array(size * size * height)
  fillTerrain(data, surfaces, options)
  for (const tree of planTrees(surfaces, options)) placeTree(data, tree, options)
  return data
}

export function generateWorld(world, seed = WORLD_SEED) {
  world.replaceAll(generateWorldData({ seed, size: world.size, height: world.height }))
  return world
}
