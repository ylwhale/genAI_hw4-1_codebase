import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld } from '../src/world.js';
import { createPlayer, stepPlayer, collides } from '../src/physics.js';
import { createFirstPersonView } from '../src/first-person.js';
import { createInteractionController } from '../src/interaction-controller.js';
import { createInteractionEffects } from '../src/interaction-effects.js';
import { SAVE_KEY, saveWorldEdits, loadWorldEdits, resetWorld } from '../src/storage.js';

function setup() {
  const world = new VoxelWorld(), player = createPlayer(world.spawn);
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const view = createFirstPersonView(new THREE.PerspectiveCamera(65, 16 / 9)); view.setPlaying(true);
  const scene = new THREE.Scene();
  const effects = createInteractionEffects(scene, { crackTextures: Array.from({ length: 4 }, () => new THREE.Texture()) });
  let saves = 0;
  const controller = createInteractionController({
    world, player,
    onStart(op) { view.beginSwing(op.action); effects.begin(op); },
    onCancel() { view.cancelSwing(); effects.clear(); },
    onComplete() { view.cancelSwing(); effects.clear(); saves++; saveWorldEdits(world, storage); },
  });
  const target = { x: 17, y: world.spawn.y - 1, z: 25, distance: 2, normal: { x: 0, y: 1, z: 0 } };
  function tick(dt, current = target) { controller.update(dt, current); effects.update(dt); view.update(dt); }
  return { world, player, storage, view, scene, effects, controller, target, tick, saves: () => saves, dispose() { effects.dispose(); view.dispose(); } };
}

test('timed placement/removal save only at completion and reload with the existing save format', () => {
  const f = setup(), y = f.world.spawn.y;
  f.controller.start(f.target, 'place', 4); f.tick(0.5);
  assert.equal(f.world.get(17, y, 25), 0);
  assert.equal(f.storage.getItem(SAVE_KEY), null);
  f.tick(0.5);
  assert.equal(f.saves(), 1);
  const fresh = new VoxelWorld();
  assert.equal(loadWorldEdits(fresh, f.storage).status, 'restored');
  assert.deepEqual(fresh.blocks, f.world.blocks);
  assert.equal(fresh.get(17, y, 25), 4);
  const saved = f.storage.getItem(SAVE_KEY);
  const wood = { ...f.target, y };
  f.controller.start(wood, 'remove'); f.tick(0.5, wood);
  assert.equal(f.storage.getItem(SAVE_KEY), saved);
  assert.equal(f.world.get(17, y, 25), 4);
  f.tick(0.5, wood);
  assert.equal(f.saves(), 2);
  const reloaded = new VoxelWorld(); loadWorldEdits(reloaded, f.storage);
  assert.deepEqual(reloaded.blocks, reloaded.original);
  f.dispose();
});

test('alternating cancelled actions neither save nor accumulate temporary render objects', () => {
  const f = setup(), before = f.world.blocks.slice(), children = [...f.effects.group.children];
  for (let i = 0; i < 50; i++) {
    f.controller.start(f.target, i % 2 ? 'remove' : 'place', 1 + i % 5);
    f.tick(0.25); f.controller.cancel('Tool changed'); f.view.cycleTool();
    assert.equal(f.controller.active, null);
    assert.equal(f.view.swinging, false);
    assert.equal(f.effects.particleCount, 0);
    assert.ok(f.effects.group.children.every(child => !child.visible));
  }
  assert.deepEqual(f.world.blocks, before);
  assert.deepEqual(f.effects.group.children, children);
  assert.equal(f.saves(), 0);
  assert.equal(f.storage.getItem(SAVE_KEY), null);
  f.controller.start(f.target, 'place', 3); f.tick(0.4);
  f.controller.cancel('World reset'); resetWorld(f.world, f.storage); f.tick(2);
  assert.deepEqual(f.world.blocks, f.world.original);
  assert.equal(f.saves(), 0);
  f.dispose();
});

test('player physics continues during construction and entering the preview cancels it', () => {
  const f = setup(), startX = f.player.x;
  f.controller.start(f.target, 'place', 3);
  for (let i = 0; i < 30; i++) {
    stepPlayer(f.world, f.player, { forward: false, backward: false, left: false, right: true, jump: false });
    f.tick(1 / 120);
  }
  assert.ok(f.player.x > startX + 0.5);
  assert.equal(f.controller.active, null);
  assert.equal(f.world.get(17, f.world.spawn.y, 25), 0);
  assert.equal(collides(f.world, f.player), false);
  assert.equal(f.saves(), 0);
  f.dispose();
});

test('every building material uses one-second timing across frame rates', () => {
  for (const frames of [20, 60, 120]) for (const type of [1, 2, 3, 4, 5]) {
    const f = setup(); f.controller.start(f.target, 'place', type);
    for (let i = 0; i < frames - 1; i++) f.tick(1 / frames);
    assert.equal(f.world.get(17, f.world.spawn.y, 25), 0);
    f.tick(1 / frames);
    assert.equal(f.world.get(17, f.world.spawn.y, 25), type);
    assert.equal(f.saves(), 1);
    f.dispose();
  }
});
