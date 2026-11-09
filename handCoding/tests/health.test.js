import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealth, damagePlayer, restoreHealth } from '../src/health.js';

test('health starts at 100, applies monster damage, clamps lethal hits, and restores exactly', () => {
  const health = createHealth();
  assert.equal(health.max, 100); assert.equal(health.current, 100);
  assert.deepEqual(damagePlayer(health, 10), { amount: 10, killed: false });
  assert.equal(health.current, 90);
  damagePlayer(health, 15); assert.equal(health.current, 75);
  assert.deepEqual(damagePlayer(health, 1000), { amount: 75, killed: true });
  assert.equal(health.current, 0); assert.equal(health.dead, true);
  assert.deepEqual(damagePlayer(health, 15), { amount: 0, killed: false });
  restoreHealth(health); assert.equal(health.current, 100); assert.equal(health.dead, false);
});

test('paused/dead state and invalid damage never reduce health or heal it', () => {
  const health = createHealth();
  damagePlayer(health, 15, false); assert.equal(health.current, 100);
  for (const amount of [-10, 0, NaN, Infinity]) damagePlayer(health, amount);
  assert.equal(health.current, 100);
  damagePlayer(health, 20);
  assert.equal(health.current, 80); // No update/timer implements automatic regeneration.
});
