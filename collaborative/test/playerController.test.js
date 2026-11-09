import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GRAVITY, MAX_FRAME_DT, PHYSICS_STEP, PLAYER } from '../src/config.js'
import { BLOCK } from '../src/world/blocks.js'
import { SKIN, bodyCollides } from '../src/world/physics.js'
import { createPlayer } from '../src/player/player.js'
import { EMBED_MAX_LIFT, movementAmount, updatePlayer, wishDirection } from '../src/player/playerController.js'
import { createFlatWorld } from './helpers.js'

const IDLE = Object.freeze({ forward: false, backward: false, left: false, right: false, jump: false })
const keys = (overrides) => ({ ...IDLE, ...overrides })
const FLOOR_Y = 1 // createFlatWorld({ groundTop: 0 }) has its top face at y = 1
const REST = SKIN + 1e-9 // landing leaves at most the physics skin gap

const near = (actual, expected, eps, label = '') =>
  assert.ok(Math.abs(actual - expected) <= eps, `${label} expected ${expected} ± ${eps}, got ${actual}`)

function horizontalSpeed(player) {
  return Math.hypot(player.velocity.x, player.velocity.z)
}

// Drive the controller for `seconds` at a fixed frame dt. `each(player, i)`
// runs after every frame. Returns the frame indices on which a jump started.
function run(world, player, input, seconds, dt = PHYSICS_STEP, each = () => {}) {
  const jumps = []
  const frames = Math.round(seconds / dt)
  for (let i = 0; i < frames; i++) {
    if (updatePlayer(player, world, input, dt).jumped) jumps.push(i)
    each(player, i)
  }
  return jumps
}

// A 16 x 16 stone floor with the player resting on it, facing `yaw`.
function setup({ x = 8.5, z = 8.5, yaw = 0, size = 16 } = {}) {
  const world = createFlatWorld({ size, height: 16, groundTop: 0 })
  const player = createPlayer({ x, y: FLOOR_Y, z })
  player.yaw = yaw
  run(world, player, IDLE, 0.1)
  assert.equal(player.onGround, true, 'setup: player rests on the floor')
  return { world, player }
}

// A player hovering high above the floor, i.e. airborne.
function airborne() {
  const world = createFlatWorld({ size: 16, height: 32, groundTop: 0 })
  const player = createPlayer({ x: 8.5, y: 25, z: 8.5 })
  player.yaw = 0
  return { world, player }
}

function snapshot(player) {
  return { position: { ...player.position }, velocity: { ...player.velocity }, onGround: player.onGround }
}

// A two-block-high wall across the whole floor along z = wallZ.
function buildWall(world, wallZ, height = 2) {
  for (let x = 0; x < world.size; x++) {
    for (let y = FLOOR_Y; y < FLOOR_Y + height; y++) world.setBlock(x, y, wallZ, BLOCK.STONE)
  }
}

test('standing still on flat ground stays put, grounded and at rest', () => {
  const { world, player } = setup()
  const start = snapshot(player)
  run(world, player, IDLE, 2)
  assert.deepEqual(player.position, start.position)
  assert.equal(player.onGround, true)
  assert.deepEqual(player.velocity, { x: 0, y: 0, z: 0 })
})

test('walking forward accelerates snappily to walk speed and never beyond it', () => {
  const { world, player } = setup()
  run(world, player, keys({ forward: true }), 0.05)
  near(horizontalSpeed(player), PLAYER.groundAccel * 0.05, 1e-6, 'speed after 50 ms')
  run(world, player, keys({ forward: true }), 0.07)
  near(horizontalSpeed(player), PLAYER.walkSpeed, 1e-9, 'full speed within 0.12 s')
  let maxSpeed = 0
  run(world, player, keys({ forward: true }), 1, PHYSICS_STEP, (p) => (maxSpeed = Math.max(maxSpeed, horizontalSpeed(p))))
  assert.ok(maxSpeed <= PLAYER.walkSpeed + 1e-9, `never faster than walkSpeed (max ${maxSpeed})`)
  assert.ok(player.velocity.z < 0 && Math.abs(player.velocity.x) < 1e-9, 'yaw 0 walks toward -Z')
  near(player.position.y, FLOOR_Y, 1e-9, 'stays on the floor')
})

test('wish direction is relative to the camera yaw', () => {
  const cases = [
    [0, { forward: true }, { x: 0, z: -1 }],
    [0, { backward: true }, { x: 0, z: 1 }],
    [0, { right: true }, { x: 1, z: 0 }],
    [0, { left: true }, { x: -1, z: 0 }],
    [-Math.PI / 2, { forward: true }, { x: 1, z: 0 }],
    [-Math.PI / 2, { right: true }, { x: 0, z: 1 }],
    [Math.PI / 2, { forward: true }, { x: -1, z: 0 }],
    [Math.PI, { forward: true }, { x: 0, z: 1 }],
  ]
  for (const [yaw, input, expected] of cases) {
    const wish = wishDirection(yaw, keys(input))
    near(wish.x, expected.x, 1e-12, `yaw ${yaw} ${JSON.stringify(input)} x`)
    near(wish.z, expected.z, 1e-12, `yaw ${yaw} ${JSON.stringify(input)} z`)
  }
})

test('walking follows the camera: facing +X, forward moves +X', () => {
  const { world, player } = setup({ x: 4.5, yaw: -Math.PI / 2 })
  run(world, player, keys({ forward: true }), 1)
  assert.ok(player.position.x > 4.5 + 3.5, `moved +X (x = ${player.position.x})`)
  near(player.position.z, 8.5, 1e-9, 'no sideways drift')
})

test('diagonal movement is normalised and no faster than straight movement', () => {
  for (const input of [
    { forward: true, right: true },
    { forward: true, left: true },
    { backward: true, right: true },
    { backward: true, left: true },
  ]) {
    const wish = wishDirection(0.3, keys(input))
    near(Math.hypot(wish.x, wish.z), 1, 1e-12, JSON.stringify(input))
  }
  const straight = setup({ x: 8.5, z: 12.5 })
  const diagonal = setup({ x: 4.5, z: 12.5 })
  run(straight.world, straight.player, keys({ forward: true }), 1)
  run(diagonal.world, diagonal.player, keys({ forward: true, right: true }), 1)
  const straightDistance = 12.5 - straight.player.position.z
  const diagonalDistance = Math.hypot(diagonal.player.position.x - 4.5, diagonal.player.position.z - 12.5)
  near(horizontalSpeed(diagonal.player), PLAYER.walkSpeed, 1e-9, 'diagonal top speed')
  near(diagonalDistance, straightDistance, 1e-6, 'same distance covered')
})

test('opposite keys cancel out', () => {
  const { world, player } = setup()
  const start = { ...player.position }
  run(world, player, keys({ forward: true, backward: true, left: true, right: true }), 1)
  assert.deepEqual(player.position, start)
  assert.equal(horizontalSpeed(player), 0)
})

test('releasing the keys stops quickly on the ground', () => {
  const { world, player } = setup({ z: 12.5 })
  run(world, player, keys({ forward: true }), 0.5)
  const releasedAt = player.position.z
  run(world, player, IDLE, PLAYER.walkSpeed / PLAYER.groundAccel + 0.02)
  assert.equal(horizontalSpeed(player), 0, 'fully stopped')
  const slide = releasedAt - player.position.z
  assert.ok(slide > 0 && slide < 0.3, `short stopping slide (${slide})`)
})

test('air control is weaker than ground control but still present', () => {
  const ground = setup()
  const air = airborne()
  run(ground.world, ground.player, keys({ forward: true }), 0.05)
  run(air.world, air.player, keys({ forward: true }), 0.05)
  const groundSpeed = horizontalSpeed(ground.player)
  const airSpeed = horizontalSpeed(air.player)
  assert.equal(air.player.onGround, false)
  near(airSpeed, PLAYER.airAccel * 0.05, 1e-6, 'air acceleration')
  assert.ok(airSpeed > 0, 'some air control')
  assert.ok(airSpeed < groundSpeed / 2, `air ${airSpeed} vs ground ${groundSpeed}`)
})

test('a running jump keeps its horizontal speed while the key is held', () => {
  const { world, player } = setup({ z: 14.5 })
  run(world, player, keys({ forward: true }), 0.5)
  const jumps = run(world, player, keys({ forward: true, jump: true }), 1 / 120)
  assert.equal(jumps.length, 1)
  run(world, player, keys({ forward: true }), 0.3, PHYSICS_STEP, (p) => {
    assert.equal(p.onGround, false)
    near(horizontalSpeed(p), PLAYER.walkSpeed, 1e-9, 'airborne speed')
  })
})

test('jumping from the ground launches at jumpSpeed and clears one block', () => {
  const { world, player } = setup()
  const result = updatePlayer(player, world, keys({ jump: true }), PHYSICS_STEP)
  assert.equal(result.jumped, true)
  assert.equal(player.onGround, false)
  near(player.velocity.y, PLAYER.jumpSpeed - GRAVITY * PHYSICS_STEP, 1e-9, 'launch velocity')
  let apex = player.position.y
  run(world, player, IDLE, 1.2, PHYSICS_STEP, (p) => (apex = Math.max(apex, p.position.y)))
  const height = apex - FLOOR_Y
  assert.ok(height > 1.25 && height < PLAYER.jumpSpeed ** 2 / (2 * GRAVITY) + 1e-9, `jump height ${height}`)
  near(player.position.y, FLOOR_Y, REST, 'lands back on the floor')
  assert.equal(player.onGround, true)
})

test('holding jump never jumps again in mid-air; it only re-jumps after landing', () => {
  const { world, player } = setup()
  const airtime = (2 * PLAYER.jumpSpeed) / GRAVITY
  const groundedBefore = []
  let wasGrounded = player.onGround
  const jumps = run(world, player, keys({ jump: true }), 3, PHYSICS_STEP, (p) => {
    groundedBefore.push(wasGrounded)
    wasGrounded = p.onGround
  })
  assert.ok(jumps.length >= 3, `re-jumps on landing (${jumps.length} jumps)`)
  for (const frame of jumps) assert.equal(groundedBefore[frame], true, `jump on frame ${frame} started from the ground`)
  for (let i = 1; i < jumps.length; i++) {
    const gap = (jumps[i] - jumps[i - 1]) * PHYSICS_STEP
    assert.ok(gap >= airtime - 0.05, `jumps ${gap.toFixed(3)} s apart (airtime ${airtime.toFixed(3)} s)`)
  }
})

test('a knockback hop is not stacked with a jump on the same step', () => {
  const { world, player } = setup()
  // simulation.knockPlayerBack sets an upward hop while onGround is still true.
  player.velocity.y = 4
  assert.equal(player.onGround, true)
  assert.deepEqual(updatePlayer(player, world, keys({ jump: true }), PHYSICS_STEP), { jumped: false })
  assert.ok(player.velocity.y < 4, 'only the hop, not a full jump')
  assert.equal(player.onGround, false)
})

test('an airborne or falling player cannot jump', () => {
  const { world, player } = airborne()
  const jumps = run(world, player, keys({ jump: true }), 0.5)
  assert.deepEqual(jumps, [])
  assert.ok(player.velocity.y < 0, 'still falling')
})

test('walking off a ledge and pressing jump mid-fall does nothing', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 4 })
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 8; z++) {
      for (let y = 1; y <= 4; y++) world.setBlock(x, y, z, BLOCK.AIR)
    }
  }
  const player = createPlayer({ x: 8.5, y: 5, z: 9.5 })
  player.yaw = 0
  run(world, player, IDLE, 0.1)
  assert.equal(player.onGround, true)
  for (let i = 0; i < 240 && player.onGround; i++) updatePlayer(player, world, keys({ forward: true }), PHYSICS_STEP)
  assert.equal(player.onGround, false, 'walked off the ledge')
  const jumps = run(world, player, keys({ forward: true, jump: true }), 0.2)
  assert.deepEqual(jumps, [], 'no jump while falling from the ledge')
  assert.equal(player.onGround, false, 'still falling')
  assert.ok(player.velocity.y < 0)
})

test('a low ceiling stops the jump without trapping the player', () => {
  const { world, player } = setup()
  // Two free blocks above the floor: the 1.8-high player has 0.2 of headroom.
  for (let x = 6; x <= 10; x++) {
    for (let z = 6; z <= 10; z++) world.setBlock(x, FLOOR_Y + 2, z, BLOCK.STONE)
  }
  let apex = player.position.y
  run(world, player, keys({ jump: true }), 1 / 120)
  run(world, player, IDLE, 1, PHYSICS_STEP, (p) => {
    apex = Math.max(apex, p.position.y)
    assert.equal(bodyCollides(world, p), false)
  })
  assert.ok(apex + player.height <= FLOOR_Y + 2 + 1e-6, 'head stopped at the ceiling')
  near(player.position.y, FLOOR_Y, REST, 'back on the floor')
  assert.equal(player.onGround, true)
})

test('a one-block step blocks walking but can be climbed by jumping', () => {
  const { world, player } = setup({ z: 10.5 })
  for (let x = 0; x < 16; x++) {
    for (let z = 3; z <= 6; z++) world.setBlock(x, FLOOR_Y, z, BLOCK.STONE)
  }
  run(world, player, keys({ forward: true }), 1)
  near(player.position.z, 7 + player.width / 2, 1e-3, 'stopped at the step face')
  near(player.position.y, FLOOR_Y, 1e-9, 'no automatic step-up')

  run(world, player, keys({ forward: true, jump: true }), 0.5)
  run(world, player, keys({ forward: true }), 0.2)
  run(world, player, IDLE, 0.5)
  near(player.position.y, FLOOR_Y + 1, REST, 'standing on top of the step')
  assert.ok(player.position.z < 7, 'moved onto the step')
  assert.equal(bodyCollides(world, player), false)
})

test('walking into a wall stops flush against it without penetrating', () => {
  const { world, player } = setup()
  buildWall(world, 4)
  run(world, player, keys({ forward: true }), 2, PHYSICS_STEP, (p) => assert.equal(bodyCollides(world, p), false))
  assert.ok(player.position.z >= 5 + player.width / 2 - 1e-9, `outside the wall (z = ${player.position.z})`)
  assert.ok(player.position.z < 5 + player.width / 2 + 0.01, 'flush against it')
  assert.equal(player.velocity.z, 0)
  assert.equal(player.onGround, true)
})

test('walls block movement from every side', () => {
  const directions = [
    { yaw: 0, start: { x: 8.5, z: 11.5 }, axis: 'z', limit: 9 + 0.3, sign: 1 }, // toward -Z
    { yaw: Math.PI, start: { x: 8.5, z: 5.5 }, axis: 'z', limit: 8 - 0.3, sign: -1 }, // toward +Z
    { yaw: -Math.PI / 2, start: { x: 5.5, z: 8.5 }, axis: 'x', limit: 8 - 0.3, sign: -1 }, // toward +X
    { yaw: Math.PI / 2, start: { x: 11.5, z: 8.5 }, axis: 'x', limit: 9 + 0.3, sign: 1 }, // toward -X
  ]
  for (const { yaw, start, axis, limit, sign } of directions) {
    const { world, player } = setup({ ...start, yaw })
    world.setBlock(8, FLOOR_Y, 8, BLOCK.STONE)
    world.setBlock(8, FLOOR_Y + 1, 8, BLOCK.STONE)
    run(world, player, keys({ forward: true }), 1.5)
    const overshoot = sign * (limit - player.position[axis])
    assert.ok(overshoot <= 1e-9, `yaw ${yaw}: stopped before the block (${player.position[axis]} vs ${limit})`)
    near(player.position[axis], limit, 0.01, `yaw ${yaw} flush`)
    assert.equal(bodyCollides(world, player), false)
  }
})

test('moving diagonally into a wall slides along it', () => {
  const { world, player } = setup({ x: 4.5 })
  buildWall(world, 4)
  run(world, player, keys({ forward: true, right: true }), 1.5)
  near(player.position.z, 5 + player.width / 2, 0.01, 'held against the wall')
  assert.ok(player.position.x > 4.5 + 2, `slid along the wall (x = ${player.position.x})`)
  assert.equal(bodyCollides(world, player), false)
})

test('the world edge acts as a wall', () => {
  const { world, player } = setup({ x: 2.5, yaw: Math.PI / 2 })
  run(world, player, keys({ forward: true }), 2)
  assert.ok(player.position.x >= player.width / 2 - 1e-9, `inside the world (x = ${player.position.x})`)
  near(player.position.x, player.width / 2, 0.01, 'flush with the edge')
})

test('gravity pulls a falling player down onto the floor', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 0 })
  const player = createPlayer({ x: 8.5, y: 6, z: 8.5 })
  run(world, player, IDLE, 0.2)
  assert.ok(player.position.y < 6 - 0.4, 'falling')
  run(world, player, IDLE, 1)
  near(player.position.y, FLOOR_Y, REST, 'landed')
  assert.equal(player.onGround, true)
  assert.equal(player.velocity.y, 0)
})

test('a fast shove into a one-block-thick wall never tunnels through', () => {
  const { world, player } = setup()
  buildWall(world, 6)
  player.velocity.z = -40
  run(world, player, IDLE, 0.5, MAX_FRAME_DT)
  assert.ok(player.position.z >= 7 + player.width / 2 - 1e-9, `stayed on its side (z = ${player.position.z})`)
  assert.equal(bodyCollides(world, player), false)
})

test('walking is frame-rate independent (1 s at dt 1/30 vs 1/240)', () => {
  const ends = [1 / 30, 1 / 60, 1 / 144, 1 / 240].map((dt) => {
    const { world, player } = setup({ z: 13.5 })
    run(world, player, keys({ forward: true, right: true }), 1, dt)
    return { ...player.position }
  })
  const [slow, , , fast] = ends
  const gap = Math.hypot(slow.x - fast.x, slow.z - fast.z)
  assert.ok(gap < 0.1, `within the contract tolerance (${gap})`)
  assert.ok(gap < 0.03, `well within it (${gap})`)
  for (const end of ends) near(Math.hypot(end.x - 8.5, end.z - 13.5), Math.hypot(slow.x - 8.5, slow.z - 13.5), 0.03, 'distance')
})

test('jump arcs are frame-rate independent', () => {
  const results = [1 / 30, 1 / 60, 1 / 120, 1 / 144, 1 / 240].map((dt) => {
    const { world, player } = setup()
    let apex = player.position.y
    let landedAt = null
    run(world, player, keys({ jump: true }), dt, dt)
    run(world, player, IDLE, 1.2, dt, (p, i) => {
      apex = Math.max(apex, p.position.y)
      if (landedAt === null && p.onGround) landedAt = (i + 2) * dt
    })
    return { apex, landedAt }
  })
  const apexes = results.map((r) => r.apex)
  const landings = results.map((r) => r.landedAt)
  assert.ok(Math.max(...apexes) - Math.min(...apexes) < 0.025, `apexes ${apexes.map((a) => a.toFixed(4))}`)
  assert.ok(Math.max(...landings) - Math.min(...landings) < 0.05, `landings ${landings.map((t) => t.toFixed(3))}`)
})

test('one long call is sub-stepped exactly like PHYSICS_STEP slices', () => {
  const a = setup()
  const b = setup()
  const input = keys({ forward: true, right: true, jump: true })
  for (let i = 0; i < 30; i++) updatePlayer(a.player, a.world, input, 1 / 30)
  for (let i = 0; i < 120; i++) updatePlayer(b.player, b.world, input, 1 / 120)
  near(a.player.position.x, b.player.position.x, 1e-9, 'x')
  near(a.player.position.y, b.player.position.y, 1e-9, 'y')
  near(a.player.position.z, b.player.position.z, 1e-9, 'z')
})

test('updatePlayer reports a jump that happens in any sub-step', () => {
  const { world, player } = setup()
  assert.deepEqual(updatePlayer(player, world, keys({ jump: true }), 1 / 30), { jumped: true })
  assert.deepEqual(updatePlayer(player, world, keys({ jump: true }), 1 / 30), { jumped: false })
})

test('frames longer than MAX_FRAME_DT are capped', () => {
  const capped = airborne()
  const reference = airborne()
  updatePlayer(capped.player, capped.world, keys({ forward: true }), 5)
  run(reference.world, reference.player, keys({ forward: true }), MAX_FRAME_DT)
  near(capped.player.position.y, reference.player.position.y, 1e-9, 'y')
  near(capped.player.position.z, reference.player.position.z, 1e-9, 'z')
})

test('invalid dt values are ignored', () => {
  const { world, player } = setup()
  player.velocity.x = 2
  const before = snapshot(player)
  for (const dt of [0, -0.016, NaN, Infinity, -Infinity, undefined, null, '0.016']) {
    assert.deepEqual(updatePlayer(player, world, keys({ forward: true, jump: true }), dt), { jumped: false })
    assert.deepEqual(snapshot(player), before, `dt ${String(dt)}`)
  }
})

test('missing or malformed input is treated as no input', () => {
  for (const input of [undefined, null, {}, 'garbage', 42]) {
    const { world, player } = setup()
    const start = { ...player.position }
    const jumps = run(world, player, input, 0.5)
    assert.deepEqual(jumps, [], `input ${String(input)}`)
    assert.deepEqual(player.position, start, `input ${String(input)}`)
  }
})

test('a non-finite yaw produces no movement instead of NaN positions', () => {
  const { world, player } = setup()
  player.yaw = NaN
  assert.deepEqual(wishDirection(NaN, keys({ forward: true })), { x: 0, z: 0 })
  run(world, player, keys({ forward: true }), 0.2)
  assert.ok(Number.isFinite(player.position.x) && Number.isFinite(player.position.z))
})

test('an embedded player is lifted out before moving', () => {
  const { world, player } = setup()
  world.setBlock(8, FLOOR_Y, 8, BLOCK.DIRT) // a block appears around the legs
  assert.equal(bodyCollides(world, player), true)
  updatePlayer(player, world, IDLE, PHYSICS_STEP)
  assert.equal(bodyCollides(world, player), false)
  near(player.position.y, FLOOR_Y + 1, 1e-3, 'standing on the new block')
  run(world, player, IDLE, 0.2)
  near(player.position.y, FLOOR_Y + 1, REST, 'settled on it')
  assert.equal(player.onGround, true)
})

test('EMBED_MAX_LIFT is the three-block lift shared with the simulation rescue', () => {
  assert.equal(EMBED_MAX_LIFT, 3)
  const { world, player } = setup()
  for (let y = FLOOR_Y; y < FLOOR_Y + EMBED_MAX_LIFT - 1; y++) world.setBlock(8, y, 8, BLOCK.STONE)
  updatePlayer(player, world, IDLE, PHYSICS_STEP)
  assert.equal(bodyCollides(world, player), false, 'freed within the lift')
  near(player.position.y, FLOOR_Y + EMBED_MAX_LIFT - 1, 1e-3)
})

test('a player buried deeper than three blocks is not teleported upward', () => {
  const { world, player } = setup()
  for (let y = FLOOR_Y; y <= FLOOR_Y + 4; y++) world.setBlock(8, y, 8, BLOCK.STONE)
  assert.doesNotThrow(() => run(world, player, keys({ forward: true, jump: true }), 0.1))
  assert.ok(player.position.y <= FLOOR_Y + 1e-9, `left in place (y = ${player.position.y})`)
  assert.ok([player.position.x, player.position.y, player.position.z].every(Number.isFinite))
})

test('knockback on the ground decays smoothly instead of being zeroed', () => {
  const { world, player } = setup()
  player.velocity.x = 6
  const speeds = []
  const startX = player.position.x
  run(world, player, IDLE, 0.3, PHYSICS_STEP, (p) => speeds.push(p.velocity.x))
  assert.ok(speeds[0] > 5.5, `still moving after one step (${speeds[0]})`)
  for (let i = 1; i < speeds.length; i++) {
    assert.ok(speeds[i] <= speeds[i - 1], 'monotonic decay')
    assert.ok(speeds[i - 1] - speeds[i] <= PLAYER.groundAccel * PHYSICS_STEP + 1e-9, 'bounded per-step change')
    assert.ok(speeds[i] >= 0, 'never reverses')
  }
  assert.equal(player.velocity.x, 0, 'fully decayed within 0.3 s')
  const slide = player.position.x - startX
  near(slide, 36 / (2 * PLAYER.groundAccel), 0.05, 'slide distance v²/2a')
})

test('knockback in the air decays more gently than on the ground', () => {
  const ground = setup()
  const air = airborne()
  ground.player.velocity.x = 6
  air.player.velocity.x = 6
  run(ground.world, ground.player, IDLE, 0.2)
  run(air.world, air.player, IDLE, 0.2)
  assert.equal(ground.player.velocity.x, 0)
  near(air.player.velocity.x, 6 - PLAYER.airAccel * 0.2, 1e-6, 'air decay')
})

test('an integrator-style hit while walking blends smoothly back into walking', () => {
  const { world, player } = setup({ z: 13.5 })
  run(world, player, keys({ forward: true }), 0.5)
  // simulation.knockPlayerBack: +4 u/s away from the attacker, small hop.
  player.velocity.z += 4
  player.velocity.y = 4
  let previous = { x: player.velocity.x, z: player.velocity.z }
  run(world, player, keys({ forward: true }), 1, PHYSICS_STEP, (p) => {
    const change = Math.hypot(p.velocity.x - previous.x, p.velocity.z - previous.z)
    assert.ok(change <= PLAYER.groundAccel * PHYSICS_STEP + 1e-9, `no velocity snap (${change})`)
    previous = { x: p.velocity.x, z: p.velocity.z }
  })
  near(player.velocity.z, -PLAYER.walkSpeed, 1e-9, 'walking again at full speed')
  assert.equal(player.onGround, true)
})

test('a dead player ignores movement and jump input but still falls', () => {
  const { world, player } = setup()
  player.health.damage(1000)
  const start = { ...player.position }
  const jumps = run(world, player, keys({ forward: true, left: true, jump: true }), 0.5)
  assert.deepEqual(jumps, [])
  assert.deepEqual(player.position, start)

  const falling = airborne()
  falling.player.health.damage(1000)
  run(falling.world, falling.player, keys({ forward: true }), 3)
  near(falling.player.position.y, FLOOR_Y, REST, 'landed')
  near(falling.player.position.z, 8.5, 1e-9, 'no steering')
})

test('movementAmount reports horizontal speed as a 0..1 fraction of walk speed', () => {
  const player = createPlayer({ x: 1, y: 1, z: 1 })
  assert.equal(movementAmount(player), 0)
  player.velocity.x = PLAYER.walkSpeed / 2
  near(movementAmount(player), 0.5, 1e-12, 'half speed')
  player.velocity.x = 0
  player.velocity.z = -PLAYER.walkSpeed
  near(movementAmount(player), 1, 1e-12, 'full speed')
  player.velocity.z = 12
  assert.equal(movementAmount(player), 1, 'clamped')
  player.velocity.z = 0
  player.velocity.y = -20
  assert.equal(movementAmount(player), 0, 'falling is not walking')
})
