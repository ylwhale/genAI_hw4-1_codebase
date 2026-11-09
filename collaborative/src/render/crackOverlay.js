// Mining cracks, impact chips, and dust. The crack cube uses polygon offset
// to avoid z-fighting with the block surface.

import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import { isCell, isFinitePoint } from '../core/geometry.js'
import { TAU, clamp } from '../core/math.js'
import { createRng } from '../core/rng.js'
import { getBlockType } from '../world/blocks.js'
import { TOP_FACE, emitFromFaces, exposedFaces, sameCell } from './blockFaces.js'
import { miningImpactCount } from './miningRhythm.js'
import { BURST_DEFAULTS, randomDirection } from './particles.js'
import { RENDER_ORDER } from './renderOrder.js'
import { createPixelTexture } from './textures.js'

export const CRACK_STAGES = 8
export const CRACK_SIZE = 16

const CRACK_CORE = [30, 24, 20, 225]
const CRACK_HALO = [44, 36, 30, 70]

// Chips flying off the exposed faces on every tool impact.
const CHIPS = Object.freeze({
  count: 5,
  outset: 0.02,
  margin: 0.15,
  push: [1, 2],
  scatter: 0.8,
  lift: [1, 2.2],
  life: [0.35, 0.55],
  size: [0.05, 0.085],
  brightness: 0.15,
  gravity: BURST_DEFAULTS.gravity,
})

// Fine dust puffed off the mined face on a steady clock.
const DUST = Object.freeze({
  interval: 0.22, // seconds between puffs
  count: 4,
  offset: 0.06, // start this far in front of the face (> half the largest cube)
  scatter: 0.04, // extra random offset, always away from the face
  speed: 1.4,
  upward: 2.2,
  life: 0.45,
  size: 0.08,
  variation: 0.14,
  gravity: BURST_DEFAULTS.gravity,
})

// Crack pattern (pure)

// Appearance threshold per pixel (0..1, Infinity = never cracks). Cracks grow
// outward from an impact point as random-walk branches, so every later stage
// contains all earlier cracks.
export function crackThresholds(size = CRACK_SIZE, seed = 0xc4ac) {
  const rng = createRng(seed)
  const thresholds = new Float32Array(size * size).fill(Infinity)
  const mark = (x, y, value) => {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || py < 0 || px >= size || py >= size) return
    const i = py * size + px
    thresholds[i] = Math.min(thresholds[i], Math.min(value, 1))
  }

  // Jagged but mostly straight: each step jitters around a slowly drifting heading.
  function walk(x, y, angle, length, start, depth) {
    let course = angle
    for (let k = 1; k <= length; k++) {
      course += rng.range(-0.12, 0.12)
      const heading = course + rng.range(-0.45, 0.45)
      x += Math.cos(heading)
      y += Math.sin(heading)
      const value = start + k * (0.85 / (size / 2))
      mark(x, y, value)
      if (depth === 0 && k > 2 && rng.chance(0.22)) {
        walk(x, y, course + rng.pick([-1, 1]) * rng.range(0.6, 1), Math.ceil(length / 2), value, 1)
      }
    }
  }

  const cx = size / 2 + rng.range(-1.5, 1.5)
  const cy = size / 2 + rng.range(-1.5, 1.5)
  mark(cx, cy, 0)
  const branches = rng.int(5, 6)
  for (let b = 0; b < branches; b++) {
    const angle = (b / branches) * TAU + rng.range(-0.35, 0.35)
    walk(cx, cy, angle, Math.round(rng.range(size * 0.4, size * 0.6)), 0.02 + b * 0.015, 0)
  }
  for (let n = 0; n < size / 2; n++) mark(rng.range(0, size), rng.range(0, size), rng.range(0.45, 1))
  return thresholds
}

// RGBA pixels (row-major, CRACK_SIZE²) for crack stage 0..stages-1.
export function generateCrackPixels(stage, { stages = CRACK_STAGES, size = CRACK_SIZE, seed } = {}) {
  const thresholds = crackThresholds(size, seed)
  const visible = (clamp(Math.floor(stage), 0, stages - 1) + 1) / stages
  const cracked = (x, y) => x >= 0 && y >= 0 && x < size && y < size && thresholds[y * size + x] <= visible
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const halo = cracked(x - 1, y) || cracked(x + 1, y) || cracked(x, y - 1) || cracked(x, y + 1)
      const rgba = cracked(x, y) ? CRACK_CORE : halo ? CRACK_HALO : null
      if (rgba) pixels.set(rgba, (y * size + x) * 4)
    }
  }
  return pixels
}

// Crack stage shown for a mining progress 0..1.
export function crackStage(progress, stages = CRACK_STAGES) {
  if (!Number.isFinite(progress)) return 0
  return clamp(Math.floor(clamp(progress, 0, 1) * stages), 0, stages - 1)
}

// Overlay

function createCrackMesh() {
  const textures = Array.from({ length: CRACK_STAGES }, (_, stage) =>
    createPixelTexture(generateCrackPixels(stage), CRACK_SIZE, CRACK_SIZE),
  )
  const material = new MeshBasicMaterial({
    map: textures[0],
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  })
  const mesh = new Mesh(new BoxGeometry(1.002, 1.002, 1.002), material)
  mesh.name = 'effects:crack'
  mesh.visible = false
  mesh.renderOrder = RENDER_ORDER.crack
  return { mesh, textures }
}

// A raycast hit usable as the dust source: a finite point on an axis face of
// `block` (a hit carrying cell coordinates must be on that very block).
function hitOnBlock(hit, block) {
  if (!isFinitePoint(hit?.point) || !isFinitePoint(hit.normal)) return false
  const { x, y, z } = hit.normal
  if (Math.abs(x) + Math.abs(y) + Math.abs(z) !== 1) return false
  return !isCell(hit) || sameCell(hit, block)
}

// particles: the shared particle system; world (optional) colours the debris
// of unknown blocks and tells which faces are open.
export function createCrackOverlay({ particles, world = null, seed = 0xc4ac } = {}) {
  const { mesh, textures } = createCrackMesh()
  const rng = createRng(seed)
  const state = { block: null, blockId: undefined, hit: null, stage: -1, impacts: 0, dustClock: 0 }

  function hide() {
    mesh.visible = false
    state.block = null
    state.blockId = undefined
    state.hit = null
    state.stage = -1
    state.impacts = 0
  }

  // The block's particle colour, or null when it is unknown (or not solid).
  function debrisColor() {
    const { block, blockId } = state
    const id = Number.isInteger(blockId) ? blockId : world?.getBlock(block.x, block.y, block.z)
    const type = getBlockType(id)
    return type?.solid ? type.particle : null
  }

  function emitChips() {
    const color = debrisColor()
    if (color === null) return
    emitFromFaces(particles, rng, state.block, exposedFaces(world, state.block), color, CHIPS.count, CHIPS)
  }

  function startBlock(block) {
    hide()
    state.block = { x: block.x, y: block.y, z: block.z }
    state.dustClock = 0 // the first dust puff comes with the first frame
  }

  // block: integer {x,y,z} or null. blockId colours the debris (falls back to
  // the world, when one was provided). hit: the crosshair raycast hit
  // { point, normal } on this block, or null.
  function set(block, progress = 0, blockId, hit = null) {
    if (!isCell(block)) return hide()
    if (!sameCell(state.block, block)) startBlock(block)
    state.blockId = blockId
    state.hit = hitOnBlock(hit, block) ? hit : null
    const stage = crackStage(progress)
    if (stage !== state.stage) {
      mesh.material.map = textures[stage]
      state.stage = stage
    }
    mesh.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5)
    mesh.visible = true
    const impacts = miningImpactCount(progress)
    if (impacts > state.impacts) emitChips()
    state.impacts = impacts
  }

  // Where the dust leaves the block: the hit point, else the centre of an
  // open face (the top one when it is open). Null when the block is enclosed.
  function dustSource() {
    if (state.hit) return state.hit
    const faces = exposedFaces(world, state.block)
    const face = faces.includes(TOP_FACE) ? TOP_FACE : faces[0]
    if (!face) return null
    const [x, y, z] = face
    const { block } = state
    return { point: { x: block.x + 0.5 + x / 2, y: block.y + 0.5 + y / 2, z: block.z + 0.5 + z / 2 }, normal: { x, y, z } }
  }

  // Random direction in the hemisphere the face looks into.
  function outwardDirection(normal) {
    const dir = randomDirection(rng)
    const facing = dir.x * normal.x + dir.y * normal.y + dir.z * normal.z
    if (facing >= 0) return dir
    return { x: dir.x - 2 * facing * normal.x, y: dir.y - 2 * facing * normal.y, z: dir.z - 2 * facing * normal.z }
  }

  function emitDust({ point, normal }, color) {
    for (let n = 0; n < DUST.count; n++) {
      const dir = outwardDirection(normal)
      const extra = rng.range(0, DUST.scatter)
      const speed = DUST.speed * rng.range(0.45, 1)
      const lift = normal.y < 0 ? 0 : DUST.upward * rng.range(0.4, 1)
      particles.spawn({
        x: point.x + normal.x * DUST.offset + dir.x * extra,
        y: point.y + normal.y * DUST.offset + dir.y * extra,
        z: point.z + normal.z * DUST.offset + dir.z * extra,
        vx: dir.x * speed,
        vy: dir.y * speed + lift,
        vz: dir.z * speed,
        life: DUST.life * rng.range(0.75, 1.25),
        size: DUST.size * rng.range(0.7, 1.3),
        gravity: DUST.gravity,
        color,
        brightness: 1 + rng.range(-DUST.variation, DUST.variation),
      })
    }
  }

  // Advances the dust clock; only a running frame (dt > 0) makes dust, so a
  // paused game keeps its crack without piling up particles.
  function update(dt) {
    if (!mesh.visible || !(dt > 0) || !Number.isFinite(dt)) return
    state.dustClock -= dt
    if (state.dustClock > 0) return
    state.dustClock = DUST.interval
    const color = debrisColor()
    const source = color === null ? null : dustSource()
    if (source) emitDust(source, color)
  }

  function dispose() {
    mesh.geometry.dispose()
    mesh.material.dispose()
    for (const texture of textures) texture.dispose()
  }

  return {
    mesh,
    set,
    hide,
    update,
    dispose,
    get stage() {
      return mesh.visible ? state.stage : -1
    },
  }
}
