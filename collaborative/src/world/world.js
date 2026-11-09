// Block (x, y, z) occupies [x, x+1) x [y, y+1) x [z, z+1); +Y is up.

import { WORLD_HEIGHT, WORLD_SIZE } from '../config.js'
import { BLOCK, isSolidBlock, isValidBlockId } from './blocks.js'

// Flat-array index shared with the generator and persistence (Y-major layers).
export function voxelIndex(size, x, y, z) {
  return (y * size + z) * size + x
}

export function createWorld({ size = WORLD_SIZE, height = WORLD_HEIGHT } = {}) {
  const data = new Uint8Array(size * size * height)
  const listeners = new Set()

  function index(x, y, z) {
    return voxelIndex(size, x, y, z)
  }

  function inBounds(x, y, z) {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      Number.isInteger(z) &&
      x >= 0 &&
      x < size &&
      z >= 0 &&
      z < size &&
      y >= 0 &&
      y < height
    )
  }

  function getBlock(x, y, z) {
    return inBounds(x, y, z) ? data[index(x, y, z)] : BLOCK.AIR
  }

  function emit(event) {
    for (const listener of [...listeners]) listener(event)
  }

  // Returns true when the stored block actually changed.
  function setBlock(x, y, z, id) {
    if (!inBounds(x, y, z) || !isValidBlockId(id)) return false
    const i = index(x, y, z)
    const previous = data[i]
    if (previous === id) return false
    data[i] = id
    emit({ type: 'block', x, y, z, previous, next: id })
    return true
  }

  function isSolid(x, y, z) {
    return isSolidBlock(getBlock(x, y, z))
  }

  // Collision view of the world: outside the horizontal bounds and below the
  // floor count as solid walls, so nothing can leave the island; open sky above.
  function isSolidForCollision(x, y, z) {
    if (x < 0 || x >= size || z < 0 || z >= size || y < 0) return true
    if (y >= height) return false
    return isSolidBlock(data[index(x, y, z)])
  }

  // Highest solid y in a column, or -1 for an empty / out-of-bounds column.
  function surfaceHeight(x, z) {
    if (!inBounds(x, 0, z)) return -1
    for (let y = height - 1; y >= 0; y--) {
      if (isSolidBlock(data[index(x, y, z)])) return y
    }
    return -1
  }

  // Replace every block at once (generation, reset, loading). Emits one
  // 'reset' event instead of thousands of block events.
  function replaceAll(source) {
    if (source.length !== data.length) throw new Error('World data size mismatch')
    data.set(source)
    emit({ type: 'reset' })
  }

  function snapshot() {
    return data.slice()
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    size,
    height,
    inBounds,
    getBlock,
    setBlock,
    isSolid,
    isSolidForCollision,
    surfaceHeight,
    index,
    replaceAll,
    snapshot,
    subscribe,
  }
}
