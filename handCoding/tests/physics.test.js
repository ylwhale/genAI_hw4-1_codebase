import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/world.js';
import { createPlayer, stepPlayer, collides, STEP, PLAYER_RADIUS, findSafeSpawn } from '../src/physics.js';

const idle = { forward: false, backward: false, left: false, right: false, jump: false };
function simulate(world, player, frames, input = idle) {
  for (let i = 0; i < frames; i++) stepPlayer(world, player, input, STEP);
}
function flat() {
  const world = new VoxelWorld();
  world.blocks.fill(0);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) world.set(x, 0, z, 3);
  return world;
}

test('gravity lands on terrain and remains stable', () => {
  const world = new VoxelWorld(), player = createPlayer({ ...world.spawn, y: 30 });
  simulate(world, player, 600);
  assert.equal(player.y, world.spawn.y);
  assert.equal(player.grounded, true);
  assert.equal(collides(world, player), false);
});

test('jump rises, rejects an airborne jump, then lands', () => {
  const world = flat(), player = createPlayer({ x: 5.5, y: 1, z: 5.5 });
  simulate(world, player, 2);
  stepPlayer(world, player, { ...idle, jump: true });
  assert.ok(player.y > 1);
  simulate(world, player, 12);
  const previous = player.velocityY;
  stepPlayer(world, player, { ...idle, jump: true });
  assert.ok(player.velocityY < previous);
  simulate(world, player, 240);
  assert.equal(player.y, 1);
  assert.equal(player.grounded, true);
});

test('walls block movement, diagonal movement slides, and horizontal bounds hold', () => {
  const world = flat(), player = createPlayer({ x: 5.5, y: 1, z: 5.5 });
  for (let y = 1; y <= 3; y++) for (let z = 0; z < 32; z++) world.set(7, y, z, 3);
  simulate(world, player, 180, { ...idle, right: true });
  assert.ok(Math.abs(player.x - (7 - PLAYER_RADIUS)) < 0.0001);
  const z = player.z;
  simulate(world, player, 60, { ...idle, forward: true, right: true });
  assert.ok(player.z < z);
  assert.equal(collides(world, player), false);
  simulate(world, player, 1200, { ...idle, left: true });
  assert.equal(player.x, PLAYER_RADIUS);
});

test('ceiling stops upward motion and saved terrain cannot obstruct spawn', () => {
  const world = flat(), player = createPlayer({ x: 5.5, y: 1, z: 5.5 });
  world.set(5, 3, 5, 3);
  simulate(world, player, 2);
  stepPlayer(world, player, { ...idle, jump: true });
  simulate(world, player, 15);
  assert.ok(player.y <= 1.25);
  assert.equal(collides(world, player), false);
  world.set(16, world.spawn.y, 25, 3);
  assert.equal(collides(world, createPlayer(findSafeSpawn(world))), false);
});

test('player can jump onto a one-block ledge and cannot walk up it without jumping', () => {
  const world = flat(), player = createPlayer({ x: 5.5, y: 1, z: 5.5 });
  for (let x = 6; x < 10; x++) world.set(x, 1, 5, 3);
  simulate(world, player, 60, { ...idle, right: true });
  assert.equal(player.x, 6 - PLAYER_RADIUS);
  stepPlayer(world, player, { ...idle, jump: true, right: true });
  simulate(world, player, 45, { ...idle, right: true });
  simulate(world, player, 120);
  assert.ok(player.x > 6.3);
  assert.equal(player.y, 2);
  assert.equal(player.grounded, true);
  assert.equal(collides(world, player), false);
});

test('solid bottom and each horizontal edge contain long-running movement', () => {
  const world = flat(); world.blocks.fill(0);
  const directions = [
    ['left', 'x', PLAYER_RADIUS], ['right', 'x', 32 - PLAYER_RADIUS],
    ['forward', 'z', PLAYER_RADIUS], ['backward', 'z', 32 - PLAYER_RADIUS],
  ];
  for (const [key, axis, boundary] of directions) {
    const player = createPlayer({ x: 16, y: 10, z: 16 });
    simulate(world, player, 1800, { ...idle, [key]: true });
    assert.equal(player[axis], boundary);
    assert.equal(player.y, 0);
    assert.equal(collides(world, player), false);
  }
});
