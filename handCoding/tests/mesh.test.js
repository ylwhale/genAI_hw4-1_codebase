import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld } from '../src/world.js';
import { createWorldGeometry, createWorldMesh } from '../src/world-mesh.js';
import { targetBlock } from '../src/interactions.js';

test('meshing omits internal faces and produces finite, aligned vertex attributes', () => {
  const world = new VoxelWorld(); world.blocks.fill(0);
  world.set(5, 3, 5, 1);
  const single = createWorldGeometry(world, true);
  assert.equal(single.index.count / 3, 12);
  world.set(6, 3, 5, 3);
  const pair = createWorldGeometry(world, true);
  assert.equal(pair.index.count / 3, 20);
  for (const attribute of Object.values(pair.attributes)) {
    assert.equal(attribute.count, pair.attributes.position.count);
    assert.ok(attribute.array.every(Number.isFinite));
  }
  single.dispose(); pair.dispose();
});

test('raycasting targets all six outward faces and the nearest occluding block', () => {
  const world = new VoxelWorld(); world.blocks.fill(0); world.set(5, 3, 5, 3);
  const mesh = createWorldMesh(world);
  const center = new THREE.Vector3(5.5, 3.5, 5.5);
  for (const normal of [[1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]]) {
    const n = new THREE.Vector3(...normal);
    const hit = targetBlock(world, mesh, center.clone().addScaledVector(n, 3), n.clone().negate());
    assert.equal(hit.x, 5); assert.equal(hit.y, 3); assert.equal(hit.z, 5);
    assert.deepEqual(hit.normal, { x: normal[0], y: normal[1], z: normal[2] });
  }
  world.set(5, 3, 7, 4);
  mesh.geometry.dispose(); mesh.geometry = createWorldGeometry(world);
  assert.equal(targetBlock(world, mesh, new THREE.Vector3(5.5, 3.5, 10), new THREE.Vector3(0,0,-1)).z, 7);
  mesh.geometry.dispose(); mesh.material.dispose();
});
