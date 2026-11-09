import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInteractionEffects } from '../src/interaction-effects.js';

test('cracks advance, particles stay bounded, cancellation clears effects, and resources dispose', () => {
  const scene = new THREE.Scene(), textures = Array.from({ length: 4 }, () => new THREE.Texture());
  const effects = createInteractionEffects(scene, { crackTextures: textures });
  const op = { action: 'remove', progress: 0, sourceType: 3, source: { x: 5, y: 3, z: 5, normal: { x: 1, y: 0, z: 0 } } };
  const meshes = [...effects.group.children];
  for (let cycle = 0; cycle < 50; cycle++) {
    effects.begin(op);
    assert.equal(effects.crackOverlay.visible, true);
    assert.ok(effects.particleCount > 0);
    op.progress = 0.8; effects.update(0.1);
    assert.equal(effects.crackStage, 3);
    assert.ok(effects.particleCount <= 48);
    effects.clear();
    assert.equal(effects.crackOverlay.visible, false);
    assert.equal(effects.particles.visible, false);
    assert.equal(effects.particleCount, 0);
  }
  assert.deepEqual(effects.group.children, meshes);
  let disposed = 0;
  textures.forEach(texture => texture.addEventListener('dispose', () => disposed++));
  meshes.forEach(mesh => {
    mesh.geometry.addEventListener('dispose', () => disposed++);
    mesh.material.addEventListener('dispose', () => disposed++);
  });
  effects.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(disposed, textures.length + meshes.length * 2);
});

test('construction preview uses the captured block, grows translucently, and clears all temporary objects', () => {
  const scene = new THREE.Scene(), atlas = new THREE.Texture();
  const effects = createInteractionEffects(scene, { atlas, crackTextures: Array.from({ length: 4 }, () => new THREE.Texture()) });
  const op = { action: 'place', selected: 4, sourceType: 3, progress: 0,
    source: { x: 5, y: 3, z: 5, normal: { x: 1, y: 0, z: 0 } }, destination: { x: 6, y: 3, z: 5 } };
  effects.begin(op);
  assert.equal(effects.preview.visible, true);
  assert.equal(effects.crackOverlay.visible, false);
  assert.equal(effects.preview.material.map, atlas);
  assert.ok(effects.preview.material.opacity < 1);
  const initialSize = effects.preview.scale.x;
  op.progress = 0.8; effects.update(0.1);
  assert.ok(effects.preview.scale.x > initialSize);
  assert.ok(effects.particleCount > 0);
  effects.clear(); effects.update(1);
  assert.ok(effects.group.children.every(child => !child.visible));
  assert.equal(effects.particleCount, 0);
  let atlasDisposed = false; atlas.addEventListener('dispose', () => { atlasDisposed = true; });
  effects.dispose();
  assert.equal(atlasDisposed, false); // Shared with the world; the caller owns it.
  atlas.dispose();
});
