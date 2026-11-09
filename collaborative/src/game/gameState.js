// Top-level game mode machine. Only 'playing' runs the simulation; every other
// mode freezes physics, AI, damage, and interactions.
//
//   title --play--> playing --pause--> paused --resume--> playing
//                     |                  ^
//                    die                 |
//                     v                  |
//                    dead ---respawn-----+
//
// 'play' and 'resume' are dispatched only once pointer lock is acquired, so a
// respawned player waits in 'paused' (frozen, alive) until the mouse is captured.

const TRANSITIONS = Object.freeze({
  title: { play: 'playing' },
  playing: { pause: 'paused', die: 'dead' },
  paused: { resume: 'playing' },
  dead: { respawn: 'paused' },
})

export function createGameState(initial = 'title') {
  if (!TRANSITIONS[initial]) throw new Error(`Unknown game mode: ${initial}`)
  let mode = initial
  const listeners = new Set()

  function can(action) {
    return Boolean(TRANSITIONS[mode][action])
  }

  // Returns true when the transition happened; invalid actions are ignored.
  function dispatch(action) {
    const next = TRANSITIONS[mode][action]
    if (!next) return false
    const previous = mode
    mode = next
    for (const listener of [...listeners]) listener({ mode, previous, action })
    return true
  }

  return {
    get mode() {
      return mode
    },
    get isSimulating() {
      return mode === 'playing'
    },
    can,
    dispatch,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
