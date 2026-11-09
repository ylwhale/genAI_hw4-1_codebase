import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DataTexture, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three'
import {
  ATLAS_GUTTER,
  BLOCK_FACES,
  TILE_NAMES,
  TILE_SIZE,
  createBlockAtlas,
  createPixelTexture,
  generateSunPixels,
  generateTilePixels,
  generateWaterPixels,
} from '../src/render/textures.js'
import { BLOCK, HOTBAR_BLOCKS, isSolidBlock } from '../src/world/blocks.js'

// Average colour of a pixel rectangle (rows top-first) in a 16x16 tile.
function averageColor(pixels, { x0 = 0, y0 = 0, x1 = TILE_SIZE, y1 = TILE_SIZE } = {}) {
  const sum = [0, 0, 0]
  let count = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * TILE_SIZE + x) * 4
      for (let c = 0; c < 3; c++) sum[c] += pixels[i + c]
      count++
    }
  }
  return sum.map((value) => value / count)
}

function tilePixel(pixels, x, y) {
  const i = (y * TILE_SIZE + x) * 4
  return [...pixels.subarray(i, i + 4)]
}

function distinctColors(pixels) {
  const colors = new Set()
  for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
  return colors.size
}

// Texel of the atlas DataTexture under (u, v); v = 0 is the first data row.
function sampleAtlas(atlas, u, v) {
  const { data, width, height } = atlas.texture.image
  const x = Math.min(width - 1, Math.floor(u * width))
  const y = Math.min(height - 1, Math.floor(v * height))
  const i = (y * width + x) * 4
  return [...data.subarray(i, i + 4)]
}

const isGreen = ([r, g, b]) => g > r + 15 && g > b + 15
const isBrown = ([r, g, b]) => r > g + 10 && g > b + 5

test('tile names cover every block face and pixels are 16x16 RGBA', () => {
  assert.equal(TILE_SIZE, 16)
  assert.deepEqual([...TILE_NAMES], ['grass_top', 'grass_side', 'dirt', 'stone', 'wood_side', 'wood_top', 'leaves'])
  for (const name of TILE_NAMES) {
    const pixels = generateTilePixels(name)
    assert.ok(pixels instanceof Uint8ClampedArray, name)
    assert.equal(pixels.length, TILE_SIZE * TILE_SIZE * 4, name)
  }
})

test('tiles are deterministic, distinct, and returned as independent copies', () => {
  for (const name of TILE_NAMES) assert.deepEqual(generateTilePixels(name), generateTilePixels(name), name)
  const signatures = new Set(TILE_NAMES.map((name) => generateTilePixels(name).join(',')))
  assert.equal(signatures.size, TILE_NAMES.length)

  const first = generateTilePixels('stone')
  first.fill(0)
  assert.notEqual(generateTilePixels('stone')[0], 0, 'mutating a result does not affect later calls')
})

test('unknown tile names are rejected', () => {
  for (const name of ['water_top', '', 'toString', '__proto__', undefined, 3]) {
    assert.throws(() => generateTilePixels(name), RangeError, String(name))
  }
})

test('every tile is fully opaque, including leaves', () => {
  for (const name of TILE_NAMES) {
    const pixels = generateTilePixels(name)
    for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], 255, `${name} alpha at ${i}`)
  }
})

test('tiles carry pixel-art detail rather than flat colour', () => {
  for (const name of TILE_NAMES) {
    assert.ok(distinctColors(generateTilePixels(name)) >= 24, `${name} has noise and highlights`)
  }
})

test('tile colours read as their materials', () => {
  assert.ok(isGreen(averageColor(generateTilePixels('grass_top'))), 'grass is green')
  assert.ok(isGreen(averageColor(generateTilePixels('leaves'))), 'leaves are green')
  assert.ok(isBrown(averageColor(generateTilePixels('dirt'))), 'dirt is brown')
  assert.ok(isBrown(averageColor(generateTilePixels('wood_side'))), 'bark is brown')
  assert.ok(isBrown(averageColor(generateTilePixels('wood_top'))), 'end grain is brown')

  const [r, g, b] = averageColor(generateTilePixels('stone'))
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 12, 'stone is a neutral grey')
  assert.ok(r > 90 && r < 170, 'stone is mid grey')

  const grass = averageColor(generateTilePixels('grass_top'))
  const leaves = averageColor(generateTilePixels('leaves'))
  assert.ok(leaves[1] < grass[1], 'leaf canopy is darker than the lawn')
})

test('grass side has a green fringe on top over a dirt body', () => {
  const pixels = generateTilePixels('grass_side')
  for (let x = 0; x < TILE_SIZE; x++) {
    assert.ok(isGreen(tilePixel(pixels, x, 0)), `row 0, column ${x} is turf`)
    assert.ok(isGreen(tilePixel(pixels, x, 1)), `row 1, column ${x} is turf`)
  }
  assert.ok(isBrown(averageColor(pixels, { y0: 9 })), 'the lower part is dirt')
})

test('wood top shows growth rings inside a bark rim', () => {
  const pixels = generateTilePixels('wood_top')
  const rim = averageColor(pixels, { y1: 1 })
  const inside = averageColor(pixels, { x0: 3, y0: 3, x1: 13, y1: 13 })
  assert.ok(rim[0] < inside[0] - 30, 'bark rim is darker than the end grain')

  const middleRow = []
  for (let x = 1; x < 15; x++) middleRow.push(tilePixel(pixels, x, 8)[0])
  let changes = 0
  for (let i = 1; i < middleRow.length; i++) if (Math.abs(middleRow[i] - middleRow[i - 1]) > 15) changes++
  assert.ok(changes >= 4, `alternating ring bands across the log (${changes} transitions)`)
})

test('bark has darker vertical grooves', () => {
  const pixels = generateTilePixels('wood_side')
  const columns = []
  for (let x = 0; x < TILE_SIZE; x++) columns.push(averageColor(pixels, { x0: x, x1: x + 1 })[0])
  assert.ok(Math.max(...columns) - Math.min(...columns) > 15, 'column brightness varies')
})

test('BLOCK_FACES maps every solid block to valid tiles and nothing else', () => {
  for (const id of HOTBAR_BLOCKS) {
    const faces = BLOCK_FACES[id]
    assert.ok(faces, `block ${id} has faces`)
    for (const face of ['top', 'side', 'bottom']) assert.ok(TILE_NAMES.includes(faces[face]), `${id}.${face}`)
  }
  assert.equal(BLOCK_FACES[BLOCK.AIR], undefined)
  for (const id of Object.keys(BLOCK_FACES)) assert.ok(isSolidBlock(Number(id)))
  assert.deepEqual(BLOCK_FACES[BLOCK.GRASS], { top: 'grass_top', side: 'grass_side', bottom: 'dirt' })
  assert.deepEqual(BLOCK_FACES[BLOCK.WOOD], { top: 'wood_top', side: 'wood_side', bottom: 'wood_top' })
  assert.ok(Object.isFrozen(BLOCK_FACES) && Object.isFrozen(BLOCK_FACES[BLOCK.GRASS]))
})

test('atlas texture is a crisp sRGB DataTexture without mipmaps', () => {
  const atlas = createBlockAtlas()
  const { texture } = atlas
  assert.ok(texture instanceof DataTexture)
  assert.equal(texture.magFilter, NearestFilter)
  assert.equal(texture.minFilter, NearestFilter)
  assert.equal(texture.generateMipmaps, false)
  assert.equal(texture.colorSpace, SRGBColorSpace)
  assert.equal(texture.flipY, false)
  assert.ok(texture.image.data instanceof Uint8Array)
  assert.equal(texture.image.data.length, atlas.width * atlas.height * 4)
  assert.equal(texture.image.width, atlas.width)
  assert.equal(texture.image.height, atlas.height)
})

test('uvFor returns frozen, non-overlapping 16-texel rectangles inside the atlas', () => {
  const atlas = createBlockAtlas()
  const rects = TILE_NAMES.map((name) => atlas.tileRect(name))
  for (const rect of rects) {
    assert.ok(Object.isFrozen(rect))
    assert.ok(rect.u0 >= 0 && rect.u1 <= 1 && rect.v0 >= 0 && rect.v1 <= 1)
    assert.ok(Math.abs((rect.u1 - rect.u0) * atlas.width - TILE_SIZE) < 1e-9)
    assert.ok(Math.abs((rect.v1 - rect.v0) * atlas.height - TILE_SIZE) < 1e-9)
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      const overlap = a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1
      assert.ok(!overlap, `${TILE_NAMES[i]} and ${TILE_NAMES[j]} do not overlap`)
    }
  }
  assert.equal(atlas.uvFor(BLOCK.GRASS, 'top'), atlas.tileRect('grass_top'))
  assert.equal(atlas.uvFor(BLOCK.GRASS, 'side'), atlas.tileRect('grass_side'))
  assert.equal(atlas.uvFor(BLOCK.GRASS, 'bottom'), atlas.tileRect('dirt'))
  assert.equal(atlas.uvFor(BLOCK.WOOD, 'top'), atlas.tileRect('wood_top'))
  assert.equal(atlas.uvFor(BLOCK.LEAVES, 'side'), atlas.tileRect('leaves'))
})

test('uvFor rejects unknown blocks and faces', () => {
  const atlas = createBlockAtlas()
  assert.equal(atlas.uvFor(BLOCK.AIR, 'top'), null)
  assert.equal(atlas.uvFor(99, 'top'), null)
  assert.equal(atlas.uvFor(BLOCK.STONE, 'front'), null)
  assert.equal(atlas.uvFor(BLOCK.STONE, undefined), null)
  assert.equal(atlas.tileRect('water'), null)
})

test('atlas rows are flipped so v1 is the top row of each tile', () => {
  const atlas = createBlockAtlas()
  const texel = 1 / atlas.width
  const texelV = 1 / atlas.height
  for (const name of TILE_NAMES) {
    const pixels = generateTilePixels(name)
    const rect = atlas.tileRect(name)
    for (const [x, y] of [[0, 0], [15, 0], [0, 15], [7, 3], [12, 9]]) {
      const u = rect.u0 + (x + 0.5) * texel
      const v = rect.v1 - (y + 0.5) * texelV
      assert.deepEqual(sampleAtlas(atlas, u, v), tilePixel(pixels, x, y), `${name} pixel ${x},${y}`)
    }
  }
})

test('grass side top rows (near v1) sample the green fringe', () => {
  const atlas = createBlockAtlas()
  const rect = atlas.uvFor(BLOCK.GRASS, 'side')
  const texelV = 1 / atlas.height
  for (let i = 0; i < 16; i++) {
    const u = rect.u0 + ((i + 0.5) / 16) * (rect.u1 - rect.u0)
    assert.ok(isGreen(sampleAtlas(atlas, u, rect.v1 - 0.5 * texelV)), `top row, column ${i}`)
    assert.ok(isGreen(sampleAtlas(atlas, u, rect.v1 - 1.5 * texelV)), `second row, column ${i}`)
  }
  const bottom = sampleAtlas(atlas, (rect.u0 + rect.u1) / 2, rect.v0 + 0.5 * texelV)
  assert.ok(!isGreen(bottom), 'bottom row is dirt')
})

test('gutters replicate edge texels so sampling just outside a tile never bleeds', () => {
  assert.ok(ATLAS_GUTTER >= 2)
  const atlas = createBlockAtlas()
  const du = 1 / atlas.width
  const dv = 1 / atlas.height
  for (const name of TILE_NAMES) {
    const rect = atlas.tileRect(name)
    for (let step = 1; step <= ATLAS_GUTTER; step++) {
      const midV = (rect.v0 + rect.v1) / 2 + 0.25 * dv
      const midU = (rect.u0 + rect.u1) / 2 + 0.25 * du
      assert.deepEqual(sampleAtlas(atlas, rect.u0 - (step - 0.5) * du, midV), sampleAtlas(atlas, rect.u0 + 0.5 * du, midV))
      assert.deepEqual(sampleAtlas(atlas, rect.u1 + (step - 0.5) * du, midV), sampleAtlas(atlas, rect.u1 - 0.5 * du, midV))
      assert.deepEqual(sampleAtlas(atlas, midU, rect.v0 - (step - 0.5) * dv), sampleAtlas(atlas, midU, rect.v0 + 0.5 * dv))
      assert.deepEqual(sampleAtlas(atlas, midU, rect.v1 + (step - 0.5) * dv), sampleAtlas(atlas, midU, rect.v1 - 0.5 * dv))
    }
    // Corner gutter texels repeat the corner pixel.
    assert.deepEqual(sampleAtlas(atlas, rect.u0 - 1.5 * du, rect.v1 + 1.5 * dv), tilePixel(generateTilePixels(name), 0, 0))
  }
})

test('tilePixels returns a copy of the generated tile for UI icons', () => {
  const atlas = createBlockAtlas()
  const pixels = atlas.tilePixels('grass_top')
  assert.deepEqual(pixels, generateTilePixels('grass_top'))
  pixels.fill(0)
  assert.deepEqual(atlas.tilePixels('grass_top'), generateTilePixels('grass_top'))
  assert.throws(() => atlas.tilePixels('nope'), RangeError)
})

test('atlas creation is deterministic and disposable', () => {
  const a = createBlockAtlas()
  const b = createBlockAtlas()
  assert.deepEqual(a.texture.image.data, b.texture.image.data)
  let disposed = false
  a.texture.addEventListener('dispose', () => (disposed = true))
  a.dispose()
  assert.ok(disposed)
})

test('decor textures: tileable water and a square sun with a fading halo', () => {
  const water = generateWaterPixels()
  assert.equal(water.length, TILE_SIZE * TILE_SIZE * 4)
  const [r, g, b] = averageColor(water)
  assert.ok(b > g && g > r, 'water is blue')
  assert.deepEqual(generateWaterPixels(), water)

  const sun = generateSunPixels()
  assert.equal(tilePixel(sun, 7, 7)[3], 255, 'opaque core')
  assert.equal(tilePixel(sun, 0, 0)[3], 0, 'transparent outer edge')
  assert.ok(tilePixel(sun, 3, 7)[3] < 255 && tilePixel(sun, 3, 7)[3] > tilePixel(sun, 1, 7)[3], 'halo fades outward')
})

test('createPixelTexture supports repeating, mipmapped decor textures', () => {
  const texture = createPixelTexture(generateWaterPixels(), TILE_SIZE, TILE_SIZE, { repeat: true, mipmaps: true })
  assert.equal(texture.wrapS, RepeatWrapping)
  assert.equal(texture.wrapT, RepeatWrapping)
  assert.equal(texture.generateMipmaps, true)
  assert.equal(texture.magFilter, NearestFilter)
  assert.notEqual(texture.minFilter, NearestFilter)
  assert.equal(texture.colorSpace, SRGBColorSpace)
})
