import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/world.js';
import { createInteractionController } from '../src/interaction-controller.js';
import { validateEdit } from '../src/interactions.js';

function fixture(type = 3) {
  const world = new VoxelWorld(); world.blocks.fill(0); world.set(5, 3, 5, type);
  const player = { x: 9.5, y: 2, z: 5.5 };
  const target = { x: 5, y: 3, z: 5, normal: { x: 1, y: 0, z: 0 }, distance: 3 };
  let commits = 0, starts = 0, cancels = 0;
  const controller = createInteractionController({ world, player, onStart() { starts++; }, onCancel() { cancels++; }, onComplete() { commits++; } });
  return { world, player, target, controller, counts: () => ({ commits, starts, cancels }) };
}

test('validation makes no mutations and destruction commits once after one second', () => {
  const { world, player, target, controller, counts } = fixture();
  const before = world.blocks.slice();
  assert.equal(validateEdit(world, player, target, 'remove').ok, true);
  assert.deepEqual(world.blocks, before);
  assert.equal(controller.start(target, 'remove').ok, true);
  assert.equal(controller.start(target, 'remove').ok, false);
  controller.update(0.99, target);
  assert.equal(world.get(5, 3, 5), 3);
  assert.equal(counts().commits, 0);
  controller.update(0.01, target);
  assert.equal(world.get(5, 3, 5), 0);
  controller.update(2, target);
  assert.deepEqual(counts(), { commits: 1, starts: 1, cancels: 0 });
});

test('a long render frame uses elapsed time but still revalidates reach before committing', () => {
  for (const distance of [3, 6.1]) {
    const { world, target, controller, counts } = fixture();
    controller.start(target, 'remove');
    controller.update(1.4, { ...target, distance });
    assert.equal(world.get(5, 3, 5), distance <= 6 ? 0 : 3);
    assert.equal(counts().commits, distance <= 6 ? 1 : 0);
    assert.equal(controller.active, null);
  }
});

test('placement previews without mutation and commits its initial selected material only once', () => {
  const { world, target, controller, counts } = fixture();
  let selected = 4;
  assert.equal(controller.start(target, 'place', selected).ok, true);
  selected = 1;
  assert.equal(controller.start(target, 'remove', selected).ok, false);
  controller.update(0.99, target);
  assert.equal(world.get(6, 3, 5), 0);
  assert.equal(controller.active.selected, 4);
  assert.equal(counts().commits, 0);
  controller.update(0.01, target);
  assert.equal(world.get(6, 3, 5), 4);
  assert.equal(counts().commits, 1);
});

test('placement cancels safely if the player enters, a block occupies it, its face changes, or play is interrupted', () => {
  for (const change of ['player', 'occupied', 'face', 'menu']) {
    const { world, player, target, controller, counts } = fixture();
    controller.start(target, 'place', 2); controller.update(0.6, target);
    if (change === 'player') Object.assign(player, { x: 6.5, y: 3, z: 5.5 });
    if (change === 'occupied') world.set(6, 3, 5, 5);
    const current = change === 'face' ? { ...target, normal: { x: 0, y: 1, z: 0 } } : target;
    controller.update(0.5, current, change !== 'menu');
    assert.equal(controller.active, null);
    assert.equal(world.get(6, 3, 5), change === 'occupied' ? 5 : 0);
    assert.equal(world.get(5, 3, 5), 3);
    assert.equal(counts().commits, 0);
    assert.equal(counts().cancels, 1);
  }
});

test('placement rejects invalid starts, player overlap, reach, and boundaries before starting any effect', () => {
  const { world, player, target, controller, counts } = fixture();
  world.set(31, 3, 5, 3);
  const before = world.blocks.slice();
  assert.equal(controller.start({ ...target, x: 31 }, 'place', 1).ok, false);
  assert.equal(controller.start({ ...target, distance: 6.01 }, 'place', 1).ok, false);
  assert.equal(controller.start(target, 'place', 7).ok, false);
  Object.assign(player, { x: 6.5, y: 3, z: 5.5 });
  assert.equal(controller.start(target, 'place', 1).ok, false);
  assert.equal(counts().starts, 0);
  assert.deepEqual(world.blocks, before);
});

test('every terrain/tree material breaks at the same duration at varied frame rates', () => {
  for (const type of [1, 2, 3, 4, 5]) for (const frames of [20, 60, 120]) {
    const { world, target, controller } = fixture(type);
    controller.start(target, 'remove');
    for (let i = 0; i < frames - 1; i++) controller.update(1 / frames, target);
    assert.equal(world.get(5, 3, 5), type);
    controller.update(1 / frames, target);
    assert.equal(world.get(5, 3, 5), 0);
  }
});

test('invalid starts have no effects and losing target, reach, focus, or source cancels without committing', () => {
  for (const change of ['target', 'reach', 'menu', 'source', 'reset']) {
    const { world, target, controller, counts } = fixture();
    assert.equal(controller.start(null, 'remove').ok, false);
    assert.equal(controller.start({ ...target, distance: 6.01 }, 'remove').ok, false);
    assert.equal(counts().starts, 0);
    controller.start(target, 'remove'); controller.update(0.6, target);
    if (change === 'source') world.set(5, 3, 5, 4);
    if (change === 'reset') controller.cancel('World reset');
    controller.update(0.5, change === 'target' ? null : change === 'reach' ? { ...target, distance: 6.1 } : target, change !== 'menu');
    assert.equal(controller.active, null);
    assert.equal(counts().commits, 0);
    assert.equal(counts().cancels, 1);
    assert.equal(world.get(5, 3, 5), change === 'source' ? 4 : 3);
  }
});
