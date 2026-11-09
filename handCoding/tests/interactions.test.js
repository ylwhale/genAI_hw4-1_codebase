import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld } from '../src/world.js';
import { createWorldMesh } from '../src/world-mesh.js';
import { targetBlock, editBlock } from '../src/interactions.js';

function fixture() {
  const world = new VoxelWorld();
  world.blocks.fill(0);
  world.set(5, 3, 5, 3);
  return { world, mesh: createWorldMesh(world), player: { x: 10.5, y: 1, z: 10.5 } };
}

test('raycasting selects the visible face and removal changes only that block', () => {
  const { world, mesh, player } = fixture();
  const target = targetBlock(world, mesh, new THREE.Vector3(5.5, 3.5, 9), new THREE.Vector3(0, 0, -1));
  assert.deepEqual(target, { x: 5, y: 3, z: 5, normal: { x: 0, y: 0, z: 1 }, point: { x: 5.5, y: 3.5, z: 6 }, distance: 3 });
  assert.equal(editBlock(world, player, target, 'remove').ok, true);
  assert.equal(world.get(5, 3, 5), 0);
  assert.equal(world.blocks.reduce((a, b) => a + Number(b !== 0), 0), 0);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('blocks beyond six camera units cannot be targeted or removed', () => {
  const { world, mesh, player } = fixture();
  assert.equal(targetBlock(world, mesh, new THREE.Vector3(5.5, 3.5, 12.01), new THREE.Vector3(0, 0, -1)), null);
  const before = world.blocks.slice();
  assert.equal(editBlock(world, player, { x: 5, y: 3, z: 5, distance: 6.01 }, 'remove').ok, false);
  assert.deepEqual(world.blocks, before);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('placement uses the adjacent visible face and the selected material', () => {
  const { world, player, mesh } = fixture();
  const target = { x: 5, y: 3, z: 5, normal: { x: 0, y: 0, z: 1 }, distance: 3 };
  assert.equal(editBlock(world, player, target, 'place', 4).ok, true);
  assert.equal(world.get(5, 3, 6), 4);
  assert.equal(world.get(5, 3, 5), 3);
  assert.equal(editBlock(world, player, target, 'place', 2).ok, false);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('placement rejects player intersection, boundaries, and invalid data without mutation', () => {
  const { world, player, mesh } = fixture();
  world.set(10, 1, 9, 3);
  world.set(31, 1, 2, 3);
  const before = world.blocks.slice();
  const target = { x: 10, y: 1, z: 9, normal: { x: 0, y: 0, z: 1 }, distance: 1 };
  assert.equal(editBlock(world, player, target, 'place', 1).reason, 'Too close to you');
  assert.equal(editBlock(world, player, { x: 31, y: 1, z: 2, normal: { x: 1, y: 0, z: 0 }, distance: 2 }, 'place', 1).reason, 'World boundary');
  assert.equal(editBlock(world, player, { ...target, distance: NaN }, 'place', 1).ok, false);
  assert.equal(editBlock(world, player, target, 'place', 9).ok, false);
  assert.deepEqual(world.blocks, before);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('exactly six units is reachable and vertical placement limits remain bounded', () => {
  const { world, mesh, player } = fixture();
  const target = targetBlock(world, mesh, new THREE.Vector3(5.5, 3.5, 12), new THREE.Vector3(0,0,-1));
  assert.equal(target.distance, 6);
  assert.equal(editBlock(world, player, target, 'remove').ok, true);
  for (const [y, normalY] of [[0, -1], [47, 1]]) {
    world.set(5, y, 5, 3);
    const before = world.blocks.slice();
    assert.equal(editBlock(world, player, { x: 5, y, z: 5, normal: { x: 0, y: normalY, z: 0 }, distance: 1 }, 'place', 2).ok, false);
    assert.deepEqual(world.blocks, before);
  }
  mesh.geometry.dispose(); mesh.material.dispose();
});
