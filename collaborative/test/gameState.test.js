import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGameState } from '../src/game/gameState.js'

test('starts on the title screen and only simulates while playing', () => {
  const state = createGameState()
  assert.equal(state.mode, 'title')
  assert.equal(state.isSimulating, false)
  assert.ok(state.dispatch('play'))
  assert.equal(state.mode, 'playing')
  assert.equal(state.isSimulating, true)
})

test('pause / resume and death / respawn cycles', () => {
  const state = createGameState('playing')
  const seen = []
  state.onChange(({ mode, previous, action }) => seen.push(`${previous}-${action}->${mode}`))
  assert.ok(state.dispatch('pause'))
  assert.ok(state.dispatch('resume'))
  assert.ok(state.dispatch('die'))
  assert.equal(state.isSimulating, false)
  assert.ok(state.dispatch('respawn'))
  assert.equal(state.isSimulating, false, 'respawned player waits for pointer lock')
  assert.ok(state.dispatch('resume'))
  assert.deepEqual(seen, [
    'playing-pause->paused',
    'paused-resume->playing',
    'playing-die->dead',
    'dead-respawn->paused',
    'paused-resume->playing',
  ])
})

test('invalid transitions are ignored', () => {
  const state = createGameState()
  assert.equal(state.dispatch('die'), false, 'cannot die on the title screen')
  assert.equal(state.dispatch('resume'), false)
  state.dispatch('play')
  state.dispatch('die')
  assert.equal(state.dispatch('pause'), false, 'death screen cannot be paused over')
  assert.equal(state.dispatch('resume'), false, 'death screen cannot be dismissed without respawning')
  assert.equal(state.mode, 'dead')
  assert.throws(() => createGameState('bogus'))
})
