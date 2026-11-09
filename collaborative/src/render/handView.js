// First-person arm and tool, drawn in a separate overlay scene.
// Animation state produces a numeric pose which the Three.js rig copies.
// Decaying offsets smooth transitions between motions.

import { DirectionalLight, Group, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene } from 'three'
import { TAU, approach, clamp01, smoothstep } from '../core/math.js'
import { MINING_IMPACT, MINING_SWINGS } from './miningRhythm.js'
import { TOOL_KEYS, TOOL_PIXEL, createToolModel, createVoxelGeometry, disposeModel, voxelBox } from './toolModels.js'

export const HAND_FOV = 70
const BUILD_PRESSES = 3

// Rest pose of the rig: root position (camera space, world units), root rotation
// (order YXZ: yaw left, pitch up, roll) and wrist rotation of the tool grip.
export const HAND_REST = Object.freeze({ x: 0.6, y: -0.45, z: -0.2, rx: 0.42, ry: 0.55, rz: -0.1, wx: 0, wz: 0 })
const POSE_KEYS = Object.keys(HAND_REST)

// Additive motion vectors, scaled by each motion's current value.
const MOTIONS = Object.freeze({
  mine: { x: -0.015, y: -0.025, z: -0.05, rx: -0.42, ry: 0.12, rz: 0.1, wx: -0.75 },
  mineLean: { x: -0.03, z: -0.025, rx: 0.05 },
  build: { y: 0.015, z: -0.06, rx: 0.1, wx: 0.25 },
  buildLean: { x: -0.03, y: 0.025, rx: 0.06, ry: 0.08 },
  swing: { x: -0.04, y: -0.03, z: -0.06, rx: -0.4, ry: 0.22, rz: 0.3, wx: -0.6 },
  place: { y: 0.02, z: -0.08, rx: 0.12, wx: 0.3 },
  switch: { y: -0.5, z: 0.04, rx: -0.7 },
})

const ONE_SHOTS = Object.freeze({
  swing: { duration: 0.3, curve: swingCurve },
  place: { duration: 0.3, curve: placeCurve },
  switch: { duration: 0.42, curve: switchCurve },
})
export const HAND_TRIGGERS = Object.freeze(Object.keys(ONE_SHOTS))

const RATES = Object.freeze({ move: 8, air: 10, landingRise: 30, landingDecay: 7, blend: 14, offset: 20 })
const WALK_RATE = TAU * 1.8 // bob cycles per second at full walking speed

// Curves (0 at rest, 1 at the peak of the motion)

function easeOutCubic(t) {
  return 1 - (1 - clamp01(t)) ** 3
}

function fract(value) {
  return value - Math.floor(value)
}

// One mining swing: accelerate into the impact and stop dead on the block,
// lift back past rest into a small wind-up, then settle exactly as the next
// swing begins.
export function mineCurve(phase) {
  const f = fract(phase)
  if (f < MINING_IMPACT) return (f / MINING_IMPACT) ** 2
  if (f < 0.65) return 1 - 1.25 * smoothstep(MINING_IMPACT, 0.65, f)
  return -0.25 * (1 - smoothstep(0.65, 1, f))
}

// A rhythmic press used while constructing.
function buildCurve(phase) {
  return Math.sin(Math.PI * fract(phase)) ** 2
}

function swingCurve(s) {
  return s < 0.35 ? easeOutCubic(s / 0.35) : 1 - smoothstep(0.35, 1, s)
}

function placeCurve(s) {
  return s < 0.3 ? smoothstep(0, 0.3, s) : 1 - smoothstep(0.3, 1, s)
}

// Lower, hold briefly at the bottom (the tool is swapped there), raise.
function switchCurve(s) {
  return s < 0.5 ? smoothstep(0, 0.4, s) : smoothstep(0, 0.4, 1 - s)
}

const miningValue = (progress) => mineCurve(progress * MINING_SWINGS)
const buildingValue = (progress) => buildCurve(progress * BUILD_PRESSES)

// Pure animation state

function createChannel() {
  return { active: false, progress: 0, weight: 0, offset: 0 }
}

export function createHandAnimState() {
  return {
    time: 0,
    walkPhase: 0,
    moving: 0,
    air: 0,
    landing: 0,
    landingTarget: 0,
    wasOnGround: true,
    mining: createChannel(),
    building: createChannel(),
    oneShots: { swing: null, place: null, switch: null },
  }
}

// Integral of an exponential approach over dt (keeps the walk phase exact).
function approachIntegral(current, target, rate, dt) {
  return target * dt + ((current - target) * (1 - Math.exp(-rate * dt))) / rate
}

function stepLocomotion(anim, dt, state) {
  const moving = clamp01(state.moving)
  anim.walkPhase = (anim.walkPhase + WALK_RATE * approachIntegral(anim.moving, moving, RATES.move, dt)) % TAU
  anim.moving = approach(anim.moving, moving, RATES.move, dt)

  const onGround = state.onGround !== false
  if (onGround && !anim.wasOnGround) anim.landingTarget = Math.max(anim.landingTarget, anim.air)
  anim.wasOnGround = onGround
  anim.air = approach(anim.air, onGround ? 0 : 1, RATES.air, dt)
  anim.landing = approach(anim.landing, anim.landingTarget, RATES.landingRise, dt)
  anim.landingTarget = approach(anim.landingTarget, 0, RATES.landingDecay, dt)
}

// A timed action drives a looping motion by its progress. When a new action
// starts (or progress jumps back) the old value is carried as a decaying
// offset so the hand flows straight into the next swing.
function stepChannel(channel, action, kind, value, dt) {
  const active = action?.kind === kind && Number.isFinite(action.progress)
  if (active) {
    const progress = clamp01(action.progress)
    if (!channel.active || progress < channel.progress) channel.offset += value(channel.progress) - value(progress)
    channel.progress = progress
  }
  channel.active = active
  channel.weight = approach(channel.weight, active ? 1 : 0, RATES.blend, dt)
  channel.offset = approach(channel.offset, 0, RATES.offset, dt)
}

function stepOneShots(oneShots, dt) {
  for (const kind of HAND_TRIGGERS) {
    const shot = oneShots[kind]
    if (!shot) continue
    shot.elapsed += dt
    shot.offset = approach(shot.offset, 0, RATES.offset, dt)
    if (shot.elapsed >= shot.duration) oneShots[kind] = null
  }
}

// state: { action: null | { kind: 'break' | 'place', progress }, moving: 0..1, onGround }
export function stepHandAnim(anim, dt, state = {}) {
  if (!Number.isFinite(dt) || dt < 0) return anim
  const input = state ?? {}
  anim.time += dt
  stepLocomotion(anim, dt, input)
  stepChannel(anim.mining, input.action, 'break', miningValue, dt)
  stepChannel(anim.building, input.action, 'place', buildingValue, dt)
  stepOneShots(anim.oneShots, dt)
  return anim
}

function shotPhase(shot) {
  return clamp01(shot.elapsed / shot.duration)
}

function shotValue(shot, kind) {
  return shot ? ONE_SHOTS[kind].curve(shotPhase(shot)) + shot.offset : 0
}

// Phase 0..1 of the running tool switch, or null when none is running.
export function switchPhase(anim) {
  const shot = anim.oneShots.switch
  return shot ? shotPhase(shot) : null
}

// Starts a one-shot motion; returns false for unknown kinds. Re-triggering a
// running swing restarts it smoothly; a running switch keeps lowering (or, if
// already rising, mirrors back down so the swap point is reached again).
export function triggerHandAnim(anim, kind) {
  if (!Object.hasOwn(ONE_SHOTS, kind)) return false
  const shot = anim.oneShots[kind]
  if (kind === 'switch' && shot) {
    if (shotPhase(shot) >= 0.5) shot.elapsed = shot.duration * (1 - shotPhase(shot))
    return true
  }
  const offset = shotValue(shot, kind)
  anim.oneShots[kind] = { elapsed: 0, duration: ONE_SHOTS[kind].duration, offset }
  return true
}

// Pose

function addMotion(pose, motion, amount) {
  if (amount === 0) return
  for (const key in motion) pose[key] += motion[key] * amount
}

// Slow breathing and drift; damped while walking so the bob reads clearly.
function addIdle(pose, time, strength) {
  const breath = Math.sin((time * TAU) / 3.4)
  const sway = Math.sin((time * TAU) / 5.3 + 1.1)
  pose.y += 0.007 * breath * strength
  pose.rx += 0.014 * breath * strength
  pose.x += 0.004 * sway * strength
  pose.rz += 0.012 * sway * strength
}

// Figure-eight bob: one side-to-side sway and two dips per cycle (two steps).
function addWalk(pose, phase, moving) {
  if (moving === 0) return
  const side = Math.sin(phase)
  pose.x += 0.026 * side * moving
  pose.y -= 0.032 * side * side * moving
  pose.rz += 0.035 * side * moving
  pose.rx += 0.02 * Math.sin(2 * phase) * moving
}

function addAirborne(pose, air, landing) {
  pose.y += 0.03 * air - 0.05 * landing
  pose.rx += 0.07 * air - 0.07 * landing
}

function channelValue(channel, value) {
  return channel.weight * (value(channel.progress) + channel.offset)
}

// Pure: the full rig pose for an animation state at a given time.
export function computeHandPose(anim, time = anim.time) {
  const pose = { ...HAND_REST }
  addIdle(pose, time, 1 - 0.6 * anim.moving)
  addWalk(pose, anim.walkPhase, anim.moving)
  addAirborne(pose, anim.air, anim.landing)
  addMotion(pose, MOTIONS.mine, channelValue(anim.mining, miningValue))
  addMotion(pose, MOTIONS.mineLean, anim.mining.weight)
  addMotion(pose, MOTIONS.build, channelValue(anim.building, buildingValue))
  addMotion(pose, MOTIONS.buildLean, anim.building.weight)
  for (const kind of HAND_TRIGGERS) addMotion(pose, MOTIONS[kind], shotValue(anim.oneShots[kind], kind))
  return pose
}

// Largest absolute difference between two poses (handy for tests and tuning).
export function poseDistance(a, b) {
  return Math.max(...POSE_KEYS.map((key) => Math.abs(a[key] - b[key])))
}

// Rig

const SKIN = 0xe2a982
const SKIN_SHADE = 0xcf9470
const SLEEVE = 0x3f7d55
const CUFF = 0xd9b45c

// Pixel-unit boxes for the forearm; the elbow pivot is the origin and the arm
// points down -Z. The fist spans z -25.5..-19.5 and the tool handle passes
// vertically through its centre. Boxes never share a face plane facing the
// same way, so nothing z-fights.
const FIST_CENTRE = [0, 0, -22.5]

function armBoxes() {
  // Curled fingers stacked along the handle on the side facing the camera.
  const fingers = [0, 1, 2, 3].map((i) => voxelBox(-3.6, -2.88 + i * 1.5, -25.1, 0.6, 1.26, 5, i % 2 ? SKIN : SKIN_SHADE))
  return [
    voxelBox(-3, -3, -14, 6, 6, 22, SLEEVE, { jitter: 0.08 }), // runs off-screen behind the elbow
    voxelBox(-3.5, -3.5, -16.5, 7, 7, 3, CUFF, { jitter: 0.07 }),
    voxelBox(-2.5, -2.5, -19.5, 5, 5, 3.5, SKIN), // wrist
    voxelBox(-3, -3, -25.5, 6, 6, 6, SKIN), // fist
    ...fingers,
    voxelBox(-3.9, 1.7, -24.2, 2.6, 1.8, 3.4, SKIN), // thumb wrapped over the grip
  ]
}

function createArmModel() {
  const mesh = new Mesh(createVoxelGeometry(armBoxes(), { pixel: TOOL_PIXEL, seed: 11 }), new MeshLambertMaterial({ vertexColors: true }))
  mesh.name = 'hand:arm'
  return mesh
}

// How each tool sits in the fist: tilted forward, head turned toward the view.
const TOOL_GRIPS = Object.freeze({
  pickaxe: { x: -0.5, y: -0.7, z: 0.05 },
  axe: { x: -0.5, y: -0.7, z: 0.05 },
  shovel: { x: -0.42, y: -0.6, z: 0.04 },
})

function createToolSet(parent) {
  const models = new Map()
  for (const key of TOOL_KEYS) {
    const model = createToolModel(key)
    const grip = TOOL_GRIPS[key]
    model.rotation.set(grip.x, grip.y, grip.z)
    model.visible = false
    parent.add(model)
    models.set(key, model)
  }
  return models
}

// Soft sky fill plus a warm key light from the upper left; no shadows.
function addLights(scene) {
  const hemisphere = new HemisphereLight(0xeef5ff, 0x6c5a48, 1.7)
  const key = new DirectionalLight(0xfff0d8, 2.3)
  key.position.set(-1.2, 2, 1.4)
  hemisphere.castShadow = false
  key.castShadow = false
  scene.add(hemisphere, key)
}

// Below a square aspect the vertical field of view widens so the horizontal
// one stays fixed: the hand shrinks with the window instead of sliding off it
// or drifting over the crosshair.
export function handFovFor(aspect) {
  if (!(aspect > 0) || aspect >= 1) return HAND_FOV
  const halfHeight = Math.tan((HAND_FOV * Math.PI) / 360) / aspect
  return (Math.atan(halfHeight) * 360) / Math.PI
}

export function createHandView({ tool = TOOL_KEYS[0] } = {}) {
  const scene = new Scene()
  const camera = new PerspectiveCamera(HAND_FOV, 16 / 9, 0.01, 10)
  addLights(scene)

  const root = new Group()
  root.name = 'hand'
  root.rotation.order = 'YXZ'
  root.add(createArmModel())
  const grip = new Group()
  grip.position.set(...FIST_CENTRE.map((v) => v * TOOL_PIXEL))
  root.add(grip)
  const tools = createToolSet(grip)
  scene.add(root)

  const anim = createHandAnimState()
  let shown = null
  let pending = null

  function show(key) {
    if (shown) tools.get(shown).visible = false
    tools.get(key).visible = true
    shown = key
  }

  // The swap happens at the bottom of the lower-swap-raise motion.
  function swapWhenHidden() {
    if (!pending) return
    const phase = switchPhase(anim)
    if (phase !== null && phase < 0.5) return
    show(pending)
    pending = null
  }

  function applyPose(pose) {
    root.position.set(pose.x, pose.y, pose.z)
    root.rotation.set(pose.rx, pose.ry, pose.rz)
    grip.rotation.set(pose.wx, 0, pose.wz)
  }

  function setTool(key) {
    if (!tools.has(key)) return false
    if (key === (pending ?? shown)) return false
    pending = key === shown ? null : key
    if (pending) triggerHandAnim(anim, 'switch')
    return true
  }

  function trigger(kind) {
    return triggerHandAnim(anim, kind)
  }

  function update(dt, state = {}) {
    if (!Number.isFinite(dt) || dt < 0) return
    stepHandAnim(anim, dt, state)
    swapWhenHidden()
    applyPose(computeHandPose(anim))
  }

  function resize(width, height) {
    if (!(width > 0) || !(height > 0)) return
    camera.aspect = width / height
    camera.fov = handFovFor(camera.aspect)
    camera.updateProjectionMatrix()
  }

  function dispose() {
    disposeModel(root)
    scene.clear()
  }

  show(tools.has(tool) ? tool : TOOL_KEYS[0])
  applyPose(computeHandPose(anim))

  return {
    scene,
    camera,
    root,
    anim,
    setTool,
    trigger,
    update,
    resize,
    dispose,
    get toolKey() {
      return shown
    },
    get pendingToolKey() {
      return pending
    },
  }
}
