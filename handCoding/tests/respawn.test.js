import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/world.js';
import { createPlayer, collides, STEP } from '../src/physics.js';
import { createEnemies, updateEnemies } from '../src/mobs.js';
import { createHealth, damagePlayer } from '../src/health.js';
import { respawnPlayer } from '../src/respawn.js';
import { SAVE_KEY, saveWorldEdits, loadWorldEdits } from '../src/storage.js';
import { createInteractionController } from '../src/interaction-controller.js';

test('lethal attacks stop the same simulation step and pending construction cancels without committing', () => {
  const world = new VoxelWorld(); const player = createPlayer(world.spawn);
  const enemies = createEnemies(world), health = createHealth(); health.current = 5;
  world.set(12, 40, 12, 3);
  const target = { x: 12, y: 40, z: 12, distance: 2, normal: { x: 0, y: 1, z: 0 } };
  const controller = createInteractionController({ world, player });
  assert.equal(controller.start(target, 'place', 4).ok, true);
  controller.update(0.5, target);
  const blocks = world.blocks.slice();
  let hits = 0;
  // Use the actual nearby open clearing, avoiding generated terrain along the short attack path.
  enemies.forEach(enemy => Object.assign(enemy, { x: player.x, y: player.y, z: player.z - 1 }));
  updateEnemies(world, enemies, player, STEP, { onAttack(amount) {
    hits++; const result = damagePlayer(health, amount);
    if (result.killed) controller.cancel('Player died');
    return !health.dead;
  } });
  assert.equal(health.current, 0); assert.equal(hits, 1); assert.equal(controller.active, null);
  controller.update(1, target, false);
  const frozen = structuredClone(enemies);
  updateEnemies(world, enemies, player, 2, { active: !health.dead });
  assert.deepEqual(enemies, frozen); assert.deepEqual(world.blocks, blocks);
});

test('respawn restores safe entities and full health while preserving saved edits byte for byte', () => {
  const world = new VoxelWorld(); const player = createPlayer(world.spawn);
  const enemies = createEnemies(world), refs = enemies.slice(), health = createHealth();
  const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  world.set(Math.floor(world.spawn.x), world.spawn.y, Math.floor(world.spawn.z), 4);
  world.set(12, 35, 12, 5); saveWorldEdits(world, storage);
  const saved = storage.getItem(SAVE_KEY), blocks = world.blocks.slice();
  damagePlayer(health, 100); Object.assign(player, { x: 0.3, y: 30, yaw: 2, velocityY: -20 });
  enemies.forEach(enemy => Object.assign(enemy, { health: 0, x: 1, y: 40, state: 'dead', hitFlash: 0.2, attackCooldown: 1.2 }));
  respawnPlayer(world, player, health, enemies);
  assert.equal(health.current, 100); assert.equal(health.dead, false);
  assert.equal(player.velocityY, 0); assert.equal(player.yaw, 0); assert.equal(collides(world, player), false);
  assert.equal(enemies.length, 4);
  enemies.forEach((enemy, i) => {
    assert.equal(enemy, refs[i]); assert.equal(enemy.health, enemy.maxHealth); assert.equal(enemy.state, 'wander');
    assert.equal(enemy.attackCooldown, 0); assert.equal(enemy.hitFlash, 0);
    assert.equal(collides(world, enemy), false);
    assert.ok(Math.hypot(enemy.x - player.x, enemy.z - player.z) >= 8);
  });
  assert.deepEqual(world.blocks, blocks); assert.equal(storage.getItem(SAVE_KEY), saved);
  const restored = new VoxelWorld(); loadWorldEdits(restored, storage);
  assert.deepEqual(restored.blocks, blocks);
});
