// Shared DOM elements, pixel sprites, and isometric block icons.
// DOM access uses the document supplied by the caller.

import { clamp } from '../core/math.js'

const TILE_EDGE = 16 // texels along one edge of an atlas tile
const TILE_LENGTH = TILE_EDGE * TILE_EDGE * 4
const ICON_ART_PIXELS = 16 // the hotbar icon spans 16 art pixels (style.css .vg-slot-icon)
const DEFAULT_ART_PIXEL = 2 // CSS px per art pixel (#ui --px) at the default GUI scale
const MAX_ICON_PIXEL_RATIO = 2

// Face brightness of the icon cube: lit top, softer left, shaded right.
export const ICON_SHADES = Object.freeze({ top: 1, left: 0.78, right: 0.6 })

// 10 x 9 heart. The left half uses 'l'/'h' and the right half 'r'/'s', so a
// half heart is only a CSS variable swap on the right-hand colours.
export const HEART_PIXELS = Object.freeze([
  '.kkk..kkk.',
  'klhlkkrrrk',
  'khlllrrrrk',
  'kllllrrrrk',
  'kllllrrrsk',
  '.klllrrsk.',
  '..kllrsk..',
  '...klrk...',
  '....kk....',
])

// Original 10 x 10 tool glyphs: 'w' wooden handle, 'm' metal head, 'h' shine.
export const TOOL_SPRITES = Object.freeze({
  pickaxe: Object.freeze([
    '..mmmmm...',
    '.mhhhhmm..',
    '......wmm.',
    '.....w..mm',
    '....w....m',
    '...w.....m',
    '..w.......',
    '.w........',
    'w.........',
    '..........',
  ]),
  axe: Object.freeze([
    '...mmm....',
    '..mhmmm...',
    '..mhmmmw..',
    '...mmmw...',
    '.....w....',
    '....w.....',
    '...w......',
    '..w.......',
    '.w........',
    'w.........',
  ]),
  shovel: Object.freeze([
    '........ww',
    '........ww',
    '.......w..',
    '......w...',
    '.....w....',
    '.mmmw.....',
    'mhmmm.....',
    'mhmmm.....',
    'mmmm......',
    '.mm.......',
  ]),
})

// 12 x 12 diagonal ticks drawn around the crosshair when a hit lands.
export const HIT_MARKER_PIXELS = Object.freeze([
  'xx........xx',
  'xxx......xxx',
  '.xxx....xxx.',
  '..x......x..',
  '............',
  '............',
  '............',
  '............',
  '..x......x..',
  '.xxx....xxx.',
  'xxx......xxx',
  'xx........xx',
])

export function element(doc, tag, { className, text, attrs } = {}, children = []) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  if (text !== undefined && text !== null) node.textContent = String(text)
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, String(value))
  for (const child of children) if (child) node.appendChild(child)
  return node
}

// Restart a one-shot CSS animation even if its class is already present.
export function replayClass(node, className) {
  node.classList.remove(className)
  void node.offsetWidth // style flush so the browser sees the class as new
  node.classList.add(className)
}

export function spriteSize(rows) {
  return { width: Math.max(0, ...rows.map((row) => row.length)), height: rows.length }
}

// Box-shadow pixel art: every non-'.' character becomes a 1em square, so CSS
// scales a sprite with font-size alone. `palette` maps a character to a CSS
// colour, or is a function (char, x, y) => colour. The drawing element sits
// one cell up-left of the art because a box-shadow is never painted under its
// own element, hence the +1 offsets.
export function pixelArtShadow(rows, palette) {
  const colorFor = typeof palette === 'function' ? palette : (key) => palette[key]
  const shadows = []
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const key = row[x]
      if (key === '.') continue
      const color = colorFor(key, x, y)
      if (!color) throw new TypeError(`No colour for pixel '${key}' at ${x},${y}`)
      shadows.push(`${x + 1}em ${y + 1}em ${color}`)
    }
  })
  return shadows.join(',')
}

export function pixelSprite(doc, rows, palette, className = '') {
  const { width, height } = spriteSize(rows)
  const sprite = element(doc, 'span', { className: `vg-sprite ${className}`.trim(), attrs: { 'aria-hidden': 'true' } })
  sprite.style.width = `${width}em`
  sprite.style.height = `${height}em`
  const ink = element(doc, 'span', { className: 'vg-sprite-ink' })
  ink.style.boxShadow = pixelArtShadow(rows, palette)
  sprite.appendChild(ink)
  return sprite
}

// Multiply a 0xRRGGBB colour by `factor` and return it as '#rrggbb'.
export function shadeColor(hex, factor = 1) {
  const channel = (shift) => clamp(Math.round(((hex >> shift) & 0xff) * factor), 0, 255)
  const value = (channel(16) << 16) | (channel(8) << 8) | channel(0)
  return `#${value.toString(16).padStart(6, '0')}`
}

// Which face of a 2:1 isometric cube covers the normalised point (x, y) in
// [0, 1]^2, with texture coordinates (u, v) on that face (v = 0 is the top
// row of the tile). The top rhombus spans y 0..0.5; the side faces meet at
// the front vertical edge x = 0.5.
export function isoCubeFace(x, y) {
  const top = { s: x - 2 * (y - 0.25), t: x + 2 * (y - 0.25) }
  if (inUnit(top.s) && inUnit(top.t)) return { face: 'top', u: top.t, v: top.s }
  if (x < 0.5) {
    const s = 2 * x
    const t = 2 * (y - 0.25) - 0.5 * s
    return inUnit(t) ? { face: 'left', u: s, v: t } : null
  }
  const s = 2 * (x - 0.5)
  const t = 2 * (y - 0.5) + 0.5 * s
  return inUnit(s) && inUnit(t) ? { face: 'right', u: s, v: t } : null
}

function inUnit(value) {
  return value >= 0 && value <= 1
}

function isTile(pixels) {
  return (pixels instanceof Uint8ClampedArray || pixels instanceof Uint8Array) && pixels.length === TILE_LENGTH
}

function copyShadedTexel(out, offset, tile, u, v, shade) {
  const tx = Math.min(TILE_EDGE - 1, Math.floor(u * TILE_EDGE))
  const ty = Math.min(TILE_EDGE - 1, Math.floor(v * TILE_EDGE))
  const source = (ty * TILE_EDGE + tx) * 4
  out[offset] = tile[source] * shade
  out[offset + 1] = tile[source + 1] * shade
  out[offset + 2] = tile[source + 2] * shade
  out[offset + 3] = tile[source + 3]
}

// Rasterise an isometric cube (RGBA, rows top-first) from a top tile and a
// side tile, nearest-texel sampled so the pixel-art stays crisp.
export function isoCubePixels(topPixels, sidePixels, size = 48) {
  if (!isTile(topPixels) || !isTile(sidePixels)) throw new TypeError('Block icon tiles must be 16x16 RGBA arrays')
  if (!Number.isInteger(size) || size < 8 || size > 512) throw new RangeError(`Invalid icon size: ${size}`)
  const out = new Uint8ClampedArray(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const hit = isoCubeFace((px + 0.5) / size, (py + 0.5) / size)
      if (!hit) continue
      const tile = hit.face === 'top' ? topPixels : sidePixels
      copyShadedTexel(out, (py * size + px) * 4, tile, hit.u, hit.v, ICON_SHADES[hit.face])
    }
  }
  return out
}

// Rows of 't' / 'l' / 'r' marking the cube faces, for a CSS-only fallback icon.
export function cubeSpriteRows(size = TILE_EDGE) {
  const code = { top: 't', left: 'l', right: 'r' }
  return Array.from({ length: size }, (_, py) => {
    let row = ''
    for (let px = 0; px < size; px++) {
      const hit = isoCubeFace((px + 0.5) / size, (py + 0.5) / size)
      row += hit ? code[hit.face] : '.'
    }
    return row
  })
}

// Device pixels covered by a hotbar icon, so the browser shows it 1:1
// instead of resampling (blurring) it: 16 art pixels x --px x pixel ratio.
export function blockIconSize(artPixel = DEFAULT_ART_PIXEL, devicePixelRatio = 1) {
  const px = Number.isFinite(artPixel) && artPixel > 0 ? artPixel : DEFAULT_ART_PIXEL
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(devicePixelRatio, MAX_ICON_PIXEL_RATIO) : 1
  return clamp(Math.round(ICON_ART_PIXELS * px * ratio), TILE_EDGE, 512)
}

// PNG data URL of an isometric block icon; '' when no canvas is available
// (Node, blocked canvas) or the tiles are invalid. Never throws.
export function createBlockIcon(topPixels, sidePixels, size = 48, { doc = globalThis.document } = {}) {
  try {
    const pixels = isoCubePixels(topPixels, sidePixels, size)
    const canvas = doc?.createElement?.('canvas')
    const context = canvas?.getContext?.('2d')
    if (!context) return ''
    canvas.width = size
    canvas.height = size
    const image = context.createImageData(size, size)
    image.data.set(pixels)
    context.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}
