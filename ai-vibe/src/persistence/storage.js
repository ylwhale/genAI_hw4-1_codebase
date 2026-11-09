import { STORAGE_KEY, WORLD } from '../config.js';
import { isValidBlockId } from '../world/blocks.js';

// World edits are stored as a compact diff against the generated terrain:
//   { version: 1, seed, size, height, edits: [[blockIndex, blockId], ...] }
// Loading validates every field so corrupt or foreign data can never crash
// the game; anything unusable is ignored and the fresh world is used instead.

const FORMAT_VERSION = 1;

/**
 * Returns window.localStorage, or null where it cannot even be accessed
 * (some privacy modes throw on access). Reads and deletes still work when the
 * storage is full, so no test write is done here.
 */
export function getStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** True if a test value can be written (false when storage is full or blocked). */
export function canWrite(storage = getStorage()) {
  if (!storage) return false;
  try {
    const probe = '__voxel_grove_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads saved edits.
 * @returns {{ status: 'empty'|'ok'|'corrupt'|'unavailable', edits: Array, dropped: number }}
 */
export function loadEdits(storage = getStorage(), world = WORLD) {
  if (!storage) return { status: 'unavailable', edits: [], dropped: 0 };

  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { status: 'unavailable', edits: [], dropped: 0 };
  }
  if (raw === null || raw === undefined) return { status: 'empty', edits: [], dropped: 0 };

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', edits: [], dropped: 0 };
  }

  if (
    !data || typeof data !== 'object' || Array.isArray(data) ||
    data.version !== FORMAT_VERSION ||
    data.seed !== world.SEED || data.size !== world.SIZE || data.height !== world.HEIGHT ||
    !Array.isArray(data.edits)
  ) {
    return { status: 'corrupt', edits: [], dropped: 0 };
  }

  const volume = world.SIZE * world.SIZE * world.HEIGHT;
  const seen = new Set();
  const edits = [];
  let dropped = 0;
  for (const entry of data.edits) {
    const valid =
      Array.isArray(entry) && entry.length === 2 &&
      Number.isInteger(entry[0]) && entry[0] >= 0 && entry[0] < volume &&
      isValidBlockId(entry[1]) && !seen.has(entry[0]);
    if (!valid) {
      dropped++;
      continue;
    }
    seen.add(entry[0]);
    edits.push([entry[0], entry[1]]);
  }
  return { status: 'ok', edits, dropped };
}

/** Writes the full edit list. Returns true on success. */
export function saveEdits(edits, storage = getStorage(), world = WORLD) {
  if (!storage) return false;
  const payload = {
    version: FORMAT_VERSION,
    seed: world.SEED,
    size: world.SIZE,
    height: world.HEIGHT,
    edits,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false; // quota exceeded or storage disabled
  }
}

/** Removes any saved world. Returns true on success. */
export function clearSave(storage = getStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
