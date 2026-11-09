import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { AIR, STONE, GRASS, WOOD, HOTBAR_BLOCKS } from '../src/world/blocks.js';
import { Player } from '../src/player/Player.js';
import { raycastVoxels } from '../src/interaction/raycast.js';
import { BlockInteraction } from '../src/interaction/BlockInteraction.js';
import { PLAYER } from '../src/config.js';

function flatWorld(top = 4) {
  const w = new World();
  w.blocks.fill(AIR);
  for (let y = 0; y <= top; y++) {
    for (let z = 0; z < w.size; z++) for (let x = 0; x < w.size; x++) w.blocks[w.index(x, y, z)] = STONE;
  }
  w.base.set(w.blocks);
  return w;
}

function setup() {
  const world = flatWorld();
  const player = new Player(world);
  player.spawn({ x: 10.5, y: 5, z: 10.5 });
  const interaction = new BlockInteraction(world, player);
  const eye = () => ({ x: player.position.x, y: player.position.y + PLAYER.EYE_HEIGHT, z: player.position.z });
  return { world, player, interaction, eye };
}

const snapshot = (w) => Buffer.from(w.blocks).toString('base64');

test('raycast hits the first solid block along the ray with the entered face', () => {
  const w = flatWorld();
  const hit = raycastVoxels(w, { x: 10.5, y: 6.62, z: 10.5 }, { x: 0, y: -1, z: 0 }, 6);
  assert.deepEqual([hit.x, hit.y, hit.z], [10, 4, 10]);
  assert.deepEqual(hit.normal, [0, 1, 0]);
  assert.ok(Math.abs(hit.distance - 1.62) < 1e-9);

  w.setBlock(13, 6, 10, GRASS);
  const side = raycastVoxels(w, { x: 10.5, y: 6.5, z: 10.5 }, { x: 1, y: 0, z: 0 }, 6);
  assert.deepEqual([side.x, side.y, side.z], [13, 6, 10]);
  assert.deepEqual(side.normal, [-1, 0, 0]);
  assert.ok(Math.abs(side.distance - 2.5) < 1e-9);
});

test('raycast respects the reach limit', () => {
  const w = flatWorld();
  w.setBlock(17, 6, 10, GRASS); // face at x = 17, 6.5 from the origin
  assert.equal(raycastVoxels(w, { x: 10.5, y: 6.5, z: 10.5 }, { x: 1, y: 0, z: 0 }, 6), null);
  w.setBlock(16, 6, 10, GRASS); // face at x = 16, 5.5 away
  const hit = raycastVoxels(w, { x: 10.5, y: 6.5, z: 10.5 }, { x: 1, y: 0, z: 0 }, 6);
  assert.equal(hit.x, 16);
});

test('raycast handles degenerate directions and leaving the world', () => {
  const w = flatWorld();
  assert.equal(raycastVoxels(w, { x: 5, y: 10, z: 5 }, { x: 0, y: 0, z: 0 }, 6), null);
  assert.equal(raycastVoxels(w, { x: 5, y: 10, z: 5 }, { x: NaN, y: 0, z: 0 }, 6), null);
  assert.equal(raycastVoxels(w, { x: 0.5, y: 10, z: 5 }, { x: -1, y: 0, z: 0 }, 6), null);
  assert.equal(raycastVoxels(w, { x: 5, y: 10, z: 5 }, { x: 0, y: 1, z: 0 }, 6), null);
});

test('breaking a nearby block removes it', () => {
  const { world, interaction, eye } = setup();
  interaction.updateTarget(eye(), { x: 0, y: -1, z: 0 });
  const r = interaction.breakBlock();
  assert.equal(r.ok, true);
  assert.equal(world.getBlock(10, 4, 10), AIR);
});

test('placing a block against a nearby face adds it', () => {
  const { world, interaction, eye } = setup();
  world.setBlock(12, 5, 10, STONE);
  interaction.updateTarget(eye(), { x: 1, y: -0.6, z: 0 });
  assert.equal(interaction.target.x, 12);
  assert.deepEqual(interaction.target.normal, [-1, 0, 0]);
  const r = interaction.placeBlock(WOOD);
  assert.equal(r.ok, true);
  assert.equal(world.getBlock(11, 5, 10), WOOD);
});

test('every hotbar block can be placed', () => {
  const { world, interaction, eye } = setup();
  for (const id of HOTBAR_BLOCKS) {
    world.setBlock(12, 5, 10, STONE);
    world.setBlock(11, 5, 10, AIR);
    interaction.updateTarget(eye(), { x: 1, y: -0.6, z: 0 });
    assert.equal(interaction.placeBlock(id).ok, true);
    assert.equal(world.getBlock(11, 5, 10), id);
  }
});

test('cannot place a block inside the player', () => {
  const { world, interaction, eye } = setup();
  const before = snapshot(world);
  // Looking straight down: the target cell above the floor is where the feet are.
  interaction.updateTarget(eye(), { x: 0, y: -1, z: 0 });
  const r = interaction.placeBlock(STONE);
  assert.deepEqual(r, { ok: false, reason: 'inside-player' });
  assert.equal(snapshot(world), before);

  // Head level is also protected.
  world.setBlock(10, 7, 11, STONE);
  interaction.updateTarget(eye(), { x: 0, y: 0.2, z: 1 });
  world.setBlock(10, 7, 11, AIR);
  world.setBlock(10, 6, 12, STONE);
  interaction.updateTarget(eye(), { x: 0, y: -0.15, z: 1 });
  assert.equal(interaction.target.z, 12);
  // Target cell (10, 6, 11) is next to the player, not inside: allowed.
  assert.equal(interaction.placeBlock(STONE).ok, true);
});

test('placing into a neighbouring cell the player only touches is allowed', () => {
  const { world, player, interaction } = setup();
  player.position.x = 10.7; // box spans x 10.4..11.0 — touching x = 11
  const r = interaction.placeBlock(STONE, { x: 11, y: 4, z: 10, normal: [0, 1, 0], distance: 2, editable: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(world.getBlock(11, 5, 10), STONE);
});

test('blocks beyond 6 units cannot be edited', () => {
  const { world, interaction, eye } = setup();
  world.setBlock(17, 6, 10, GRASS);
  const before = snapshot(world);
  interaction.updateTarget(eye(), { x: 1, y: 0, z: 0 });
  assert.equal(interaction.target, null, 'out of reach: nothing targeted');
  assert.equal(interaction.breakBlock().ok, false);
  assert.equal(interaction.placeBlock(STONE).ok, false);
  // A forged far target is still rejected.
  const far = { x: 17, y: 6, z: 10, normal: [-1, 0, 0], distance: 6.5, editable: true };
  assert.equal(interaction.breakBlock(far).reason, 'too-far');
  assert.equal(interaction.placeBlock(STONE, far).reason, 'too-far');
  assert.equal(snapshot(world), before);
});

test('edits outside the world boundaries are rejected', () => {
  const { world, interaction } = setup();
  const before = snapshot(world);
  const edge = { x: 31, y: 4, z: 10, normal: [1, 0, 0], distance: 3, editable: true };
  assert.equal(interaction.placeBlock(STONE, edge).reason, 'out-of-bounds');
  const roof = { x: 5, y: world.height - 1, z: 5, normal: [0, 1, 0], distance: 3, editable: true };
  assert.equal(interaction.placeBlock(STONE, roof).reason, 'out-of-bounds');
  const outside = { x: 32, y: 4, z: 10, normal: [0, 1, 0], distance: 3, editable: true };
  assert.equal(interaction.breakBlock(outside).reason, 'out-of-bounds');
  assert.equal(snapshot(world), before);
});

test('the rock base under the world cannot be broken but can be built on', () => {
  const { world, interaction } = setup();
  for (let y = 0; y <= 4; y++) world.setBlock(3, y, 3, AIR);
  const hit = raycastVoxels(world, { x: 3.5, y: 4.5, z: 3.5 }, { x: 0, y: -1, z: 0 }, 6);
  assert.equal(hit.editable, false);
  assert.equal(hit.y, -1);
  assert.equal(interaction.breakBlock(hit).reason, 'unbreakable');
  assert.equal(interaction.placeBlock(STONE, hit).ok, true);
  assert.equal(world.getBlock(3, 0, 3), STONE);
});

test('invalid operations leave the world unchanged', () => {
  const { world, interaction } = setup();
  const before = snapshot(world);
  assert.equal(interaction.breakBlock(null).ok, false);
  assert.equal(interaction.placeBlock(STONE, null).ok, false);
  assert.equal(interaction.placeBlock(AIR, { x: 5, y: 4, z: 5, normal: [0, 1, 0], distance: 2, editable: true }).ok, false);
  assert.equal(interaction.placeBlock(42, { x: 5, y: 4, z: 5, normal: [0, 1, 0], distance: 2, editable: true }).ok, false);
  assert.equal(interaction.breakBlock({ x: 5, y: 10, z: 5, normal: [0, 1, 0], distance: 2, editable: true }).ok, false);
  assert.equal(interaction.placeBlock(STONE, { x: 5, y: 4, z: 5, normal: [0, 0, 0], distance: 0, editable: true }).ok, false);
  assert.equal(interaction.placeBlock(STONE, { x: 5, y: 3, z: 5, normal: [0, 1, 0], distance: 2, editable: true }).reason, 'occupied');
  assert.equal(snapshot(world), before);
});

test('placement is rejected when the player box reaches even slightly into the cell', () => {
  const { world, player, interaction } = setup();
  player.position.x = 10.7005; // box maxX = 11.0005: 0.5 mm into column x = 11
  const target = { x: 11, y: 4, z: 10, normal: [0, 1, 0], distance: 2, editable: true };
  assert.equal(interaction.placeBlock(STONE, target).reason, 'inside-player');
  assert.equal(world.getBlock(11, 5, 10), AIR);
});

test('property: an accepted placement never overlaps the player collision box', () => {
  const { world, player, interaction } = setup();
  let seed = 12345;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  let accepted = 0;
  for (let i = 0; i < 4000; i++) {
    player.position.x = 9.6 + rand() * 2.8;
    player.position.z = 9.6 + rand() * 2.8;
    player.position.y = 5 + (rand() < 0.5 ? 1e-4 : rand() * 1.5);
    const x = 9 + Math.floor(rand() * 5);
    const y = 5 + Math.floor(rand() * 3);
    const z = 9 + Math.floor(rand() * 5);
    const target = { x, y: y - 1, z, normal: [0, 1, 0], distance: 2, editable: true };
    const hadSupport = world.getBlock(x, y - 1, z) !== AIR;
    world.setBlock(x, y - 1, z, STONE); // support block (test setup, bypasses the rules)
    if (player.collidesAt()) {
      if (!hadSupport) world.setBlock(x, y - 1, z, AIR);
      continue;
    }
    const r = interaction.placeBlock(STONE, target);
    if (r.ok) {
      accepted++;
      assert.equal(player.collidesAt(), false, `overlap at ${JSON.stringify(player.position)} cell ${x},${y},${z}`);
      world.setBlock(x, y, z, AIR);
    }
    if (!hadSupport) world.setBlock(x, y - 1, z, AIR);
  }
  assert.ok(accepted > 500, `exercised ${accepted} accepted placements`);
});
