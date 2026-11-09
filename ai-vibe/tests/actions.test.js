import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { AIR, STONE, GRASS, WOOD, LEAVES, DIRT } from '../src/world/blocks.js';
import { Player } from '../src/player/Player.js';
import { BlockInteraction } from '../src/interaction/BlockInteraction.js';
import { BlockActions, distanceToCell } from '../src/interaction/BlockActions.js';
import { PLAYER, INTERACTION } from '../src/config.js';

const FRAME = 1 / 60;

function setup() {
  const world = new World();
  world.blocks.fill(AIR);
  for (let y = 0; y <= 4; y++) {
    for (let z = 0; z < world.size; z++) for (let x = 0; x < world.size; x++) world.blocks[world.index(x, y, z)] = STONE;
  }
  world.base.set(world.blocks);
  const player = new Player(world);
  player.spawn({ x: 10.5, y: 5, z: 10.5 });
  const interaction = new BlockInteraction(world, player);
  const actions = new BlockActions(world, player, interaction);
  const events = [];
  actions.on((e) => events.push(e));
  const eye = () => ({ x: player.position.x, y: player.position.y + PLAYER.EYE_HEIGHT, z: player.position.z });
  const aim = (dir) => interaction.updateTarget(eye(), dir);
  const run = (seconds) => {
    const n = Math.round(seconds / FRAME);
    for (let i = 0; i < n; i++) actions.update(FRAME, eye());
  };
  return { world, player, interaction, actions, events, eye, aim, run };
}

const snapshot = (w) => Buffer.from(w.blocks).toString('base64');
const DOWN = { x: 0, y: -1, z: 0 };
const EAST_LOW = { x: 1, y: -0.6, z: 0 };

test('distanceToCell measures to the closest point of the cube', () => {
  assert.equal(distanceToCell({ x: 0.5, y: 0.5, z: 0.5 }, 0, 0, 0), 0);
  assert.equal(distanceToCell({ x: 3, y: 0.5, z: 0.5 }, 0, 0, 0), 2);
  assert.ok(Math.abs(distanceToCell({ x: 2, y: 2, z: 0.5 }, 0, 0, 0) - Math.SQRT2) < 1e-12);
});

test('mining keeps the block until ~1 s has passed, then removes it once', () => {
  const { world, actions, events, aim, run } = setup();
  aim(DOWN);
  const r = actions.startBreak(aim(DOWN));
  assert.equal(r.ok, true);
  assert.equal(actions.busy, true);
  run(INTERACTION.BREAK_DURATION - 0.1);
  assert.equal(world.getBlock(10, 4, 10), STONE, 'still visible mid-animation');
  assert.ok(actions.progress > 0.85 && actions.progress < 1);
  run(0.15);
  assert.equal(world.getBlock(10, 4, 10), AIR);
  assert.equal(actions.busy, false);
  assert.deepEqual(events.map((e) => e.type), ['start', 'complete']);
  assert.equal(events[1].result.id, STONE);
});

test('construction leaves the world untouched until it completes', () => {
  const { world, actions, events, aim, run } = setup();
  world.setBlock(12, 5, 10, STONE);
  const before = snapshot(world);
  assert.equal(actions.startPlace(aim(EAST_LOW), WOOD).ok, true);
  run(INTERACTION.PLACE_DURATION - 0.1);
  assert.equal(snapshot(world), before);
  run(0.15);
  assert.equal(world.getBlock(11, 5, 10), WOOD);
  assert.deepEqual(events.map((e) => e.type), ['start', 'complete']);
});

test('the block type selected when construction began is the one placed', () => {
  const { world, actions, aim, run } = setup();
  world.setBlock(12, 5, 10, STONE);
  let selected = LEAVES;
  actions.startPlace(aim(EAST_LOW), selected);
  selected = DIRT; // the player switches slots mid-animation
  run(1.2);
  assert.equal(world.getBlock(11, 5, 10), LEAVES);
  void selected;
});

test('only one interaction can be active at a time', () => {
  const { world, actions, aim, run } = setup();
  world.setBlock(12, 5, 10, STONE);
  assert.equal(actions.startBreak(aim(DOWN)).ok, true);
  assert.equal(actions.startBreak(aim(DOWN)).reason, 'busy');
  assert.equal(actions.startPlace(aim(EAST_LOW), WOOD).reason, 'busy');
  run(1.1);
  assert.equal(world.getBlock(10, 4, 10), AIR);
  assert.equal(world.getBlock(11, 5, 10), AIR, 'rejected placement never happened');
});

test('invalid starts are rejected and change nothing', () => {
  const { world, actions, interaction, aim } = setup();
  const before = snapshot(world);
  assert.equal(actions.startBreak(null).reason, 'no-target');
  assert.equal(actions.startPlace(null, STONE).reason, 'no-target');
  assert.equal(actions.startPlace(aim(DOWN), STONE).reason, 'inside-player');
  assert.equal(actions.startPlace(aim(DOWN), AIR).reason, 'invalid-block');
  world.setBlock(17, 6, 10, GRASS);
  assert.equal(interaction.updateTarget({ x: 10.5, y: 6.5, z: 10.5 }, { x: 1, y: 0, z: 0 }), null);
  const far = { x: 17, y: 6, z: 10, normal: [-1, 0, 0], distance: 6.5, editable: true };
  assert.equal(actions.startBreak(far).reason, 'too-far');
  assert.equal(actions.startPlace(far, STONE).reason, 'too-far');
  const air = { x: 10, y: 8, z: 10, normal: [0, 1, 0], distance: 2, editable: true };
  assert.equal(actions.startBreak(air).reason, 'no-target');
  const base = { x: 3, y: -1, z: 3, normal: [0, 1, 0], distance: 2, editable: false };
  assert.equal(actions.startBreak(base).reason, 'unbreakable');
  world.setBlock(17, 6, 10, AIR);
  assert.equal(snapshot(world), before);
  assert.equal(actions.busy, false);
});

test('walking out of reach cancels mining without changing the world', () => {
  const { world, player, actions, events, aim, run } = setup();
  actions.startBreak(aim(DOWN));
  const before = snapshot(world);
  run(0.3);
  player.position.x = 20.5; // > 6 units from the block at x = 10
  run(0.05);
  assert.equal(actions.busy, false);
  assert.equal(events.at(-1).type, 'cancel');
  assert.equal(events.at(-1).reason, 'too-far');
  run(1);
  assert.equal(snapshot(world), before);
});

test('construction is cancelled if the player steps into the cell', () => {
  const { world, player, actions, events, aim, run } = setup();
  world.setBlock(12, 5, 10, STONE);
  const before = snapshot(world);
  actions.startPlace(aim(EAST_LOW), STONE);
  run(0.4);
  player.position.x = 11.2; // now overlapping cell x = 11
  run(0.05);
  assert.equal(events.at(-1).reason, 'inside-player');
  run(1);
  assert.equal(snapshot(world), before);
});

test('a block changed by something else cancels mining; a filled cell cancels construction', () => {
  const { world, actions, events, aim, run } = setup();
  actions.startBreak(aim(DOWN));
  run(0.2);
  world.setBlock(10, 4, 10, DIRT);
  run(0.05);
  assert.equal(events.at(-1).reason, 'changed');
  assert.equal(world.getBlock(10, 4, 10), DIRT);

  world.setBlock(12, 5, 10, STONE);
  actions.startPlace(aim(EAST_LOW), WOOD);
  run(0.2);
  world.setBlock(11, 5, 10, GRASS);
  run(0.05);
  assert.equal(events.at(-1).reason, 'occupied');
  assert.equal(world.getBlock(11, 5, 10), GRASS);
});

test('reset (world reload) and external cancel stop the action safely', () => {
  const { world, actions, events, aim, run } = setup();
  actions.startBreak(aim(DOWN));
  run(0.5);
  world.resetToBase();
  assert.equal(actions.busy, false);
  assert.equal(events.at(-1).reason, 'world-reloaded');
  run(1);
  assert.equal(world.getBlock(10, 4, 10), STONE);

  actions.startBreak(aim(DOWN));
  run(0.5);
  assert.equal(actions.cancel('paused'), true);
  assert.equal(actions.cancel('paused'), false, 'second cancel is a no-op');
  run(1);
  assert.equal(world.getBlock(10, 4, 10), STONE);
});

test('long or irregular frames still complete exactly once', () => {
  const { world, actions, events, eye, aim } = setup();
  actions.startBreak(aim(DOWN));
  actions.update(0.4, eye());
  actions.update(0, eye());
  actions.update(NaN, eye());
  actions.update(0.7, eye());
  actions.update(0.7, eye());
  assert.equal(world.getBlock(10, 4, 10), AIR);
  assert.equal(events.filter((e) => e.type === 'complete').length, 1);
});
