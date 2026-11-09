import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VoxelWorld, SIZE, HEIGHT, inBounds } from '../src/world.js';

test('seed 42 generates exactly the same world and all five block types', () => {
  const a = new VoxelWorld(), b = new VoxelWorld();
  assert.deepEqual(a.blocks, b.blocks);
  assert.equal(SIZE, 32);
  assert.equal(a.blocks.length, 32 * 32 * HEIGHT);
  assert.deepEqual([...new Set(a.blocks)].sort(), [0, 1, 2, 3, 4, 5]);
  assert.equal(createHash('sha256').update(a.blocks).digest('hex'), 'ec25728208132ecfafbb22168af24ca20ecb222711995f874cb333b60b378945');
  assert.notDeepEqual(a.blocks, new VoxelWorld(43).blocks);
});

test('terrain has hills and the spawn has supporting ground and clear headroom', () => {
  const world = new VoxelWorld();
  const { x, y, z } = world.spawn;
  assert.equal(world.get(Math.floor(x), y - 1, Math.floor(z)), 1);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    assert.equal(world.get(Math.floor(x) + dx, y, Math.floor(z) + dz), 0);
    assert.equal(world.get(Math.floor(x) + dx, y + 1, Math.floor(z) + dz), 0);
  }
  const heights = [];
  for (let x = 0; x < SIZE; x++) heights.push(world.surface(x, 0));
  assert.ok(Math.max(...heights) - Math.min(...heights) >= 2);
});

test('invalid coordinates and block types leave data unchanged', () => {
  const world = new VoxelWorld(), before = world.blocks.slice();
  for (const p of [[-1, 2, 0], [32, 2, 0], [0, -1, 0], [0, HEIGHT, 0], [0, 2, 32], [0.5, 2, 0]]) {
    assert.equal(inBounds(...p), false);
    assert.equal(world.set(...p, 1), false);
  }
  assert.equal(world.set(0, 2, 0, 6), false);
  assert.deepEqual(world.blocks, before);
});
