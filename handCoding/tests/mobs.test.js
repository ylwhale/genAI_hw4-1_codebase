import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld } from '../src/world.js';
import { collides } from '../src/physics.js';
import { createEnemies, resetEnemies, MOB_TYPES } from '../src/mobs.js';
import { createMobView } from '../src/mob-view.js';

test('three Mosslings and one Stoneguard spawn deterministically with correct stats and clear volumes', () => {
  const world = new VoxelWorld(), enemies = createEnemies(world);
  assert.equal(enemies.length, 4);
  assert.deepEqual(enemies.map(e => e.type), ['mossling', 'mossling', 'mossling', 'stoneguard']);
  assert.deepEqual(enemies, createEnemies(world));
  for (const enemy of enemies) {
    assert.equal(enemy.health, MOB_TYPES[enemy.type].maxHealth);
    assert.equal(collides(world, enemy), false);
    assert.ok(enemy.x >= enemy.radius && enemy.x <= 32 - enemy.radius);
    assert.ok(enemy.z >= enemy.radius && enemy.z <= 32 - enemy.radius);
    assert.ok(Math.hypot(enemy.x - world.spawn.x, enemy.z - world.spawn.z) >= 8);
    assert.ok(enemy.y === 0 || world.get(Math.floor(enemy.x), enemy.y - 1, Math.floor(enemy.z)));
  }
  assert.equal(enemies[0].damage, 10); assert.equal(enemies[0].speed, 1.3);
  assert.equal(enemies[3].damage, 15); assert.equal(enemies[3].speed, 0.8);
});

test('edited worlds reset enemies safely without changing blocks or entity identities', () => {
  const world = new VoxelWorld(), enemies = createEnemies(world), references = [...enemies];
  const first = enemies[0]; world.set(Math.floor(first.x), first.y, Math.floor(first.z), 3);
  enemies.forEach(enemy => { enemy.health = 0; enemy.x = 16; });
  const before = world.blocks.slice(); resetEnemies(world, enemies);
  assert.deepEqual(world.blocks, before);
  for (let i = 0; i < 4; i++) {
    assert.equal(enemies[i], references[i]);
    assert.equal(enemies[i].health, enemies[i].maxHealth);
    assert.equal(collides(world, enemies[i]), false);
  }
});

test('models are distinct, fit their collision bounds, and follow their entity positions', () => {
  const enemies = createEnemies(new VoxelWorld()), scene = new THREE.Scene();
  const view = createMobView(scene, enemies); view.update();
  assert.equal(view.models.length, 4);
  for (const model of view.models) {
    const size = new THREE.Box3().setFromObject(model.root).getSize(new THREE.Vector3());
    assert.ok(size.x <= model.enemy.radius * 2 + 0.001);
    assert.ok(size.y <= model.enemy.height + 0.001);
    assert.ok(size.z <= model.enemy.radius * 2 + 0.001);
  }
  assert.notEqual(view.models[0].materials[0].color.getHex(), view.models[3].materials[0].color.getHex());
  enemies[0].x += 1; view.update(); assert.equal(view.models[0].root.position.x, enemies[0].x);
  view.dispose(); assert.equal(scene.children.length, 0);
});
