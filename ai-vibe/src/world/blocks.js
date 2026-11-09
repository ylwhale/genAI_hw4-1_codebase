// Block registry. Block ids are stored as bytes in the world volume.

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const WOOD = 4;
export const LEAVES = 5;

/**
 * Texture keys refer to procedural textures created in render/textures.js.
 * `cutout` blocks have see-through pixels, so faces next to them are kept.
 * `particle` colors are used for the block-break burst.
 */
export const BLOCKS = {
  [GRASS]: {
    id: GRASS,
    name: 'Grass',
    faces: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
    particle: ['#5b9e3a', '#7a5434', '#6fb348'],
  },
  [DIRT]: {
    id: DIRT,
    name: 'Dirt',
    faces: { top: 'dirt', side: 'dirt', bottom: 'dirt' },
    particle: ['#7a5434', '#8d6440', '#5f4128'],
  },
  [STONE]: {
    id: STONE,
    name: 'Stone',
    faces: { top: 'stone', side: 'stone', bottom: 'stone' },
    particle: ['#8a8d90', '#6e7175', '#a3a6a8'],
  },
  [WOOD]: {
    id: WOOD,
    name: 'Wood',
    faces: { top: 'log_top', side: 'log_side', bottom: 'log_top' },
    particle: ['#6b4a2b', '#8a6a43', '#4f3620'],
  },
  [LEAVES]: {
    id: LEAVES,
    name: 'Leaves',
    faces: { top: 'leaves', side: 'leaves', bottom: 'leaves' },
    cutout: true,
    particle: ['#3f8a2e', '#5aa83c', '#2f6e24'],
  },
};

/** The five blocks available in the hotbar, in slot order (keys 1–5). */
export const HOTBAR_BLOCKS = [GRASS, DIRT, STONE, WOOD, LEAVES];

export function isValidBlockId(id) {
  return Number.isInteger(id) && (id === AIR || Object.prototype.hasOwnProperty.call(BLOCKS, id));
}

export function isCutout(id) {
  return id !== AIR && BLOCKS[id]?.cutout === true;
}
