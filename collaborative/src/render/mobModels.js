// Mob rigs share geometry but own their materials for independent hit flashes.
// Origin is the feet centre, facing -Z; root.rotation.y sets yaw.

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { clamp, clamp01, lerp, smoothstep } from '../core/math.js'
import { hash3 } from '../core/rng.js'
import { MOB_TYPES } from '../mobs/mobTypes.js'

const AO_FLOOR = 0.8 // brightness at the underside of every box (cheap baked occlusion)
const HURT_TINT = new Color(1, 0.12, 0.1)
const HURT_EMISSIVE = new Color(0.55, 0.04, 0.02)
const HURT_GLOW = new Color(1, 0.3, 0.22)


// Palettes

const MOSS = Object.freeze({
  base: MOB_TYPES.mossling.color,
  dark: 0x4a9131,
  deep: 0x3a7427,
  light: 0x78c24c,
  bright: 0x98d65c,
  belly: 0xb4d77a,
  foot: 0x3f6a2a,
  toe: 0x5a8a3c,
  eye: 0x141810,
  shine: 0xf3f6e6,
  mouth: 0x26331b,
  fang: 0xeceedd,
  blush: 0xd98a72,
  stem: 0x5c7c2a,
  leaf: 0xa1dc5d,
  leafDark: 0x73b846,
  bud: 0xd7ef93,
  spore: 0xd8ecb4,
})

const STONE = Object.freeze({
  base: MOB_TYPES.stoneguard.color,
  dark: 0x74787d,
  deep: 0x5e6267,
  light: 0xa2a6ab,
  crack: 0x33373b,
  moss: 0x5f8f3b,
  mossLight: 0x7cab4c,
  mossDark: 0x46702d,
  eye: 0xffb53a,
  core: 0xff9426,
  dust: 0xb8b2a7,
})

// A box: size [w, h, d] centred at [x, y, z] relative to its part's pivot.
// `rot` tilts it about its own centre; `vary` mottles its brightness.
function box(size, at, color, { rot = null, vary = 0 } = {}) {
  return { size, at, color, rot, vary }
}


// Mossling: a round little moss blob on two stubby feet, with a leafy sprout.

const MOSSLING_FOOT = [
  box([0.2, 0.13, 0.26], [0, -0.075, -0.02], MOSS.foot),
  box([0.16, 0.06, 0.06], [0, -0.11, -0.17], MOSS.toe),
]

// Widest at the nub arms (±0.39), so the rest pose stays inside the 0.7-wide
// body box (+0.05) that collision and melee use.
const MOSSLING_BODY = [
  box([0.62, 0.46, 0.62], [0, 0.3, 0], MOSS.base, { vary: 0.05 }), // core
  box([0.48, 0.62, 0.5], [0, 0.31, 0], MOSS.dark, { vary: 0.04 }), // rounds top and bottom
  box([0.66, 0.3, 0.5], [0, 0.3, 0], MOSS.base, { vary: 0.05 }), // rounds the flanks
  box([0.44, 0.22, 0.4], [0, 0.22, -0.14], MOSS.light, { vary: 0.04 }), // belly bulge
  box([0.38, 0.08, 0.38], [0, 0.64, 0], MOSS.dark), // crown
  box([0.32, 0.16, 0.02], [0, 0.21, -0.345], MOSS.belly), // pale belly patch
  // moss tufts on the crown and shoulders
  box([0.14, 0.07, 0.14], [-0.1, 0.7, 0.06], MOSS.light, { vary: 0.08 }),
  box([0.12, 0.06, 0.12], [0.12, 0.69, -0.05], MOSS.deep, { vary: 0.08 }),
  box([0.1, 0.06, 0.1], [0.04, 0.7, 0.15], MOSS.bright, { vary: 0.08 }),
  box([0.12, 0.08, 0.1], [-0.22, 0.56, 0.16], MOSS.bright, { vary: 0.08 }),
  box([0.1, 0.08, 0.12], [0.24, 0.58, 0.1], MOSS.light, { vary: 0.08 }),
  // stubby nub arms
  box([0.07, 0.12, 0.14], [-0.355, 0.2, -0.04], MOSS.dark),
  box([0.07, 0.12, 0.14], [0.355, 0.2, -0.04], MOSS.dark),
  // lichen speckles on the flanks and mottled moss on the back
  box([0.02, 0.1, 0.12], [-0.34, 0.34, 0.08], MOSS.bright),
  box([0.02, 0.06, 0.1], [-0.34, 0.4, -0.1], MOSS.deep),
  box([0.02, 0.08, 0.1], [0.34, 0.32, -0.08], MOSS.deep),
  box([0.02, 0.06, 0.12], [0.34, 0.38, 0.1], MOSS.light),
  box([0.16, 0.12, 0.02], [-0.1, 0.42, 0.32], MOSS.deep, { vary: 0.08 }),
  box([0.12, 0.1, 0.02], [0.1, 0.3, 0.32], MOSS.light, { vary: 0.08 }),
  box([0.1, 0.08, 0.02], [0.08, 0.48, 0.32], MOSS.bright),
  box([0.12, 0.06, 0.02], [-0.16, 0.2, 0.32], MOSS.bright),
  // face: a small mouth with one tiny fang, and rosy cheeks
  box([0.1, 0.025, 0.02], [0, 0.37, -0.32], MOSS.mouth),
  box([0.03, 0.03, 0.02], [0.03, 0.35, -0.322], MOSS.fang),
  box([0.07, 0.04, 0.02], [-0.23, 0.37, -0.32], MOSS.blush),
  box([0.07, 0.04, 0.02], [0.23, 0.37, -0.32], MOSS.blush),
]

// Dark beady eyes with a glint, in their own part so they can blink.
const MOSSLING_EYES = [
  box([0.1, 0.12, 0.04], [-0.14, 0, 0], MOSS.eye),
  box([0.1, 0.12, 0.04], [0.14, 0, 0], MOSS.eye),
  box([0.035, 0.035, 0.02], [-0.115, 0.03, -0.025], MOSS.shine),
  box([0.035, 0.035, 0.02], [0.165, 0.03, -0.025], MOSS.shine),
]

const MOSSLING_SPROUT = [
  box([0.05, 0.13, 0.05], [0, 0.045, 0], MOSS.stem),
  box([0.17, 0.03, 0.09], [-0.085, 0.11, 0], MOSS.leaf, { rot: [0, 0, -0.5] }),
  box([0.15, 0.03, 0.08], [0.075, 0.13, 0], MOSS.leafDark, { rot: [0, 0, 0.55] }),
  box([0.05, 0.05, 0.05], [0, 0.13, 0], MOSS.bud),
]

// Crouch and lean back before the pounce, stretch into a forward lunge on the
// strike (which overrides the wind-up), waddle when walking.
function poseMossling({ rig, body, eyes, footL, footR, sprout }, pose) {
  const squash = lerp(0.16 * pose.windup, -0.1, pose.strike)
  const spread = 1 - pose.breathe * 0.5 + squash * 0.5
  body.scale.set(spread, 1 + pose.breathe - squash, spread)
  body.rotation.set(lerp(0.3 * pose.windup, -0.45, pose.strike) + 0.2 * pose.hurt, 0, pose.sway)
  footL.rotation.x = pose.stride
  footR.rotation.x = -pose.stride
  eyes.scale.y = 1 - 0.85 * pose.blink
  sprout.rotation.set(lerp(0.35 * pose.windup, -0.5, pose.strike) + 0.9 * pose.death, 0, pose.flutter - pose.sway)
  rig.position.set(0, pose.bob, -0.3 * pose.strike)
}

const MOSSLING = {
  parts: [
    { name: 'footL', parent: 'rig', pivot: [-0.16, 0.14, 0], boxes: MOSSLING_FOOT },
    { name: 'footR', parent: 'rig', pivot: [0.16, 0.14, 0], boxes: MOSSLING_FOOT },
    { name: 'body', parent: 'rig', pivot: [0, 0.12, 0], boxes: MOSSLING_BODY },
    { name: 'eyes', parent: 'body', pivot: [0, 0.44, -0.32], boxes: MOSSLING_EYES },
    { name: 'sprout', parent: 'body', pivot: [0, 0.66, 0.02], boxes: MOSSLING_SPROUT },
  ],
  motion: Object.freeze({ breathRate: 2.6, breath: 0.035, bob: 0.05, stride: 0.5, sway: 0.14, blinkEvery: 3.4 }),
  death: Object.freeze({ axis: 'z', angle: 1.4 }), // rolls onto its side
  palette: Object.freeze({
    body: MOSS.base,
    chip: MOSS.bright, // bits knocked off by a hit
    spark: 0xf4ffd9,
    death: Object.freeze([MOSS.base, MOSS.dark, MOSS.light, MOSS.leaf, MOSS.belly]),
    dust: MOSS.spore,
    strike: MOSS.leaf,
  }),
  pose: poseMossling,
}


// Stoneguard: a tall stone golem with heavy fists, amber eyes, a glowing
// heart-stone, moss patches and cracks.

const GUARD_LEG = [
  box([0.24, 0.54, 0.28], [0, -0.31, 0], STONE.dark, { vary: 0.04 }),
  box([0.28, 0.12, 0.36], [0, -0.6, -0.03], STONE.deep), // foot
  box([0.18, 0.12, 0.03], [0, -0.3, -0.15], STONE.base), // knee plate
]

const GUARD_LEG_MOSSY = [
  ...GUARD_LEG,
  box([0.03, 0.16, 0.14], [-0.13, -0.42, 0.02], STONE.moss, { vary: 0.08 }),
  box([0.16, 0.03, 0.12], [-0.06, -0.525, 0.1], STONE.mossLight),
]

// Broad chest over a narrow waist, so the heavy fists hang clear of the hips
// and the whole rest pose fits the 0.9-wide body box (+0.05).
const GUARD_TORSO = [
  box([0.4, 0.16, 0.34], [0, 0.06, 0], STONE.deep), // pelvis
  box([0.42, 0.24, 0.38], [0, 0.24, 0], STONE.dark, { vary: 0.04 }), // waist
  box([0.58, 0.42, 0.48], [0, 0.54, 0], STONE.base, { vary: 0.04 }), // chest
  box([0.5, 0.1, 0.42], [0, 0.78, 0], STONE.light), // shoulder line
  // stepped spine stones down the back
  box([0.16, 0.1, 0.05], [0, 0.68, 0.245], STONE.light),
  box([0.18, 0.1, 0.05], [0.01, 0.56, 0.245], STONE.dark),
  box([0.14, 0.1, 0.05], [-0.01, 0.44, 0.245], STONE.base),
  box([0.13, 0.13, 0.02], [0.1, 0.55, -0.245], STONE.crack), // heart-stone socket
  // cracks radiating from the heart-stone, plus a few old ones
  box([0.025, 0.16, 0.02], [0.15, 0.44, -0.245], STONE.crack, { rot: [0, 0, 0.35] }),
  box([0.025, 0.12, 0.02], [0.04, 0.65, -0.245], STONE.crack, { rot: [0, 0, 0.5] }),
  box([0.1, 0.02, 0.02], [0.22, 0.58, -0.245], STONE.crack, { rot: [0, 0, -0.3] }),
  box([0.02, 0.14, 0.02], [-0.22, 0.45, -0.245], STONE.crack, { rot: [0, 0, -0.25] }),
  box([0.02, 0.16, 0.025], [0.295, 0.5, 0.06], STONE.crack),
  // moss draped over the left shoulder and growing on the back
  box([0.22, 0.05, 0.3], [-0.15, 0.85, 0.02], STONE.moss, { vary: 0.08 }),
  box([0.1, 0.12, 0.02], [-0.2, 0.76, -0.25], STONE.mossLight),
  box([0.16, 0.14, 0.02], [-0.2, 0.52, 0.25], STONE.mossDark, { vary: 0.08 }),
  box([0.1, 0.08, 0.02], [-0.12, 0.42, 0.25], STONE.moss),
]

const GUARD_TORSO_GLOW = [box([0.09, 0.09, 0.03], [0.1, 0.55, -0.25], STONE.core)]

const GUARD_HEAD = [
  box([0.26, 0.08, 0.24], [0, 0.03, 0], STONE.deep), // neck
  box([0.44, 0.36, 0.4], [0, 0.22, -0.02], STONE.base, { vary: 0.04 }), // skull
  box([0.5, 0.08, 0.12], [0, 0.29, -0.18], STONE.light), // heavy brow
  box([0.34, 0.09, 0.05], [0, 0.08, -0.225], STONE.dark), // jaw
  box([0.08, 0.06, 0.04], [0, 0.17, -0.235], STONE.dark), // nose ridge
  box([0.3, 0.05, 0.28], [0.03, 0.425, 0.01], STONE.moss, { vary: 0.08 }), // moss cap
  box([0.1, 0.06, 0.1], [0.12, 0.47, -0.05], STONE.mossLight),
  box([0.08, 0.04, 0.08], [-0.08, 0.46, 0.08], STONE.mossDark),
  box([0.02, 0.12, 0.025], [-0.225, 0.2, -0.06], STONE.crack, { rot: [0.3, 0, 0] }),
]

const GUARD_HEAD_GLOW = [
  box([0.11, 0.055, 0.03], [-0.1, 0.19, -0.225], STONE.eye),
  box([0.11, 0.055, 0.03], [0.1, 0.19, -0.225], STONE.eye),
]

const GUARD_ARM = [
  box([0.22, 0.18, 0.32], [0, 0, 0], STONE.light), // shoulder pauldron
  box([0.16, 0.46, 0.24], [0, -0.22, 0], STONE.base, { vary: 0.04 }), // upper arm
  box([0.22, 0.38, 0.32], [0, -0.6, -0.01], STONE.dark, { vary: 0.04 }), // fist
  box([0.24, 0.07, 0.34], [0, -0.68, -0.01], STONE.deep), // knuckle band
]

const GUARD_ARM_CRACKED = [
  ...GUARD_ARM,
  box([0.025, 0.14, 0.02], [0.05, -0.55, -0.18], STONE.crack, { rot: [0, 0, 0.4] }),
]

const GUARD_ARM_MOSSY = [
  ...GUARD_ARM,
  box([0.2, 0.04, 0.28], [0, 0.11, 0], STONE.moss, { vary: 0.08 }),
  box([0.03, 0.1, 0.1], [0.11, 0.02, 0.04], STONE.mossLight),
]

// Arms blend from the walking swing, to raised overhead (wind-up), to the
// smash; the strike pose overrides the wind-up as it lands.
function guardArmAngle(swing, pose) {
  const raised = lerp(swing, 2.75, pose.windup)
  return lerp(raised, 0.95, pose.strike) + 0.6 * pose.death
}

function poseStoneguard({ rig, torso, head, legL, legR, armL, armR }, pose) {
  const splay = 0.05 + pose.breathe * 2 + 0.12 * pose.windup
  const lean = lerp(0.12 * pose.windup, -0.3, pose.strike)
  legL.rotation.x = pose.stride
  legR.rotation.x = -pose.stride
  armL.rotation.set(guardArmAngle(-0.8 * pose.stride, pose), 0, -splay)
  armR.rotation.set(guardArmAngle(0.8 * pose.stride, pose), 0, splay)
  torso.rotation.set(lean + 0.15 * pose.hurt - pose.breathe, 0, pose.sway)
  head.rotation.set(lean, 0, -0.5 * pose.sway)
  rig.position.set(0, pose.bob, -0.1 * pose.strike)
}

const STONEGUARD = {
  parts: [
    { name: 'legL', parent: 'rig', pivot: [-0.15, 0.66, 0], boxes: GUARD_LEG_MOSSY },
    { name: 'legR', parent: 'rig', pivot: [0.15, 0.66, 0], boxes: GUARD_LEG },
    { name: 'torso', parent: 'rig', pivot: [0, 0.64, 0], boxes: GUARD_TORSO, glow: GUARD_TORSO_GLOW },
    { name: 'head', parent: 'torso', pivot: [0, 0.76, 0], boxes: GUARD_HEAD, glow: GUARD_HEAD_GLOW },
    { name: 'armL', parent: 'torso', pivot: [-0.3, 0.7, 0], boxes: GUARD_ARM_CRACKED },
    { name: 'armR', parent: 'torso', pivot: [0.3, 0.7, 0], boxes: GUARD_ARM_MOSSY },
  ],
  motion: Object.freeze({ breathRate: 1.5, breath: 0.02, bob: 0.035, stride: 0.45, sway: 0.04, blinkEvery: 0 }),
  death: Object.freeze({ axis: 'x', angle: 1.35 }), // topples backward like a statue
  palette: Object.freeze({
    body: STONE.base,
    chip: STONE.light,
    spark: 0xfff1d6,
    death: Object.freeze([STONE.base, STONE.dark, STONE.light, STONE.moss, STONE.core]),
    dust: STONE.dust,
    strike: STONE.dust,
  }),
  pose: poseStoneguard,
}

const BLUEPRINTS = Object.freeze({ mossling: MOSSLING, stoneguard: STONEGUARD })

export const MOB_MODEL_TYPES = Object.freeze(Object.keys(BLUEPRINTS))

// Neutral pose; every field is a weight or an angle/offset already scaled by
// the type's motion settings (see computeMobPose in mobView.js).
export const REST_POSE = Object.freeze({
  breathe: 0,
  bob: 0,
  stride: 0,
  sway: 0,
  flutter: 0,
  blink: 0,
  pulse: 1,
  windup: 0,
  strike: 0,
  hurt: 0,
  death: 0,
})

export function hasMobModel(typeKey) {
  return Object.hasOwn(BLUEPRINTS, typeKey)
}

// Effect colours for a mob type (null for unknown types).
export function mobPalette(typeKey) {
  return hasMobModel(typeKey) ? BLUEPRINTS[typeKey].palette : null
}


// Geometry: every part's boxes are baked into one indexed BufferGeometry with
// vertex colours, cached by box list so all models of a type share it.

const geometryCache = new Map()

export function sharedGeometryCount() {
  return geometryCache.size
}

// Frees the shared geometries (call when no models remain, e.g. on shutdown).
export function disposeMobGeometries() {
  for (const geometry of geometryCache.values()) geometry.dispose()
  geometryCache.clear()
}

function sharedGeometry(boxes, shaded) {
  if (!geometryCache.has(boxes)) geometryCache.set(boxes, buildBoxGeometry(boxes, { shaded }))
  return geometryCache.get(boxes)
}

function buildBoxGeometry(boxes, { shaded = true } = {}) {
  const out = { positions: [], normals: [], colors: [], indices: [] }
  for (const spec of boxes) appendBox(out, spec, shaded)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(out.positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(out.normals, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(out.colors, 3))
  geometry.setIndex(out.indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function appendBox(out, { size, at, color, rot, vary }, shaded) {
  const [width, height, depth] = size
  const cube = new BoxGeometry(width, height, depth)
  const local = cube.getAttribute('position')
  const tint = new Color(color).multiplyScalar(1 + vary * (2 * boxNoise(at) - 1))
  const offset = out.positions.length / 3
  for (let i = 0; i < local.count; i++) {
    const shade = shaded ? AO_FLOOR + (1 - AO_FLOOR) * (local.getY(i) / height + 0.5) : 1
    out.colors.push(tint.r * shade, tint.g * shade, tint.b * shade)
  }
  cube.applyMatrix4(boxMatrix(at, rot))
  out.positions.push(...cube.getAttribute('position').array)
  out.normals.push(...cube.getAttribute('normal').array)
  for (const index of cube.getIndex().array) out.indices.push(offset + index)
  cube.dispose()
}

function boxMatrix(at, rot) {
  const rotation = new Quaternion()
  if (rot) rotation.setFromEuler(new Euler(rot[0], rot[1], rot[2]))
  return new Matrix4().compose(new Vector3(at[0], at[1], at[2]), rotation, new Vector3(1, 1, 1))
}

// Deterministic per-box brightness noise in [0, 1), keyed by the box centre.
function boxNoise([x, y, z]) {
  return hash3(Math.round(x * 1000), Math.round(y * 1000), Math.round(z * 1000), 0x5eed)
}


// Models

// Builds a model of the given type. `variant` (0..1) gives each individual a
// slightly different moss/stone shade.
export function createMobModel(typeKey, { variant = 0 } = {}) {
  if (!hasMobModel(typeKey)) throw new Error(`Unknown mob model type: ${String(typeKey)}`)
  const blueprint = BLUEPRINTS[typeKey]
  const materials = createMaterials(blueprint)
  const tint = variantTint(variant)
  const root = new Group()
  root.name = `mob:${typeKey}`
  const parts = buildRig(blueprint, materials, root)
  let hurt = 0
  let glow = 1
  let disposed = false

  function refreshMaterials() {
    materials.solid.color.copy(tint).lerp(HURT_TINT, hurt)
    materials.solid.emissive.copy(HURT_EMISSIVE).multiplyScalar(hurt)
    if (materials.glow) materials.glow.color.setScalar(glow).lerp(HURT_GLOW, hurt)
  }

  function setHurt(amount) {
    const next = clamp01(amount)
    if (next === hurt) return
    hurt = next
    refreshMaterials()
  }

  // Glowing eyes and heart-stone breathe softly, flare on the wind-up and go
  // dark on death.
  function setGlow(pose) {
    const next = clamp((0.78 + 0.22 * pose.pulse + 0.35 * pose.windup) * (1 - pose.death), 0, 1.4)
    if (next === glow) return
    glow = next
    refreshMaterials()
  }

  function applyPose(pose = REST_POSE) {
    const full = { ...REST_POSE, ...pose }
    blueprint.pose(parts, full)
    applyDeath(parts.rig, full.death, blueprint.death)
    if (materials.glow) setGlow(full)
  }

  function dispose() {
    if (disposed) return
    disposed = true
    root.removeFromParent()
    materials.solid.dispose()
    materials.glow?.dispose()
  }

  refreshMaterials()
  applyPose(REST_POSE)

  return {
    type: typeKey,
    root,
    parts,
    motion: blueprint.motion,
    palette: blueprint.palette,
    materials: [materials.solid, materials.glow].filter(Boolean),
    get hurt() {
      return hurt
    },
    get disposed() {
      return disposed
    },
    setHurt,
    applyPose,
    dispose,
  }
}

function createMaterials(blueprint) {
  const hasGlow = blueprint.parts.some((part) => part.glow)
  return {
    solid: new MeshLambertMaterial({ vertexColors: true }),
    glow: hasGlow ? new MeshBasicMaterial({ vertexColors: true }) : null,
  }
}

function variantTint(variant) {
  const v = Number.isFinite(variant) ? variant - Math.floor(variant) : 0
  return new Color(0.95 + 0.07 * v, 1, 1 - 0.07 * v)
}

function buildRig(blueprint, materials, root) {
  const rig = new Group()
  rig.name = 'rig'
  root.add(rig)
  const parts = { rig }
  for (const spec of blueprint.parts) {
    const part = new Group()
    part.name = spec.name
    part.position.fromArray(spec.pivot)
    part.add(createMesh(sharedGeometry(spec.boxes, true), materials.solid, true))
    if (spec.glow) part.add(createMesh(sharedGeometry(spec.glow, false), materials.glow, false))
    parts[spec.parent].add(part)
    parts[spec.name] = part
  }
  return parts
}

function createMesh(geometry, material, shadows) {
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = shadows
  mesh.receiveShadow = shadows
  return mesh
}

// Death: fall over (accelerating), then shrink into the ground.
function applyDeath(rig, death, { axis, angle }) {
  const fall = clamp(death / 0.55, 0, 1)
  const fade = smoothstep(0.4, 1, death)
  rig.rotation.set(0, 0, 0)
  rig.rotation[axis] = angle * fall * fall
  rig.scale.setScalar(Math.max(0.001, 1 - 0.92 * fade))
  rig.position.y -= 0.12 * fade
}
