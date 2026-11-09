import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { AIR, STONE } from '../src/world/blocks.js';
import { Player } from '../src/player/Player.js';
import { PHYSICS, PLAYER } from '../src/config.js';

const IDLE = { forward: 0, strafe: 0, jump: false };

/** A flat test world: stone up to y = 4 (ground top at y = 5). */
function flatWorld() {
  const w = new World();
  w.blocks.fill(AIR);
  for (let y = 0; y <= 4; y++) {
    for (let z = 0; z < w.size; z++) for (let x = 0; x < w.size; x++) w.blocks[w.index(x, y, z)] = STONE;
  }
  w.base.set(w.blocks);
  return w;
}

function simulate(player, seconds, input = IDLE) {
  const steps = Math.round(seconds / PHYSICS.STEP);
  for (let i = 0; i < steps; i++) player.step(PHYSICS.STEP, input);
}

test('gravity pulls the player down and they land on the ground', () => {
  const w = flatWorld();
  const p = new Player(w);
  p.spawn({ x: 10.5, y: 12, z: 10.5 });
  simulate(p, 0.2);
  assert.ok(p.position.y < 12, 'falling');
  simulate(p, 3);
  assert.ok(Math.abs(p.position.y - 5) < 0.01, `landed at ${p.position.y}`);
  assert.equal(p.onGround, true);
});

test('player never falls through the terrain, even at terminal velocity', () => {
  const w = flatWorld();
  const p = new Player(w);
  p.spawn({ x: 7.5, y: w.height - 2, z: 7.5 });
  simulate(p, 10);
  assert.ok(p.position.y >= 5 - 1e-6, `y=${p.position.y}`);
  assert.equal(p.collidesAt(), false);

  // Standing still for a long time stays stable.
  const y = p.position.y;
  simulate(p, 20);
  assert.ok(Math.abs(p.position.y - y) < 1e-6);
});

test('jumping works only when grounded and reaches ~1.3 blocks', () => {
  const w = flatWorld();
  const p = new Player(w);
  p.spawn({ x: 10.5, y: 5, z: 10.5 });
  simulate(p, 0.5);
  assert.equal(p.onGround, true);

  let peak = p.position.y;
  p.step(PHYSICS.STEP, { ...IDLE, jump: true });
  assert.ok(p.velocity.y > 0, 'jump started');
  for (let i = 0; i < 120; i++) {
    p.step(PHYSICS.STEP, IDLE);
    peak = Math.max(peak, p.position.y);
  }
  const height = peak - 5;
  assert.ok(height > 1.1 && height < 1.5, `jump height ${height}`);
});

test('holding jump in the air never adds upward velocity mid-air', () => {
  const w = flatWorld();
  const p = new Player(w);
  p.spawn({ x: 10.5, y: 5, z: 10.5 });
  simulate(p, 0.3);
  const jump = { ...IDLE, jump: true };
  let midAirBoosts = 0;
  for (let i = 0; i < 600; i++) {
    const grounded = p.onGround;
    const vy = p.velocity.y;
    p.step(PHYSICS.STEP, jump);
    // Landing zeroes a negative velocity; only a positive gain counts as a jump.
    if (!grounded && p.velocity.y > Math.max(vy, 0) + 1e-9) midAirBoosts++;
  }
  assert.equal(midAirBoosts, 0);
});

test('walking into a wall is blocked; the player cannot walk through solid blocks', () => {
  const w = flatWorld();
  // Wall at x = 14 two blocks high.
  for (let z = 0; z < w.size; z++) {
    w.setBlock(14, 5, z, STONE);
    w.setBlock(14, 6, z, STONE);
  }
  const p = new Player(w);
  p.spawn({ x: 10.5, y: 5, z: 10.5 }, -Math.PI / 2); // facing +X
  simulate(p, 3, { forward: 1, strafe: 0, jump: false });
  assert.ok(p.position.x <= 14 - PLAYER.WIDTH / 2 + 1e-3, `x=${p.position.x}`);
  assert.ok(p.position.x > 13.5, 'walked up to the wall');
  assert.equal(p.collidesAt(), false);

  // Even jumping against a 2-high wall does not get through.
  simulate(p, 3, { forward: 1, strafe: 0, jump: true });
  assert.ok(p.position.x <= 14 - PLAYER.WIDTH / 2 + 1e-3);
});

test('a one-block step can be climbed by jumping', () => {
  const w = flatWorld();
  for (let z = 0; z < w.size; z++) w.setBlock(14, 5, z, STONE);
  const p = new Player(w);
  p.spawn({ x: 12.5, y: 5, z: 10.5 }, -Math.PI / 2);
  simulate(p, 3, { forward: 1, strafe: 0, jump: true });
  assert.ok(p.position.x > 14, `climbed: x=${p.position.x}`);
});

test('ceilings stop upward motion', () => {
  const w = flatWorld();
  w.setBlock(10, 7, 10, STONE); // 2 blocks of headroom: jump hits the ceiling
  const p = new Player(w);
  p.spawn({ x: 10.5, y: 5, z: 10.5 });
  simulate(p, 0.3);
  let peak = 0;
  p.step(PHYSICS.STEP, { ...IDLE, jump: true });
  for (let i = 0; i < 100; i++) {
    p.step(PHYSICS.STEP, IDLE);
    peak = Math.max(peak, p.position.y + PLAYER.HEIGHT);
  }
  assert.ok(peak <= 7 + 1e-6, `head peak ${peak}`);
  assert.equal(p.collidesAt(), false);
});

test('the player cannot leave the 32 x 32 world', () => {
  const w = flatWorld();
  const p = new Player(w);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    p.spawn({ x: 16.5, y: 5, z: 16.5 }, yaw);
    simulate(p, 12, { forward: 1, strafe: 0, jump: true });
    const { x, z } = p.position;
    assert.ok(x >= PLAYER.WIDTH / 2 - 1e-6 && x <= w.size - PLAYER.WIDTH / 2 + 1e-6, `x=${x}`);
    assert.ok(z >= PLAYER.WIDTH / 2 - 1e-6 && z <= w.size - PLAYER.WIDTH / 2 + 1e-6, `z=${z}`);
    assert.ok(p.position.y >= 5 - 1e-6);
  }
});

test('if the bottom layer is dug out the player still stands on the rock base', () => {
  const w = flatWorld();
  for (let y = 0; y <= 4; y++) w.setBlock(10, y, 10, AIR);
  const p = new Player(w);
  p.spawn({ x: 10.5, y: 5, z: 10.5 });
  simulate(p, 3);
  assert.ok(Math.abs(p.position.y) < 0.01, `y=${p.position.y}`);
});

test('a player embedded in a block is pushed out instead of getting stuck', () => {
  const w = flatWorld();
  const p = new Player(w);
  p.spawn({ x: 10.5, y: 5, z: 10.5 });
  w.blocks[w.index(10, 5, 10)] = STONE; // bypass placement rules on purpose
  simulate(p, 0.5);
  assert.equal(p.collidesAt(), false);
});

test('unstick frees a slightly embedded player with a tiny nudge, not a teleport', () => {
  const w = flatWorld();
  for (let y = 5; y <= 20; y++) w.setBlock(11, y, 10, STONE); // tall column beside the player
  const p = new Player(w);
  p.spawn({ x: 10.5, y: 5, z: 10.5 });
  p.position.x = 10.7005; // 0.5 mm inside the column
  assert.equal(p.collidesAt(), true);
  p.step(PHYSICS.STEP, IDLE);
  assert.equal(p.collidesAt(), false);
  assert.ok(p.position.y < 5.01, `stayed on the ground (y=${p.position.y})`);
  assert.ok(Math.abs(p.position.x - 10.7) < 0.01, `x=${p.position.x}`);
});
