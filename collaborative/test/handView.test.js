import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Box3, Vector3 } from 'three'
import {
  HAND_FOV,
  HAND_REST,
  HAND_TRIGGERS,
  computeHandPose,
  createHandAnimState,
  createHandView,
  handFovFor,
  mineCurve,
  poseDistance,
  stepHandAnim,
  switchPhase,
  triggerHandAnim,
} from '../src/render/handView.js'
import { MINING_IMPACT } from '../src/render/miningRhythm.js'
import { TOOL_KEYS, TOOL_PIXEL, createToolModel, createVoxelGeometry, extrudeSprite, voxelBox } from '../src/render/toolModels.js'
import { TOOLS } from '../src/interaction/tools.js'

// Drive an animation state through `seconds` of a scripted timeline.
// script(t) -> { state, triggers: [kind] } evaluated at the start of each frame.
function simulate(seconds, dt, script = () => ({})) {
  const anim = createHandAnimState()
  const frames = Math.round(seconds / dt)
  const poses = []
  for (let i = 0; i < frames; i++) {
    const { state = {}, triggers = [] } = script(i * dt, i)
    for (const kind of triggers) triggerHandAnim(anim, kind)
    stepHandAnim(anim, dt, state)
    poses.push(computeHandPose(anim))
  }
  return { anim, poses }
}

const breaking = (progress) => ({ kind: 'break', progress })

// --- pure curves and helpers -------------------------------------------------

test('the mining swing starts and ends at rest and peaks at the impact', () => {
  assert.equal(mineCurve(0), 0)
  assert.ok(Math.abs(mineCurve(MINING_IMPACT) - 1) < 1e-12)
  assert.ok(Math.abs(mineCurve(0.999999)) < 1e-6)
  assert.ok(mineCurve(0.7) < 0, 'recoils past rest into a small wind-up')
  assert.ok(Math.abs(mineCurve(1.3) - 1) < 1e-12, 'periodic')
  for (let f = 0; f < 1; f += 0.01) assert.ok(mineCurve(f) <= 1 && mineCurve(f) >= -0.25 - 1e-9)
})

test('handFovFor keeps 70 degrees on landscape screens and keeps the horizontal fov on narrow ones', () => {
  assert.equal(handFovFor(16 / 9), HAND_FOV)
  assert.equal(handFovFor(1), HAND_FOV)
  assert.equal(handFovFor(0), HAND_FOV)
  assert.equal(handFovFor(Number.NaN), HAND_FOV)
  const narrow = handFovFor(0.6)
  assert.ok(narrow > HAND_FOV)
  const horizontal = (fov, aspect) => Math.tan((fov * Math.PI) / 360) * aspect
  assert.ok(Math.abs(horizontal(narrow, 0.6) - horizontal(HAND_FOV, 1)) < 1e-12)
})

// --- pose behaviour ------------------------------------------------------------

test('a fresh state sits at the rest pose (only a tiny idle offset)', () => {
  const pose = computeHandPose(createHandAnimState(), 0)
  assert.ok(poseDistance(pose, HAND_REST) < 0.015)
  assert.equal(computeHandPose(createHandAnimState()).x, pose.x, 'time defaults to the state clock')
})

test('idle breathing sways the hand subtly and keeps it near rest', () => {
  const { poses } = simulate(10, 1 / 60)
  const spread = Math.max(...poses.map((pose) => poseDistance(pose, HAND_REST)))
  assert.ok(spread > 0.003, 'the hand is alive while idle')
  assert.ok(spread < 0.03, 'but the sway stays subtle')
})

test('walk bob amplitude scales with movement and fades when the player stops', () => {
  const lateral = (moving) => {
    const { poses } = simulate(3, 1 / 120, () => ({ state: { moving } }))
    const xs = poses.slice(-120).map((pose) => pose.x)
    return Math.max(...xs) - Math.min(...xs)
  }
  const still = lateral(0)
  const slow = lateral(0.3)
  const full = lateral(1)
  assert.ok(full > slow && slow > still, `${still} < ${slow} < ${full}`)
  assert.ok(full > 0.04)

  const { poses } = simulate(4, 1 / 120, (t) => ({ state: { moving: t < 2 ? 1 : 0 } }))
  const settled = poses.slice(-120)
  const xs = settled.map((pose) => pose.x)
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.012, 'bob decays back to idle sway')
})

test('mining produces exactly four strikes over a one second break', () => {
  const dt = 1 / 240
  const { poses } = simulate(1, dt, (t) => ({ state: { action: breaking(t + dt) } }))
  const dips = poses.map((pose) => pose.rx - HAND_REST.rx)
  let strikes = 0
  for (let i = 1; i < dips.length - 1; i++) {
    if (dips[i] < dips[i - 1] && dips[i] <= dips[i + 1] && dips[i] < -0.2) strikes++
  }
  assert.equal(strikes, 4)
})

test('construction plays a pressing motion while placing', () => {
  const dt = 1 / 120
  const { poses } = simulate(1, dt, (t) => ({ state: { action: { kind: 'place', progress: t + dt } } }))
  const z = poses.map((pose) => pose.z)
  assert.ok(Math.min(...z) < HAND_REST.z - 0.04, 'the hand pushes forward')
  assert.ok(poses.every((pose) => Math.abs(pose.rx - HAND_REST.rx) < 0.5))
})

test('the hand smoothly returns to rest after an action ends', () => {
  const idle = simulate(2.5, 1 / 60).poses.at(-1)
  const { poses } = simulate(2.5, 1 / 60, (t) => ({ state: { action: t < 0.6 ? breaking(t) : null } }))
  assert.ok(poseDistance(poses.at(-1), idle) < 1e-3)
})

test('animation is frame-rate independent (30 vs 60 vs 144 fps)', () => {
  const script = (t) => ({
    state: { moving: t < 1 ? 1 : 0.4, action: t >= 0.5 && t < 1.25 ? breaking((t - 0.5) / 0.75) : null },
    triggers: [],
  })
  const run = (fps) => {
    const anim = createHandAnimState()
    const frames = Math.round(1.5 * fps)
    for (let i = 0; i < frames; i++) {
      const t = i / fps
      // One-shots fire on frame boundaries shared by all three rates.
      if (i === Math.round(fps / 6)) triggerHandAnim(anim, 'swing')
      if (i === Math.round(fps / 3)) triggerHandAnim(anim, 'switch')
      stepHandAnim(anim, 1 / fps, script(t).state)
    }
    return computeHandPose(anim)
  }
  const a = run(30)
  const b = run(60)
  const c = run(144)
  assert.ok(poseDistance(a, b) < 0.02, `30 vs 60: ${poseDistance(a, b)}`)
  assert.ok(poseDistance(b, c) < 0.02, `60 vs 144: ${poseDistance(b, c)}`)
})

test('pure idle/walk smoothing is exactly frame-rate independent', () => {
  const run = (fps) => simulate(2, 1 / fps, (t) => ({ state: { moving: t < 1 ? 1 : 0.25 } })).poses.at(-1)
  assert.ok(poseDistance(run(30), run(240)) < 1e-9)
})

// Largest frame-to-frame pose change of a scripted 4 s timeline. Continuous
// motion shrinks with the step size; a snap (discontinuity) does not.
function worstJump(dt) {
  const at = (seconds) => Math.round(seconds / dt)
  const triggersAt = { [at(1.7)]: ['swing'], [at(1.8)]: ['swing'], [at(2)]: ['switch'], [at(2.3)]: ['switch'], [at(2.5)]: ['place'] }
  const script = (t, i) => {
    let action = null
    if (t < 0.4) action = breaking(t)
    else if (t >= 0.45 && t < 1.45) action = breaking(t - 0.45)
    else if (t >= 1.45 && t < 2.45) action = breaking(t - 1.45) // chained without an idle frame
    else if (t >= 2.5 && t < 3.5) action = { kind: 'place', progress: t - 2.5 }
    return {
      state: { action, moving: t > 0.5 && t < 2 ? 1 : 0, onGround: !(t > 1 && t < 1.3) },
      triggers: triggersAt[i] ?? [],
    }
  }
  const { poses } = simulate(4, dt, script)
  let worst = 0
  for (let i = 1; i < poses.length; i++) worst = Math.max(worst, poseDistance(poses[i], poses[i - 1]))
  return worst
}

test('nothing snaps: action restarts, chained breaks, re-triggers and tool switches stay continuous', () => {
  const coarse = worstJump(1 / 1000)
  const fine = worstJump(1 / 4000)
  assert.ok(fine < 0.01, `largest jump per 0.25 ms: ${fine}`)
  assert.ok(fine < coarse * 0.4, `jumps shrink with the step (${coarse} -> ${fine}), so none is a snap`)
})

test('one-shot triggers: swing ~0.3 s, place ~0.3 s, switch ~0.42 s; unknown kinds are ignored', () => {
  assert.deepEqual([...HAND_TRIGGERS].sort(), ['place', 'swing', 'switch'])
  const expected = { swing: 0.3, place: 0.3, switch: 0.42 }
  for (const kind of HAND_TRIGGERS) {
    const anim = createHandAnimState()
    assert.equal(triggerHandAnim(anim, kind), true)
    stepHandAnim(anim, expected[kind] - 0.01)
    assert.ok(anim.oneShots[kind], `${kind} still running`)
    stepHandAnim(anim, 0.02)
    assert.equal(anim.oneShots[kind], null, `${kind} finished`)
  }
  const anim = createHandAnimState()
  assert.equal(triggerHandAnim(anim, 'dance'), false)
  assert.equal(triggerHandAnim(anim, 'constructor'), false)
})

test('a melee swing visibly moves the hand and returns', () => {
  const { poses } = simulate(0.5, 1 / 240, (t, i) => ({ triggers: i === 0 ? ['swing'] : [] }))
  const peak = Math.max(...poses.map((pose) => poseDistance(pose, HAND_REST)))
  assert.ok(peak > 0.3)
  assert.ok(poseDistance(poses.at(-1), HAND_REST) < 0.02)
})

test('switch lowers, holds at the bottom at the midpoint, then raises; re-triggering mirrors back down', () => {
  const anim = createHandAnimState()
  triggerHandAnim(anim, 'switch')
  stepHandAnim(anim, 0.21)
  assert.ok(Math.abs(switchPhase(anim) - 0.5) < 1e-9)
  const bottom = computeHandPose(anim)
  assert.ok(bottom.y < HAND_REST.y - 0.45, 'fully lowered at the swap point')
  stepHandAnim(anim, 0.1) // now rising
  const rising = computeHandPose(anim)
  assert.ok(switchPhase(anim) > 0.5)
  triggerHandAnim(anim, 'switch')
  assert.ok(switchPhase(anim) < 0.5, 'mirrored back into the lowering half')
  assert.ok(poseDistance(computeHandPose(anim), rising) < 1e-9, 'without a jump')
  assert.equal(switchPhase(createHandAnimState()), null)
})

test('stepHandAnim ignores invalid dt and tolerates missing state', () => {
  const anim = createHandAnimState()
  for (const dt of [-1, Number.NaN, Infinity, undefined]) stepHandAnim(anim, dt, { moving: 1 })
  assert.equal(anim.time, 0)
  assert.equal(anim.moving, 0)
  stepHandAnim(anim, 0.1, null)
  stepHandAnim(anim, 0.1)
  stepHandAnim(anim, 0.1, { moving: Number.NaN, action: { kind: 'break', progress: Number.NaN } })
  assert.ok(Math.abs(anim.time - 0.3) < 1e-12)
  assert.equal(anim.mining.active, false)
  assert.ok(Object.values(computeHandPose(anim)).every(Number.isFinite))
})

test('jumping lifts the hand and landing dips it before settling', () => {
  const dt = 1 / 120
  const { poses } = simulate(1.6, dt, (t) => ({ state: { onGround: !(t >= 0.2 && t < 0.7) } }))
  const at = (t) => poses[Math.round(t / dt) - 1]
  assert.ok(at(0.65).y > HAND_REST.y + 0.02, 'airborne lift')
  const landing = poses.slice(Math.round(0.7 / dt), Math.round(1 / dt))
  assert.ok(Math.min(...landing.map((pose) => pose.y)) < HAND_REST.y - 0.01, 'landing dip')
  assert.ok(Math.abs(poses.at(-1).y - HAND_REST.y) < 0.012, 'settles')
})

// --- tool models ------------------------------------------------------------------

test('tool models exist for every tool on the belt', () => {
  assert.deepEqual([...TOOL_KEYS].sort(), TOOLS.map((tool) => tool.key).sort())
})

function modelBounds(model) {
  model.updateMatrixWorld(true)
  return new Box3().setFromObject(model)
}

test('createToolModel builds a wooden handle and a metal head per tool', () => {
  for (const key of TOOL_KEYS) {
    const model = createToolModel(key)
    assert.equal(model.isGroup, true)
    assert.equal(model.userData.key, key)
    const names = model.children.map((child) => child.name).sort()
    assert.deepEqual(names, [`${key}:metal`, `${key}:wood`])
    for (const mesh of model.children) {
      assert.ok(mesh.geometry.index.count > 0)
      assert.equal(mesh.material.vertexColors, true)
    }
    const size = modelBounds(model).getSize(new Vector3())
    assert.ok(size.y > 15 * TOOL_PIXEL && size.y < 24 * TOOL_PIXEL, `${key} height ${size.y}`)
    assert.ok(size.z <= 3 * TOOL_PIXEL + 1e-9, 'flat voxel sprite, at most 3 px thick')
  }
})

test('tool silhouettes differ: wide pickaxe arch, one-sided axe head, narrow shovel blade', () => {
  const width = (key) => {
    const box = modelBounds(createToolModel(key))
    return { min: box.min.x / TOOL_PIXEL, max: box.max.x / TOOL_PIXEL }
  }
  const pickaxe = width('pickaxe')
  const axe = width('axe')
  const shovel = width('shovel')
  assert.ok(pickaxe.max - pickaxe.min >= 16 - 1e-6)
  assert.ok(axe.max > 6 && axe.min > -3, 'the axe blade sits on one side of the handle')
  assert.ok(shovel.max - shovel.min <= 8 + 1e-6)
})

test('tool models are deterministic and unknown keys throw', () => {
  const a = createToolModel('axe').children[0].geometry.attributes.color.array
  const b = createToolModel('axe').children[0].geometry.attributes.color.array
  assert.deepEqual(a, b)
  assert.throws(() => createToolModel('sword'), /Unknown tool/)
  assert.throws(() => createToolModel('toString'), /Unknown tool/)
})

test('the grip point (origin) lies inside the handle', () => {
  for (const key of TOOL_KEYS) {
    const wood = createToolModel(key, { pixel: 1 }).children.find((child) => child.name.endsWith(':wood'))
    const positions = wood.geometry.attributes.position
    let below = false
    let above = false
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(positions.getX(i)) <= 1 && positions.getY(i) < 0) below = true
      if (Math.abs(positions.getX(i)) <= 1 && positions.getY(i) > 0) above = true
    }
    assert.ok(below && above, `${key} handle passes through the grip`)
  }
})

test('voxel geometry: pixel-subdivided faces, outward counter-clockwise winding, hidden faces', () => {
  const cube = createVoxelGeometry([voxelBox(0, 0, 0, 1, 1, 1, 0x808080)])
  assert.equal(cube.attributes.position.count, 24)
  assert.equal(cube.index.count, 36)
  const slab = createVoxelGeometry([voxelBox(0, 0, 0, 2, 1, 1, 0x808080)])
  assert.equal(slab.index.count / 6, 10, '2 + 4 + 4 pixel quads')
  const open = createVoxelGeometry([voxelBox(0, 0, 0, 1, 1, 1, 0x808080, { hide: ['px', 'ny'] })])
  assert.equal(open.index.count / 6, 4)

  const geometry = createVoxelGeometry([voxelBox(-1, 2, -3, 3, 2, 1.5, 0x8844cc)], { pixel: 0.5 })
  const pos = geometry.attributes.position
  const normal = geometry.attributes.normal
  const index = geometry.index
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  for (let t = 0; t < index.count; t += 3) {
    a.fromBufferAttribute(pos, index.getX(t))
    b.fromBufferAttribute(pos, index.getX(t + 1))
    c.fromBufferAttribute(pos, index.getX(t + 2))
    const faceNormal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
    const stored = new Vector3().fromBufferAttribute(normal, index.getX(t))
    assert.ok(faceNormal.dot(stored) > 0.999, 'triangle winds counter-clockwise around its outward normal')
  }
  geometry.computeBoundingBox()
  assert.deepEqual(geometry.boundingBox.min.toArray(), [-0.5, 1, -1.5])
  assert.deepEqual(geometry.boundingBox.max.toArray(), [1, 2, -0.75])
})

test('sprite extrusion hides faces shared with equally thick neighbours', () => {
  const legend = { a: { color: 0xffffff, depth: 2, material: 'm' }, b: { color: 0, depth: 3, material: 'm' } }
  const { m } = extrudeSprite(['aab'], legend, [0, 0])
  assert.equal(m.length, 3)
  assert.deepEqual(m[0].hide, ['px'], 'covered by its twin on the right')
  assert.deepEqual(m[1].hide, ['px', 'nx'], 'the thicker neighbour also covers it')
  assert.deepEqual(m[2].hide, [], 'the thick cell stays fully visible')
  assert.equal(m[2].z, -1.5)
})

// --- the Three.js hand view ---------------------------------------------------

test('createHandView builds an overlay scene without background, fog or shadows', () => {
  const hand = createHandView()
  assert.equal(hand.scene.background, null)
  assert.equal(hand.scene.fog, null)
  const lights = []
  hand.scene.traverse((node) => {
    if (node.isLight) lights.push(node)
    if (node.isMesh) assert.equal(node.castShadow, false)
  })
  assert.ok(lights.length >= 2)
  assert.ok(lights.every((light) => light.castShadow === false))
  assert.equal(hand.camera.fov, HAND_FOV)
  assert.equal(hand.toolKey, 'pickaxe')
})

test('resize updates the camera aspect and projection; invalid sizes are ignored', () => {
  const hand = createHandView()
  hand.resize(1000, 500)
  assert.equal(hand.camera.aspect, 2)
  const wide = hand.camera.projectionMatrix.elements[0]
  hand.resize(1280, 1024)
  assert.equal(hand.camera.aspect, 1.25)
  assert.notEqual(hand.camera.projectionMatrix.elements[0], wide, 'projection matrix recomputed')
  hand.resize(600, 1000)
  assert.ok(hand.camera.fov > HAND_FOV, 'portrait windows widen the vertical fov')
  hand.resize(0, 0)
  hand.resize(Number.NaN, 100)
  assert.equal(hand.camera.aspect, 0.6)
})

test('setTool swaps the model at the bottom of a lower-swap-raise motion', () => {
  const hand = createHandView()
  assert.equal(hand.setTool('axe'), true)
  assert.equal(hand.toolKey, 'pickaxe', 'still showing the old tool while lowering')
  assert.equal(hand.pendingToolKey, 'axe')
  let swappedAt = null
  for (let i = 1; i <= 60 && swappedAt === null; i++) {
    hand.update(1 / 120, { moving: 0, onGround: true })
    if (hand.toolKey === 'axe') swappedAt = i / 120
  }
  assert.ok(swappedAt > 0.2 && swappedAt < 0.23, `swapped at ${swappedAt}`)
  assert.equal(hand.pendingToolKey, null)
  const visible = []
  hand.root.traverse((node) => {
    if (node.name.startsWith('tool:') && node.visible) visible.push(node.name)
  })
  assert.deepEqual(visible, ['tool:axe'])
})

test('setTool ignores unknown and unchanged tools, and can cancel a pending swap', () => {
  const hand = createHandView({ tool: 'shovel' })
  assert.equal(hand.toolKey, 'shovel')
  assert.equal(hand.setTool('shovel'), false)
  assert.equal(hand.anim.oneShots.switch, null, 'no animation for the current tool')
  assert.equal(hand.setTool('sword'), false)
  assert.equal(hand.setTool('axe'), true)
  assert.equal(hand.setTool('axe'), false, 'already pending')
  assert.equal(hand.setTool('shovel'), true)
  assert.equal(hand.pendingToolKey, null)
  for (let i = 0; i < 60; i++) hand.update(1 / 60, {})
  assert.equal(hand.toolKey, 'shovel')
  assert.equal(createHandView({ tool: 'sword' }).toolKey, 'pickaxe', 'unknown start tool falls back')
})

test('switching tools mid-break keeps the mining loop running', () => {
  const hand = createHandView()
  const state = (progress) => ({ action: breaking(progress), moving: 0, onGround: true })
  for (let i = 1; i <= 30; i++) hand.update(1 / 120, state(i / 120))
  hand.setTool('shovel')
  hand.trigger('switch')
  for (let i = 31; i <= 120; i++) hand.update(1 / 120, state(i / 120))
  assert.equal(hand.toolKey, 'shovel')
  assert.ok(hand.anim.mining.weight > 0.99)
  assert.equal(hand.anim.mining.active, true)
})

test('update and trigger are safe with odd input; dispose empties the scene', () => {
  const hand = createHandView()
  assert.equal(hand.trigger('swing'), true)
  assert.equal(hand.trigger('nope'), false)
  hand.update(Number.NaN, {})
  hand.update(-1, {})
  assert.equal(hand.anim.time, 0)
  hand.update(0.016)
  hand.update(0.016, null)
  hand.update(0.016, { action: { kind: 'place', progress: 2 } })
  assert.ok(Number.isFinite(hand.root.position.x))
  hand.dispose()
  assert.equal(hand.scene.children.length, 0)
})

// Smallest distance (in units of half the screen height) between any visible
// rig vertex and the crosshair, for the current pose.
function centreClearance(hand) {
  hand.scene.updateMatrixWorld(true)
  hand.camera.updateMatrixWorld(true)
  const aspect = hand.camera.aspect
  const v = new Vector3()
  let best = Infinity
  hand.root.traverseVisible((node) => {
    if (!node.isMesh) return
    const positions = node.geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      v.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld)
      if (v.z > -hand.camera.near) continue
      v.project(hand.camera)
      best = Math.min(best, Math.hypot(v.x * aspect, v.y))
    }
  })
  return best
}

test('the hand and tools never cover the screen centre, in any motion or window shape', () => {
  const scenarios = [
    { name: 'idle', action: () => null },
    { name: 'mining', action: breaking },
    { name: 'building', action: (p) => ({ kind: 'place', progress: p }) },
    { name: 'swing', action: () => null, trigger: 'swing' },
    { name: 'place', action: () => null, trigger: 'place' },
    { name: 'switch', action: () => null, trigger: 'switch' },
    { name: 'swing while mining', action: breaking, trigger: 'swing' },
  ]
  for (const [width, height] of [
    [1920, 1080],
    [1280, 1024],
    [900, 1200],
  ]) {
    for (const tool of TOOL_KEYS) {
      for (const scenario of scenarios) {
        const hand = createHandView({ tool })
        hand.resize(width, height)
        if (scenario.trigger) hand.trigger(scenario.trigger)
        let worst = Infinity
        for (let i = 0; i < 132; i += 1) {
          hand.update(1 / 120, { action: scenario.action(Math.min(1, i / 120)), moving: i % 2, onGround: true })
          if (i % 3 === 0) worst = Math.min(worst, centreClearance(hand))
        }
        assert.ok(worst > 0.08, `${width}x${height} ${tool} ${scenario.name}: clearance ${worst.toFixed(3)}`)
      }
    }
  }
})

test('at rest the tool sits clearly in the lower-right, well away from the crosshair', () => {
  for (const tool of TOOL_KEYS) {
    const hand = createHandView({ tool })
    hand.resize(1920, 1080)
    hand.update(0, {})
    assert.ok(centreClearance(hand) > 0.25, tool)
    const centre = modelBounds(hand.root).getCenter(new Vector3()).project(hand.camera)
    assert.ok(centre.x > 0 && centre.y < 0, 'lower-right quadrant')
  }
})

test('the old tool is off-screen when the switch swaps it', () => {
  const hand = createHandView()
  hand.resize(1920, 1080)
  triggerHandAnim(hand.anim, 'switch')
  hand.update(0.21, {})
  assert.ok(Math.abs(switchPhase(hand.anim) - 0.5) < 1e-9)
  hand.scene.updateMatrixWorld(true)
  hand.camera.updateMatrixWorld(true)
  const v = new Vector3()
  hand.root.traverseVisible((node) => {
    if (!node.isMesh || !node.name.startsWith('pickaxe')) return
    const positions = node.geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      v.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld).project(hand.camera)
      assert.ok(v.y < -1 || Math.abs(v.x) > 1, 'tool vertex hidden below the screen edge')
    }
  })
})
