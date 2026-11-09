import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, getToolSprite, buildToolGeometry } from '../src/render/tools.js';

const silhouette = (id) => getToolSprite(id).map((row) => row.map((c) => (c ? '#' : '.')).join('')).join('\n');

test('there are exactly three tools: pickaxe, axe and shovel', () => {
  assert.deepEqual(TOOLS.map((t) => t.id), ['pickaxe', 'axe', 'shovel']);
  assert.deepEqual(TOOLS.map((t) => t.name), ['Pickaxe', 'Axe', 'Shovel']);
});

test('each tool sprite is a 16x16, substantial, deterministic drawing', () => {
  for (const { id } of TOOLS) {
    const sprite = getToolSprite(id);
    assert.equal(sprite.length, 16);
    assert.ok(sprite.every((row) => row.length === 16));
    const filled = sprite.flat().filter(Boolean).length;
    assert.ok(filled >= 45, `${id} has ${filled} pixels`);
    assert.ok(sprite.flat().every((c) => c === null || /^#[0-9a-f]{6}$/i.test(c)));
  }
  assert.equal(silhouette('axe'), silhouette('axe'));
});

test('the three silhouettes are clearly different', () => {
  const ids = TOOLS.map((t) => t.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = silhouette(ids[i]);
      const b = silhouette(ids[j]);
      let diff = 0;
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
      assert.ok(diff >= 20, `${ids[i]} vs ${ids[j]} differ in ${diff} pixels`);
    }
  }
});

test('tool models extrude into closed voxel geometry with colours', () => {
  for (const { id } of TOOLS) {
    const g = buildToolGeometry(id, 0.03);
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    assert.ok(pos.count > 300 && pos.count % 6 === 0, `${id}: ${pos.count} vertices`);
    assert.equal(col.count, pos.count);
    for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]));
    // Grip at the origin: the model extends further up than down (the head is at the top).
    g.computeBoundingBox();
    assert.ok(g.boundingBox.max.y > -g.boundingBox.min.y);
  }
});
