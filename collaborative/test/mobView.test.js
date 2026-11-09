// Mob visuals: voxel models (structure, sizing, facing, hurt flash, disposal)
// and the mob view (one model per mob, transforms, animation from mob state,
// particle bursts, cleanup). Runs in Node with a plain THREE.Scene and a stub
// effects object; no WebGL is needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Box3, MeshBasicMaterial, Scene, Vector3 } from 'three'
import { createEventBus } from '../src/core/events.js'
import { lookDirection } from '../src/core/geometry.js'
import { MOB_RULES } from '../src/config.js'
import { MOB_TYPES } from '../src/mobs/mobTypes.js'
import { MOB_ANIM } from '../src/mobs/mob.js'
import { createMobManager } from '../src/mobs/mobManager.js'
import {
  MOB_MODEL_TYPES,
  REST_POSE,
  createMobModel,
  disposeMobGeometries,
  hasMobModel,
  mobPalette,
  sharedGeometryCount,
} from '../src/render/mobModels.js'
import { computeMobPose, createMobView, strikeEnvelope } from '../src/render/mobView.js'
import { createFlatWorld } from './helpers.js'

const FRAME = 1 / 60

// --- fixtures ---------------------------------------------------------------

let nextId = 9000

// A plain mob entity with exactly the contract fields the view reads.
function makeMob(type = 'mossling', overrides = {}) {
  const dims = MOB_TYPES[type] ?? { width: 0.8, height: 1, maxHealth: 10 }
  return {
    id: nextId++,
    type,
    position: { x: 5.5, y: 4, z: 7.5 },
    velocity: { x: 0, y: 0, z: 0 },
    width: dims.width,
    height: dims.height,
    yaw: 0,
    health: dims.maxHealth,
    maxHealth: dims.maxHealth,
    state: 'wander',
    windup: 0,
    anim: { walkCycle: 0, moving: 0, attackTimer: 0, hurtTimer: 0, deathTimer: 0 },
    ...overrides,
  }
}

function stubEffects() {
  const bursts = []
  return {
    bursts,
    burst(position, color, count, options) {
      bursts.push({ position, color, count, options })
    },
  }
}

function setup({ withEvents = true, withEffects = true } = {}) {
  const scene = new Scene()
  const events = withEvents ? createEventBus() : null
  const effects = withEffects ? stubEffects() : null
  const view = createMobView({ scene, events, effects })
  return { scene, events, effects, view }
}

function run(view, mobs, seconds, dt = FRAME) {
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) view.update(mobs, dt)
}

function boundsOf(object) {
  object.updateMatrixWorld(true)
  return new Box3().setFromObject(object)
}

function meshesOf(object) {
  const meshes = []
  object.traverse((child) => {
    if (child.isMesh) meshes.push(child)
  })
  return meshes
}

function trackDisposal(items) {
  const disposed = new Set()
  for (const item of items) item.addEventListener('dispose', () => disposed.add(item))
  return disposed
}

// Mean linear RGB of a model's vertex colours (solid meshes only).
function meanColor(model) {
  const sum = [0, 0, 0]
  let count = 0
  for (const mesh of meshesOf(model.root)) {
    if (mesh.material instanceof MeshBasicMaterial) continue
    const colors = mesh.geometry.getAttribute('color')
    for (let i = 0; i < colors.count; i++) {
      sum[0] += colors.getX(i)
      sum[1] += colors.getY(i)
      sum[2] += colors.getZ(i)
      count++
    }
  }
  return sum.map((value) => value / count)
}

function isPlainPoint(point) {
  return (
    Object.getPrototypeOf(point) === Object.prototype &&
    [point.x, point.y, point.z].every(Number.isFinite)
  )
}

function isHexColor(color) {
  return Number.isInteger(color) && color >= 0 && color <= 0xffffff
}

// --- models -----------------------------------------------------------------

test('both mob types build voxel models sized to their bodies, origin at the feet', () => {
  assert.deepEqual([...MOB_MODEL_TYPES].sort(), ['mossling', 'stoneguard'])
  for (const type of MOB_MODEL_TYPES) {
    const model = createMobModel(type)
    const box = boundsOf(model.root)
    const { height, width } = MOB_TYPES[type]
    assert.ok(Math.abs(box.min.y) < 1e-6, `${type} stands on its origin`)
    assert.ok(box.max.y > height * 0.9 && box.max.y < height + 0.1, `${type} is about as tall as its body`)
    assert.ok(Math.abs((box.min.x + box.max.x) / 2) < 0.05, `${type} is centred in x`)
    assert.ok(Math.abs((box.min.z + box.max.z) / 2) < 0.05, `${type} is centred in z`)
    model.dispose()
  }
})

// Collision and melee both use the mob's square body box, so the resting
// model must not visibly poke out of it (into walls, or past where a click
// can land). Vertex-precise bounds, 0.05 tolerance.
test('at rest every mob model stays within its collision and hit box', () => {
  for (const type of MOB_MODEL_TYPES) {
    const model = createMobModel(type)
    model.root.updateMatrixWorld(true)
    const box = new Box3().setFromObject(model.root, true)
    const limit = MOB_TYPES[type].width / 2 + 0.05
    for (const axis of ['x', 'z']) {
      const reach = Math.max(-box.min[axis], box.max[axis])
      assert.ok(reach <= limit, `${type} reaches ${reach.toFixed(3)} on ${axis} (limit ${limit})`)
    }
    model.dispose()
  }
})

test('Mossling and Stoneguard are clearly distinct designs', () => {
  const mossling = createMobModel('mossling')
  const stoneguard = createMobModel('stoneguard')
  for (const part of ['rig', 'body', 'eyes', 'sprout', 'footL', 'footR']) assert.ok(mossling.parts[part], part)
  for (const part of ['rig', 'torso', 'head', 'armL', 'armR', 'legL', 'legR']) assert.ok(stoneguard.parts[part], part)

  const moss = meanColor(mossling)
  assert.ok(moss[1] > moss[0] * 1.5 && moss[1] > moss[2] * 1.5, 'Mossling reads as green')
  const stone = meanColor(stoneguard)
  assert.ok(Math.max(...stone) - Math.min(...stone) < 0.08, 'Stoneguard reads as grey stone')

  assert.ok(stoneguard.materials.some((material) => material instanceof MeshBasicMaterial), 'glowing eyes')
  assert.ok(!mossling.materials.some((material) => material instanceof MeshBasicMaterial), 'beady dark eyes')
  const size = (model) => boundsOf(model.root).getSize(new Vector3())
  assert.ok(size(stoneguard).y > size(mossling).y * 1.8, 'Stoneguard is much taller')
  mossling.dispose()
  stoneguard.dispose()
})

test('models face -Z at yaw 0 and turn with root.rotation.y like the camera', () => {
  const model = createMobModel('mossling')
  const eyes = () => model.parts.eyes.getWorldPosition(new Vector3())
  model.root.updateMatrixWorld(true)
  assert.ok(eyes().z < -0.2, 'eyes on the -Z side')

  for (const yaw of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    model.root.rotation.y = yaw
    model.root.updateMatrixWorld(true)
    const facing = lookDirection(yaw, 0)
    const eye = eyes()
    const forward = eye.x * facing.x + eye.z * facing.z
    assert.ok(forward > 0.2, `eyes point along lookDirection(${yaw.toFixed(2)})`)
  }
  model.dispose()
})

test('solid meshes cast and receive shadows; glow meshes do not', () => {
  for (const type of MOB_MODEL_TYPES) {
    const model = createMobModel(type)
    for (const mesh of meshesOf(model.root)) {
      const glow = mesh.material instanceof MeshBasicMaterial
      assert.equal(mesh.castShadow, !glow)
      assert.equal(mesh.receiveShadow, !glow)
    }
    model.dispose()
  }
})

test('unknown types are rejected and lookups never match inherited keys', () => {
  assert.throws(() => createMobModel('creeper'), /Unknown mob model type/)
  assert.throws(() => createMobModel(undefined), /Unknown mob model type/)
  assert.equal(hasMobModel('toString'), false)
  assert.equal(mobPalette('nope'), null)
  const palette = mobPalette('stoneguard')
  for (const color of [palette.body, palette.chip, palette.spark, palette.dust, palette.strike, ...palette.death]) {
    assert.ok(isHexColor(color))
  }
  assert.equal(mobPalette('mossling').body, MOB_TYPES.mossling.color)
})

test('geometry is shared per type while every model owns its materials', () => {
  const a = createMobModel('stoneguard')
  const count = sharedGeometryCount()
  const b = createMobModel('stoneguard')
  assert.equal(sharedGeometryCount(), count, 'no new geometry for a second model')
  const meshesA = meshesOf(a.root)
  const meshesB = meshesOf(b.root)
  assert.equal(meshesA.length, meshesB.length)
  meshesA.forEach((mesh, i) => {
    assert.equal(mesh.geometry, meshesB[i].geometry)
    assert.notEqual(mesh.material, meshesB[i].material)
  })
  a.dispose()
  b.dispose()
})

test('setHurt flashes only its own model red and clamps its input', () => {
  const hit = createMobModel('mossling')
  const other = createMobModel('mossling')
  const [solid] = hit.materials
  hit.setHurt(1)
  assert.equal(hit.hurt, 1)
  assert.ok(solid.emissive.r > 0.4 && solid.emissive.r > solid.emissive.g * 5, 'red emissive flash')
  assert.ok(solid.color.g < 0.3, 'green suppressed so the flash reads red')
  assert.equal(other.materials[0].emissive.r, 0, 'other models are untouched')

  hit.setHurt(5)
  assert.equal(hit.hurt, 1)
  hit.setHurt(-1)
  assert.equal(hit.hurt, 0)
  assert.equal(solid.emissive.r, 0)
  hit.setHurt(0.5)
  hit.setHurt(Number.NaN)
  assert.equal(hit.hurt, 0)
  assert.ok(solid.color.g > 0.9, 'colour restored after the flash')
  hit.dispose()
  other.dispose()
})

test('stoneguard glow flashes too and dims on death', () => {
  const model = createMobModel('stoneguard')
  const glow = model.materials.find((material) => material instanceof MeshBasicMaterial)
  model.setHurt(1)
  assert.ok(glow.color.r > glow.color.g * 2, 'eyes flash red')
  model.setHurt(0)
  model.applyPose({ pulse: 1 })
  const bright = glow.color.r
  model.applyPose({ death: 1 })
  assert.ok(glow.color.r < bright * 0.1, 'eyes go dark when it dies')
  model.dispose()
})

test('dispose frees the model materials, detaches it, and keeps shared geometry', () => {
  const scene = new Scene()
  const model = createMobModel('stoneguard')
  scene.add(model.root)
  const materials = trackDisposal(model.materials)
  const geometries = trackDisposal(new Set(meshesOf(model.root).map((mesh) => mesh.geometry)))
  model.dispose()
  model.dispose()
  assert.equal(materials.size, model.materials.length)
  assert.equal(geometries.size, 0, 'shared geometry stays alive for other models')
  assert.equal(model.root.parent, null)
  assert.equal(model.disposed, true)
})

test('poses drive the rigs: wind-up, strike, walk and death', () => {
  const guard = createMobModel('stoneguard')
  guard.applyPose({ windup: 1 })
  assert.ok(guard.parts.armL.rotation.x > 2.5 && guard.parts.armR.rotation.x > 2.5, 'arms raised overhead')
  assert.ok(guard.parts.torso.rotation.x > 0.1, 'leans back to wind up')
  guard.applyPose({ windup: 1, strike: 1 })
  assert.ok(Math.abs(guard.parts.armL.rotation.x - 0.95) < 1e-9, 'strike overrides the wind-up')
  assert.ok(Math.abs(guard.parts.torso.rotation.x + 0.3) < 1e-9, 'leans into the smash')
  guard.applyPose({ stride: 0.4 })
  assert.equal(guard.parts.legL.rotation.x, 0.4)
  assert.equal(guard.parts.legR.rotation.x, -0.4)
  guard.applyPose({ death: 1 })
  assert.ok(guard.parts.rig.rotation.x > 1.2, 'topples backward')
  assert.ok(guard.parts.rig.scale.x < 0.1, 'shrinks away')
  guard.applyPose(REST_POSE)
  assert.equal(guard.parts.rig.rotation.x, 0)
  assert.equal(guard.parts.rig.scale.x, 1)

  const moss = createMobModel('mossling')
  moss.applyPose({ strike: 1 })
  assert.ok(moss.parts.rig.position.z < -0.25, 'lunges forward (-Z)')
  moss.applyPose({ windup: 1 })
  assert.ok(moss.parts.body.scale.y < 0.9, 'crouches before the pounce')
  moss.applyPose({ blink: 1 })
  assert.ok(moss.parts.eyes.scale.y < 0.2, 'blinks')
  moss.applyPose({ death: 1 })
  assert.ok(moss.parts.rig.rotation.z > 1.2, 'rolls onto its side')
  guard.dispose()
  moss.dispose()
})

// --- pose maths ---------------------------------------------------------------

test('computeMobPose: idle breathing, walk cycle from walkCycle and moving', () => {
  const motion = createMobModel('mossling').motion
  const idle = [0, 0.3, 0.6, 0.9].map((time) => computeMobPose({ time }, motion))
  assert.ok(idle.every((pose) => pose.stride === 0), 'no stride while standing')
  assert.ok(idle.some((pose) => Math.abs(pose.breathe) > motion.breath * 0.5), 'breathes while idle')
  assert.ok(idle.every((pose) => Math.abs(pose.breathe) <= motion.breath + 1e-12))

  const forward = computeMobPose({ moving: 1, walkCycle: Math.PI / 2 }, motion)
  const back = computeMobPose({ moving: 1, walkCycle: -Math.PI / 2 }, motion)
  assert.ok(Math.abs(forward.stride - motion.stride) < 1e-12)
  assert.ok(Math.abs(back.stride + motion.stride) < 1e-12)
  assert.equal(forward.breathe, 0, 'breathing gives way to walking')
  const half = computeMobPose({ moving: 0.5, walkCycle: Math.PI / 2 }, motion)
  assert.ok(Math.abs(half.stride - motion.stride / 2) < 1e-12, 'stride scales with moving')
})

test('computeMobPose: invalid inputs yield a finite, clamped pose', () => {
  const pose = computeMobPose({
    time: Number.NaN,
    walkCycle: Infinity,
    moving: 7,
    windup: 5,
    strike: -2,
    hurt: Number.NaN,
    death: -1,
  })
  for (const [key, value] of Object.entries(pose)) assert.ok(Number.isFinite(value), key)
  assert.equal(pose.windup, 1)
  assert.equal(pose.strike, 0)
  assert.equal(pose.hurt, 0)
  assert.equal(pose.death, 0)
  assert.deepEqual(Object.keys(computeMobPose()).sort(), Object.keys(REST_POSE).sort())
})

test('computeMobPose: a dying mob stops walking, breathing, blinking and attacking', () => {
  const motion = createMobModel('mossling').motion
  const pose = computeMobPose({ time: 0.4, moving: 1, walkCycle: 1, windup: 1, strike: 1, death: 1 }, motion)
  assert.equal(pose.stride, 0)
  assert.equal(pose.breathe, 0)
  assert.equal(pose.blink, 0)
  assert.equal(pose.windup, 0)
  assert.equal(pose.strike, 0)
  assert.equal(pose.death, 1)
})

test('strikeEnvelope snaps to impact early and recovers by the end', () => {
  assert.equal(strikeEnvelope(0), 0)
  assert.ok(strikeEnvelope(0.14) > 0.99, 'impact almost immediately')
  assert.ok(strikeEnvelope(0.6) < strikeEnvelope(0.3), 'eases back')
  assert.ok(strikeEnvelope(1) < 1e-9)
  assert.equal(strikeEnvelope(-1), 0)
  assert.ok(strikeEnvelope(2) < 1e-9)
  assert.equal(strikeEnvelope(Number.NaN), 0)
})

// --- view: model lifecycle ----------------------------------------------------

test('view keeps one model per mob and copies position and yaw', () => {
  const { scene, view } = setup()
  const a = makeMob('mossling', { yaw: 1.2 })
  const b = makeMob('stoneguard', { position: { x: 10.5, y: 6, z: 3.5 } })
  view.update([a, b, a], FRAME)
  assert.ok(scene.children.includes(view.group))
  assert.equal(view.modelCount, 2)
  assert.equal(view.group.children.length, 2)

  const model = view.modelFor(a)
  assert.equal(model.type, 'mossling')
  assert.deepEqual(model.root.position.toArray(), [5.5, 4, 7.5])
  assert.equal(model.root.rotation.y, 1.2)

  a.position.x = 6.25
  a.position.y = 5
  a.yaw = -2
  run(view, [a, b], 0.5)
  assert.equal(view.modelFor(a), model, 'the same model is reused')
  assert.equal(view.group.children.length, 2)
  assert.deepEqual(model.root.position.toArray(), [6.25, 5, 7.5])
  assert.equal(model.root.rotation.y, -2)
  assert.deepEqual(view.modelFor(b).root.position.toArray(), [10.5, 6, 3.5])
})

test('mobs that leave the list lose their model and its materials are freed', () => {
  const { view } = setup()
  const a = makeMob('mossling')
  const b = makeMob('stoneguard')
  view.update([a, b], FRAME)
  const model = view.modelFor(a)
  const disposed = trackDisposal(model.materials)
  view.update([b], FRAME)
  assert.equal(view.modelCount, 1)
  assert.equal(view.modelFor(a), null)
  assert.ok(!view.group.children.includes(model.root))
  assert.equal(disposed.size, model.materials.length)
  view.update([], FRAME)
  assert.equal(view.group.children.length, 0)
})

test('models are keyed by mob identity, so fresh mobs after a reset get fresh models', () => {
  const { view } = setup()
  const old = makeMob('mossling', { id: 1 })
  view.update([old], FRAME)
  const stale = view.modelFor(old)
  const fresh = makeMob('mossling', { id: 1 })
  view.update([fresh], FRAME)
  assert.equal(view.modelCount, 1)
  assert.notEqual(view.modelFor(fresh), stale)
  assert.equal(stale.disposed, true)
})

test('skips malformed mobs and unknown types instead of throwing', () => {
  const { view } = setup()
  const good = makeMob('mossling')
  const junk = [
    null,
    undefined,
    42,
    { type: 'zombie', position: { x: 1, y: 1, z: 1 } },
    makeMob('mossling', { position: { x: Number.NaN, y: 0, z: 0 } }),
    { type: 'mossling' },
  ]
  assert.doesNotThrow(() => view.update([...junk, good], FRAME))
  assert.equal(view.modelCount, 1)
  assert.doesNotThrow(() => view.update(null, FRAME))
  assert.doesNotThrow(() => view.update({ not: 'iterable' }, FRAME))
  assert.equal(view.modelCount, 0)
})

test('invalid dt still syncs transforms but never advances the animation clock', () => {
  const { view } = setup()
  const mob = makeMob('mossling')
  view.update([mob], 0.37)
  const body = view.modelFor(mob).parts.body
  const scale = body.scale.y
  for (const dt of [Number.NaN, -1, Infinity, undefined, 0]) {
    mob.position.z += 1
    assert.doesNotThrow(() => view.update([mob], dt))
    assert.equal(view.modelFor(mob).root.position.z, mob.position.z)
    assert.equal(body.scale.y, scale, `breathing frozen for dt=${dt}`)
  }
  view.update([mob], 0.2)
  assert.notEqual(body.scale.y, scale, 'a valid dt animates again')
})

test('walking mobs swing their legs from anim.walkCycle', () => {
  const { view } = setup()
  const mob = makeMob('stoneguard')
  view.update([mob], FRAME)
  const { legL, legR } = view.modelFor(mob).parts
  assert.equal(legL.rotation.x, 0)
  mob.anim.moving = 1
  mob.anim.walkCycle = Math.PI / 2
  view.update([mob], FRAME)
  assert.ok(legL.rotation.x > 0.3 && legR.rotation.x < -0.3)
  mob.anim.walkCycle = (3 * Math.PI) / 2
  view.update([mob], FRAME)
  assert.ok(legL.rotation.x < -0.3 && legR.rotation.x > 0.3, 'legs alternate')
})

// --- view: combat animation ---------------------------------------------------

test('hurt flash follows anim.hurtTimer and only tints the mob that was hit', () => {
  const { view } = setup()
  const hit = makeMob('mossling')
  const bystander = makeMob('mossling')
  view.update([hit, bystander], FRAME)
  hit.anim.hurtTimer = MOB_ANIM.hurtDuration
  view.update([hit, bystander], FRAME)
  const model = view.modelFor(hit)
  assert.equal(model.hurt, 1)
  assert.ok(model.materials[0].emissive.r > 0.4)
  assert.equal(view.modelFor(bystander).hurt, 0)
  assert.equal(view.modelFor(bystander).materials[0].emissive.r, 0)

  hit.anim.hurtTimer = MOB_ANIM.hurtDuration / 2
  view.update([hit, bystander], FRAME)
  assert.ok(Math.abs(model.hurt - 0.5) < 1e-9, 'fades with the timer')
  hit.anim.hurtTimer = 0
  view.update([hit, bystander], FRAME)
  assert.equal(model.hurt, 0)
  assert.equal(model.materials[0].emissive.r, 0)
})

// Drives an attack the way mobAI.js and mobManager.js do, one frame per tick:
// the brain counts mob.windup down; when it reaches 0 the strike lands and
// 'mob:attack' is emitted (inside the manager update) before the view draws.
function attackDriver(view, events, mob, { lands = true } = {}) {
  mob.state = 'attack'
  mob.windup = MOB_RULES.attackWindup
  mob.anim.attackTimer = MOB_RULES.attackWindup + MOB_ANIM.strikeRecovery
  let struck = false
  const driver = {
    get strikeNext() {
      return mob.windup > 0 && mob.windup <= FRAME + 1e-9
    },
    tick() {
      if (mob.windup > 0) mob.windup = Math.max(0, mob.windup - FRAME - 1e-12)
      mob.anim.attackTimer = Math.max(0, mob.anim.attackTimer - FRAME)
      if (mob.windup === 0 && lands && !struck) {
        struck = true
        events.emit('mob:attack', { mob, damage: MOB_TYPES[mob.type].damage })
      }
      view.update([mob], FRAME)
    },
    windUp() {
      while (!driver.strikeNext) driver.tick()
    },
  }
  return driver
}

test('a stoneguard winds up overhead, then smashes when the strike lands', () => {
  const { view, events, effects } = setup()
  const mob = makeMob('stoneguard')
  view.update([mob], FRAME)
  const { armL, torso } = view.modelFor(mob).parts
  const rest = armL.rotation.x

  const attack = attackDriver(view, events, mob)
  attack.tick()
  assert.ok(armL.rotation.x < rest + 0.5, 'the wind-up starts from rest')
  attack.windUp()
  assert.ok(armL.rotation.x > 2.4, 'arms raised overhead just before the strike')
  assert.ok(torso.rotation.x > 0.05, 'leaning back')
  assert.equal(effects.bursts.length, 0, 'nothing lands during the wind-up')

  attack.tick()
  const strikes = effects.bursts.filter((b) => b.color === mobPalette('stoneguard').strike)
  assert.equal(strikes.length, 1, 'dust kicked up by the strike')
  assert.ok(strikes[0].position.z < mob.position.z - 0.3, 'in front of the mob (yaw 0 faces -Z)')
  assert.ok(armL.rotation.x < 1.3, 'arms smash down on the strike frame')
  assert.ok(torso.rotation.x < -0.2, 'leans into the smash')
  for (let i = 0; i < 30; i++) attack.tick()
  assert.ok(Math.abs(armL.rotation.x - rest) < 0.1, 'back to rest after the follow-through')
})

test('a cancelled wind-up relaxes without a strike even while attackTimer runs', () => {
  const { view, events, effects } = setup()
  const mob = makeMob('stoneguard')
  view.update([mob], FRAME)
  const { armL } = view.modelFor(mob).parts
  const rest = armL.rotation.x
  const attack = attackDriver(view, events, mob, { lands: false })
  for (let i = 0; i < 12; i++) attack.tick()
  assert.ok(armL.rotation.x > 1, 'mid wind-up')

  mob.state = 'chase' // the target escaped: the brain zeroes mob.windup
  mob.windup = 0
  for (let i = 0; i < 12; i++) attack.tick()
  assert.ok(mob.anim.attackTimer > 0, 'the animation timer is still running')
  assert.ok(Math.abs(armL.rotation.x - rest) < 0.1, 'arms lowered again')
  assert.equal(effects.bursts.length, 0, 'no strike effect')
})

test('a mossling crouches, then lunges forward on its strike', () => {
  const { view, events } = setup()
  const mob = makeMob('mossling')
  view.update([mob], FRAME)
  const { rig, body } = view.modelFor(mob).parts
  const attack = attackDriver(view, events, mob)
  attack.windUp()
  assert.ok(body.scale.y < 0.92, 'crouched at the end of the wind-up')
  assert.ok(rig.position.z > -0.01, 'not lunging yet')
  attack.tick()
  attack.tick()
  assert.ok(rig.position.z < -0.25, 'lunges toward -Z')
  assert.ok(body.scale.y > 1.03, 'stretched into the pounce')
  for (let i = 0; i < 30; i++) attack.tick()
  assert.ok(Math.abs(rig.position.z) < 0.01, 'settles back')
})

test('the wind-up pose reads mob.windup only; anim.attackTimer alone never raises the arms', () => {
  const { view } = setup()
  const mob = makeMob('stoneguard', { state: 'attack' })
  view.update([mob], FRAME)
  const { armL } = view.modelFor(mob).parts
  const rest = armL.rotation.x
  mob.anim.attackTimer = MOB_ANIM.strikeRecovery + 0.05
  run(view, [mob], 0.3)
  assert.ok(Math.abs(armL.rotation.x - rest) < 1e-9, 'no wind-up without mob.windup')
  mob.windup = 0.05 // 0.05 s of wind-up left
  run(view, [mob], 0.3)
  assert.ok(armL.rotation.x > 2.2, 'nearly at the top of the wind-up')
  delete mob.windup
  run(view, [mob], 0.3)
  assert.ok(Math.abs(armL.rotation.x - rest) < 0.05, 'a missing windup counts as none')
})

// Regression: anim.attackTimer runs one physics sub-step ahead of
// mob.windup, which used to make the raised arms sag on the frame before the
// strike. With the real AI the wind-up must rise steadily, then smash.
test('with the real mob AI the wind-up rises steadily and the smash lands on the strike frame', () => {
  const world = createFlatWorld({ size: 24, height: 16, groundTop: 3 })
  const events = createEventBus()
  const manager = createMobManager({ world, events, seed: 7, plan: ['stoneguard'] })
  manager.spawnAll({ x: 2.5, y: 4, z: 2.5 })
  const view = createMobView({ scene: new Scene(), events, effects: stubEffects() })
  const [mob] = manager.mobs
  const target = { position: { x: mob.position.x, y: 4, z: mob.position.z - 1.3 }, height: 1.8, active: true }
  let struck = false
  events.on('mob:attack', () => (struck = true))

  const angles = []
  for (let i = 0; i < 60 && !struck; i++) {
    manager.update(FRAME, target)
    view.update(manager.mobs, FRAME)
    if (!struck) angles.push(view.modelFor(mob).parts.armL.rotation.x)
  }
  assert.ok(struck, 'the stoneguard attacked')
  assert.ok(angles.length >= 15, 'a visible wind-up preceded the strike')
  angles.slice(1).forEach((angle, i) => assert.ok(angle >= angles[i] - 1e-9, `wind-up never sags (frame ${i + 1})`))
  assert.ok(angles.at(-1) > 2.4, 'arms fully raised just before the strike')
  assert.ok(view.modelFor(mob).parts.armL.rotation.x < 1.1, 'smash on the strike frame')
  view.dispose()
})

// --- view: death --------------------------------------------------------------

test('death topples and shrinks the model, then hides it with one puff', () => {
  const { view, effects } = setup()
  const mob = makeMob('stoneguard')
  view.update([mob], FRAME)
  const model = view.modelFor(mob)
  mob.state = 'dying'
  mob.anim.deathTimer = MOB_ANIM.deathDuration
  view.update([mob], FRAME)
  assert.ok(model.parts.rig.rotation.x < 0.01, 'starts upright')

  mob.anim.deathTimer = MOB_ANIM.deathDuration * 0.4
  view.update([mob], FRAME)
  assert.ok(model.parts.rig.rotation.x > 0.5, 'toppling')
  assert.ok(model.parts.rig.scale.x < 1, 'shrinking')
  assert.equal(model.root.visible, true)

  mob.anim.deathTimer = 0
  view.update([mob], FRAME)
  view.update([mob], FRAME)
  assert.equal(model.root.visible, false)
  const puffs = () => effects.bursts.filter((b) => b.color === mobPalette('stoneguard').dust)
  assert.equal(puffs().length, 1)
  view.update([], FRAME)
  assert.equal(puffs().length, 1, 'removal after the animation adds no second puff')
  assert.equal(view.modelCount, 0)
})

test('death progress never runs backwards, and removal mid-death still puffs', () => {
  const { view, effects } = setup()
  const mob = makeMob('mossling', { state: 'dying' })
  mob.anim.deathTimer = 0.2
  view.update([mob], FRAME)
  const { rig } = view.modelFor(mob).parts
  const tilt = rig.rotation.z
  mob.anim.deathTimer = MOB_ANIM.deathDuration // a bogus timer jump must not revive it
  view.update([mob], FRAME)
  assert.equal(rig.rotation.z, tilt)
  view.update([], FRAME)
  const puffs = effects.bursts.filter((b) => b.color === mobPalette('mossling').dust)
  assert.equal(puffs.length, 1)
})

// --- view: particle effects ----------------------------------------------------

test('mob:hurt sprays sparks and chips at the body with plain positions and hex colours', () => {
  const { view, events, effects } = setup()
  const mob = makeMob('mossling')
  view.update([mob], FRAME)
  events.emit('mob:hurt', { mob, amount: 25, position: { x: 0, y: 0, z: 0 } })
  const palette = mobPalette('mossling')
  assert.deepEqual(effects.bursts.map((b) => b.color).sort(), [palette.chip, palette.spark].sort())
  for (const { position, color, count, options } of effects.bursts) {
    assert.ok(isPlainPoint(position))
    assert.ok(isHexColor(color))
    assert.ok(Number.isInteger(count) && count > 0)
    assert.ok(options.lifetime > 0 && options.lifetime <= 1)
    assert.ok(position.y > mob.position.y && position.y < mob.position.y + mob.height)
    assert.equal(position.x, mob.position.x)
  }
  assert.notEqual(effects.bursts[0].position, effects.bursts[1].position, 'each burst gets its own point')
})

test('mob:killed bursts voxels in every colour of the mob palette', () => {
  const { events, effects } = setup()
  const mob = makeMob('stoneguard')
  events.emit('mob:killed', { mob, position: { ...mob.position } })
  const { death } = mobPalette('stoneguard')
  assert.deepEqual(effects.bursts.map((b) => b.color), [...death])
  const total = effects.bursts.reduce((sum, b) => sum + b.count, 0)
  assert.ok(total >= 30 && total <= 80, 'a satisfying but lightweight burst')
})

test('malformed events and unknown mobs are ignored', () => {
  const { events, effects, view } = setup()
  for (const type of ['mob:hurt', 'mob:killed', 'mob:attack']) {
    assert.doesNotThrow(() => events.emit(type, null))
    assert.doesNotThrow(() => events.emit(type, undefined))
    assert.doesNotThrow(() => events.emit(type, {}))
    assert.doesNotThrow(() => events.emit(type, { mob: { type: 'zombie', position: { x: 0, y: 0, z: 0 } } }))
  }
  assert.equal(effects.bursts.length, 0)
  assert.equal(view.modelCount, 0)
})

test('works without an event bus or effects', () => {
  const { view } = setup({ withEvents: false, withEffects: false })
  const mob = makeMob('stoneguard', { state: 'dying' })
  assert.doesNotThrow(() => run(view, [mob], 0.2))
  assert.equal(view.modelCount, 1)
  assert.doesNotThrow(() => view.update([], FRAME))
  view.dispose()

  const scene = new Scene()
  const events = createEventBus()
  const partial = createMobView({ scene, events, effects: {} })
  assert.doesNotThrow(() => events.emit('mob:killed', { mob }))
  partial.dispose()
})

// --- view: cleanup -------------------------------------------------------------

test('clear() removes every model at once, without particles', () => {
  const { view, effects } = setup()
  const mobs = ['mossling', 'mossling', 'mossling', 'stoneguard'].map((type) => makeMob(type))
  view.update(mobs, FRAME)
  const materials = trackDisposal(mobs.flatMap((mob) => view.modelFor(mob).materials))
  mobs[0].state = 'dying'
  mobs[0].anim.deathTimer = MOB_ANIM.deathDuration / 2
  view.update(mobs, FRAME)
  view.clear()
  assert.equal(view.modelCount, 0)
  assert.equal(view.group.children.length, 0)
  assert.equal(materials.size, 5, '3 mossling + 2 stoneguard materials freed')
  assert.equal(effects.bursts.length, 0)
  view.update(mobs, FRAME)
  assert.equal(view.modelCount, 4, 'models come back on the next update')
})

test('world reset and respawn drop every model at once, with no stray puffs', () => {
  const { view, events, effects } = setup()
  const dying = makeMob('mossling', { state: 'dying' })
  dying.anim.deathTimer = MOB_ANIM.deathDuration / 2
  view.update([dying, makeMob('stoneguard')], FRAME)
  const materials = trackDisposal(view.modelFor(dying).materials)
  for (const type of ['player:respawned', 'world:reset']) {
    events.emit(type, {})
    assert.equal(view.modelCount, 0, `${type} clears the models`)
    assert.equal(view.group.children.length, 0)
    view.update([makeMob('mossling'), makeMob('stoneguard')], FRAME)
    assert.equal(view.modelCount, 2, 'the fresh mobs get models on the next frame')
  }
  assert.equal(materials.size, 1)
  assert.equal(effects.bursts.length, 0, 'the mid-death mob does not puff at its old spot')
})

test('no leaks across many spawn and despawn cycles', () => {
  const { view } = setup()
  view.update([makeMob('mossling'), makeMob('stoneguard')], FRAME)
  const geometries = sharedGeometryCount()
  let created = 0
  let freed = 0
  for (let cycle = 0; cycle < 40; cycle++) {
    const mobs = ['mossling', 'mossling', 'mossling', 'stoneguard'].map((type) => makeMob(type))
    view.update(mobs, FRAME)
    for (const mob of mobs) {
      const { materials } = view.modelFor(mob)
      created += materials.length
      for (const material of materials) material.addEventListener('dispose', () => freed++)
    }
    assert.ok(view.group.children.length <= 4)
  }
  view.update([], FRAME)
  assert.equal(view.group.children.length, 0)
  assert.equal(freed, created)
  assert.equal(sharedGeometryCount(), geometries, 'geometry is reused, never rebuilt')
})

test('dispose() unsubscribes, detaches the group and frees shared geometry', () => {
  const { scene, events, effects, view } = setup()
  const mob = makeMob('stoneguard')
  view.update([mob], FRAME)
  const geometries = trackDisposal(new Set(meshesOf(view.modelFor(mob).root).map((mesh) => mesh.geometry)))
  view.dispose()
  view.dispose()
  assert.ok(!scene.children.includes(view.group))
  assert.equal(view.modelCount, 0)
  assert.ok(geometries.size > 0)
  assert.equal(sharedGeometryCount(), 0)
  events.emit('mob:hurt', { mob })
  events.emit('mob:killed', { mob })
  assert.equal(effects.bursts.length, 0, 'no longer listening')
  view.update([mob], FRAME)
  assert.equal(view.modelCount, 0, 'a disposed view stays empty')

  const model = createMobModel('stoneguard')
  assert.ok(sharedGeometryCount() > 0, 'geometry is rebuilt on demand afterwards')
  model.dispose()
  disposeMobGeometries()
})

// --- with the real mob manager --------------------------------------------------

test('follows the real mob manager through spawn, hurt, death and removal', () => {
  const world = createFlatWorld({ size: 24, height: 16, groundTop: 3 })
  const events = createEventBus()
  const manager = createMobManager({ world, events, seed: 7, plan: ['mossling', 'stoneguard'] })
  manager.spawnAll({ x: 2.5, y: 4, z: 2.5 })
  const scene = new Scene()
  const effects = stubEffects()
  const view = createMobView({ scene, events, effects })
  const far = { position: { x: 2.5, y: 4, z: 2.5 }, height: 1.8, active: false }
  const frame = () => {
    manager.update(FRAME, far)
    view.update(manager.mobs, FRAME)
  }

  frame()
  assert.equal(view.modelCount, 2)
  for (const mob of manager.mobs) {
    const { root } = view.modelFor(mob)
    assert.deepEqual(root.position.toArray(), [mob.position.x, mob.position.y, mob.position.z])
    assert.equal(root.rotation.y, mob.yaw)
  }

  const victim = manager.mobs.find((mob) => mob.type === 'mossling')
  const model = view.modelFor(victim)
  manager.damage(victim, 100)
  frame()
  assert.ok(model.hurt > 0.8, 'hurt flash on the killing blow')
  assert.ok(effects.bursts.length >= 2 + mobPalette('mossling').death.length)
  for (let i = 0; i < 60; i++) frame()
  assert.equal(view.modelCount, 1, 'the dead mob is gone after its death animation')
  assert.equal(model.disposed, true)
  assert.ok(effects.bursts.some((b) => b.color === mobPalette('mossling').dust), 'final puff')
  view.dispose()
})
