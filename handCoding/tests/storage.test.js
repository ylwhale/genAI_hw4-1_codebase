import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld, blockIndex } from '../src/world.js';
import { SAVE_KEY, loadWorldEdits, saveWorldEdits, resetWorld } from '../src/storage.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
}

test('only edits are saved and restored into a freshly generated world', () => {
  const storage = memoryStorage(), world = new VoxelWorld();
  assert.equal(loadWorldEdits(world, storage).status, 'empty');
  world.set(16, world.spawn.y - 1, 25, 0);
  world.set(14, world.spawn.y + 2, 25, 4);
  assert.equal(saveWorldEdits(world, storage).count, 2);
  const fresh = new VoxelWorld();
  assert.equal(loadWorldEdits(fresh, storage).status, 'restored');
  assert.deepEqual(fresh.blocks, world.blocks);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).edits.length, 2);
});

test('reset removes saved edits and restores the original deterministic world', () => {
  const storage = memoryStorage(), world = new VoxelWorld();
  world.set(16, world.spawn.y + 1, 25, 5);
  saveWorldEdits(world, storage);
  assert.equal(resetWorld(world, storage).ok, true);
  assert.equal(storage.getItem(SAVE_KEY), null);
  assert.deepEqual(world.blocks, new VoxelWorld().blocks);
});

test('malformed, out-of-bounds, mixed-validity, and duplicate saves apply no partial edits', () => {
  const storage = memoryStorage(), world = new VoxelWorld();
  const original = world.blocks.slice();
  const payload = edits => JSON.stringify({ version: 1, seed: 42, size: 32, height: 48, edits });
  for (const raw of ['{broken', 'null', payload([[blockIndex(0, 0, 0), 0], [-1, 2]]), payload([[0, 2], [0, 3]]), payload([[0, 9]]), payload([[0.5, 1]])]) {
    storage.setItem(SAVE_KEY, raw);
    assert.equal(loadWorldEdits(world, storage).status, 'corrupt');
    assert.deepEqual(world.blocks, original);
  }
});

test('storage denial or quota errors do not crash play or in-memory reset', () => {
  const unavailable = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('denied'); } };
  const world = new VoxelWorld();
  assert.equal(loadWorldEdits(world, unavailable).status, 'unavailable');
  world.set(0, 0, 0, 0);
  assert.equal(saveWorldEdits(world, unavailable).ok, false);
  assert.equal(resetWorld(world, unavailable).ok, false);
  assert.deepEqual(world.blocks, world.original);
});
