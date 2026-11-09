import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { AIR, STONE, GRASS, DIRT, LEAVES, WOOD } from '../src/world/blocks.js';
import { Health } from '../src/player/Health.js';
import { MobManager } from '../src/entities/MobManager.js';
import { Mob, DEATH_DURATION } from '../src/entities/Mob.js';
import { MOB_TYPES } from '../src/entities/mobTypes.js';
import { PlayerCombat } from '../src/entities/PlayerCombat.js';
import { COMBAT } from '../src/config.js';

const STEP = 1 / 120;

function flatWorld(top = 4) {
  const w = new World();
  w.blocks.fill(AIR);
  for (let y = 0; y <= top; y++) {
    for (let z = 0; z < w.size; z++) for (let x = 0; x < w.size; x++) w.blocks[w.index(x, y, z)] = STONE;
  }
  w.base.set(w.blocks);
  return w;
}

function overlapsSolid(mob) {
  return mob.body.collidesAt();
}

function insideWorld(mob, w) {
  const b = mob.body.getBox();
  return b.minX >= 0 && b.minZ >= 0 && b.maxX <= w.size && b.maxZ <= w.size && b.minY >= 0;
}

/** Collects manager events. */
function track(manager) {
  const events = [];
  manager.on((e) => events.push({ ...e, t: manager.__t ?? 0 }));
  return events;
}

function run(manager, seconds, target, dt = STEP, each) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    manager.__t = (manager.__t ?? 0) + dt;
    manager.update(dt, typeof target === 'function' ? target() : target);
    each?.();
  }
}

/** A manager holding a single mob of `typeId` at (x, y, z). */
function single(world, typeId, x, y, z) {
  const m = new MobManager(world);
  m.mobs = [new Mob(MOB_TYPES[typeId], world, 0, 1234)];
  m.mobs[0].respawn(x, y, z);
  m.mobs[0].cooldown = 0;
  return m;
}

// ---------------------------------------------------------------- health

test('player health starts at 100, never goes below 0, ignores bad input, resets', () => {
  const h = new Health(COMBAT.PLAYER_MAX_HEALTH);
  assert.equal(h.current, 100);
  assert.equal(h.damage(15), 15);
  assert.equal(h.current, 85);
  assert.equal(h.damage(-5), 0);
  assert.equal(h.damage(NaN), 0);
  assert.equal(h.damage(Infinity), 0);
  assert.equal(h.damage(200), 85);
  assert.equal(h.current, 0);
  assert.equal(h.dead, true);
  assert.equal(h.damage(10), 0, 'no further damage once dead');
  assert.equal(h.current, 0);
  h.reset();
  assert.equal(h.current, 100);
  assert.equal(h.dead, false);
});

// -------------------------------------------------------------- spawning

test('three Mosslings and one Stoneguard spawn in valid, safe places', () => {
  const w = new World();
  const spawn = w.findSpawnPoint();
  const m = new MobManager(w);
  m.spawnAll(spawn);
  const counts = {};
  for (const mob of m.mobs) counts[mob.type.id] = (counts[mob.type.id] || 0) + 1;
  assert.deepEqual(counts, { stoneguard: 1, mossling: 3 });
  for (const mob of m.mobs) {
    assert.equal(mob.alive, true);
    assert.equal(overlapsSolid(mob), false, `${mob.type.id} not inside terrain`);
    assert.ok(insideWorld(mob, w), `${mob.type.id} inside the world`);
    const p = mob.position;
    const below = w.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z));
    assert.ok([GRASS, DIRT, STONE].includes(below), `${mob.type.id} stands on ground, not ${below}`);
    assert.ok(Math.hypot(p.x - spawn.x, p.z - spawn.z) > COMBAT.SPAWN_MIN_DISTANCE, 'more than 8 units from spawn');
  }
  // Spread out from each other.
  for (let i = 0; i < m.mobs.length; i++) {
    for (let j = i + 1; j < m.mobs.length; j++) {
      const a = m.mobs[i].position;
      const b = m.mobs[j].position;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2);
    }
  }
});

test('spawning is deterministic and never uses tree tops', () => {
  const w = new World();
  const spawn = w.findSpawnPoint();
  const a = new MobManager(w).spawnAll(spawn);
  const b = new MobManager(w).spawnAll(spawn);
  assert.deepEqual(a, b);
  for (const s of a) {
    const below = w.getBlock(Math.floor(s.x), s.y - 1, Math.floor(s.z));
    assert.ok(below !== LEAVES && below !== WOOD);
  }
});

test('creatures settle onto the ground after spawning (no floating)', () => {
  const w = new World();
  const m = new MobManager(w);
  m.spawnAll(w.findSpawnPoint());
  run(m, 1, null);
  for (const mob of m.mobs) {
    assert.equal(mob.body.onGround, true, `${mob.type.id} grounded`);
    assert.equal(overlapsSolid(mob), false);
  }
});

// --------------------------------------------------------------- wander

test('with the player far away, creatures wander slowly and stay valid', () => {
  const w = new World();
  const m = new MobManager(w);
  m.spawnAll(w.findSpawnPoint());
  const start = m.mobs.map((mob) => ({ ...mob.position }));
  let maxSpeed = 0;
  let violations = 0;
  run(m, 30, null, STEP, () => {
    for (const mob of m.mobs) {
      const v = Math.hypot(mob.body.velocity.x, mob.body.velocity.z);
      maxSpeed = Math.max(maxSpeed, v / mob.type.wanderSpeed);
      if (overlapsSolid(mob) || !insideWorld(mob, w)) violations++;
    }
  });
  assert.equal(violations, 0);
  assert.ok(maxSpeed <= 1.01, `never faster than wander speed (${maxSpeed})`);
  const moved = m.mobs.map((mob, i) => Math.hypot(mob.position.x - start[i].x, mob.position.z - start[i].z));
  assert.ok(moved.every((d) => d > 0.5), `all wandered: ${moved.map((d) => d.toFixed(2))}`);
  assert.ok(m.mobs.every((mob) => mob.state === 'wander'));
});

// ---------------------------------------------------------------- chase

test('creatures chase when the player is within 10 units, at their own speed', () => {
  for (const [typeId, speed] of [['mossling', 1.3], ['stoneguard', 0.8]]) {
    const w = flatWorld();
    const m = single(w, typeId, 6.5, 5, 10.5);
    const mob = m.mobs[0];
    const target = { x: 15.5, y: 5.9, z: 10.5 }; // 9 units away
    run(m, 0.5, target);
    assert.equal(mob.state, 'chase');
    const x0 = mob.position.x;
    run(m, 2, target);
    const measured = (mob.position.x - x0) / 2;
    assert.ok(Math.abs(measured - speed) < 0.1, `${typeId} chase speed ${measured.toFixed(3)} ≈ ${speed}`);
  }
});

test('creatures ignore a player more than 10 units away', () => {
  const w = flatWorld();
  const m = single(w, 'mossling', 3.5, 5, 10.5);
  run(m, 3, { x: 14.5, y: 5.9, z: 10.5 }); // 11 units
  assert.notEqual(m.mobs[0].state, 'chase');
  assert.notEqual(m.mobs[0].state, 'attack');
});

test('a chasing creature hops up a one-block step', () => {
  const w = flatWorld();
  // A raised plateau starting at x = 10 (one block higher than the ground).
  for (let z = 0; z < w.size; z++) for (let x = 10; x < w.size; x++) w.setBlock(x, 5, z, STONE);
  const m = single(w, 'mossling', 7.5, 5, 10.5);
  run(m, 6, { x: 13.5, y: 6.9, z: 10.5 });
  assert.ok(m.mobs[0].position.x > 10, `climbed onto the step (x=${m.mobs[0].position.x.toFixed(2)})`);
  assert.ok(m.mobs[0].position.y >= 6 - 1e-3);
});

test('creatures never pass through walls while chasing', () => {
  const w = flatWorld();
  // A 3-high wall with no gaps between the creatures and the player.
  for (let z = 0; z < w.size; z++) for (let y = 5; y <= 7; y++) w.setBlock(12, y, z, STONE);
  for (const typeId of ['mossling', 'stoneguard']) {
    const m = single(w, typeId, 9.5, 5, 10.5);
    let overlaps = 0;
    run(m, 15, { x: 15.5, y: 5.9, z: 10.5 }, STEP, () => {
      if (overlapsSolid(m.mobs[0])) overlaps++;
    });
    assert.equal(overlaps, 0);
    assert.ok(m.mobs[0].position.x < 12, `${typeId} stayed on its side`);
  }
});

// --------------------------------------------------------------- attack

function stationary(typeId) {
  return { ...MOB_TYPES[typeId], speed: 0, wanderSpeed: 0 };
}

test('attacks land only within 1.75 units, every 1.5 s, for the type damage', () => {
  for (const typeId of ['mossling', 'stoneguard']) {
    const w = flatWorld();
    const type = stationary(typeId);
    const m = new MobManager(w);
    m.mobs = [new Mob(type, w, 0, 99)];
    const mob = m.mobs[0];
    mob.respawn(10.5, 5, 10.5);
    mob.cooldown = 0;
    const centreY = 5 + type.height / 2;
    const events = track(m);

    // Just inside range (same height as the mob's centre).
    m.__t = 0;
    run(m, 6.05, { x: 10.5 + 1.7, y: centreY, z: 10.5 });
    const hits = events.filter((e) => e.type === 'hit');
    // Hits land 0.35 s into each attack: at 0.35, 1.85, 3.35 and 4.85 s.
    assert.equal(hits.length, 4, `${typeId} hits in 6 s`);
    assert.ok(Math.abs(hits[0].t - COMBAT.ATTACK_WINDUP) < 0.02);
    for (let i = 1; i < hits.length; i++) assert.ok(hits[i].t - hits[i - 1].t >= COMBAT.ATTACK_COOLDOWN - 1e-6);
    assert.equal(mob.type.damage, typeId === 'mossling' ? 10 : 15);

    // Just outside range: no attacks at all.
    events.length = 0;
    mob.respawn(10.5, 5, 10.5);
    mob.cooldown = 0;
    run(m, 4, { x: 10.5 + 1.8, y: centreY, z: 10.5 });
    assert.equal(events.filter((e) => e.type === 'attack-start' || e.type === 'hit').length, 0, `${typeId} out of range`);
  }
});

test('a player who steps out of range during the wind-up is not hit', () => {
  const w = flatWorld();
  const m = new MobManager(w);
  const type = stationary('mossling');
  m.mobs = [new Mob(type, w, 0, 5)];
  const mob = m.mobs[0];
  mob.respawn(10.5, 5, 10.5);
  mob.cooldown = 0;
  const events = track(m);
  const near = { x: 11.9, y: 5.4, z: 10.5 };
  const far = { x: 13, y: 5.4, z: 10.5 };
  run(m, 0.1, near); // attack starts
  assert.equal(events.at(-1).type, 'attack-start');
  run(m, 0.5, far); // dodged before the hit
  assert.equal(events.filter((e) => e.type === 'hit').length, 0);
  assert.equal(events.filter((e) => e.type === 'miss').length, 1);
});

test('no attack without line of sight; line of sight is blocked by solid blocks', () => {
  const w = flatWorld();
  const m = new MobManager(w);
  m.mobs = [new Mob(stationary('mossling'), w, 0, 5)];
  const mob = m.mobs[0];
  mob.respawn(10.5, 5, 10.5);
  mob.cooldown = 0;
  // Direct check of the line-of-sight test.
  assert.equal(m.lineOfSight(mob, { x: 14.5, y: 5.6, z: 10.5 }), true);
  w.setBlock(12, 5, 10, STONE);
  assert.equal(m.lineOfSight(mob, { x: 14.5, y: 5.6, z: 10.5 }), false);
  w.setBlock(12, 5, 10, AIR);
  // The attack decision requires it.
  m.lineOfSight = () => false;
  const events = track(m);
  run(m, 4, { x: 11.9, y: 5.4, z: 10.5 });
  assert.equal(events.filter((e) => e.type === 'hit' || e.type === 'attack-start').length, 0);
});

test('nothing attacks while the player is untargetable (paused / dead)', () => {
  const w = flatWorld();
  const m = single(w, 'mossling', 10.5, 5, 10.5);
  const events = track(m);
  run(m, 5, null);
  assert.equal(events.length, 0);
});

// --------------------------------------------------------- player combat

function combatSetup(typeId = 'mossling') {
  const w = flatWorld();
  const m = single(w, typeId, 12.5, 5, 10.5);
  const combat = new PlayerCombat(w, m);
  const eye = { x: 10.5, y: 6.62, z: 10.5 };
  const mob = m.mobs[0];
  const aim = () => ({ x: mob.position.x - eye.x, y: mob.position.y + mob.type.height / 2 - eye.y, z: mob.position.z - eye.z });
  return { w, m, combat, eye, mob, aim };
}

test('melee: 25 damage per hit, 0.6 s cooldown, Mossling dies in 2 hits and disappears', () => {
  const { m, combat, eye, mob, aim } = combatSetup('mossling');
  const r1 = combat.attack(eye, aim(), 10);
  assert.equal(r1.ok, true);
  assert.equal(r1.damage, 25);
  assert.equal(mob.health, 15);
  assert.equal(combat.attack(eye, aim(), 10.3).reason, 'cooldown');
  assert.equal(mob.health, 15);
  const r2 = combat.attack(eye, aim(), 10.6);
  assert.equal(r2.ok, true);
  assert.equal(r2.killed, true);
  assert.equal(mob.health, 0);
  assert.equal(mob.state, 'dying');
  assert.equal(m.raycast(eye, aim(), 3), null, 'a dying creature is no longer a target');
  run(m, DEATH_DURATION + 0.05, null);
  assert.equal(mob.state, 'dead');
});

test('melee: Stoneguard takes 3 hits; health never below 0', () => {
  const { combat, eye, mob, aim } = combatSetup('stoneguard');
  let t = 0;
  for (let i = 0; i < 3; i++) {
    t += 0.6;
    assert.equal(combat.attack(eye, aim(), t).ok, true);
  }
  assert.equal(mob.health, 0);
  assert.equal(mob.alive, false);
  t += 0.6;
  assert.equal(combat.attack(eye, aim(), t).reason, 'no-target');
  assert.equal(mob.health, 0);
});

test('melee: out of range (3 units) or behind a block is not a valid target', () => {
  const { w, combat, eye, mob, aim } = combatSetup('mossling');
  mob.body.place(14.5, 5, 10.5); // ~3.7 units away
  assert.equal(combat.attack(eye, aim(), 1).reason, 'no-target');
  mob.body.place(12.5, 5, 10.5);
  w.setBlock(11, 6, 10, STONE); // block in the line of fire
  assert.equal(combat.findTarget(eye, aim()), null);
  assert.equal(combat.attack(eye, aim(), 2).reason, 'no-target');
  assert.equal(mob.health, 40);
  w.setBlock(11, 6, 10, AIR);
  assert.equal(combat.attack(eye, aim(), 3).ok, true);
});

test('melee picks the nearest creature along the crosshair ray', () => {
  const w = flatWorld();
  const m = new MobManager(w);
  m.mobs = [new Mob(MOB_TYPES.mossling, w, 0, 1), new Mob(MOB_TYPES.mossling, w, 1, 2)];
  m.mobs[0].respawn(13, 5, 10.5);
  m.mobs[1].respawn(12, 5, 10.5);
  const combat = new PlayerCombat(w, m);
  const r = combat.attack({ x: 10.5, y: 5.4, z: 10.5 }, { x: 1, y: 0, z: 0 }, 1);
  assert.equal(r.ok, true);
  assert.equal(r.mob, m.mobs[1]);
});

test('a hit knocks the creature back and stuns it briefly', () => {
  const { m, combat, eye, mob, aim } = combatSetup('mossling');
  combat.attack(eye, aim(), 1);
  assert.ok(mob.body.velocity.x > 0, 'pushed away from the player');
  assert.ok(mob.stun > 0);
  run(m, 0.6, null);
  assert.equal(mob.stun, 0);
  assert.equal(mob.body.collidesAt(), false);
});

// --------------------------------------------------------------- respawn

test('respawning resets every creature to full health at its spawn spot', () => {
  const w = new World();
  const spawn = w.findSpawnPoint();
  const m = new MobManager(w);
  const spots = m.spawnAll(spawn);
  for (const mob of m.mobs) mob.takeHit(100, 1, 0);
  run(m, 2, null);
  assert.ok(m.mobs.every((mob) => mob.state === 'dead'));
  const again = m.spawnAll(spawn);
  assert.deepEqual(again, spots);
  for (const mob of m.mobs) {
    assert.equal(mob.alive, true);
    assert.equal(mob.health, mob.type.maxHealth);
  }
  assert.equal(m.aliveCount, 4);
});

test('cells occupied by a creature are reported (placement must not trap it)', () => {
  const w = flatWorld();
  const m = single(w, 'stoneguard', 10.5, 5, 10.5);
  assert.equal(m.occupiesCell(10, 5, 10), true);
  assert.equal(m.occupiesCell(10, 6, 10), true);
  assert.equal(m.occupiesCell(10, 7, 10), false);
  assert.equal(m.occupiesCell(12, 5, 10), false);
  m.mobs[0].takeHit(100, 1, 0);
  assert.equal(m.occupiesCell(10, 5, 10), false, 'dying creatures no longer block');
});

// ----------------------------------------------------------- timing

test('chase movement is frame-rate independent', () => {
  const positions = [];
  for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
    const w = flatWorld();
    const m = single(w, 'mossling', 6.5, 5, 10.5);
    run(m, 3, { x: 15.5, y: 5.9, z: 10.5 }, dt);
    positions.push(m.mobs[0].position.x);
  }
  const spread = Math.max(...positions) - Math.min(...positions);
  assert.ok(spread < 0.08, `positions ${positions.map((p) => p.toFixed(3))}`);
});

test('regression: Mosslings still reach and hit a player standing one block higher', () => {
  for (const [label, build, player] of [
    // A single placed block (pillar) to stand on.
    ['pillar', (w) => w.setBlock(14, 5, 10, STONE), { x: 14.5, y: 6 + 0.9, z: 10.5 }],
    // A one-block ledge with the player near its edge.
    ['ledge edge', (w) => { for (let z = 0; z < w.size; z++) for (let x = 14; x < w.size; x++) w.setBlock(x, 5, z, STONE); }, { x: 14.4, y: 6 + 0.9, z: 10.5 }],
    // ...and deeper on the ledge.
    ['ledge', (w) => { for (let z = 0; z < w.size; z++) for (let x = 14; x < w.size; x++) w.setBlock(x, 5, z, STONE); }, { x: 15, y: 6 + 0.9, z: 10.5 }],
  ]) {
    const w = flatWorld();
    build(w);
    const m = single(w, 'mossling', 9.5, 5, 10.5);
    const events = track(m);
    run(m, 12, player);
    const hits = events.filter((e) => e.type === 'hit').length;
    assert.ok(hits >= 3, `${label}: ${hits} hits`);
    assert.equal(m.mobs[0].body.collidesAt(), false);
  }
});

test('a Stoneguard slam is not cancelled by being hit; a Mossling lunge is', () => {
  for (const [typeId, expectHit] of [['stoneguard', true], ['mossling', false]]) {
    const w = flatWorld();
    const m = new MobManager(w);
    m.mobs = [new Mob(stationary(typeId), w, 0, 5)];
    const mob = m.mobs[0];
    mob.respawn(10.5, 5, 10.5);
    mob.cooldown = 0;
    const events = track(m);
    const target = { x: 11.9, y: 5 + mob.type.height / 2, z: 10.5 };
    run(m, 0.1, target); // wind-up started
    assert.equal(mob.state, 'attack');
    mob.takeHit(5, 1, 0);
    mob.body.place(10.5, 5, 10.5); // ignore knockback for this check
    run(m, 0.4, target);
    assert.equal(events.some((e) => e.type === 'hit'), expectHit, typeId);
  }
});

test('regression: a Mossling climbs onto a 1-wide terrace instead of hopping in place', () => {
  // Terrace one block up (x = 14), backed by a 2-high wall at x = 15; the
  // player stands 0.56-0.69 in from the terrace edge (the old failure band).
  for (const offset of [0.56, 0.6, 0.65, 0.69]) {
    const w = flatWorld();
    for (let z = 0; z < w.size; z++) {
      w.setBlock(14, 5, z, STONE);
      for (let y = 5; y <= 7; y++) w.setBlock(15, y, z, STONE);
    }
    const m = single(w, 'mossling', 9.5, 5, 10.5);
    const events = track(m);
    run(m, 12, { x: 14 + offset, y: 6 + 0.9, z: 10.5 });
    const hits = events.filter((e) => e.type === 'hit').length;
    const misses = events.filter((e) => e.type === 'miss').length;
    assert.ok(hits >= 4, `offset ${offset}: ${hits} hits, ${misses} misses`);
  }
});

test('regression: creatures step off a 2-block ledge to reach a player below', () => {
  for (const typeId of ['stoneguard', 'mossling']) {
    const w = flatWorld();
    // A 2-block-high plateau for x <= 11; the player waits at its foot.
    for (let z = 0; z < w.size; z++) for (let x = 0; x <= 11; x++) for (let y = 5; y <= 6; y++) w.setBlock(x, y, z, STONE);
    const m = single(w, typeId, 8.5, 7, 10.5);
    const events = track(m);
    run(m, 10, { x: 12.35, y: 5 + 0.9, z: 10.5 });
    const hits = events.filter((e) => e.type === 'hit').length;
    assert.ok(hits >= 3, `${typeId}: ${hits} hits`);
    assert.equal(m.mobs[0].body.collidesAt(), false);
  }
});

// ---------------------------------------------- round-3 fuzz regressions

test('regression: a Stoneguard on a 2-high ledge above a player hugging the cliff steps off and attacks', () => {
  const w = flatWorld();
  for (let z = 0; z < w.size; z++) for (let x = 14; x < w.size; x++) for (let y = 5; y <= 6; y++) w.setBlock(x, y, z, STONE);
  const m = single(w, 'stoneguard', 16, 7, 20.43); // approaches along the edge
  const events = track(m);
  run(m, 20, { x: 13.699, y: 5.9, z: 15.5 });
  assert.ok(events.filter((e) => e.type === 'hit').length >= 2);
});

test('regression: no hop-lock where one side of the step is taller', () => {
  const w = flatWorld();
  for (let z = 0; z < w.size; z++) for (let x = 14; x < w.size; x++) w.setBlock(x, 5, z, STONE);
  for (let z = 0; z <= 9; z++) for (let x = 14; x < w.size; x++) w.setBlock(x, 6, z, STONE);
  const m = single(w, 'mossling', 10.5, 5, 10.3);
  const events = track(m);
  run(m, 15, { x: 14.35, y: 6.9, z: 10.3 });
  assert.ok(events.filter((e) => e.type === 'hit').length >= 4);
});

test('regression: a chasing creature gets around a single tree trunk', () => {
  const w = flatWorld();
  for (let y = 5; y <= 8; y++) w.setBlock(12, y, 10, WOOD);
  const m = single(w, 'mossling', 9.5, 5, 10.5);
  const events = track(m);
  run(m, 15, { x: 14.5, y: 5.9, z: 10.5 });
  assert.ok(events.filter((e) => e.type === 'hit').length >= 2);
});

test('regression: a wandering creature never freezes against the world edge', () => {
  const w = flatWorld();
  const m = single(w, 'mossling', 31.6499, 5, 16.5);
  const mob = m.mobs[0];
  mob.yaw = -Math.PI / 2;
  mob.wander = { x: 1, z: 0, timer: 2, moving: true };
  run(m, 30, null);
  assert.ok(Math.hypot(mob.position.x - 31.65, mob.position.z - 16.5) > 2, `moved to ${mob.position.x.toFixed(2)}`);
});

test('regression: melee range is measured to the real body (3.0, not the padded box)', () => {
  const w = flatWorld();
  const m = single(w, 'mossling', 10.5, 5, 10.5);
  const combat = new PlayerCombat(w, m);
  const face = 10.5 - MOB_TYPES.mossling.width / 2;
  const y = 5 + MOB_TYPES.mossling.height / 2;
  assert.equal(combat.findTarget({ x: face - 3.03, y, z: 10.5 }, { x: 1, y: 0, z: 0 }), null);
  assert.ok(combat.findTarget({ x: face - 2.97, y, z: 10.5 }, { x: 1, y: 0, z: 0 }));
  // Aim slightly beside the body is still forgiven.
  assert.ok(combat.findTarget({ x: face - 2, y, z: 10.5 + 0.35 + 0.04 }, { x: 1, y: 0, z: 0 }));
});

// Game-like loop with real player physics: step, creatures, push-out.
function gameLoop(w, m, player, seconds, input = { forward: 0, strafe: 0, jump: false }, each) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    player.syncPrevious();
    player.step(STEP, input);
    m.update(STEP, MobManager.playerTarget(player, {}));
    m.separatePlayer(player);
    each?.(i);
  }
}

test('regression: a creature never stays inside the player when pushed against a cliff', async () => {
  const { Player } = await import('../src/player/Player.js');
  for (const [typeId, height] of [['mossling', 3], ['stoneguard', 2]]) {
    const w = flatWorld();
    for (let z = 0; z < w.size; z++) for (let x = 14; x < w.size; x++) for (let y = 5; y < 5 + height; y++) w.setBlock(x, y, z, STONE);
    const player = new Player(w);
    player.spawn({ x: 13.695, y: 5, z: 15.5 });
    const m = single(w, typeId, 17, 5 + height, 15.5);
    let overlapSteps = 0;
    const steps = Math.round(15 / STEP);
    gameLoop(w, m, player, 15, undefined, () => {
      const pb = player.getBox();
      const mb = m.mobs[0].body.getBox();
      const ox = Math.min(pb.maxX, mb.maxX) - Math.max(pb.minX, mb.minX);
      const oz = Math.min(pb.maxZ, mb.maxZ) - Math.max(pb.minZ, mb.minZ);
      const oy = Math.min(pb.maxY, mb.maxY) - Math.max(pb.minY, mb.minY);
      if (ox > 1e-3 && oz > 1e-3 && oy > 1e-3) overlapSteps++;
    });
    assert.ok(overlapSteps / steps < 0.02, `${typeId}: overlapping ${(100 * overlapSteps / steps).toFixed(1)}% of the time`);
    assert.equal(player.collidesAt(), false);
    assert.equal(m.mobs[0].body.collidesAt(), false);
  }
});

test('regression: a creature does not walk under a jumping player and shove them', async () => {
  const { Player } = await import('../src/player/Player.js');
  const w = flatWorld();
  const player = new Player(w);
  player.spawn({ x: 16.5, y: 5, z: 16.5 });
  const m = single(w, 'mossling', 10.5, 5, 16.5);
  gameLoop(w, m, player, 60, { forward: 0, strafe: 0, jump: true });
  const moved = Math.hypot(player.position.x - 16.5, player.position.z - 16.5);
  assert.ok(moved < 1, `player shoved ${moved.toFixed(2)} units`);
});

// ---------------------------------------------- round-4 fuzz regressions

test('regression: creatures follow a 1-wide corridor to the player (no wall ping-pong)', () => {
  for (const [typeId, mobX] of [['stoneguard', 14.5], ['mossling', 14.65]]) {
    const w = flatWorld();
    for (let z = 6; z <= 24; z++) for (let y = 5; y <= 7; y++) {
      w.setBlock(13, y, z, STONE);
      w.setBlock(15, y, z, STONE);
    }
    const m = single(w, typeId, mobX, 5, 18.5);
    const events = track(m);
    run(m, 15, { x: 14.305, y: 5.9, z: 15.5 });
    assert.ok(events.filter((e) => e.type === 'hit').length >= 4, typeId);
  }
});

test('regression: creatures get around a trunk when the player is off to one side', () => {
  for (const typeId of ['stoneguard', 'mossling']) {
    const w = flatWorld();
    for (let y = 5; y <= 8; y++) w.setBlock(12, y, 10, WOOD);
    const m = single(w, typeId, 9.5, 5, 10.5);
    const events = track(m);
    run(m, 20, { x: 15, y: 5.9, z: 11.4 });
    assert.ok(events.filter((e) => e.type === 'hit').length >= 2, typeId);
  }
});

test('regression: a Mossling climbs the diagonal seed-42 staircase from its spawn', () => {
  const w = new World();
  const m = single(w, 'mossling', 29.5, 11, 11.5);
  const events = track(m);
  run(m, 15, { x: 27.6, y: 15 + 0.9, z: 8.62 });
  assert.ok(events.filter((e) => e.type === 'hit').length >= 3);
});

test('regression: a Stoneguard waits on the rim instead of dropping into a 1x1 pit onto the player', async () => {
  const { Player } = await import('../src/player/Player.js');
  const w = flatWorld(6);
  w.setBlock(14, 5, 15, AIR);
  w.setBlock(14, 6, 15, AIR);
  const player = new Player(w);
  player.spawn({ x: 14.5, y: 5, z: 15.5 });
  const m = single(w, 'stoneguard', 17.5, 7, 15.5);
  let overlapSteps = 0;
  gameLoop(w, m, player, 20, undefined, () => {
    if (m.overlapWith(player, m.mobs[0])) overlapSteps++;
  });
  assert.equal(overlapSteps, 0);
  assert.equal(m.mobs[0].body.collidesAt(), false);
});

test('regression: push-out never snaps the player (creature landing on them moves instead)', async () => {
  const { Player } = await import('../src/player/Player.js');
  const w = flatWorld();
  for (let z = 0; z < w.size; z++) for (let x = 14; x < w.size; x++) for (let y = 5; y <= 6; y++) w.setBlock(x, y, z, STONE);
  const player = new Player(w);
  player.spawn({ x: 13.305, y: 5, z: 8.695 });
  const m = single(w, 'stoneguard', 15.305, 7, 8.695);
  let maxStep = 0;
  let prev = { x: player.position.x, z: player.position.z };
  gameLoop(w, m, player, 10, undefined, () => {
    const d = Math.hypot(player.position.x - prev.x, player.position.z - prev.z);
    maxStep = Math.max(maxStep, d);
    prev = { x: player.position.x, z: player.position.z };
  });
  assert.ok(maxStep <= 0.21, `largest single-step player move ${maxStep.toFixed(3)}`);
});

test('regression: a player squeezed between two creatures is not left inside either', async () => {
  const { Player } = await import('../src/player/Player.js');
  const w = flatWorld();
  for (let x = 0; x < w.size; x++) for (let y = 5; y <= 7; y++) w.setBlock(x, y, 3, STONE);
  const player = new Player(w);
  player.spawn({ x: 15.45, y: 5, z: 4.31 });
  const m = new MobManager(w);
  m.mobs = [new Mob(MOB_TYPES.stoneguard, w, 0, 1), new Mob(MOB_TYPES.mossling, w, 1, 2)];
  m.mobs[0].respawn(15.9, 5, 4.46);
  m.mobs[1].respawn(14.95, 5, 4.75);
  for (let i = 0; i < 5; i++) m.separatePlayer(player);
  assert.ok(m.mobs.every((mob) => !m.overlapWith(player, mob)));
  assert.equal(player.collidesAt(), false);
  assert.ok(m.mobs.every((mob) => !mob.body.collidesAt()));
});

// ---------------------------------------------- round-5 fuzz regressions

test('regression: a Stoneguard steps off a concave ledge corner to reach the player (no freeze above them)', async () => {
  const { Player } = await import('../src/player/Player.js');
  const w = flatWorld();
  for (let z = 0; z < w.size; z++) for (let x = 0; x < w.size; x++) {
    if (x >= 14 || z >= 14) for (let y = 5; y <= 6; y++) w.setBlock(x, y, z, STONE);
  }
  const player = new Player(w);
  player.spawn({ x: 13.695, y: 5, z: 13.695 });
  const m = single(w, 'stoneguard', 15.427, 7, 14.695);
  const events = track(m);
  gameLoop(w, m, player, 20);
  assert.ok(events.filter((e) => e.type === 'hit').length >= 3);
});

test('regression: the push-out budget is per step (no 0.6 shove when a creature grazes the player by a ledge)', async () => {
  const { Player } = await import('../src/player/Player.js');
  const w = flatWorld();
  for (let z = 0; z < w.size; z++) for (let x = 14; x < w.size; x++) for (let y = 5; y <= 6; y++) w.setBlock(x, y, z, STONE);
  const player = new Player(w);
  player.spawn({ x: 13.695, y: 5, z: 8.305 });
  const m = single(w, 'stoneguard', 15.427, 7, 9.305);
  let maxStep = 0;
  gameLoop(w, m, player, 10, undefined, () => {});
  // Re-run measuring each push-out call on its own.
  player.spawn({ x: 13.695, y: 5, z: 8.305 });
  m.mobs[0].respawn(15.427, 7, 9.305);
  m.mobs[0].cooldown = 0;
  for (let i = 0; i < Math.round(10 / STEP); i++) {
    player.syncPrevious();
    player.step(STEP, { forward: 0, strafe: 0, jump: false });
    m.update(STEP, MobManager.playerTarget(player, {}));
    const bx = player.position.x;
    const bz = player.position.z;
    m.separatePlayer(player);
    maxStep = Math.max(maxStep, Math.hypot(player.position.x - bx, player.position.z - bz));
  }
  assert.ok(maxStep <= 0.2 + 1e-6, `largest push-out ${maxStep.toFixed(3)}`);
});
