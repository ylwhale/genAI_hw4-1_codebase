import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createActionController } from '../src/interaction/actionController.js'
import { BLOCK } from '../src/world/blocks.js'
import { BREAK_DURATION, PLACE_DURATION } from '../src/config.js'

const TARGET = Object.freeze({ x: 3, y: 4, z: 5 })

// Steps until the action completes; returns the frame count and the result.
function runUntilComplete(actions, dt, maxFrames = 10000) {
  for (let frame = 1; frame <= maxFrames; frame++) {
    const done = actions.update(dt)
    if (done) return { frame, done }
  }
  return { frame: Infinity, done: null }
}

test('a new controller is idle', () => {
  const actions = createActionController()
  assert.equal(actions.active, null)
  assert.equal(actions.isBusy(), false)
  assert.equal(actions.update(1 / 60), null)
  assert.equal(actions.cancel('pause'), null)
})

test('start begins a break action with a full snapshot', () => {
  const actions = createActionController()
  assert.equal(actions.start('break', TARGET, BLOCK.STONE), true)
  assert.equal(actions.isBusy(), true)
  const active = actions.active
  assert.equal(active.kind, 'break')
  assert.deepEqual(active.target, { x: 3, y: 4, z: 5 })
  assert.equal(active.blockId, BLOCK.STONE)
  assert.equal(active.elapsed, 0)
  assert.equal(active.duration, BREAK_DURATION)
  assert.equal(active.progress, 0)
})

test('only one action at a time: a second start is ignored while busy', () => {
  const actions = createActionController()
  assert.ok(actions.start('break', TARGET, BLOCK.STONE))
  actions.update(0.3)
  assert.equal(actions.start('break', { x: 0, y: 1, z: 0 }, BLOCK.DIRT), false)
  assert.equal(actions.start('place', { x: 0, y: 1, z: 0 }, BLOCK.DIRT), false)
  const active = actions.active
  assert.deepEqual(active.target, TARGET)
  assert.equal(active.blockId, BLOCK.STONE)
  assert.ok(Math.abs(active.elapsed - 0.3) < 1e-12, 'the running action is untouched')
})

test('malformed start requests are rejected and leave the controller idle', () => {
  const actions = createActionController()
  const invalid = [
    ['dig', TARGET, BLOCK.STONE],
    [undefined, TARGET, BLOCK.STONE],
    ['constructor', TARGET, BLOCK.STONE],
    ['break', null, BLOCK.STONE],
    ['break', { x: 1.5, y: 0, z: 0 }, BLOCK.STONE],
    ['break', { x: 1, y: 2 }, BLOCK.STONE],
    ['break', { x: '1', y: 2, z: 3 }, BLOCK.STONE],
    ['break', TARGET, BLOCK.AIR],
    ['place', TARGET, 99],
    ['place', TARGET, undefined],
    ['place', TARGET, 1.5],
  ]
  for (const args of invalid) {
    assert.equal(actions.start(...args), false, JSON.stringify(args))
    assert.equal(actions.isBusy(), false)
  }
})

test('the target is copied in and snapshots are read-only copies', () => {
  const actions = createActionController()
  const target = { x: 1, y: 2, z: 3 }
  actions.start('place', target, BLOCK.WOOD)
  target.x = 99
  assert.equal(actions.active.target.x, 1)
  const snapshot = actions.active
  snapshot.target.y = 50
  snapshot.elapsed = 10
  assert.equal(actions.active.target.y, 2)
  assert.equal(actions.active.elapsed, 0)
  assert.equal(actions.update(0.5), null, 'mutating a snapshot cannot complete the action')
})

test('progress tracks elapsed time', () => {
  const actions = createActionController()
  actions.start('break', TARGET, BLOCK.DIRT)
  actions.update(0.25)
  assert.ok(Math.abs(actions.active.progress - 0.25) < 1e-12)
  actions.update(0.5)
  assert.ok(Math.abs(actions.active.progress - 0.75) < 1e-12)
})

test('completion lands on the frame that reaches 1 s at 30, 60, 144 and 240 fps', () => {
  for (const fps of [30, 60, 144, 240]) {
    const actions = createActionController()
    actions.start('break', TARGET, BLOCK.STONE)
    const { frame, done } = runUntilComplete(actions, 1 / fps)
    assert.equal(frame, fps, `${fps} fps completes after exactly ${fps} frames`)
    assert.equal(done.kind, 'break')
    assert.deepEqual(done.target, TARGET)
    assert.equal(done.blockId, BLOCK.STONE)
    assert.equal(done.progress, 1)
    assert.equal(done.elapsed, done.duration)
    assert.equal(actions.active, null)
    assert.equal(actions.isBusy(), false)
  }
})

test('an action is not complete at 0.99 s and is complete at 1.0 s', () => {
  const actions = createActionController()
  actions.start('place', TARGET, BLOCK.GRASS)
  assert.equal(actions.update(0.99), null)
  assert.ok(actions.isBusy())
  assert.ok(actions.active.progress < 1)
  const done = actions.update(0.01)
  assert.ok(done, 'completes once the duration is reached')
  assert.equal(done.kind, 'place')
})

test('uneven and oversized frames complete exactly once with progress clamped to 1', () => {
  const uneven = createActionController()
  uneven.start('break', TARGET, BLOCK.STONE)
  const { frame, done } = runUntilComplete(uneven, 0.3)
  assert.equal(frame, 4)
  assert.equal(done.elapsed, 1)
  assert.equal(done.progress, 1)

  const hitch = createActionController()
  hitch.start('break', TARGET, BLOCK.STONE)
  assert.ok(hitch.update(5))
  assert.equal(hitch.update(5), null, 'a completed action is reported only once')
})

test('invalid dt values are ignored', () => {
  const actions = createActionController()
  actions.start('break', TARGET, BLOCK.STONE)
  for (const dt of [-0.5, Number.NaN, Infinity, -Infinity, undefined, null, '0.5']) {
    assert.equal(actions.update(dt), null, String(dt))
  }
  assert.equal(actions.active.elapsed, 0)
  assert.equal(actions.update(0), null, 'dt = 0 is a valid no-op frame')
  assert.equal(actions.active.elapsed, 0)
})

test('cancel returns the cancelled action with its reason and goes idle', () => {
  const actions = createActionController()
  actions.start('break', TARGET, BLOCK.WOOD)
  actions.update(0.4)
  const cancelled = actions.cancel('target-lost')
  assert.equal(cancelled.kind, 'break')
  assert.equal(cancelled.reason, 'target-lost')
  assert.deepEqual(cancelled.target, TARGET)
  assert.ok(Math.abs(cancelled.progress - 0.4) < 1e-12)
  assert.equal(actions.active, null)
  assert.equal(actions.update(1), null, 'nothing completes after a cancel')
  assert.equal(actions.cancel('again'), null)
})

test('cancel without a reason uses a generic one', () => {
  const actions = createActionController()
  actions.start('place', TARGET, BLOCK.DIRT)
  assert.equal(actions.cancel().reason, 'cancelled')
})

test('a fresh action can start right after completion or cancellation, restarting the timer', () => {
  const actions = createActionController()
  actions.start('break', TARGET, BLOCK.STONE)
  const first = actions.update(1)
  assert.ok(first)
  assert.ok(actions.start('break', { x: 3, y: 3, z: 5 }, BLOCK.DIRT), 'held button chains the next break')
  assert.equal(actions.active.elapsed, 0)
  assert.ok(actions.active.id > first.id)
  actions.update(0.5)
  actions.cancel('attack')
  assert.ok(actions.start('place', TARGET, BLOCK.LEAVES))
  assert.equal(actions.active.progress, 0)
})

test('break and place use their own configured durations', () => {
  const defaults = createActionController()
  assert.equal(defaults.durationOf('break'), BREAK_DURATION)
  assert.equal(defaults.durationOf('place'), PLACE_DURATION)
  assert.equal(defaults.durationOf('dig'), null)
  assert.equal(defaults.durationOf('toString'), null)

  const custom = createActionController({ breakDuration: 0.5, placeDuration: 2 })
  custom.start('break', TARGET, BLOCK.STONE)
  assert.ok(custom.update(0.5))
  custom.start('place', TARGET, BLOCK.STONE)
  assert.equal(custom.update(1.5), null)
  assert.ok(Math.abs(custom.active.progress - 0.75) < 1e-12)
  assert.ok(custom.update(0.5))
})

test('invalid durations fall back to the configured defaults', () => {
  for (const value of [0, -1, Number.NaN, Infinity, '2']) {
    const actions = createActionController({ breakDuration: value, placeDuration: value })
    assert.equal(actions.durationOf('break'), BREAK_DURATION)
    assert.equal(actions.durationOf('place'), PLACE_DURATION)
  }
})

test('completion time is the same whatever the frame rate (within one frame)', () => {
  for (const dt of [1 / 24, 1 / 50, 1 / 75, 1 / 165, 0.07]) {
    const actions = createActionController()
    actions.start('break', TARGET, BLOCK.STONE)
    const { frame } = runUntilComplete(actions, dt)
    const seconds = frame * dt
    assert.ok(seconds >= 1 - 1e-9 && seconds < 1 + dt, `dt ${dt}: completed at ${seconds}`)
  }
})
