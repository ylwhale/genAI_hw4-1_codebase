import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyGravity, bodyCollides, moveBody, isSupported } from '../src/world/physics.js'
import { BLOCK } from '../src/world/blocks.js'
import { createBody, createFlatWorld } from './helpers.js'

function simulate(world, body, seconds, dt = 1 / 120, each = () => {}) {
  for (let t = 0; t < seconds; t += dt) {
    each(body)
    applyGravity(body, dt)
    moveBody(world, body, dt)
  }
}

test('gravity pulls a body down until it lands on the ground', () => {
  const world = createFlatWorld({ groundTop: 3 })
  const body = createBody(5.5, 9, 5.5)
  simulate(world, body, 2)
  assert.ok(Math.abs(body.position.y - 4) < 0.01, `rests on top of y=3 (got ${body.position.y})`)
  assert.equal(body.onGround, true)
  assert.equal(body.velocity.y, 0)
  assert.equal(bodyCollides(world, body), false)
})

test('fast falls never tunnel through a one-block floor', () => {
  const world = createFlatWorld({ groundTop: 0 })
  const body = createBody(5.5, 14, 5.5)
  body.velocity.y = -40
  for (let i = 0; i < 60; i++) moveBody(world, body, 1 / 20)
  assert.ok(body.position.y >= 1 - 1e-6, `stays above the floor (got ${body.position.y})`)
})

test('walls block horizontal movement in both directions', () => {
  const world = createFlatWorld({ groundTop: 0 })
  world.setBlock(8, 1, 5, BLOCK.STONE)
  world.setBlock(8, 2, 5, BLOCK.STONE)
  const body = createBody(6.5, 1, 5.5)
  simulate(world, body, 1.5, 1 / 120, (b) => (b.velocity.x = 4.3))
  assert.ok(body.position.x <= 8 - 0.3 + 1e-3, `stopped at the wall (got ${body.position.x})`)
  assert.ok(body.position.x > 7.6)
  assert.equal(bodyCollides(world, body), false)

  const back = createBody(10.5, 1, 5.5)
  simulate(world, back, 1.5, 1 / 120, (b) => (b.velocity.x = -4.3))
  assert.ok(back.position.x >= 9 + 0.3 - 1e-3, `stopped at the wall from the other side (got ${back.position.x})`)
})

test('world boundaries act as walls', () => {
  const world = createFlatWorld({ size: 8, groundTop: 0 })
  const body = createBody(1, 1, 1)
  simulate(world, body, 1, 1 / 120, (b) => {
    b.velocity.x = -5
    b.velocity.z = -5
  })
  assert.ok(body.position.x >= 0.3 - 1e-6)
  assert.ok(body.position.z >= 0.3 - 1e-6)
})

test('a ceiling stops upward motion', () => {
  const world = createFlatWorld({ groundTop: 0 })
  world.setBlock(4, 3, 4, BLOCK.STONE)
  const body = createBody(4.5, 1, 4.5)
  body.velocity.y = 8
  moveBody(world, body, 0.1)
  assert.ok(body.position.y + body.height <= 3 + 1e-6)
  assert.equal(body.velocity.y, 0)
  assert.equal(body.onGround, false)
})

test('onGround is false while airborne or rising', () => {
  const world = createFlatWorld({ groundTop: 0 })
  const body = createBody(4.5, 1.0001, 4.5)
  assert.ok(isSupported(world, body))
  body.velocity.y = 8
  moveBody(world, body, 1 / 120)
  assert.equal(body.onGround, false)
})

test('results are frame-rate independent', () => {
  const world = createFlatWorld({ groundTop: 0 })
  const slow = createBody(3.5, 1, 3.5)
  const fast = createBody(3.5, 1, 3.5)
  simulate(world, slow, 1, 1 / 30, (b) => (b.velocity.z = 3))
  simulate(world, fast, 1, 1 / 240, (b) => (b.velocity.z = 3))
  assert.ok(Math.abs(slow.position.z - fast.position.z) < 0.15)
})

test('liftOutOfBlocks rescues an embedded body', async () => {
  const { liftOutOfBlocks } = await import('../src/world/physics.js')
  const world = createFlatWorld({ groundTop: 3 })
  const body = createBody(4.5, 2.2, 4.5)
  assert.equal(bodyCollides(world, body), true)
  assert.equal(liftOutOfBlocks(world, body), true)
  assert.equal(bodyCollides(world, body), false)
  assert.ok(Math.abs(body.position.y - 4) < 0.01)
  assert.equal(liftOutOfBlocks(world, body), false, 'a free body is left alone')
})
