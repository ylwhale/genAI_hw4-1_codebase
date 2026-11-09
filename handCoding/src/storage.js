import { SEED, SIZE, HEIGHT } from './world.js';

export const SAVE_KEY = 'voxel-grove:world:v1';

export function loadWorldEdits(world, storage, key = SAVE_KEY) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { status: 'empty', count: 0 };
    const data = JSON.parse(raw);
    if (data?.version !== 1 || data.seed !== SEED || data.size !== SIZE || data.height !== HEIGHT
      || !Array.isArray(data.edits) || data.edits.length > world.blocks.length) return { status: 'corrupt', count: 0 };
    // Validate the entire payload before applying any part of it.
    const seen = new Set();
    for (const entry of data.edits) {
      if (!Array.isArray(entry) || entry.length !== 2) return { status: 'corrupt', count: 0 };
      const [index, type] = entry;
      if (!Number.isInteger(index) || index < 0 || index >= world.blocks.length
        || !Number.isInteger(type) || type < 0 || type > 5 || seen.has(index)) return { status: 'corrupt', count: 0 };
      seen.add(index);
    }
    for (const [index, type] of data.edits) world.blocks[index] = type;
    return { status: 'restored', count: data.edits.length };
  } catch (error) {
    return { status: error instanceof SyntaxError ? 'corrupt' : 'unavailable', count: 0 };
  }
}

export function saveWorldEdits(world, storage, key = SAVE_KEY) {
  const edits = [];
  for (let i = 0; i < world.blocks.length; i++) if (world.blocks[i] !== world.original[i]) edits.push([i, world.blocks[i]]);
  try {
    storage.setItem(key, JSON.stringify({ version: 1, seed: SEED, size: SIZE, height: HEIGHT, edits }));
    return { ok: true, count: edits.length };
  } catch { return { ok: false, count: edits.length }; }
}

export function resetWorld(world, storage, key = SAVE_KEY) {
  world.blocks.set(world.original);
  try { storage.removeItem(key); return { ok: true }; }
  catch { return { ok: false }; }
}
