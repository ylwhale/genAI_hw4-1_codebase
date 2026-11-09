import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_PITCH,
  applyLook,
  createPlayer,
  eyePosition,
  playerBox,
  resetPlayer,
  viewDirection,
  yawToward,
} from '../src/player/player.js'
import { PLAYER, WORLD_SIZE } from '../src/config.js'
import { lookDirection } from '../src/core/geometry.js'

const near = (actual, expected, eps = 1e-9, label = '') =>
  assert.ok(Math.abs(actual - expected) <= eps, `${label} expected ${expected}, got ${actual}`)

// Horizontal unit vector from `from` toward the world centre.
function towardCentre(from) {
  const dx = WORLD_SIZE / 2 - from.x
  const dz = WORLD_SIZE / 2 - from.z
  const length = Math.hypot(dx, dz)
  return { x: dx / length, z: dz / length }
}

test('createPlayer builds a resting, full-health body at the spawn', () => {
  const player = createPlayer({ x: 16.5, y: 9, z: 12.5 })
  assert.deepEqual(player.position, { x: 16.5, y: 9, z: 12.5 })
  assert.deepEqual(player.velocity, { x: 0, y: 0, z: 0 })
  assert.equal(player.width, PLAYER.width)
  assert.equal(player.height, PLAYER.height)
  assert.equal(player.eyeHeight, PLAYER.eyeHeight)
  assert.equal(player.pitch, 0)
  assert.equal(player.onGround, false)
  assert.equal(player.health.current, PLAYER.maxHealth)
  assert.equal(player.health.max, PLAYER.maxHealth)
  assert.equal(player.health.isDead, false)
  assert.ok(Number.isFinite(player.yaw))
})

test('createPlayer copies the spawn instead of aliasing it', () => {
  const spawn = { x: 3.5, y: 5, z: 4.5 }
  const player = createPlayer(spawn)
  spawn.x = 100
  assert.equal(player.position.x, 3.5)
  assert.notEqual(player.position, spawn)
})

test('separate players have independent state', () => {
  const a = createPlayer({ x: 1, y: 2, z: 3 })
  const b = createPlayer({ x: 1, y: 2, z: 3 })
  a.health.damage(50)
  a.velocity.x = 4
  assert.equal(b.health.current, 100)
  assert.equal(b.velocity.x, 0)
})

test('the default yaw faces the world centre', () => {
  for (const spawn of [
    { x: 4.5, y: 6, z: 16 }, // west of centre -> look +X
    { x: 16, y: 6, z: 28.5 }, // south of centre -> look -Z (yaw 0)
    { x: 28.5, y: 6, z: 3.5 }, // north-east corner -> look diagonally
    { x: 16.5, y: 6, z: 16.5 }, // just off centre
  ]) {
    const player = createPlayer(spawn)
    const view = viewDirection(player)
    const expected = towardCentre(spawn)
    near(view.x, expected.x, 1e-9, 'view x')
    near(view.z, expected.z, 1e-9, 'view z')
  }
  near(createPlayer({ x: 16, y: 6, z: 28.5 }).yaw, 0, 1e-12, 'yaw toward -Z')
  near(createPlayer({ x: 4.5, y: 6, z: 16 }).yaw, -Math.PI / 2, 1e-12, 'yaw toward +X')
})

test('a spawn exactly at the world centre still gets a finite yaw', () => {
  const player = createPlayer({ x: WORLD_SIZE / 2, y: 6, z: WORLD_SIZE / 2 })
  assert.equal(player.yaw, 0)
})

test('createPlayer and resetPlayer reject invalid spawns', () => {
  for (const spawn of [undefined, null, {}, { x: 1, y: 2 }, { x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }, { x: '1', y: 2, z: 3 }]) {
    assert.throws(() => createPlayer(spawn), TypeError, JSON.stringify(spawn))
  }
  const player = createPlayer({ x: 1, y: 2, z: 3 })
  assert.throws(() => resetPlayer(player, { x: NaN, y: 0, z: 0 }), TypeError)
  assert.deepEqual(player.position, { x: 1, y: 2, z: 3 }, 'a rejected reset leaves the player untouched')
})

test('resetPlayer restores position, rest, level view and full health', () => {
  const player = createPlayer({ x: 5.5, y: 8, z: 5.5 })
  const positionRef = player.position
  player.position.x = 20
  player.velocity.x = 3
  player.velocity.y = -12
  player.velocity.z = 1
  player.onGround = true
  player.pitch = 1.2
  player.health.damage(100)
  assert.equal(player.health.isDead, true)

  resetPlayer(player, { x: 10.5, y: 7, z: 9.5 })
  assert.deepEqual(player.position, { x: 10.5, y: 7, z: 9.5 })
  assert.equal(player.position, positionRef, 'position object identity is preserved')
  assert.deepEqual(player.velocity, { x: 0, y: 0, z: 0 })
  assert.equal(player.onGround, false)
  assert.equal(player.pitch, 0)
  assert.equal(player.health.current, 100)
  assert.equal(player.health.isDead, false)
})

test('resetPlayer accepts the player position itself as the spawn (simulation boot pattern)', () => {
  const player = createPlayer({ x: 12.5, y: 9, z: 18.5 })
  player.velocity.y = -5
  resetPlayer(player, player.position)
  assert.deepEqual(player.position, { x: 12.5, y: 9, z: 18.5 })
  assert.equal(player.velocity.y, 0)
})

test('resetPlayer honours an explicit yaw, wrapped into [-PI, PI)', () => {
  const player = createPlayer({ x: 4.5, y: 6, z: 16 })
  resetPlayer(player, player.position, { yaw: 0.75 })
  assert.equal(player.yaw, 0.75)
  resetPlayer(player, player.position, { yaw: 3 * Math.PI })
  assert.ok(player.yaw >= -Math.PI && player.yaw < Math.PI)
  near(Math.cos(player.yaw), -1, 1e-9, 'same heading as 3PI')
  resetPlayer(player, player.position, { yaw: NaN })
  near(player.yaw, -Math.PI / 2, 1e-12, 'non-finite yaw falls back to facing the centre')
})

test('resetPlayer can face a custom look-at point', () => {
  const player = createPlayer({ x: 5, y: 6, z: 5 })
  resetPlayer(player, { x: 5, y: 6, z: 5 }, { lookAt: { x: 5, y: 0, z: 20 } })
  const view = viewDirection(player)
  near(view.x, 0, 1e-9, 'x')
  near(view.z, 1, 1e-9, 'z')
})

test('yawToward follows the camera convention and handles coincident points', () => {
  near(yawToward({ x: 0, z: 0 }, { x: 0, z: -5 }), 0, 1e-12, '-Z')
  near(yawToward({ x: 0, z: 0 }, { x: 5, z: 0 }), -Math.PI / 2, 1e-12, '+X')
  near(yawToward({ x: 0, z: 0 }, { x: -5, z: 0 }), Math.PI / 2, 1e-12, '-X')
  assert.equal(yawToward({ x: 2, z: 2 }, { x: 2, z: 2 }), 0)
  assert.equal(yawToward({ x: 2, z: 2 }, { x: NaN, z: 2 }), 0)
  assert.equal(yawToward({ x: 2, z: 2 }, null), 0)
})

test('eyePosition sits eyeHeight above the feet and is a fresh object', () => {
  const player = createPlayer({ x: 3.5, y: 4, z: 6.5 })
  const eye = eyePosition(player)
  assert.deepEqual(eye, { x: 3.5, y: 4 + PLAYER.eyeHeight, z: 6.5 })
  eye.y = 99
  assert.equal(player.position.y, 4)
})

test('playerBox is the 0.6 x 1.8 body box around the feet', () => {
  const player = createPlayer({ x: 3.5, y: 4, z: 6.5 })
  const box = playerBox(player)
  near(box.minX, 3.2)
  near(box.maxX, 3.8)
  near(box.minZ, 6.2)
  near(box.maxZ, 6.8)
  assert.equal(box.minY, 4)
  near(box.maxY, 5.8)
})

test('viewDirection matches lookDirection and is a unit vector', () => {
  const player = createPlayer({ x: 1, y: 1, z: 1 })
  player.yaw = 0.8
  player.pitch = -0.4
  const view = viewDirection(player)
  assert.deepEqual(view, lookDirection(0.8, -0.4))
  near(Math.hypot(view.x, view.y, view.z), 1, 1e-12, 'length')
})

test('moving the mouse right turns right, moving it down looks down', () => {
  const player = createPlayer({ x: 16, y: 6, z: 28.5 })
  assert.equal(player.yaw, 0)
  applyLook(player, 100, 0)
  assert.ok(player.yaw < 0, 'yaw decreases')
  assert.ok(viewDirection(player).x > 0, 'from facing -Z, turning right looks toward +X')
  near(player.yaw, -100 * PLAYER.lookSensitivity, 1e-12, 'yaw delta uses the default sensitivity')

  applyLook(player, 0, 50)
  assert.ok(player.pitch < 0)
  assert.ok(viewDirection(player).y < 0, 'looks down')
  applyLook(player, -100, -50)
  near(player.yaw, 0, 1e-12, 'yaw back to start')
  near(player.pitch, 0, 1e-12, 'pitch back to level')
})

test('a custom sensitivity scales the look deltas', () => {
  const player = createPlayer({ x: 16, y: 6, z: 28.5 })
  applyLook(player, 10, -10, 0.01)
  near(player.yaw, -0.1, 1e-12, 'yaw')
  near(player.pitch, 0.1, 1e-12, 'pitch')
})

test('pitch is clamped just short of straight up and down', () => {
  const player = createPlayer({ x: 1, y: 1, z: 1 })
  near(MAX_PITCH, Math.PI / 2 - 0.01, 1e-15, 'limit')
  applyLook(player, 0, -1e6)
  assert.equal(player.pitch, MAX_PITCH)
  applyLook(player, 0, 1e6)
  assert.equal(player.pitch, -MAX_PITCH)
  const view = viewDirection(player)
  assert.ok(Math.hypot(view.x, view.z) > 0, 'never exactly vertical, so yaw stays meaningful')
})

test('pitch exactly at the limit is kept, just past it is clamped', () => {
  const player = createPlayer({ x: 1, y: 1, z: 1 })
  const s = 0.001
  applyLook(player, 0, -(MAX_PITCH - 1e-6) / s, s)
  near(player.pitch, MAX_PITCH - 1e-6, 1e-12, 'inside the limit')
  applyLook(player, 0, -0.01 / s, s)
  assert.equal(player.pitch, MAX_PITCH)
})

test('yaw wraps around instead of growing without bound', () => {
  const player = createPlayer({ x: 16, y: 6, z: 28.5 })
  for (let i = 0; i < 1000; i++) applyLook(player, 250, 0)
  assert.ok(player.yaw >= -Math.PI && player.yaw < Math.PI, `yaw ${player.yaw}`)
  const expected = -1000 * 250 * PLAYER.lookSensitivity
  near(Math.cos(player.yaw), Math.cos(expected), 1e-6, 'cos')
  near(Math.sin(player.yaw), Math.sin(expected), 1e-6, 'sin')
})

test('non-finite look deltas are ignored per axis', () => {
  const player = createPlayer({ x: 16, y: 6, z: 28.5 })
  applyLook(player, NaN, 10)
  assert.equal(player.yaw, 0)
  near(player.pitch, -10 * PLAYER.lookSensitivity, 1e-12, 'pitch still applied')
  const pitch = player.pitch
  applyLook(player, 20, Infinity)
  near(player.yaw, -20 * PLAYER.lookSensitivity, 1e-12, 'yaw still applied')
  assert.equal(player.pitch, pitch)
  const yaw = player.yaw
  applyLook(player, undefined, undefined)
  applyLook(player, '5', null)
  assert.equal(player.yaw, yaw)
  assert.equal(player.pitch, pitch)
})

test('a non-finite sensitivity ignores the whole look update', () => {
  const player = createPlayer({ x: 16, y: 6, z: 28.5 })
  applyLook(player, 10, 10, NaN)
  applyLook(player, 10, 10, Infinity)
  assert.equal(player.yaw, 0)
  assert.equal(player.pitch, 0)
})
