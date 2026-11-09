import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { AIR, GRASS, DIRT, STONE, WOOD, LEAVES } from '../src/world/blocks.js';
import { Player } from '../src/player/Player.js';

function checksum(blocks) {
  let h = 2166136261;
  for (let i = 0; i < blocks.length; i++) h = Math.imul(h ^ blocks[i], 16777619);
  return h >>> 0;
}

test('world is 32 x 32 with valid horizontal coordinates 0..31', () => {
  const w = new World();
  assert.equal(w.size, 32);
  assert.ok(w.inBounds(0, 0, 0));
  assert.ok(w.inBounds(31, w.height - 1, 31));
  assert.ok(!w.inBounds(-1, 5, 0));
  assert.ok(!w.inBounds(32, 5, 0));
  assert.ok(!w.inBounds(0, 5, 32));
  assert.ok(!w.inBounds(0, -1, 0));
  assert.ok(!w.inBounds(0, w.height, 0));
  assert.ok(!w.inBounds(1.5, 5, 0), 'non-integer coordinates are rejected');
});

test('terrain is deterministic for seed 42', () => {
  const a = new World();
  const b = new World();
  assert.equal(a.seed, 42);
  assert.equal(checksum(a.blocks), checksum(b.blocks));
  assert.deepEqual(a.blocks, b.blocks);
});

test('terrain contains hills, grass, dirt, stone and trees', () => {
  const w = new World();
  const counts = {};
  for (const id of w.blocks) counts[id] = (counts[id] || 0) + 1;
  for (const id of [GRASS, DIRT, STONE, WOOD, LEAVES]) assert.ok(counts[id] > 0, `block ${id} present`);

  let min = Infinity;
  let max = -Infinity;
  for (let z = 0; z < w.size; z++) {
    for (let x = 0; x < w.size; x++) {
      // ground height ignoring trees
      let y = w.topY(x, z);
      while (y > 0 && (w.getBlock(x, y, z) === LEAVES || w.getBlock(x, y, z) === WOOD)) y--;
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
  }
  assert.ok(max - min >= 8, `terrain has hills (relief ${max - min})`);

  // Trees: trunks of wood topped by leaves.
  let trunks = 0;
  for (let z = 0; z < w.size; z++) {
    for (let x = 0; x < w.size; x++) {
      for (let y = 1; y < w.height; y++) {
        if (w.getBlock(x, y, z) === WOOD && w.getBlock(x, y - 1, z) === DIRT) trunks++;
      }
    }
  }
  assert.ok(trunks >= 5, `found ${trunks} trees`);
});

test('spawn point is safe: on grass, clear of terrain and trees', () => {
  const w = new World();
  const spawn = w.findSpawnPoint();
  const bx = Math.floor(spawn.x);
  const bz = Math.floor(spawn.z);
  assert.equal(w.getBlock(bx, spawn.y - 1, bz), GRASS);
  for (let y = spawn.y; y < w.height; y++) assert.equal(w.getBlock(bx, y, bz), AIR, `open sky at y=${y}`);
  const p = new Player(w);
  p.spawn(spawn);
  assert.equal(p.collidesAt(), false);
});

test('spawn adapts when the spawn column has been built on', () => {
  const w = new World();
  const first = w.findSpawnPoint();
  const bx = Math.floor(first.x);
  const bz = Math.floor(first.z);
  for (let y = first.y; y < first.y + 3; y++) w.setBlock(bx, y, bz, STONE);
  const p = new Player(w);
  p.spawn(w.findSpawnPoint());
  assert.equal(p.collidesAt(), false);
});

test('setBlock rejects out-of-bounds coordinates and invalid ids', () => {
  const w = new World();
  const before = checksum(w.blocks);
  assert.equal(w.setBlock(-1, 10, 0, STONE), false);
  assert.equal(w.setBlock(32, 10, 0, STONE), false);
  assert.equal(w.setBlock(0, 10, 32, STONE), false);
  assert.equal(w.setBlock(0, w.height, 0, STONE), false);
  assert.equal(w.setBlock(0, -1, 0, STONE), false);
  assert.equal(w.setBlock(5, 30, 5, 99), false);
  assert.equal(w.setBlock(5, 30, 5, 2.5), false);
  assert.equal(checksum(w.blocks), before);
});

test('edits diff, applyEdits validation and reset to the original world', () => {
  const w = new World();
  const original = checksum(w.blocks);
  w.setBlock(3, 30, 3, STONE);
  const top = w.topY(10, 10);
  w.setBlock(10, top, 10, AIR);
  const edits = w.getEdits();
  assert.equal(edits.length, 2);

  const w2 = new World();
  const applied = w2.applyEdits([...edits, [-5, 1], [1e9, 1], [10, 77], 'junk', null, [1, 2, 3]]);
  assert.equal(applied, 2);
  assert.deepEqual(w2.blocks, w.blocks);

  w.resetToBase();
  assert.equal(checksum(w.blocks), original);
  assert.equal(w.getEdits().length, 0);

  const fresh = new World();
  assert.equal(checksum(fresh.blocks), original, 'regenerating gives the same initial terrain');
});
