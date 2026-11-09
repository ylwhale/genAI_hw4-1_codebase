import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld } from '../src/world.js';
import { createEnemies, updateEnemyEffects, resetEnemies, MOB_DEATH_DURATION } from '../src/mobs.js';
import { createMobView } from '../src/mob-view.js';

test('walking, attacks, hit fade, and death animation use elapsed time and reset cleanly', () => {
  for (const rate of [20, 60, 120]) {
    const world = new VoxelWorld(), enemies = createEnemies(world), scene = new THREE.Scene();
    const view = createMobView(scene, enemies), enemy = enemies[3], model = view.models[3];
    enemy.moving = true; updateEnemyEffects(enemies, 0.1); view.update();
    assert.notEqual(model.legs[0].rotation.x, 0);
    assert.equal(model.legs[0].rotation.x, -model.legs[1].rotation.x);
    enemy.moving = false; enemy.attackAnimation = 0.3; enemy.hitFlash = 0.2;
    view.update(); assert.notEqual(model.materials[0].color.getHex(), model.palette[0]);
    updateEnemyEffects(enemies, 0.15); view.update(); assert.ok(Math.abs(model.arms[0].rotation.x) > 1);
    const frozen = structuredClone(enemies); updateEnemyEffects(enemies, 10, false);
    assert.deepEqual(enemies, frozen);
    updateEnemyEffects(enemies, 0.15); view.update();
    assert.equal(model.materials[0].color.getHex(), model.palette[0]); assert.ok(Math.abs(model.arms[0].rotation.x) < 1e-9);
    enemy.health = 0; enemy.deathTime = 0;
    const frameCount = Math.round(MOB_DEATH_DURATION * rate);
    for (let i = 0; i < frameCount / 2; i++) updateEnemyEffects(enemies, 1 / rate);
    view.update(); assert.ok(model.root.scale.y > 0 && model.root.scale.y < 1); assert.equal(model.root.visible, true);
    for (let i = frameCount / 2; i < frameCount + 1; i++) updateEnemyEffects(enemies, 1 / rate);
    view.update(); assert.equal(model.root.visible, false); assert.equal(model.root.scale.y, 0);
    resetEnemies(world, enemies); view.update(); assert.equal(model.root.visible, true); assert.equal(model.root.scale.y, 1);
    view.dispose();
  }
});

test('repeated hit/death/reset cycles reuse meshes and materials and dispose owned resources', () => {
  const world = new VoxelWorld(), enemies = createEnemies(world), scene = new THREE.Scene(), view = createMobView(scene, enemies);
  const meshIds = view.hitMeshes.map(mesh => mesh.uuid), materialIds = view.models.flatMap(model => model.materials.map(material => material.uuid));
  let geometriesDisposed = 0, materialsDisposed = 0;
  view.hitMeshes[0].geometry.addEventListener('dispose', () => geometriesDisposed++);
  view.models.forEach(model => model.materials.forEach(material => material.addEventListener('dispose', () => materialsDisposed++)));
  for (let i = 0; i < 100; i++) {
    enemies.forEach(enemy => { enemy.hitFlash = 0.2; enemy.health = 0; });
    updateEnemyEffects(enemies, 0.5); view.update(); resetEnemies(world, enemies); view.update();
  }
  assert.equal(scene.children.length, 1); assert.deepEqual(view.hitMeshes.map(mesh => mesh.uuid), meshIds);
  assert.deepEqual(view.models.flatMap(model => model.materials.map(material => material.uuid)), materialIds);
  assert.equal(geometriesDisposed, 0); assert.equal(materialsDisposed, 0);
  view.dispose(); assert.equal(scene.children.length, 0); assert.equal(geometriesDisposed, 1); assert.equal(materialsDisposed, 20);
});
