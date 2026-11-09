// Health stays within [0, max]. Only reset() clears the death latch; no regeneration.

import { PLAYER } from '../config.js'

export function createHealth(max = PLAYER.maxHealth) {
  if (!isPositiveNumber(max)) throw new RangeError(`Max health must be a positive finite number (got ${String(max)})`)
  let current = max

  // Returns the health actually removed: 0 for ignored hits (invalid amount or
  // already dead), at most the remaining health for an overkill.
  function damage(amount) {
    if (!isPositiveNumber(amount) || current <= 0) return 0
    const applied = Math.min(amount, current)
    current -= applied
    return applied
  }

  function reset() {
    current = max
  }

  return {
    get current() {
      return current
    },
    get max() {
      return max
    },
    get isDead() {
      return current <= 0
    },
    get fraction() {
      return current / max
    },
    damage,
    reset,
  }
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0
}
