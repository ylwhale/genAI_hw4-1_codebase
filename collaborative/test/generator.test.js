import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TERRAIN_SHAPE,
  TREE_SHAPE,
  generateHeightMap,
  generateWorld,
  generateWorldData,
  planTrees,
} from '../src/world/generator.js'
import { createFractalNoise2D, createNoise2D } from '../src/world/noise.js'
import { createWorld, voxelIndex } from '../src/world/world.js'
import { BLOCK, isValidBlockId } from '../src/world/blocks.js'
import { TERRAIN, WORLD_HEIGHT, WORLD_SIZE } from '../src/config.js'

const SIZE = WORLD_SIZE
const HEIGHT = WORLD_HEIGHT
const CENTRE = SIZE / 2
const TERRAIN_BLOCKS = new Set([BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE])
const OTHER_SEEDS = [0, 1, 7, 99, 1234, 2024, 31337, 4000000000]

const seed42 = generateWorldData()

function blockAt(data, x, y, z, size = SIZE) {
  return data[voxelIndex(size, x, y, z)]
}

// Highest grass/dirt/stone block of a column (ignores trees standing on it).
function terrainSurface(data, x, z, { size = SIZE, height = HEIGHT } = {}) {
  for (let y = height - 1; y >= 0; y--) {
    if (TERRAIN_BLOCKS.has(blockAt(data, x, y, z, size))) return y
  }
  return -1
}

function forEachColumn(size, visit) {
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) visit(x, z)
  }
}

// Trunk bases: wood standing directly on terrain.
function findTrunks(data, { size = SIZE, height = HEIGHT } = {}) {
  const trunks = []
  forEachColumn(size, (x, z) => {
    for (let y = 1; y < height; y++) {
      if (blockAt(data, x, y, z, size) !== BLOCK.WOOD) continue
      if (!TERRAIN_BLOCKS.has(blockAt(data, x, y - 1, z, size))) continue
      let top = y
      while (top + 1 < height && blockAt(data, x, top + 1, z, size) === BLOCK.WOOD) top++
      trunks.push({ x, z, base: y - 1, trunkTop: top, length: top - y + 1 })
    }
  })
  return trunks
}

function openSkyAbove(data, x, z, surface) {
  for (let y = surface + 1; y < HEIGHT; y++) if (blockAt(data, x, y, z) !== BLOCK.AIR) return false
  return true
}

function countIds(data) {
  const counts = new Map()
  for (const id of data) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

function maxNonAirY(data, { size = SIZE, height = HEIGHT } = {}) {
  let max = -1
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== BLOCK.AIR) max = Math.max(max, Math.floor(i / (size * size)))
  }
  assert.ok(max < height)
  return max
}

// --- noise ---

test('gradient noise is deterministic, bounded, and zero on the lattice', () => {
  const a = createNoise2D(42)
  const b = createNoise2D(42)
  const other = createNoise2D(43)
  let differs = 0
  for (let i = 0; i < 2000; i++) {
    const x = (i * 0.731) % 37 - 18
    const z = (i * 1.379) % 41 - 20
    const value = a(x, z)
    assert.equal(value, b(x, z))
    assert.ok(value >= -1 && value <= 1, `in range: ${value}`)
    if (Math.abs(value - other(x, z)) > 1e-6) differs++
  }
  assert.ok(differs > 1500, 'a different seed gives a different field')
  for (const [x, z] of [[0, 0], [3, -7], [-12, 5]]) assert.equal(a(x, z), 0)
})

test('gradient noise is continuous and actually varies', () => {
  const noise = createNoise2D(7)
  let min = Infinity
  let max = -Infinity
  for (let x = -5; x < 5; x += 0.01) {
    const step = Math.abs(noise(x + 0.01, 0.37) - noise(x, 0.37))
    assert.ok(step < 0.05, `no jumps (step ${step} at x=${x})`)
    min = Math.min(min, noise(x, 0.37))
    max = Math.max(max, noise(x, 0.37))
  }
  assert.ok(max - min > 0.5, 'the field has real relief')
})

test('fractal noise stays in [-1, 1] and validates its octave count', () => {
  const fbm = createFractalNoise2D(42, { octaves: 4 })
  for (let i = 0; i < 1000; i++) {
    const value = fbm(i * 0.37 - 100, i * 0.11)
    assert.ok(value >= -1 && value <= 1)
  }
  assert.equal(fbm(1.25, 2.5), createFractalNoise2D(42, { octaves: 4 })(1.25, 2.5))
  for (const octaves of [0, 9, 1.5, NaN]) {
    assert.throws(() => createFractalNoise2D(1, { octaves }), RangeError)
  }
})

// --- determinism, shape, bounds ---

test('generation is byte-identical for the same seed and defaults to seed 42', () => {
  assert.ok(seed42 instanceof Uint8Array)
  assert.equal(seed42.length, SIZE * SIZE * HEIGHT)
  assert.deepEqual(generateWorldData({ seed: 42, size: 32, height: 32 }), seed42)
  assert.deepEqual(generateWorldData(), seed42)
  for (const id of countIds(seed42).keys()) assert.ok(isValidBlockId(id), `valid block id ${id}`)
})

test('different seeds produce different islands', () => {
  const others = [43, 7, 1].map((seed) => generateWorldData({ seed }))
  for (const data of others) {
    let differing = 0
    for (let i = 0; i < data.length; i++) if (data[i] !== seed42[i]) differing++
    assert.ok(differing > 500, `seeds differ substantially (${differing} blocks)`)
  }
  assert.notDeepEqual(generateHeightMap({ seed: 42 }), generateHeightMap({ seed: 43 }))
})

test('layer y = 0 is a stone floor everywhere', () => {
  forEachColumn(SIZE, (x, z) => assert.equal(blockAt(seed42, x, 0, z), BLOCK.STONE))
})

test('every column surface lies within the terrain envelope and matches the height map', () => {
  const heights = generateHeightMap()
  forEachColumn(SIZE, (x, z) => {
    const surface = terrainSurface(seed42, x, z)
    assert.equal(surface, heights[z * SIZE + x])
    assert.ok(surface >= TERRAIN.minSurface && surface <= TERRAIN.maxSurface, `surface ${surface} at ${x},${z}`)
    for (let y = 0; y <= surface; y++) {
      assert.ok(TERRAIN_BLOCKS.has(blockAt(seed42, x, y, z)), 'no holes in the ground')
    }
  })
})

test('columns are layered: stone body, 3-4 dirt, grass top; bare stone only on high peaks', () => {
  let rockyTops = 0
  forEachColumn(SIZE, (x, z) => {
    const surface = terrainSurface(seed42, x, z)
    const top = blockAt(seed42, x, surface, z)
    if (top === BLOCK.STONE) {
      rockyTops++
      assert.ok(surface >= TERRAIN_SHAPE.rockLevel, `bare stone only on peaks (y=${surface})`)
      for (let y = 0; y <= surface; y++) assert.equal(blockAt(seed42, x, y, z), BLOCK.STONE)
      return
    }
    assert.equal(top, BLOCK.GRASS)
    let dirt = 0
    while (blockAt(seed42, x, surface - 1 - dirt, z) === BLOCK.DIRT) dirt++
    assert.ok(dirt === 3 || dirt === 4, `dirt depth ${dirt} at ${x},${z}`)
    for (let y = 0; y < surface - dirt; y++) assert.equal(blockAt(seed42, x, y, z), BLOCK.STONE)
  })
  assert.ok(rockyTops >= 3, `some exposed stone on the peaks (${rockyTops})`)
})

// --- terrain character (seed 42) ---

test('rolling hills with one prominent hill away from the spawn clearing', () => {
  const heights = generateHeightMap()
  const max = Math.max(...heights)
  const min = Math.min(...heights)
  assert.ok(max - min >= 8, `relief ${max - min}`)
  assert.ok(new Set(heights).size >= 8, 'many distinct levels, not a few terraces')
  const clearing = heights[CENTRE * SIZE + CENTRE]
  assert.ok(max >= clearing + 5, `the hill towers over the clearing (${max} vs ${clearing})`)
  let summitDistance = Infinity
  forEachColumn(SIZE, (x, z) => {
    if (heights[z * SIZE + x] === max) summitDistance = Math.min(summitDistance, Math.hypot(x - CENTRE, z - CENTRE))
  })
  assert.ok(summitDistance >= 6, `summit is not on the spawn (${summitDistance.toFixed(1)})`)
})

test('slopes are gentle and the summit can be climbed on foot from spawn', () => {
  const heights = generateHeightMap()
  let pairs = 0
  let steep = 0
  forEachColumn(SIZE, (x, z) => {
    for (const [nx, nz] of [[x + 1, z], [x, z + 1]]) {
      if (nx >= SIZE || nz >= SIZE) continue
      const step = Math.abs(heights[z * SIZE + x] - heights[nz * SIZE + nx])
      assert.ok(step <= 2, `no cliffs taller than 2 (${step} at ${x},${z})`)
      pairs++
      if (step > 1) steep++
    }
  })
  assert.ok(steep / pairs < 0.05, `mostly walkable 1-block steps (${steep}/${pairs} steep)`)

  // Breadth-first walk over steps of at most one block.
  const seen = new Set([CENTRE * SIZE + CENTRE])
  const queue = [[CENTRE, CENTRE]]
  while (queue.length > 0) {
    const [x, z] = queue.shift()
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      const key = nz * SIZE + nx
      if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE || seen.has(key)) continue
      if (Math.abs(heights[key] - heights[z * SIZE + x]) > 1) continue
      seen.add(key)
      queue.push([nx, nz])
    }
  }
  const summit = Math.max(...heights)
  assert.ok([...seen].some((key) => heights[key] === summit), 'summit reachable by walking and jumping')
})

test('the island falls off gently to the sea at the edges', () => {
  const heights = generateHeightMap()
  const border = []
  const inland = []
  forEachColumn(SIZE, (x, z) => {
    const h = heights[z * SIZE + x]
    const edgeDistance = Math.min(x, z, SIZE - 1 - x, SIZE - 1 - z)
    if (edgeDistance === 0) border.push(h)
    if (Math.hypot(x + 0.5 - CENTRE, z + 0.5 - CENTRE) < SIZE / 4) inland.push(h)
  })
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length
  assert.ok(border.every((h) => h <= TERRAIN.minSurface + 1), 'the shoreline is at sea level')
  assert.ok(mean(border) < TERRAIN.minSurface + 0.5)
  assert.ok(mean(inland) >= TERRAIN.minSurface + 3, 'the interior rises well above the shore')
  // Corners are the lowest, flattest part of the island.
  for (const [x, z] of [[0, 0], [SIZE - 1, 0], [0, SIZE - 1], [SIZE - 1, SIZE - 1]]) {
    assert.equal(heights[z * SIZE + x], TERRAIN.minSurface)
  }
})

test('a flat, tree-free clearing surrounds the centre column', () => {
  const clearing = terrainSurface(seed42, CENTRE, CENTRE)
  assert.equal(blockAt(seed42, CENTRE, clearing, CENTRE), BLOCK.GRASS)
  forEachColumn(SIZE, (x, z) => {
    const distance = Math.hypot(x - CENTRE, z - CENTRE)
    if (distance <= 3) assert.equal(terrainSurface(seed42, x, z), clearing, `flat at ${x},${z}`)
    if (distance > 4) return
    assert.ok(openSkyAbove(seed42, x, z, terrainSurface(seed42, x, z)), `no tree parts over ${x},${z}`)
  })
})

// --- trees ---

test('seed 42 grows 6-10 well-formed trees', () => {
  const trunks = findTrunks(seed42)
  assert.ok(trunks.length >= TREE_SHAPE.minCount && trunks.length <= TREE_SHAPE.maxCount, `${trunks.length} trees`)
  for (const trunk of trunks) {
    assert.ok(trunk.length >= 4 && trunk.length <= 6, `trunk length ${trunk.length}`)
    assert.equal(blockAt(seed42, trunk.x, trunk.base, trunk.z), BLOCK.GRASS, 'trunks stand on grass')
    assert.equal(blockAt(seed42, trunk.x, trunk.trunkTop + 1, trunk.z), BLOCK.LEAVES, 'capped by leaves')
    let leaves = 0
    for (let y = trunk.trunkTop - 2; y <= trunk.trunkTop + 1; y++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) if (blockAt(seed42, trunk.x + dx, y, trunk.z + dz) === BLOCK.LEAVES) leaves++
      }
    }
    assert.ok(leaves >= 30, `full canopy (${leaves} leaves)`)
  }
})

test('trees stay inside the world, apart from each other, and away from the centre', () => {
  const trunks = findTrunks(seed42)
  for (const trunk of trunks) {
    assert.ok(Math.min(trunk.x, trunk.z, SIZE - 1 - trunk.x, SIZE - 1 - trunk.z) >= 2, 'trunk >= 2 from the edge')
    assert.ok(Math.hypot(trunk.x - CENTRE, trunk.z - CENTRE) > 3, 'not near the centre column')
  }
  for (let i = 0; i < trunks.length; i++) {
    for (let j = i + 1; j < trunks.length; j++) {
      const a = trunks[i]
      const b = trunks[j]
      assert.ok(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) >= 5, 'canopies never overlap')
    }
  }
})

test('every wood and leaves block belongs to exactly one tree canopy', () => {
  const trunks = findTrunks(seed42)
  const counts = countIds(seed42)
  const trunkWood = trunks.reduce((sum, trunk) => sum + trunk.length, 0)
  assert.equal(counts.get(BLOCK.WOOD), trunkWood, 'no stray wood: leaves never replaced a trunk')
  for (let i = 0; i < seed42.length; i++) {
    if (seed42[i] !== BLOCK.LEAVES) continue
    const x = i % SIZE
    const z = Math.floor(i / SIZE) % SIZE
    const y = Math.floor(i / (SIZE * SIZE))
    const owners = trunks.filter(
      (t) => Math.abs(t.x - x) <= 2 && Math.abs(t.z - z) <= 2 && y >= t.trunkTop - 2 && y <= t.trunkTop + 1,
    )
    assert.equal(owners.length, 1, `leaf at ${x},${y},${z}`)
  }
})

test('tree tops stay at y <= 23, leaving at least 8 empty layers for building', () => {
  assert.ok(maxNonAirY(seed42) <= HEIGHT - 9)
  for (let y = HEIGHT - 8; y < HEIGHT; y++) {
    forEachColumn(SIZE, (x, z) => assert.equal(blockAt(seed42, x, y, z), BLOCK.AIR))
  }
  for (const tree of planTrees(generateHeightMap())) assert.ok(tree.top <= HEIGHT - 9, `tree top ${tree.top}`)
})

test('planTrees describes exactly the trees that were placed', () => {
  const plan = planTrees(generateHeightMap())
  const trunks = findTrunks(seed42)
  assert.equal(plan.length, trunks.length)
  for (const tree of plan) {
    const trunk = trunks.find((t) => t.x === tree.x && t.z === tree.z)
    assert.ok(trunk, `planned tree at ${tree.x},${tree.z} exists`)
    assert.equal(trunk.base, tree.base)
    assert.equal(trunk.length, tree.trunkHeight)
    assert.equal(tree.top, tree.base + tree.trunkHeight + 1)
  }
})

// --- robustness across seeds and sizes ---

test('every seed keeps the island guarantees', () => {
  for (const seed of OTHER_SEEDS) {
    const data = generateWorldData({ seed })
    const trunks = findTrunks(data)
    assert.ok(trunks.length >= 6 && trunks.length <= 10, `seed ${seed}: ${trunks.length} trees`)
    assert.ok(maxNonAirY(data) <= HEIGHT - 9, `seed ${seed}: build space above trees`)
    const clearing = terrainSurface(data, CENTRE, CENTRE)
    forEachColumn(SIZE, (x, z) => {
      assert.equal(blockAt(data, x, 0, z), BLOCK.STONE)
      const surface = terrainSurface(data, x, z)
      assert.ok(surface >= TERRAIN.minSurface && surface <= TERRAIN.maxSurface, `seed ${seed}: surface ${surface}`)
      const distance = Math.hypot(x - CENTRE, z - CENTRE)
      if (distance <= 3) assert.equal(surface, clearing, `seed ${seed}: flat clearing`)
      if (distance <= 4) assert.ok(openSkyAbove(data, x, z, surface), `seed ${seed}: clearing is tree-free`)
    })
    for (const trunk of trunks) assert.ok(Math.hypot(trunk.x - CENTRE, trunk.z - CENTRE) > 5)
  }
})

test('generateWorld fills a world in one reset and honours its dimensions', () => {
  const world = createWorld()
  const events = []
  world.subscribe((event) => events.push(event.type))
  assert.equal(generateWorld(world), world)
  assert.deepEqual(world.snapshot(), seed42)
  assert.deepEqual(events, ['reset'])

  const small = generateWorld(createWorld({ size: 16, height: 24 }), 5)
  assert.deepEqual(small.snapshot(), generateWorldData({ seed: 5, size: 16, height: 24 }))
  assert.equal(small.getBlock(3, 0, 3), BLOCK.STONE)
})

test('small or shallow worlds still generate valid terrain', () => {
  for (const [size, height] of [[1, 2], [8, 8], [12, 16], [20, 40]]) {
    const data = generateWorldData({ seed: 3, size, height })
    assert.equal(data.length, size * size * height)
    const dims = { size, height }
    forEachColumn(size, (x, z) => {
      assert.equal(blockAt(data, x, 0, z, size), BLOCK.STONE)
      assert.ok(terrainSurface(data, x, z, dims) <= Math.min(TERRAIN.maxSurface, height - 1))
    })
    const trunks = findTrunks(data, dims)
    if (trunks.length > 0) assert.ok(maxNonAirY(data, dims) <= height - 9, `${size}x${height}: room above trees`)
  }
})

test('a low ceiling shortens or removes trees so 8 layers always stay free', () => {
  const dims = { size: 32, height: 22 }
  const data = generateWorldData({ seed: 42, ...dims })
  const trunks = findTrunks(data, dims)
  assert.ok(trunks.length > 0, 'low ground still grows trees')
  let highestTreeBlock = -1
  for (let i = 0; i < data.length; i++) {
    if (data[i] === BLOCK.WOOD || data[i] === BLOCK.LEAVES) highestTreeBlock = Math.floor(i / (32 * 32))
  }
  assert.ok(highestTreeBlock <= dims.height - 9, `no tree reaches above y = 13 (${highestTreeBlock})`)
  for (const trunk of trunks) assert.ok(trunk.length >= 4 && trunk.length <= 6)
})

test('invalid generation options are rejected', () => {
  for (const size of [0, -4, 2.5, NaN, '32']) {
    assert.throws(() => generateWorldData({ size }), RangeError, `size ${size}`)
  }
  for (const height of [0, 1, 3.5]) {
    assert.throws(() => generateWorldData({ height }), RangeError, `height ${height}`)
  }
  for (const seed of [NaN, Infinity, '42']) {
    assert.throws(() => generateWorldData({ seed }), RangeError, `seed ${seed}`)
  }
})
