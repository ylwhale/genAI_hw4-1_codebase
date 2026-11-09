// Shared test fixtures: small hand-built worlds for deterministic checks.

import { createWorld } from '../src/world/world.js'
import { BLOCK } from '../src/world/blocks.js'

// A flat world with solid ground filling y = 0..groundTop (inclusive).
export function createFlatWorld({ size = 16, height = 16, groundTop = 3, block = BLOCK.STONE } = {}) {
  const world = createWorld({ size, height })
  for (let y = 0; y <= groundTop; y++) {
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) world.setBlock(x, y, z, block)
    }
  }
  return world
}

export function createBody(x, y, z, { width = 0.6, height = 1.8 } = {}) {
  return { position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 }, width, height, onGround: false }
}

export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  }
}
