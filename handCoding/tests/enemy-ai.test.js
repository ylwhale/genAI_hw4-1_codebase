import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/world.js';
import { createEnemies, updateEnemies } from '../src/mobs.js';
import { collides } from '../src/physics.js';
import { clearVoxelLine } from '../src/visibility.js';

function fixture() {
  const world = new VoxelWorld(); world.blocks.fill(0); world.spawn.y = 1;
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) world.set(x, 0, z, 3);
  const enemy = createEnemies(world)[0];
  Object.assign(enemy, { x: 10.5, y: 1, z: 10.5, yaw: 0, wanderTime: 5, decisions: 1 });
  return { world, enemy, player: { x: 29, y: 1, z: 29 } };
}

test('distant enemies wander slowly and pause freezes all enemy state', () => {
  const { world, enemy, player } = fixture();
  updateEnemies(world, [enemy], player, 1);
  assert.equal(enemy.state, 'wander');
  assert.ok(Math.abs(enemy.z - 10.5 - 1.3 * 0.35) < 1e-8);
  assert.equal(collides(world, enemy), false);
  const before = structuredClone(enemy);
  updateEnemies(world, [enemy], player, 10, { active: false });
  assert.deepEqual(enemy, before);
});

test('attack range and 1.5-second cooldown gate damage; a wall blocks the attack path', () => {
  const { world, enemy, player } = fixture(); Object.assign(player, { x: 10.5, z: 11.5 });
  let hits = 0, damage = 0;
  const options = { onAttack(amount) { hits++; damage += amount; } };
  updateEnemies(world, [enemy], player, 0.01, options);
  assert.equal(enemy.state, 'attack'); assert.equal(hits, 1); assert.equal(damage, 10);
  updateEnemies(world, [enemy], player, 1.49, options); assert.equal(hits, 1);
  updateEnemies(world, [enemy], player, 0.02, options); assert.equal(hits, 2);
  Object.assign(enemy, { x: 10.65, z: 10.5, attackCooldown: 0 });
  Object.assign(player, { x: 12.3, z: 10.5 });
  world.set(11, 1, 10, 3); world.set(11, 2, 10, 3);
  updateEnemies(world, [enemy], player, 0.1, options);
  assert.equal(enemy.state, 'chase'); assert.equal(hits, 2);
  assert.equal(collides(world, enemy), false);
});

test('visibility checks stone, wood, leaves, and floors, and a fatal callback stops subsequent attacks', () => {
  const { world, enemy, player } = fixture();
  const from = { x: 10.5, y: 1.6, z: 10.5 }, to = { x: 12.5, y: 1.6, z: 10.5 };
  assert.equal(clearVoxelLine(world, from, to), true);
  assert.equal(clearVoxelLine(world, from, { ...from, y: 0.6 }), false);
  for (const type of [1, 3, 4, 5]) { world.set(11, 1, 10, type); assert.equal(clearVoxelLine(world, from, to), false); }
  world.set(11, 1, 10, 0);
  Object.assign(player, { x: 10.5, z: 11.5 });
  const second = { ...enemy, id: 1 };
  let hits = 0;
  updateEnemies(world, [enemy, second], player, 3, { onAttack() { hits++; return false; } });
  assert.equal(hits, 1);
});

test('enemies chase within ten units at their specified speed and stop at terrain', () => {
  for (const frames of [20, 60, 120]) {
    const { world, enemy, player } = fixture(); Object.assign(player, { x: 15.5, z: 10.5 });
    for (let i = 0; i < frames; i++) updateEnemies(world, [enemy], player, 1 / frames);
    assert.equal(enemy.state, 'chase');
    assert.ok(Math.abs(enemy.x - 11.8) < 1e-8);
    assert.equal(collides(world, enemy), false);
  }
  const { world, enemy, player } = fixture(); Object.assign(player, { x: 15, z: 10.5 });
  for (let y = 1; y < 4; y++) for (let z = 0; z < 32; z++) world.set(11, y, z, 4);
  updateEnemies(world, [enemy], player, 3);
  assert.equal(enemy.x, 11 - enemy.radius);
  assert.equal(collides(world, enemy), false);
});

test('enemy gravity and fixed substeps land safely even with a long update', () => {
  const { world, enemy, player } = fixture(); enemy.y = 20;
  updateEnemies(world, [enemy], player, 3);
  assert.equal(enemy.y, 1); assert.equal(enemy.grounded, true);
  assert.equal(collides(world, enemy), false);
});

test('both body sizes respect speed, attack damage, trees, and world edges at varied update rates', () => {
  for (const type of ['mossling', 'stoneguard']) for (const rate of [20, 60, 120]) {
    const { world, player } = fixture(), enemy = createEnemies(world).find(e => e.type === type);
    Object.assign(enemy, { x: 10.5, y: 1, z: 10.5, yaw: 0 });
    Object.assign(player, { x: 15.5, y: 1, z: 10.5 });
    for (let i = 0; i < rate; i++) updateEnemies(world, [enemy], player, 1 / rate);
    assert.ok(Math.abs(enemy.x - 10.5 - enemy.speed) < 1e-8);
    // Trees have the same solid occupancy contract as stone, including leaves.
    for (let y = 1; y < 4; y++) for (let z = 0; z < 32; z++) world.set(12, y, z, y === 3 ? 5 : 4);
    updateEnemies(world, [enemy], player, 4);
    assert.equal(enemy.x, 12 - enemy.radius); assert.equal(collides(world, enemy), false);
    Object.assign(enemy, { x: 31 - enemy.radius, y: 1, z: 25.5, attackCooldown: 0 });
    Object.assign(player, { x: 40, y: 1, z: 25.5 });
    updateEnemies(world, [enemy], player, 2);
    assert.ok(enemy.x <= 32 - enemy.radius); assert.equal(collides(world, enemy), false);
    Object.assign(player, { x: enemy.x - 1, y: 1, z: enemy.z });
    let received = 0;
    updateEnemies(world, [enemy], player, 0.01, { onAttack(amount) { received += amount; } });
    assert.equal(received, type === 'mossling' ? 10 : 15);
  }
});
