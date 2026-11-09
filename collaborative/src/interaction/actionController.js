// Times one break/place action at a time. The caller revalidates the target
// every frame and on completion.

import { BREAK_DURATION, PLACE_DURATION } from '../config.js'
import { isCell } from '../core/geometry.js'
import { isSolidBlock } from '../world/blocks.js'

// Absorbs float drift so 60 frames of 1/60 s finish a 1 s action on frame 60.
const COMPLETE_EPSILON = 1e-9

function positiveOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function isValidDt(dt) {
  return Number.isFinite(dt) && dt >= 0
}

// Read-only copy handed to callers, so outside code can never mutate timing.
function snapshot(action) {
  return {
    id: action.id,
    kind: action.kind,
    target: { ...action.target },
    blockId: action.blockId,
    elapsed: action.elapsed,
    duration: action.duration,
    progress: Math.min(action.elapsed / action.duration, 1),
  }
}

export function createActionController({ breakDuration = BREAK_DURATION, placeDuration = PLACE_DURATION } = {}) {
  const durations = {
    break: positiveOr(breakDuration, BREAK_DURATION),
    place: positiveOr(placeDuration, PLACE_DURATION),
  }
  let current = null
  let nextId = 1

  function isValidRequest(kind, target, blockId) {
    return Object.hasOwn(durations, kind) && isCell(target) && isSolidBlock(blockId)
  }

  // Returns false (and changes nothing) while busy or for malformed arguments.
  function start(kind, target, blockId) {
    if (current || !isValidRequest(kind, target, blockId)) return false
    const { x, y, z } = target
    current = { id: nextId++, kind, target: { x, y, z }, blockId, elapsed: 0, duration: durations[kind] }
    return true
  }

  // Advances the active action; returns it once, on the frame it completes.
  function update(dt) {
    if (!current || !isValidDt(dt)) return null
    current.elapsed = Math.min(current.elapsed + dt, current.duration)
    if (current.elapsed < current.duration - COMPLETE_EPSILON) return null
    current.elapsed = current.duration
    const completed = snapshot(current)
    current = null
    return completed
  }

  function cancel(reason = 'cancelled') {
    if (!current) return null
    const cancelled = { ...snapshot(current), reason }
    current = null
    return cancelled
  }

  return {
    get active() {
      return current ? snapshot(current) : null
    },
    isBusy() {
      return current !== null
    },
    durationOf(kind) {
      return Object.hasOwn(durations, kind) ? durations[kind] : null
    },
    start,
    update,
    cancel,
  }
}
