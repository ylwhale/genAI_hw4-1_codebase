import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEdits, saveEdits, clearSave } from '../src/persistence/storage.js';
import { STORAGE_KEY } from '../src/config.js';
import { World } from '../src/world/World.js';
import { STONE, AIR } from '../src/world/blocks.js';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

test('edits round-trip through storage and rebuild the same world', () => {
  const storage = new MemoryStorage();
  const w = new World();
  w.setBlock(4, 30, 4, STONE);
  w.setBlock(16, w.topY(16, 16), 16, AIR);
  assert.equal(saveEdits(w.getEdits(), storage), true);

  const loaded = loadEdits(storage);
  assert.equal(loaded.status, 'ok');
  const w2 = new World();
  w2.applyEdits(loaded.edits);
  assert.deepEqual(w2.blocks, w.blocks);
});

test('missing save is reported as empty', () => {
  assert.equal(loadEdits(new MemoryStorage()).status, 'empty');
});

test('corrupt or foreign data never throws', () => {
  const cases = [
    '{not json',
    '"just a string"',
    'null',
    '[]',
    '42',
    JSON.stringify({ version: 2, seed: 42, size: 32, height: 48, edits: [] }),
    JSON.stringify({ version: 1, seed: 7, size: 32, height: 48, edits: [] }),
    JSON.stringify({ version: 1, seed: 42, size: 32, height: 48, edits: 'nope' }),
    JSON.stringify({ version: 1, seed: 42, size: 16, height: 48, edits: [] }),
  ];
  for (const raw of cases) {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, raw);
    const r = loadEdits(storage);
    assert.equal(r.status, 'corrupt', raw);
    assert.deepEqual(r.edits, []);
  }
});

test('invalid entries inside an otherwise valid save are dropped', () => {
  const storage = new MemoryStorage();
  const volume = 32 * 32 * 48;
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1, seed: 42, size: 32, height: 48,
      edits: [[5, 3], [5, 1], [-1, 1], [volume, 1], [7, 99], [8, 1.5], [1.5, 1], 'x', null, [9], [10, 0]],
    }),
  );
  const r = loadEdits(storage);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.edits, [[5, 3], [10, 0]]);
  assert.equal(r.dropped, 9);
});

test('storage failures are handled gracefully', () => {
  const throwing = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  assert.equal(loadEdits(throwing).status, 'unavailable');
  assert.equal(saveEdits([[1, 1]], throwing), false);
  assert.equal(clearSave(throwing), false);
  assert.equal(loadEdits(null).status, 'unavailable');
  assert.equal(saveEdits([], null), false);
});

test('clearSave removes saved edits so the original world loads', () => {
  const storage = new MemoryStorage();
  saveEdits([[100, 3]], storage);
  assert.equal(clearSave(storage), true);
  assert.equal(loadEdits(storage).status, 'empty');
});
