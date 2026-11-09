// Shared strike timing keeps hand swings and mining chips in sync.

import { clamp01 } from '../core/math.js'

export const MINING_SWINGS = 4 // strikes per break action (every 0.25 s at 1 s)
export const MINING_IMPACT = 0.3 // fraction of each swing at which the head lands

// Number of tool impacts reached at a given break progress (0..MINING_SWINGS).
export function miningImpactCount(progress) {
  if (!Number.isFinite(progress)) return 0
  const swings = clamp01(progress) * MINING_SWINGS
  return swings < MINING_IMPACT ? 0 : Math.min(MINING_SWINGS, Math.floor(swings - MINING_IMPACT) + 1)
}
