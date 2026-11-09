import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld } from '../src/world.js';
import { createEnemies } from '../src/mobs.js';
import { createMobView } from '../src/mob-view.js';
import { createWorldMesh, createWorldGeometry } from '../src/world-mesh.js';
import { createCombat } from '../src/combat.js';
import { createInteractionController } from '../src/interaction-controller.js';

function fixture(type = 'mossling') {
  const world = new VoxelWorld(); world.blocks.fill(0);
  const all = createEnemies(world), enemy = all.find(e => e.type === type), enemies = [enemy];
  Object.assign(enemy, { x: 5.5, y: 1, z: 7.2, yaw: 0 });
  const scene = new THREE.Scene(), view = createMobView(scene, enemies); view.update();
  const mesh = createWorldMesh(world), combat = createCombat({ world, worldMesh: mesh, enemies, mobView: view });
  return { world, enemy, view, mesh, combat, origin: new THREE.Vector3(5.5, 1.6, 9.5), direction: new THREE.Vector3(0,0,-1),
    dispose() { view.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); } };
}

test('visible melee hits deal 25 damage, obey a 0.6-second cooldown, and defeat both enemy types', () => {
  for (const type of ['mossling', 'stoneguard']) {
    const f = fixture(type), before = f.world.blocks.slice();
    assert.equal(f.combat.target(f.origin, f.direction).kind, 'enemy');
    const hp = f.enemy.health;
    assert.equal(f.combat.attack(f.origin, f.direction).damage, 25);
    assert.equal(f.enemy.health, hp - 25);
    assert.equal(f.combat.attack(f.origin, f.direction).ok, false);
    f.combat.update(0.59); assert.equal(f.combat.attack(f.origin, f.direction).ok, false);
    f.combat.update(0.01); assert.equal(f.combat.attack(f.origin, f.direction).ok, true);
    if (type === 'stoneguard') { assert.equal(f.enemy.health, 10); f.combat.update(0.6); f.combat.attack(f.origin, f.direction); }
    assert.equal(f.enemy.health, 0);
    assert.equal(f.combat.target(f.origin, f.direction).kind, 'none');
    assert.deepEqual(f.world.blocks, before);
    f.dispose();
  }
});

test('nearer terrain blocks melee and retains delayed mining behavior', () => {
  const f = fixture(); f.world.set(5, 1, 8, 3); f.mesh.geometry.dispose(); f.mesh.geometry = createWorldGeometry(f.world);
  const target = f.combat.target(f.origin, f.direction);
  assert.equal(target.kind, 'block'); assert.equal(target.block.z, 8);
  assert.equal(f.combat.attack(f.origin, f.direction).ok, false); assert.equal(f.enemy.health, 40);
  const mining = createInteractionController({ world: f.world, player: { x: 10, y: 1, z: 10 } });
  mining.start(target.block, 'remove'); mining.update(0.5, target.block); assert.equal(f.world.get(5, 1, 8), 3);
  mining.update(0.5, target.block); assert.equal(f.world.get(5, 1, 8), 0);
  f.mesh.geometry.dispose(); f.mesh.geometry = createWorldGeometry(f.world);
  assert.equal(f.combat.attack(f.origin, f.direction).ok, true);
  f.dispose();
});

test('out-of-range enemies, paused input, and cooldown pauses cannot produce hits', () => {
  const f = fixture(); f.enemy.z = 4; f.view.update();
  assert.equal(f.combat.target(f.origin, f.direction).kind, 'out-of-reach');
  assert.equal(f.combat.attack(f.origin, f.direction).ok, false);
  f.enemy.z = 7.2; f.view.update();
  assert.equal(f.combat.attack(f.origin, f.direction, false).ok, false);
  assert.equal(f.enemy.health, 40);
  f.combat.attack(f.origin, f.direction); const cooldown = f.combat.cooldown;
  f.combat.update(10, false); assert.equal(f.combat.cooldown, cooldown);
  f.dispose();
});
