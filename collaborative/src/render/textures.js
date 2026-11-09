// Seeded 16x16 tiles and the block texture atlas.
// Pixel arrays are RGBA with rows top-first (image order).

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearMipmapLinearFilter,
  NearestFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three'
import { TAU, clamp, smoothstep } from '../core/math.js'
import { createRng, deriveSeed } from '../core/rng.js'
import { BLOCK } from '../world/blocks.js'

export const TILE_SIZE = 16
export const TILE_NAMES = Object.freeze(['grass_top', 'grass_side', 'dirt', 'stone', 'wood_side', 'wood_top', 'leaves'])
export const ATLAS_GUTTER = 2 // texels of replicated edge around every tile (no bleeding)

const ATLAS_COLUMNS = 4
const TEXTURE_SEED = 0x5eed

// Which tile each face of a solid block shows.
export const BLOCK_FACES = Object.freeze({
  [BLOCK.GRASS]: Object.freeze({ top: 'grass_top', side: 'grass_side', bottom: 'dirt' }),
  [BLOCK.DIRT]: sameOnAllFaces('dirt'),
  [BLOCK.STONE]: sameOnAllFaces('stone'),
  [BLOCK.WOOD]: Object.freeze({ top: 'wood_top', side: 'wood_side', bottom: 'wood_top' }),
  [BLOCK.LEAVES]: sameOnAllFaces('leaves'),
})

function sameOnAllFaces(name) {
  return Object.freeze({ top: name, side: name, bottom: name })
}

// Palettes are sRGB, ordered dark -> light so noise values map to brightness.
const GRASS = [[70, 128, 46], [84, 144, 54], [96, 158, 60], [108, 170, 66], [122, 182, 74]]
const GRASS_TIP = [146, 200, 90]
const GRASS_ROOT = [58, 108, 40]
const GRASS_SHADOW = [60, 78, 36]
const DIRT = [[100, 70, 46], [116, 82, 54], [130, 93, 62], [143, 104, 70], [156, 116, 80]]
const PEBBLE = [168, 150, 124]
const DIRT_SHADOW = [86, 60, 40]
const STONE = [[102, 104, 109], [114, 116, 121], [126, 128, 133], [138, 140, 145], [150, 152, 157]]
const STONE_CRACK = [84, 86, 91]
const STONE_EDGE = [166, 168, 173]
const BARK = [[78, 56, 34], [92, 67, 40], [106, 77, 46], [120, 88, 53]]
const BARK_GROOVE = [58, 42, 26]
const BARK_LIGHT = [140, 104, 64]
const RING_LIGHT = [186, 148, 96]
const RING_DARK = [158, 120, 74]
const RING_CORE = [128, 94, 56]
const LEAF_DEPTH = [[24, 62, 25], [30, 74, 29], [37, 86, 34]]
const LEAF = [[50, 112, 42], [62, 128, 48], [76, 144, 56], [90, 158, 64]]
const LEAF_TIP = [120, 184, 82]
const WATER = [[38, 92, 160], [44, 104, 174], [52, 116, 186], [60, 128, 196]]
const WAVE_CREST = [126, 186, 230]
const WAVE_TROUGH = [32, 80, 146]
const SUN_CORE = [255, 251, 230]
const SUN_HALO = [255, 232, 176]

const PAINTERS = Object.freeze({
  grass_top: paintGrassTop,
  grass_side: paintGrassSide,
  dirt: paintDirt,
  stone: paintStone,
  wood_side: paintBark,
  wood_top: paintWoodRings,
  leaves: paintLeaves,
})

// Returns a fresh 16*16*4 RGBA array for a named block tile.
export function generateTilePixels(name) {
  if (!Object.hasOwn(PAINTERS, name)) throw new RangeError(`Unknown tile: ${name}`)
  const tile = createTile()
  PAINTERS[name](tile, createRng(deriveSeed(TEXTURE_SEED, name)))
  return tile.pixels
}

// Tileable water texture for the decorative sea (blue bands + wave crests).
export function generateWaterPixels() {
  const tile = createTile()
  const rng = createRng(deriveSeed(TEXTURE_SEED, 'water'))
  paintSpeckled(tile, rng, WATER, { blotch: 0.7, grain: 3 })
  for (let i = 0; i < 7; i++) paintWave(tile, rng)
  return tile.pixels
}

// Square, blocky sun: a bright core with stepped, fading halo rings.
export function generateSunPixels() {
  const tile = createTile()
  const centre = (TILE_SIZE - 1) / 2
  forEachPixel((x, y) => {
    const ring = Math.max(Math.abs(x - centre), Math.abs(y - centre))
    const alpha = ring < 3.5 ? 255 : Math.max(0, 200 - (ring - 3.5) * 52)
    tile.set(x, y, ring < 3.5 ? SUN_CORE : SUN_HALO, alpha)
  })
  return tile.pixels
}

// Wrap RGBA pixels (rows in texture order) in a crisp, colour-managed texture.
export function createPixelTexture(pixels, width, height, { repeat = false, mipmaps = false } = {}) {
  const texture = new DataTexture(new Uint8Array(pixels), width, height, RGBAFormat, UnsignedByteType)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : NearestFilter
  texture.generateMipmaps = mipmaps
  texture.wrapS = texture.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

// All block tiles packed into one DataTexture. Rows are flipped on upload so
// v1 is the top of each tile; every tile is padded with replicated edge texels.
export function createBlockAtlas() {
  const tiles = new Map(TILE_NAMES.map((name) => [name, generateTilePixels(name)]))
  const layout = atlasLayout(TILE_NAMES.length)
  const data = new Uint8Array(layout.width * layout.height * 4)
  const rects = new Map()
  TILE_NAMES.forEach((name, index) => {
    const origin = cellOrigin(index, layout)
    writePaddedTile(data, layout.width, origin, tiles.get(name))
    rects.set(name, tileRect(origin, layout))
  })
  const texture = createPixelTexture(data, layout.width, layout.height)
  const faceRects = resolveFaceRects(rects)

  return {
    texture,
    width: layout.width,
    height: layout.height,
    uvFor(blockId, face) {
      return faceRects.get(blockId)?.[face] ?? null
    },
    tileRect(name) {
      return rects.get(name) ?? null
    },
    tilePixels(name) {
      const pixels = tiles.get(name)
      if (!pixels) throw new RangeError(`Unknown tile: ${name}`)
      return pixels.slice()
    },
    dispose() {
      texture.dispose()
    },
  }
}


// Atlas layout

function atlasLayout(tileCount) {
  const cell = TILE_SIZE + ATLAS_GUTTER * 2
  const rows = Math.ceil(tileCount / ATLAS_COLUMNS)
  return { cell, width: ATLAS_COLUMNS * cell, height: rows * cell }
}

// Texel origin (bottom-left, texture space) of a tile's padded cell.
function cellOrigin(index, layout) {
  return { x: (index % ATLAS_COLUMNS) * layout.cell, y: Math.floor(index / ATLAS_COLUMNS) * layout.cell }
}

function tileRect(origin, { width, height }) {
  return Object.freeze({
    u0: (origin.x + ATLAS_GUTTER) / width,
    v0: (origin.y + ATLAS_GUTTER) / height,
    u1: (origin.x + ATLAS_GUTTER + TILE_SIZE) / width,
    v1: (origin.y + ATLAS_GUTTER + TILE_SIZE) / height,
  })
}

// Copy a top-first tile into the bottom-first atlas, clamping lookups so the
// gutter repeats the tile's edge texels.
function writePaddedTile(data, atlasWidth, origin, pixels) {
  const cell = TILE_SIZE + ATLAS_GUTTER * 2
  const last = TILE_SIZE - 1
  for (let ty = 0; ty < cell; ty++) {
    const row = clamp(last + ATLAS_GUTTER - ty, 0, last)
    for (let tx = 0; tx < cell; tx++) {
      const column = clamp(tx - ATLAS_GUTTER, 0, last)
      const source = (row * TILE_SIZE + column) * 4
      const target = ((origin.y + ty) * atlasWidth + origin.x + tx) * 4
      data.set(pixels.subarray(source, source + 4), target)
    }
  }
}

function resolveFaceRects(rects) {
  const result = new Map()
  for (const [id, faces] of Object.entries(BLOCK_FACES)) {
    result.set(Number(id), {
      top: rects.get(faces.top),
      side: rects.get(faces.side),
      bottom: rects.get(faces.bottom),
    })
  }
  return result
}


// Pixel canvas and colour helpers

function createTile() {
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)
  const offset = (x, y) => (wrap(y) * TILE_SIZE + wrap(x)) * 4
  return {
    pixels,
    // Coordinates wrap so stamps crossing an edge keep the tile seamless.
    set(x, y, [r, g, b], alpha = 255) {
      const i = offset(x, y)
      pixels[i] = r
      pixels[i + 1] = g
      pixels[i + 2] = b
      pixels[i + 3] = alpha
    },
    get(x, y) {
      const i = offset(x, y)
      return [pixels[i], pixels[i + 1], pixels[i + 2]]
    },
  }
}

function forEachPixel(fn) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) fn(x, y)
  }
}

function wrap(value) {
  return ((value % TILE_SIZE) + TILE_SIZE) % TILE_SIZE
}

function pickShade(palette, value) {
  return palette[clamp(Math.floor(value * palette.length), 0, palette.length - 1)]
}

function vary(color, rng, amount) {
  const delta = (rng.next() * 2 - 1) * amount
  return color.map((channel) => channel + delta)
}

function mixColor(a, b, t) {
  return a.map((channel, i) => channel + (b[i] - channel) * t)
}

// Smooth, tileable value noise from a coarse random lattice (0..1).
function createBlotchNoise(rng, cells) {
  const lattice = Array.from({ length: cells * cells }, () => rng.next())
  const at = (cx, cz) => lattice[(((cz % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)]
  const scale = cells / TILE_SIZE
  return (x, y) => {
    const fx = x * scale
    const fy = y * scale
    const ix = Math.floor(fx)
    const iy = Math.floor(fy)
    const sx = smoothstep(0, 1, fx - ix) // fractions in [0, 1)
    const sy = smoothstep(0, 1, fy - iy)
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx
    const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx
    return top + (bottom - top) * sy
  }
}

// Base layer shared by most tiles: soft blotches plus per-pixel grain.
function paintSpeckled(tile, rng, palette, { blotch = 0.55, cells = 4, grain = 5 } = {}) {
  const noise = createBlotchNoise(rng, cells)
  forEachPixel((x, y) => {
    const value = blotch * noise(x, y) + (1 - blotch) * rng.next()
    tile.set(x, y, vary(pickShade(palette, value), rng, grain))
  })
}

function scatter(rng, count, fn) {
  for (let i = 0; i < count; i++) fn(rng.int(0, TILE_SIZE - 1), rng.int(0, TILE_SIZE - 1))
}


// Tile painters

function paintGrassTop(tile, rng) {
  paintSpeckled(tile, rng, GRASS, { blotch: 0.5 })
  // Sunlit blade tips with a slightly darker stem below, plus shaded roots.
  scatter(rng, 16, (x, y) => {
    tile.set(x, y, vary(GRASS_TIP, rng, 8))
    tile.set(x, y + 1, vary(GRASS[3], rng, 6))
  })
  scatter(rng, 10, (x, y) => tile.set(x, y, vary(GRASS_ROOT, rng, 5)))
}

function paintDirt(tile, rng) {
  paintSpeckled(tile, rng, DIRT, { blotch: 0.45 })
  for (let i = 0; i < 6; i++) paintPebble(tile, rng)
}

function paintPebble(tile, rng) {
  const x = rng.int(0, TILE_SIZE - 1)
  const y = rng.int(0, TILE_SIZE - 1)
  const width = rng.chance(0.5) ? 2 : 1
  for (let dx = 0; dx < width; dx++) {
    tile.set(x + dx, y, vary(PEBBLE, rng, 10))
    tile.set(x + dx, y + 1, DIRT_SHADOW)
  }
}

// Dirt with a ragged turf fringe hanging from the top edge.
function paintGrassSide(tile, rng) {
  paintDirt(tile, rng)
  const depths = fringeDepths(rng)
  for (let x = 0; x < TILE_SIZE; x++) {
    const depth = depths[x]
    tile.set(x, 0, vary(GRASS_TIP, rng, 6))
    for (let y = 1; y < depth; y++) tile.set(x, y, vary(pickShade(GRASS, rng.next() * 0.85), rng, 6))
    tile.set(x, depth, mixColor(tile.get(x, depth), GRASS_SHADOW, 0.6))
  }
}

// A wandering lower edge (2-4 px) with occasional longer drips.
function fringeDepths(rng) {
  const depths = []
  let depth = rng.int(2, 4)
  for (let x = 0; x < TILE_SIZE; x++) {
    depth = clamp(depth + rng.int(-1, 1), 2, 4)
    depths.push(rng.chance(0.2) ? depth + 2 : depth)
  }
  return depths
}

function paintStone(tile, rng) {
  paintSpeckled(tile, rng, STONE, { blotch: 0.7, grain: 4 })
  for (let i = 0; i < 4; i++) paintCrack(tile, rng)
}

// A short dark fissure with a lit lip above it, wandering left or right.
function paintCrack(tile, rng) {
  let x = rng.int(0, TILE_SIZE - 1)
  let y = rng.int(0, TILE_SIZE - 1)
  const step = rng.chance(0.5) ? 1 : -1
  const length = rng.int(2, 5)
  for (let i = 0; i < length; i++) {
    tile.set(x, y - 1, STONE_EDGE)
    tile.set(x, y, STONE_CRACK)
    x += step
    if (rng.chance(0.4)) y += rng.chance(0.5) ? 1 : -1
  }
}

// Vertical bark: streaky columns with wavy grooves. The groove wobble is
// periodic over the tile height so stacked trunk blocks line up.
function paintBark(tile, rng) {
  const columnTone = Array.from({ length: TILE_SIZE }, () => rng.next())
  forEachPixel((x, y) => {
    const value = 0.65 * columnTone[x] + 0.35 * rng.next()
    tile.set(x, y, vary(pickShade(BARK, value), rng, 4))
  })
  for (let groove = 0; groove < 4; groove++) paintGroove(tile, rng, groove * 4 + rng.int(0, 1))
}

function paintGroove(tile, rng, column) {
  const phase = rng.next() * TAU
  const amplitude = rng.chance(0.6) ? 1 : 0
  for (let y = 0; y < TILE_SIZE; y++) {
    const x = column + Math.round(Math.sin((y / TILE_SIZE) * TAU + phase) * amplitude)
    tile.set(x, y, vary(BARK_GROOVE, rng, 4))
    if (rng.chance(0.6)) tile.set(x + 1, y, mixColor(tile.get(x + 1, y), BARK_LIGHT, 0.5))
  }
}

// End grain: squarish growth rings inside a one-pixel bark rim.
function paintWoodRings(tile, rng) {
  const centre = (TILE_SIZE - 1) / 2
  forEachPixel((x, y) => {
    const dx = Math.abs(x - centre)
    const dy = Math.abs(y - centre)
    const edge = Math.max(dx, dy)
    if (edge > 6.5) return tile.set(x, y, vary(pickShade(BARK, rng.next()), rng, 4))
    const radius = 0.55 * edge + 0.45 * Math.hypot(dx, dy)
    if (radius < 1.2) return tile.set(x, y, vary(RING_CORE, rng, 4))
    const band = Math.floor(radius * 0.85 + rng.next() * 0.3)
    tile.set(x, y, vary(band % 2 === 0 ? RING_LIGHT : RING_DARK, rng, 5))
  })
}

// Dark leafy depths with brighter plus-shaped leaf clusters on top. Leaves are
// fully opaque (alpha 255 everywhere), matching their collision.
function paintLeaves(tile, rng) {
  paintSpeckled(tile, rng, LEAF_DEPTH, { blotch: 0.6, grain: 4 })
  for (let i = 0; i < 18; i++) stampLeafCluster(tile, rng)
}

function stampLeafCluster(tile, rng) {
  const x = rng.int(0, TILE_SIZE - 1)
  const y = rng.int(0, TILE_SIZE - 1)
  const tone = pickShade(LEAF, rng.next())
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) tile.set(x + dx, y + dy, vary(tone, rng, 7))
  tile.set(x, y - 1, vary(LEAF_TIP, rng, 6))
  tile.set(x + 1, y + 1, mixColor(tone, LEAF_DEPTH[0], 0.6))
}

function paintWave(tile, rng) {
  const x = rng.int(0, TILE_SIZE - 1)
  const y = rng.int(0, TILE_SIZE - 1)
  const length = rng.int(3, 5)
  for (let i = 0; i < length; i++) {
    tile.set(x + i, y, vary(WAVE_CREST, rng, 6))
    tile.set(x + i + 1, y + 1, WAVE_TROUGH)
  }
}
