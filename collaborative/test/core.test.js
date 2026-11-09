import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRng, hash3, deriveSeed } from '../src/core/rng.js'
import { GAME_EVENTS, createEventBus } from '../src/core/events.js'
import { bodyBox, boxesOverlap, distanceToBox, rayBoxDistance, lookDirection } from '../src/core/geometry.js'
import { clamp } from '../src/core/math.js'

test('rng is deterministic per seed and differs across seeds', () => {
  const a = createRng(42)
  const b = createRng(42)
  const c = createRng(43)
  const seqA = Array.from({ length: 5 }, () => a.next())
  const seqB = Array.from({ length: 5 }, () => b.next())
  const seqC = Array.from({ length: 5 }, () => c.next())
  assert.deepEqual(seqA, seqB)
  assert.notDeepEqual(seqA, seqC)
  for (const value of seqA) assert.ok(value >= 0 && value < 1)
})

test('rng helpers stay inside their ranges', () => {
  const rng = createRng(7)
  for (let i = 0; i < 200; i++) {
    const n = rng.int(2, 5)
    assert.ok(Number.isInteger(n) && n >= 2 && n <= 5)
    const r = rng.range(-1, 1)
    assert.ok(r >= -1 && r < 1)
  }
  assert.deepEqual(rng.shuffle([1, 2, 3, 4]).sort(), [1, 2, 3, 4])
})

test('hash3 and deriveSeed are stable', () => {
  assert.equal(hash3(1, 2, 3, 42), hash3(1, 2, 3, 42))
  assert.notEqual(hash3(1, 2, 3, 42), hash3(1, 2, 4, 42))
  assert.equal(deriveSeed(42, 'terrain'), deriveSeed(42, 'terrain'))
  assert.notEqual(deriveSeed(42, 'terrain'), deriveSeed(42, 'trees'))
})

test('event bus delivers, unsubscribes, and tolerates unknown types', () => {
  const bus = createEventBus()
  const seen = []
  const off = bus.on('hit', (payload) => seen.push(payload))
  bus.emit('hit', 1)
  off()
  bus.emit('hit', 2)
  bus.emit('nobody-listens', 3)
  assert.deepEqual(seen, [1])
})

test('geometry helpers', () => {
  const box = bodyBox({ x: 1, y: 2, z: 3 }, 0.6, 1.8)
  assert.deepEqual(box, { minX: 0.7, minY: 2, minZ: 2.7, maxX: 1.3, maxY: 3.8, maxZ: 3.3 })
  assert.ok(boxesOverlap(box, { minX: 1, minY: 3, minZ: 3, maxX: 2, maxY: 4, maxZ: 4 }))
  assert.ok(!boxesOverlap(box, { minX: 1.3, minY: 2, minZ: 2.7, maxX: 2, maxY: 4, maxZ: 4 }))
  assert.equal(distanceToBox({ x: 0, y: 0, z: 0 }, { minX: 3, minY: 0, minZ: 0, maxX: 4, maxY: 1, maxZ: 1 }), 3)
  assert.equal(clamp(5, 0, 2), 2)
})

test('rayBoxDistance hits, misses, and respects max distance', () => {
  const unit = { minX: 2, minY: 0, minZ: 0, maxX: 3, maxY: 1, maxZ: 1 }
  const origin = { x: 0, y: 0.5, z: 0.5 }
  assert.equal(rayBoxDistance(origin, { x: 1, y: 0, z: 0 }, unit), 2)
  assert.equal(rayBoxDistance(origin, { x: -1, y: 0, z: 0 }, unit), null)
  assert.equal(rayBoxDistance(origin, { x: 1, y: 0, z: 0 }, unit, 1.5), null)
  assert.equal(rayBoxDistance({ x: 2.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, unit), 0)
})

test('lookDirection follows the Three.js camera convention', () => {
  const forward = lookDirection(0, 0)
  assert.ok(Math.abs(forward.x) < 1e-9 && Math.abs(forward.y) < 1e-9 && Math.abs(forward.z + 1) < 1e-9)
  const left = lookDirection(Math.PI / 2, 0)
  assert.ok(Math.abs(left.x + 1) < 1e-9)
  const up = lookDirection(0, Math.PI / 2)
  assert.ok(Math.abs(up.y - 1) < 1e-9)
})

test('a bus with known event names rejects typos on both on() and emit()', () => {
  const bus = createEventBus({ known: GAME_EVENTS })
  assert.doesNotThrow(() => bus.on('mob:killed', () => {}))
  assert.throws(() => bus.on('mob:kiled', () => {}), /Unknown event type/)
  assert.throws(() => bus.emit('player:respawn', {}), /Unknown event type/)
})

test('math helpers', async () => {
  const { approach, clamp01, lerp, smoothstep, wrapAngle, yawFromDirection, TAU } = await import('../src/core/math.js')
  assert.equal(clamp01(NaN), 0)
  assert.equal(clamp01(2), 1)
  assert.equal(lerp(2, 4, 0.5), 3)
  assert.equal(smoothstep(0, 1, 0.5), 0.5)
  assert.equal(smoothstep(0, 1, -1), 0)
  assert.ok(Math.abs(approach(0, 10, 5, 100) - 10) < 1e-9)
  assert.ok(wrapAngle(Math.PI) === -Math.PI && Math.abs(wrapAngle(TAU + 0.5) - 0.5) < 1e-12)
  assert.ok(Math.abs(yawFromDirection(0, -1)) < 1e-12, 'facing -Z is yaw 0')
})

test('geometry validation and horizontal direction helpers', async () => {
  const { isCell, isFinitePoint, horizontalDirection } = await import('../src/core/geometry.js')
  assert.ok(isCell({ x: 1, y: 2, z: 3 }) && !isCell({ x: 1.5, y: 2, z: 3 }) && !isCell(null))
  assert.ok(isFinitePoint({ x: 1.5, y: 2, z: 3 }) && !isFinitePoint({ x: NaN, y: 0, z: 0 }))
  assert.deepEqual(horizontalDirection({ x: 0, y: 0, z: 0 }, { x: 3, y: 9, z: 4 }), { x: 0.6, z: 0.8, length: 5 })
  assert.deepEqual(horizontalDirection({ x: 1, y: 0, z: 1 }, { x: 1, y: 5, z: 1 }), { x: 0, z: 0, length: 0 })
})
