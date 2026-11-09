import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/world.js';
import { createEnemies, enemyOccupiesBlock } from '../src/mobs.js';
import { createInteractionController } from '../src/interaction-controller.js';

test('construction rejects an enemy body and cancels if an enemy enters a pending preview', () => {
  const world = new VoxelWorld(); world.blocks.fill(0); world.set(10, 0, 10, 1);
  const player = { x: 15.5, y: 1, z: 10.5 }, enemies = createEnemies(world);
  const enemy = enemies[0]; Object.assign(enemy, { x: 10.5, y: 1, z: 10.5 });
  const target = { x: 10, y: 0, z: 10, distance: 5, normal: { x: 0, y: 1, z: 0 } };
  let commits = 0;
  const controller = createInteractionController({ world, player, canPlace: cell => !enemyOccupiesBlock(enemies, cell), onComplete() { commits++; } });
  assert.equal(controller.start(target, 'place', 4).ok, false);
  enemy.x = 8;
  assert.equal(controller.start(target, 'place', 4).ok, true);
  controller.update(0.75, target);
  enemy.x = 10.5;
  controller.update(0.25, target);
  assert.equal(controller.active, null); assert.equal(commits, 0); assert.equal(world.get(10, 1, 10), 0);
  enemy.health = 0;
  assert.equal(controller.start(target, 'place', 4).ok, true);
  controller.update(1, target); assert.equal(commits, 1);
});
