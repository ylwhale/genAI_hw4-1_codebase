// Tool sprites extruded into voxels and merged into one geometry per material.
// Seeded shading on each pixel quad matches the hand's texture.

import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial, MeshPhongMaterial } from 'three'
import { hash3 } from '../core/rng.js'

export const TOOL_PIXEL = 0.022 // world units per voxel pixel in the hand overlay

// Corner of face `index` at face-local fractions (s, t). Tangents are chosen
// so (u x v) equals the outward normal, which keeps winding counter-clockwise.
const FACES = [
  { normal: [1, 0, 0], size: (b) => [b.d, b.h], at: (b, s, t) => [b.x + b.w, b.y + t * b.h, b.z + b.d - s * b.d] },
  { normal: [-1, 0, 0], size: (b) => [b.d, b.h], at: (b, s, t) => [b.x, b.y + t * b.h, b.z + s * b.d] },
  { normal: [0, 1, 0], size: (b) => [b.w, b.d], at: (b, s, t) => [b.x + s * b.w, b.y + b.h, b.z + b.d - t * b.d] },
  { normal: [0, -1, 0], size: (b) => [b.w, b.d], at: (b, s, t) => [b.x + s * b.w, b.y, b.z + t * b.d] },
  { normal: [0, 0, 1], size: (b) => [b.w, b.h], at: (b, s, t) => [b.x + s * b.w, b.y + t * b.h, b.z + b.d] },
  { normal: [0, 0, -1], size: (b) => [b.w, b.h], at: (b, s, t) => [b.x + b.w - s * b.w, b.y + t * b.h, b.z] },
]
const FACE_NAMES = Object.freeze(['px', 'nx', 'py', 'ny', 'pz', 'nz'])

// Box helper: min corner + size in pixels, a hex colour, optional face names to skip.
export function voxelBox(x, y, z, w, h, d, color, { hide = [], jitter } = {}) {
  return { x, y, z, w, h, d, color, hide, jitter }
}

function createBuffers() {
  return { positions: [], normals: [], colors: [], indices: [] }
}

function pushQuad(buffers, corners, normal, rgb) {
  const base = buffers.positions.length / 3
  for (const corner of corners) {
    buffers.positions.push(...corner)
    buffers.normals.push(...normal)
    buffers.colors.push(...rgb)
  }
  buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

// Pixel-level shade variation, stable for a given pixel position and seed.
function shadeFor(color, jitter, seed, faceIndex, px, py, pz) {
  const noise = hash3(Math.floor(px * 2 + faceIndex * 97), Math.floor(py * 2), Math.floor(pz * 2), seed) * 2 - 1
  const factor = 1 + noise * jitter
  return [color.r * factor, color.g * factor, color.b * factor]
}

function pushFace(buffers, box, faceIndex, color, options) {
  const face = FACES[faceIndex]
  const [uLen, vLen] = face.size(box)
  const uCells = Math.max(1, Math.ceil(uLen - 1e-6))
  const vCells = Math.max(1, Math.ceil(vLen - 1e-6))
  const jitter = box.jitter ?? options.jitter
  for (let i = 0; i < uCells; i++) {
    const s0 = i / uLen
    const s1 = Math.min(i + 1, uLen) / uLen
    for (let j = 0; j < vCells; j++) {
      const t0 = j / vLen
      const t1 = Math.min(j + 1, vLen) / vLen
      const centre = face.at(box, (s0 + s1) / 2, (t0 + t1) / 2)
      const rgb = shadeFor(color, jitter, options.seed, faceIndex, ...centre)
      const corners = [face.at(box, s0, t0), face.at(box, s1, t0), face.at(box, s1, t1), face.at(box, s0, t1)]
      pushQuad(buffers, corners.map((p) => p.map((v) => v * options.pixel)), face.normal, rgb)
    }
  }
}

// Merge boxes (in pixel units) into one indexed BufferGeometry with normals
// and linear vertex colours, scaled by `pixel` world units per pixel.
export function createVoxelGeometry(boxes, { pixel = 1, jitter = 0.06, seed = 7 } = {}) {
  const buffers = createBuffers()
  const options = { pixel, jitter, seed }
  const color = new Color()
  for (const box of boxes) {
    color.setHex(box.color)
    FACES.forEach((_, faceIndex) => {
      if (!box.hide.includes(FACE_NAMES[faceIndex])) pushFace(buffers, box, faceIndex, color, options)
    })
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(buffers.positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(buffers.normals), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(buffers.colors), 3))
  geometry.setIndex(buffers.indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// Sprite extrusion

// Faces shared with an equally thick (or thicker) neighbour are never visible.
function hiddenFaces(sprite, legend, col, row, depth) {
  const covers = (c, r) => {
    const entry = legend[sprite[r]?.[c]]
    return Boolean(entry) && entry.depth >= depth
  }
  const hide = []
  if (covers(col + 1, row)) hide.push('px')
  if (covers(col - 1, row)) hide.push('nx')
  if (covers(col, row - 1)) hide.push('py')
  if (covers(col, row + 1)) hide.push('ny')
  return hide
}

// Turn a character sprite (row 0 = top) into boxes grouped by material. Each
// legend entry is { color, depth, material }; `origin` is the sprite point
// [column, row] that becomes the model origin (the hand's grip point).
export function extrudeSprite(sprite, legend, origin) {
  const groups = {}
  sprite.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      const entry = legend[line[col]]
      if (!entry) continue
      const x = col - origin[0]
      const y = origin[1] - row - 1
      const hide = hiddenFaces(sprite, legend, col, row, entry.depth)
      const box = voxelBox(x, y, -entry.depth / 2, 1, 1, entry.depth, entry.color, { hide, jitter: entry.jitter })
      ;(groups[entry.material] ??= []).push(box)
    }
  })
  return groups
}

// Tool designs

const WOOD = { w: 0xa8743f, W: 0x7a5128, b: 0x5b3b26 }
const IRON = { h: 0xe8eef3, m: 0xa9b4be, d: 0x6c7783, e: 0x58616c, r: 0x8f9ba7 }
const COPPER = { h: 0xf7c48f, m: 0xd08747, d: 0x96552c, e: 0xb0652f }

function woodLegend() {
  return {
    w: { color: WOOD.w, depth: 2, material: 'wood', jitter: 0.09 },
    W: { color: WOOD.W, depth: 2, material: 'wood', jitter: 0.09 },
    b: { color: WOOD.b, depth: 3, material: 'wood', jitter: 0.1 },
  }
}

function metalLegend(palette, depths) {
  const legend = {}
  for (const [char, depth] of Object.entries(depths)) {
    legend[char] = { color: palette[char], depth, material: 'metal', jitter: 0.035 }
  }
  return legend
}

// Handles run down the sprite's centre columns 7-8; the head sits on top.
const TOOL_DESIGNS = {
  pickaxe: {
    origin: [8, 15.5],
    legend: { ...woodLegend(), ...metalLegend(IRON, { h: 2, m: 2, d: 2 }) },
    sprite: [
      '....hhhhhhhh....',
      '..hhmmmmmmmmhh..',
      '.hmmmmbbbbmmmmh.',
      'hmmdd.bbbb.ddmmh',
      'hmd....ww....dmh',
      'md.....ww.....dm',
      'd......ww......d',
      '.......ww.......',
      '.......wW.......',
      '.......ww.......',
      '.......Ww.......',
      '.......ww.......',
      '.......ww.......',
      '.......wW.......',
      '.......ww.......',
      '.......ww.......',
      '.......Ww.......',
      '.......ww.......',
      '.......WW.......',
    ],
  },
  axe: {
    origin: [8, 15.5],
    legend: { ...woodLegend(), ...metalLegend(COPPER, { h: 1, m: 1, d: 1, e: 3 }) },
    sprite: [
      '.......WW.......',
      '.......ww..mh...',
      '......eeeemmmh..',
      '......eeeemmmmh.',
      '......eeeemmmmmh',
      '......eeeemmmmmh',
      '......eeeedmmmh.',
      '......eeeedmmh..',
      '.......ww..dh...',
      '.......ww.......',
      '.......wW.......',
      '.......ww.......',
      '.......Ww.......',
      '.......ww.......',
      '.......ww.......',
      '.......wW.......',
      '.......ww.......',
      '.......Ww.......',
      '.......WW.......',
    ],
  },
  shovel: {
    origin: [8, 16.5],
    legend: { ...woodLegend(), ...metalLegend(IRON, { h: 1, m: 1, d: 1, r: 2, e: 3 }) },
    sprite: [
      '.......hh.......',
      '......hmmh......',
      '.....hmrrmh.....',
      '....hmmrrmmd....',
      '....hmmrrmmd....',
      '....hmmrrmmd....',
      '....hmmrrmmd....',
      '....dddrrddd....',
      '.......ee.......',
      '.......ee.......',
      '.......ww.......',
      '.......wW.......',
      '.......ww.......',
      '.......Ww.......',
      '.......ww.......',
      '.......ww.......',
      '.......wW.......',
      '.......ww.......',
      '.......ww.......',
      '......WwwW......',
      '......WWWW......',
    ],
  },
}

export const TOOL_KEYS = Object.freeze(Object.keys(TOOL_DESIGNS))

function createMaterial(kind) {
  if (kind === 'metal') return new MeshPhongMaterial({ vertexColors: true, shininess: 56, specular: 0x5a5a5a })
  return new MeshLambertMaterial({ vertexColors: true })
}

// A THREE.Group for 'pickaxe' | 'axe' | 'shovel'. The origin is the grip
// point; the handle runs along +Y with the head on top and the flat side of
// the head facing +Z. Throws for unknown keys (callers validate first).
export function createToolModel(key, { pixel = TOOL_PIXEL } = {}) {
  if (!Object.hasOwn(TOOL_DESIGNS, key)) throw new Error(`Unknown tool model: ${key}`)
  const design = TOOL_DESIGNS[key]
  const group = new Group()
  group.name = `tool:${key}`
  const parts = extrudeSprite(design.sprite, design.legend, design.origin)
  for (const [material, boxes] of Object.entries(parts)) {
    const mesh = new Mesh(createVoxelGeometry(boxes, { pixel, seed: material.length * 31 + key.length }), createMaterial(material))
    mesh.name = `${key}:${material}`
    group.add(mesh)
  }
  group.userData = { key, headHeight: design.origin[1] * pixel, length: design.sprite.length * pixel }
  return group
}

// Release GPU resources of any voxel model (tool, hand) built here.
export function disposeModel(root) {
  root.traverse((node) => {
    if (!node.isMesh) return
    node.geometry.dispose()
    node.material.dispose()
  })
}
