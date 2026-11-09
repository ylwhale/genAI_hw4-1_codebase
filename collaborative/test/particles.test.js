// Voxel debris particles: the pure pool/simulation and its instanced mesh.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BURST_DEFAULTS, PARTICLE_CAPACITY, createParticleSystem, particleScale } from '../src/render/particles.js'
import { createFlatWorld } from './helpers.js'
import { livePositions } from './render-helpers.js'

const ORIGIN = Object.freeze({ x: 4.5, y: 6.5, z: 4.5 })

// A long-lived particle with a recognisable x coordinate.
function marker(x) {
  return { x, y: 0, z: 0, life: 100, size: 0.1, gravity: 0 }
}

test('the particle pool holds at least 300 particles and starts empty', () => {
  const system = createParticleSystem()
  assert.ok(PARTICLE_CAPACITY >= 300)
  assert.equal(system.capacity, PARTICLE_CAPACITY)
  assert.equal(system.count, 0)
})

test('a malformed capacity falls back to the default pool size', () => {
  for (const capacity of [Number.NaN, 0, -5, Infinity, 'big']) {
    assert.equal(createParticleSystem(capacity).capacity, PARTICLE_CAPACITY, String(capacity))
  }
  assert.equal(createParticleSystem(10.7).capacity, 10)
})

test('burst spawns the requested number of particles around the position', () => {
  const system = createParticleSystem()
  assert.equal(system.burst(ORIGIN, 0x8d9399, 24), 24)
  assert.equal(system.count, 24)
  for (const p of livePositions(system)) {
    assert.ok(Math.hypot(p.x - ORIGIN.x, p.y - ORIGIN.y, p.z - ORIGIN.z) <= BURST_DEFAULTS.spread + 1e-6)
    assert.ok(p.life >= BURST_DEFAULTS.lifetime * 0.75 - 1e-6 && p.life <= BURST_DEFAULTS.lifetime * 1.25 + 1e-6)
  }
})

test('burst ignores invalid positions and counts, and clamps huge counts to the capacity', () => {
  const system = createParticleSystem(50)
  assert.equal(system.burst(null, 0xffffff, 10), 0)
  assert.equal(system.burst({ x: Number.NaN, y: 0, z: 0 }, 0xffffff, 10), 0)
  assert.equal(system.burst(ORIGIN, 0xffffff, -5), 0)
  assert.equal(system.burst(ORIGIN, 0xffffff, Number.NaN), 0)
  assert.equal(system.burst(ORIGIN, 0xffffff, 'many'), 0)
  assert.equal(system.count, 0)
  assert.equal(system.burst(ORIGIN, 0xffffff, 10.9), 10)
  assert.equal(system.burst(ORIGIN, 0xffffff, 1e6), 50)
  assert.equal(system.count, 50)
})

test('pool exhaustion recycles the oldest particle and never throws', () => {
  const system = createParticleSystem(4)
  for (let i = 0; i < 4; i++) system.spawn(marker(i))
  system.spawn(marker(99))
  assert.deepEqual(livePositions(system).map((p) => p.x).sort((a, b) => a - b), [1, 2, 3, 99])
  system.spawn(marker(100))
  assert.deepEqual(livePositions(system).map((p) => p.x).sort((a, b) => a - b), [2, 3, 99, 100])
  assert.doesNotThrow(() => {
    for (let i = 0; i < 2000; i++) system.burst(ORIGIN, 0x6aa84f, 30)
  })
  assert.equal(system.count, 4)
})

test('free slots are reused before any live particle is recycled', () => {
  const system = createParticleSystem(3)
  system.spawn({ ...marker(1), life: 0.1 })
  system.spawn(marker(2))
  system.spawn(marker(3))
  system.step(0.2)
  assert.equal(system.count, 2)
  system.spawn(marker(4))
  assert.deepEqual(livePositions(system).map((p) => p.x).sort(), [2, 3, 4])
})

test('spawn rejects malformed particles', () => {
  const system = createParticleSystem(4)
  assert.equal(system.spawn({ x: 0, y: 0, z: 0, life: 0, size: 0.1 }), -1)
  assert.equal(system.spawn({ x: 0, y: 0, z: 0, life: 1, size: Number.NaN }), -1)
  assert.equal(system.spawn({ x: 'a', y: 0, z: 0, life: 1, size: 0.1 }), -1)
  assert.equal(system.count, 0)
})

test('particles live for ~0.5-1 s and are all gone after their lifetime', () => {
  const system = createParticleSystem()
  system.burst(ORIGIN, 0xffffff, 40, { lifetime: 0.6 })
  system.step(0.6 * 0.75 - 0.01)
  assert.equal(system.count, 40, 'nobody dies before the shortest lifetime')
  system.step(0.6 * 0.5 + 0.02)
  assert.equal(system.count, 0)
  assert.ok(BURST_DEFAULTS.lifetime * 0.75 >= 0.5 && BURST_DEFAULTS.lifetime * 1.25 <= 1)
})

test('gravity pulls debris down; negative gravity makes sparkles float up', () => {
  const falling = createParticleSystem()
  falling.spawn({ x: 0, y: 10, z: 0, vy: 0, life: 2, size: 0.1, gravity: 16 })
  const floating = createParticleSystem()
  floating.spawn({ x: 0, y: 10, z: 0, vy: 0, life: 2, size: 0.1, gravity: -1 })
  for (let i = 0; i < 30; i++) {
    falling.step(1 / 60)
    floating.step(1 / 60)
  }
  assert.ok(livePositions(falling)[0].y < 8.5)
  assert.ok(livePositions(floating)[0].y > 10)
})

test('particle motion is frame-rate independent', () => {
  const run = (fps) => {
    const system = createParticleSystem(64, { seed: 7 })
    system.burst(ORIGIN, 0xffffff, 32, { lifetime: 2 })
    for (let i = 0; i < 0.5 * fps; i++) system.step(1 / fps)
    return livePositions(system)
  }
  const slow = run(30)
  const fast = run(240)
  assert.equal(slow.length, fast.length)
  slow.forEach((p, i) => {
    assert.ok(Math.hypot(p.x - fast[i].x, p.y - fast[i].y, p.z - fast[i].z) < 1e-4)
  })
})

test('invalid dt leaves particles untouched', () => {
  const system = createParticleSystem(8)
  system.burst(ORIGIN, 0xffffff, 8)
  const before = livePositions(system)
  for (const dt of [-1, Number.NaN, Infinity, undefined]) system.step(dt)
  assert.deepEqual(livePositions(system), before)
})

test('with a world, debris lands on top of blocks instead of falling through', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  const system = createParticleSystem(64, { world, seed: 3 })
  system.burst({ x: 8.5, y: 5.5, z: 8.5 }, 0x8d9399, 40, { lifetime: 3 })
  for (let i = 0; i < 120; i++) system.step(1 / 60)
  const particles = livePositions(system)
  assert.equal(particles.length, 40)
  for (const p of particles) {
    assert.ok(p.y - p.size / 2 >= 4 - 1e-3, `particle at y ${p.y} is above the ground top`)
    assert.equal(world.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), false)
  }
  assert.ok(particles.some((p) => p.y < 4.2), 'debris has settled onto the ground')
})

test('particleScale pops in, holds, and shrinks away to zero', () => {
  assert.ok(particleScale(0, 1, 0.2) > 0 && particleScale(0, 1, 0.2) < 0.2)
  assert.equal(particleScale(0.3, 1, 0.2), 0.2)
  assert.ok(particleScale(0.8, 1, 0.2) < 0.2)
  assert.ok(particleScale(0.99, 1, 0.2) < particleScale(0.8, 1, 0.2))
  assert.equal(particleScale(1, 1, 0.2), 0)
  assert.equal(particleScale(0.5, 0, 0.2), 0)
})
