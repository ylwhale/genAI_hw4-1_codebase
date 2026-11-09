import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHealth } from '../src/player/health.js'
import { PLAYER } from '../src/config.js'

test('starts full at the extension maximum of 100 HP', () => {
  const health = createHealth()
  assert.equal(PLAYER.maxHealth, 100)
  assert.equal(health.max, 100)
  assert.equal(health.current, 100)
  assert.equal(health.fraction, 1)
  assert.equal(health.isDead, false)
})

test('supports a custom maximum', () => {
  const health = createHealth(40)
  assert.equal(health.max, 40)
  assert.equal(health.current, 40)
  assert.equal(health.damage(10), 10)
  assert.equal(health.fraction, 0.75)
})

test('rejects an invalid maximum at construction', () => {
  for (const max of [0, -5, NaN, Infinity, -Infinity, '100', null, {}]) {
    assert.throws(() => createHealth(max), RangeError, `max ${String(max)}`)
  }
})

test('damage reduces health and reports the amount applied', () => {
  const health = createHealth()
  assert.equal(health.damage(10), 10)
  assert.equal(health.current, 90)
  assert.equal(health.damage(15), 15)
  assert.equal(health.current, 75)
  assert.equal(health.fraction, 0.75)
  assert.equal(health.isDead, false)
})

test('fractional damage is applied exactly', () => {
  const health = createHealth()
  assert.equal(health.damage(0.5), 0.5)
  assert.equal(health.current, 99.5)
})

test('invalid damage amounts are ignored and leave health unchanged', () => {
  const health = createHealth()
  for (const amount of [0, -0, -10, NaN, Infinity, -Infinity, undefined, null, '10', true, {}, [5]]) {
    assert.equal(health.damage(amount), 0, `amount ${String(amount)}`)
    assert.equal(health.current, 100, `amount ${String(amount)}`)
  }
  assert.equal(health.isDead, false)
})

test('overkill clamps at 0 and reports only the remaining health as applied', () => {
  const health = createHealth()
  assert.equal(health.damage(95), 95)
  assert.equal(health.damage(10), 5)
  assert.equal(health.current, 0)
  assert.equal(health.fraction, 0)
  assert.equal(health.isDead, true)

  const oneShot = createHealth()
  assert.equal(oneShot.damage(1e9), 100)
  assert.equal(oneShot.current, 0)
})

test('ten Mossling hits (10 damage) kill exactly on the tenth', () => {
  const health = createHealth()
  for (let i = 1; i <= 9; i++) {
    assert.equal(health.damage(10), 10)
    assert.equal(health.isDead, false, `alive after hit ${i}`)
  }
  assert.equal(health.damage(10), 10)
  assert.equal(health.current, 0)
  assert.equal(health.isDead, true)
})

test('Stoneguard hits (15 damage) never push health below zero', () => {
  const health = createHealth()
  const applied = []
  for (let i = 0; i < 8; i++) applied.push(health.damage(15))
  assert.deepEqual(applied, [15, 15, 15, 15, 15, 15, 10, 0])
  assert.equal(health.current, 0)
})

test('many tiny hits end at exactly 0, never negative', () => {
  const health = createHealth()
  let total = 0
  for (let i = 0; i < 1000; i++) {
    total += health.damage(0.3)
    assert.ok(health.current >= 0)
  }
  assert.equal(health.current, 0)
  assert.ok(Math.abs(total - 100) < 1e-9)
})

test('death is a latch: no further damage is applied once dead', () => {
  const health = createHealth()
  health.damage(100)
  assert.equal(health.isDead, true)
  for (let i = 0; i < 5; i++) assert.equal(health.damage(10), 0)
  assert.equal(health.current, 0)
  assert.equal(health.isDead, true)
})

test('reset restores full health and clears death', () => {
  const health = createHealth()
  health.damage(100)
  health.reset()
  assert.equal(health.current, 100)
  assert.equal(health.isDead, false)
  assert.equal(health.fraction, 1)
  assert.equal(health.damage(25), 25, 'damage works again after reset')
  assert.equal(health.current, 75)
})

test('reset on a damaged but living player also refills', () => {
  const health = createHealth()
  health.damage(30)
  health.reset()
  assert.equal(health.current, 100)
})

test('health cannot be overwritten from outside and never regenerates', () => {
  const health = createHealth()
  health.damage(40)
  assert.throws(() => {
    health.current = 500
  }, TypeError)
  assert.throws(() => {
    health.max = 1
  }, TypeError)
  assert.equal(health.current, 60)
  assert.equal(health.max, 100)
  // The only mutators are damage and reset: nothing heals over time.
  const methods = Object.keys(health).filter((key) => typeof Object.getOwnPropertyDescriptor(health, key).value === 'function')
  assert.deepEqual(methods.sort(), ['damage', 'reset'])
  for (let i = 0; i < 10; i++) assert.equal(health.current, 60)
})

test('separate health instances are independent', () => {
  const a = createHealth()
  const b = createHealth()
  a.damage(50)
  assert.equal(a.current, 50)
  assert.equal(b.current, 100)
})
