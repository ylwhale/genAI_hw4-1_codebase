// Placement preview: a translucent block, rising fill, wireframe, and sparkles.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three'
import { isCell } from '../core/geometry.js'
import { clamp01 } from '../core/math.js'
import { createRng } from '../core/rng.js'
import { getBlockType, isSolidBlock } from '../world/blocks.js'
import { createBoxOutline } from './blockHighlight.js'
import { sameCell } from './blockFaces.js'
import { RENDER_ORDER } from './renderOrder.js'

const PREVIEW_GLOW = 0x9ff0ff
const SPARKLES_PER_SECOND = 18
const BOX_FACE_KINDS = ['side', 'side', 'top', 'bottom', 'side', 'side'] // BoxGeometry order: +x -x +y -y +z -z

// Remap a BoxGeometry's per-face UVs into the atlas tile of each face. With
// fill < 1 the side faces show only the bottom part of their tile, so a box
// scaled to that height keeps undistorted texels (the "rising" construction).
export function applyAtlasUvs(geometry, atlas, blockId, fill = 1, baseUvs = geometry.userData.baseUvs) {
  const uv = geometry.attributes.uv
  const base = baseUvs ?? uv.array.slice()
  geometry.userData.baseUvs = base
  for (let face = 0; face < 6; face++) {
    const rect = atlas.uvFor(blockId, BOX_FACE_KINDS[face])
    const height = BOX_FACE_KINDS[face] === 'side' ? fill : 1
    for (let i = face * 4; i < face * 4 + 4; i++) {
      uv.array[i * 2] = rect.u0 + base[i * 2] * (rect.u1 - rect.u0)
      uv.array[i * 2 + 1] = rect.v0 + base[i * 2 + 1] * height * (rect.v1 - rect.v0)
    }
  }
  uv.needsUpdate = true
  return geometry
}

// A horizontal square (the construction "scan line").
function createRing(material) {
  const h = 0.51
  const corners = [
    [-h, 0, -h],
    [h, 0, -h],
    [h, 0, h],
    [-h, 0, h],
  ]
  const points = []
  corners.forEach((corner, i) => points.push(...corner, ...corners[(i + 1) % 4]))
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
  return new LineSegments(geometry, material)
}

function createParts(atlas) {
  const map = atlas?.texture ?? null
  const ghostMaterial = new MeshBasicMaterial({ map, color: 0xd8f6ff, transparent: true, opacity: 0.28, depthWrite: false })
  const fillGeometry = new BoxGeometry(0.985, 1, 0.985)
  fillGeometry.translate(0, 0.5, 0)
  const fillMaterial = new MeshLambertMaterial({
    map,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    emissive: 0x2b6a78,
    emissiveIntensity: 0.5,
  })
  const glow = { color: PREVIEW_GLOW, transparent: true, depthWrite: false, blending: AdditiveBlending }
  const ghostGeometry = new BoxGeometry(0.995, 0.995, 0.995)
  const parts = {
    group: new Group(),
    ghostGeometry,
    ghost: new Mesh(ghostGeometry, ghostMaterial),
    fill: new Mesh(fillGeometry, fillMaterial),
    frame: createBoxOutline(1.012, new LineBasicMaterial({ ...glow, opacity: 0.5 })),
    ring: createRing(new LineBasicMaterial({ ...glow, color: 0xe6fcff, opacity: 0.9 })),
  }
  parts.group.name = 'effects:preview'
  parts.group.visible = false
  parts.ghost.position.y = 0.5 // the group origin is the cell's bottom centre
  parts.frame.position.y = 0.5
  for (const name of ['ghost', 'fill', 'frame', 'ring']) {
    parts[name].name = `preview:${name}`
    parts[name].renderOrder = RENDER_ORDER.overlay
    parts.group.add(parts[name])
  }
  return parts
}

// Lighter, cooler version of a block colour for construction sparkles.
function sparkleColor(hex) {
  return new Color(hex).lerp(new Color(PREVIEW_GLOW), 0.55).getHex()
}

// atlas (optional) textures the ghost and fill; particles receives sparkles.
export function createPlacementPreview({ atlas = null, particles, seed = 0x9e37 } = {}) {
  const parts = createParts(atlas)
  const rng = createRng(seed)
  const ghostGeometries = new Map()
  const state = { cell: null, blockId: null, progress: 0, sparkleClock: 0 }
  let time = 0

  function hide() {
    parts.group.visible = false
    state.cell = null
    state.blockId = null
    state.progress = 0
  }

  function ghostGeometryFor(blockId) {
    if (!atlas) return parts.ghostGeometry
    if (!ghostGeometries.has(blockId)) {
      ghostGeometries.set(blockId, applyAtlasUvs(new BoxGeometry(0.995, 0.995, 0.995), atlas, blockId))
    }
    return ghostGeometries.get(blockId)
  }

  function start(cell, blockId) {
    state.cell = { x: cell.x, y: cell.y, z: cell.z }
    state.blockId = blockId
    state.sparkleClock = 0
    state.progress = -1 // forces a relayout for the new block
    parts.ghost.geometry = ghostGeometryFor(blockId)
    const tint = atlas ? 0xffffff : getBlockType(blockId).particle
    parts.fill.material.color.setHex(tint)
    if (!atlas) parts.ghost.material.color.setHex(new Color(tint).lerp(new Color(0xffffff), 0.35).getHex())
    parts.group.position.set(cell.x + 0.5, cell.y, cell.z + 0.5)
    parts.group.visible = true
  }

  function layout(progress) {
    const fillHeight = Math.max(progress, 0.001)
    parts.fill.visible = progress > 0
    parts.fill.scale.set(1, fillHeight, 1)
    if (atlas) applyAtlasUvs(parts.fill.geometry, atlas, state.blockId, fillHeight)
    parts.ring.position.y = fillHeight
    parts.ring.visible = progress > 0 && progress < 1
  }

  // cell: integer {x,y,z} or null; progress 0..1 of the construction.
  function set(cell, blockId, progress = 0) {
    if (!isCell(cell) || !isSolidBlock(blockId)) return hide()
    if (!sameCell(state.cell, cell) || state.blockId !== blockId) start(cell, blockId)
    const p = clamp01(progress)
    if (p !== state.progress) layout(p)
    state.progress = p
  }

  // A tiny glowing cube rising off the construction line.
  function emitSparkle(cell, height) {
    const edge = rng.range(-0.5, 0.5)
    const side = rng.int(0, 3)
    const x = side < 2 ? edge : side === 2 ? -0.5 : 0.5
    const z = side < 2 ? (side === 0 ? -0.5 : 0.5) : edge
    particles.spawn({
      x: cell.x + 0.5 + x,
      y: cell.y + height,
      z: cell.z + 0.5 + z,
      vx: x * 0.4,
      vy: rng.range(0.5, 1.1),
      vz: z * 0.4,
      life: rng.range(0.35, 0.6),
      size: rng.range(0.035, 0.06),
      gravity: -0.6,
      spin: 4,
      color: sparkleColor(getBlockType(state.blockId).particle),
      brightness: 1.2,
    })
  }

  // Pulses the glow and emits sparkles while the block is being built.
  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) return
    time += dt
    if (!state.cell) return
    const pulse = 0.5 + 0.5 * Math.sin(time * 6)
    const p = state.progress
    parts.ghost.material.opacity = 0.2 + 0.12 * pulse
    parts.frame.material.opacity = 0.3 + 0.4 * p + 0.25 * pulse
    parts.fill.material.emissiveIntensity = 0.3 + 0.45 * pulse * (1 - p)
    if (p <= 0 || p >= 1) return
    state.sparkleClock += dt * SPARKLES_PER_SECOND
    while (state.sparkleClock >= 1) {
      state.sparkleClock -= 1
      emitSparkle(state.cell, p)
    }
  }

  function dispose() {
    for (const object of [parts.fill, parts.frame, parts.ring]) {
      object.geometry.dispose()
      object.material.dispose()
    }
    parts.ghost.material.dispose()
    parts.ghostGeometry.dispose()
    for (const geometry of ghostGeometries.values()) geometry.dispose()
  }

  return { group: parts.group, set, hide, update, dispose }
}
