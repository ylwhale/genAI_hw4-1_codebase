// Synchronous events connect gameplay to views without importing rendering code.

// Passing `known` to createEventBus rejects unregistered event names.
export const GAME_EVENTS = Object.freeze([
  'hotbar:select',
  'tool:change',
  'action:start',
  'action:cancel',
  'block:broken',
  'block:placed',
  'player:swing',
  'player:damaged',
  'player:died',
  'player:respawned',
  'mob:spawned',
  'mob:hurt',
  'mob:killed',
  'mob:attack',
  'mob:removed',
  'world:reset',
])

export function createEventBus({ known = null } = {}) {
  const listeners = new Map()
  const allowed = known ? new Set(known) : null

  function check(type) {
    if (allowed && !allowed.has(type)) throw new Error(`Unknown event type: ${type}`)
  }

  return {
    on(type, listener) {
      check(type)
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
      return () => listeners.get(type)?.delete(listener)
    },
    emit(type, payload) {
      check(type)
      const set = listeners.get(type)
      if (!set) return
      for (const listener of [...set]) listener(payload)
    },
    clear() {
      listeners.clear()
    },
  }
}
