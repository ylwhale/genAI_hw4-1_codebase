import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFirstPersonView, TOOL_NAMES } from '../src/first-person.js';

test('hand stays attached to camera, hidden in menu, and cycles distinct tool models', () => {
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.05, 200);
  const view = createFirstPersonView(camera);
  assert.equal(view.rig.parent, camera);
  assert.equal(view.rig.visible, false);
  assert.equal(view.toolName, 'Pickaxe');
  for (let i = 0; i < 3; i++) {
    assert.equal(view.tools.filter(tool => tool.visible).length, 1);
    assert.equal(view.tools.find(tool => tool.visible).name, TOOL_NAMES[i]);
    assert.equal(view.cycleTool(), TOOL_NAMES[(i + 1) % 3]);
  }
  assert.notDeepEqual(view.tools[0].children.map(m => m.scale.toArray()), view.tools[1].children.map(m => m.scale.toArray()));
  view.setPlaying(true); view.update(0);
  camera.position.set(16, 10, 20); camera.rotation.set(0.3, 0.8, 0); camera.updateMatrixWorld(true);
  const projected = view.rig.getWorldPosition(new THREE.Vector3()).project(camera);
  assert.ok(projected.x > 0 && projected.x < 1 && projected.y < 0 && projected.y > -1);
  view.setPlaying(false);
  assert.equal(view.rig.visible, false);
  view.dispose();
  assert.equal(view.rig.parent, null);
});

test('foreground pass preserves renderer clearing state and stays in view at narrow aspect ratios', () => {
  for (const aspect of [16 / 9, 653 / 788]) {
    const camera = new THREE.PerspectiveCamera(65, aspect), view = createFirstPersonView(camera);
    let clears = 0, renders = 0;
    const renderer = { autoClear: true, clearDepth() { clears++; }, render(scene, usedCamera) {
      renders++; assert.equal(scene, view.scene); assert.equal(usedCamera, camera); assert.equal(this.autoClear, false);
    } };
    view.render(renderer); assert.equal(renders, 0);
    view.setPlaying(true); view.update(0.1); camera.updateMatrixWorld(true);
    const projected = view.rig.getWorldPosition(new THREE.Vector3()).project(camera);
    assert.ok(projected.x > 0 && projected.x < 1 && projected.y < 0 && projected.y > -1);
    view.render(renderer);
    assert.equal(renderer.autoClear, true);
    renderer.autoClear = false; view.render(renderer);
    assert.equal(renderer.autoClear, false);
    assert.equal(clears, 2); assert.equal(renders, 2);
    view.dispose();
  }
});

test('swing timing is independent of frame rate, rejects overlap, and returns to rest', () => {
  for (const frames of [20, 60, 120]) {
    const view = createFirstPersonView(new THREE.PerspectiveCamera(65, 16 / 9));
    view.setPlaying(true);
    assert.equal(view.beginSwing('remove'), true);
    assert.equal(view.beginSwing('place'), false);
    for (let i = 0; i < frames / 2; i++) view.update(1 / frames);
    assert.ok(Math.abs(view.swingProgress - 0.5) < 1e-9);
    assert.notEqual(view.rig.rotation.x, -0.06);
    for (let i = 0; i < frames / 2; i++) view.update(1 / frames);
    assert.equal(view.swinging, false);
    assert.equal(view.rig.rotation.x, -0.06);
    assert.equal(view.rig.rotation.z, -0.12);
    assert.equal(view.beginSwing('place'), true);
    view.update(0.3); view.cancelSwing();
    assert.equal(view.swinging, false);
    assert.equal(view.rig.rotation.x, -0.06);
    assert.equal(view.beginSwing('place'), true);
    view.setPlaying(false);
    assert.equal(view.swinging, false);
    assert.equal(view.beginSwing('remove'), false);
    view.dispose();
  }
});
