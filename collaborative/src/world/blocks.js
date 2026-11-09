// Block type registry. Ids are stored in the world's Uint8Array and in saved
// edits, so existing ids must never be renumbered.

export const BLOCK = Object.freeze({
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WOOD: 4,
  LEAVES: 5,
})

// `particle` is the representative colour used for break/build particles and
// UI swatches; textures are generated separately in render/textures.js.
const DEFINITIONS = [
  { id: BLOCK.AIR, key: 'air', name: 'Air', solid: false, particle: 0x000000 },
  { id: BLOCK.GRASS, key: 'grass', name: 'Grass', solid: true, particle: 0x6aa84f },
  { id: BLOCK.DIRT, key: 'dirt', name: 'Dirt', solid: true, particle: 0x8b5a3c },
  { id: BLOCK.STONE, key: 'stone', name: 'Stone', solid: true, particle: 0x8d9399 },
  { id: BLOCK.WOOD, key: 'wood', name: 'Wood', solid: true, particle: 0x8a6239 },
  { id: BLOCK.LEAVES, key: 'leaves', name: 'Leaves', solid: true, particle: 0x3f8f3a },
]

const BY_ID = new Map(DEFINITIONS.map((definition) => [definition.id, Object.freeze(definition)]))

// (SPEC) the five selectable hotbar blocks, in slot order 1-5.
export const HOTBAR_BLOCKS = Object.freeze([BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.WOOD, BLOCK.LEAVES])

export function getBlockType(id) {
  return BY_ID.get(id) ?? null
}

export function isValidBlockId(id) {
  return Number.isInteger(id) && BY_ID.has(id)
}

export function isSolidBlock(id) {
  return BY_ID.get(id)?.solid ?? false
}
