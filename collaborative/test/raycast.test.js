import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../src/world/world.js'
import { BLOCK } from '../src/world/blocks.js'
import { raycastBlocks, segmentIsClear } from '../src/world/raycast.js'

function worldWith(blocks) {
  const world = createWorld({ size: 16, height: 16 })
  for (const [x, y, z] of blocks) world.setBlock(x, y, z, BLOCK.STONE)
  return world
}

test('ray hits the first block and reports the entry face', () => {
  const world = worldWith([[5, 2, 2], [7, 2, 2]])
  const hit = raycastBlocks(world, { x: 1.5, y: 2.5, z: 2.5 }, { x: 1, y: 0, z: 0 }, 6)
  assert.equal(hit.x, 5)
  assert.equal(hit.y, 2)
  assert.equal(hit.z, 2)
  assert.deepEqual(hit.normal, { x: -1, y: 0, z: 0 })
  assert.ok(Math.abs(hit.distance - 3.5) < 1e-9)
})

test('ray respects maximum distance (reach limit)', () => {
  const world = worldWith([[8, 2, 2]])
  const origin = { x: 1.5, y: 2.5, z: 2.5 }
  assert.equal(raycastBlocks(world, origin, { x: 1, y: 0, z: 0 }, 6), null, '6.5 units away is out of reach')
  assert.ok(raycastBlocks(world, origin, { x: 1, y: 0, z: 0 }, 7))
})

test('downward ray reports a top face normal', () => {
  const world = worldWith([[3, 1, 3]])
  const hit = raycastBlocks(world, { x: 3.5, y: 4.2, z: 3.5 }, { x: 0, y: -1, z: 0 }, 6)
  assert.deepEqual([hit.x, hit.y, hit.z], [3, 1, 3])
  assert.deepEqual(hit.normal, { x: 0, y: 1, z: 0 })
})

test('diagonal ray does not skip cells', () => {
  const world = worldWith([[4, 4, 4]])
  const hit = raycastBlocks(world, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 1, z: 1 }, 10)
  assert.deepEqual([hit.x, hit.y, hit.z], [4, 4, 4])
})

test('degenerate inputs miss safely', () => {
  const world = worldWith([[1, 1, 1]])
  assert.equal(raycastBlocks(world, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 6), null)
  assert.equal(raycastBlocks(world, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0), null)
})

test('segmentIsClear detects walls between two points', () => {
  const world = worldWith([[5, 1, 1]])
  assert.equal(segmentIsClear(world, { x: 3.5, y: 1.5, z: 1.5 }, { x: 7.5, y: 1.5, z: 1.5 }), false)
  assert.equal(segmentIsClear(world, { x: 3.5, y: 2.5, z: 1.5 }, { x: 7.5, y: 2.5, z: 1.5 }), true)
  assert.equal(segmentIsClear(world, { x: 3.5, y: 1.5, z: 1.5 }, { x: 4.9, y: 1.5, z: 1.5 }), true)
})

test('rays with unbounded distance terminate when leaving the world', () => {
  const world = worldWith([[1, 1, 1]])
  assert.equal(raycastBlocks(world, { x: 5.5, y: 5.5, z: 5.5 }, { x: 0.2, y: 1, z: 0.1 }, Infinity), null)
  assert.equal(raycastBlocks(world, { x: -40, y: 5.5, z: 5.5 }, { x: -1, y: 0, z: 0 }, Infinity), null)
  const fromOutside = raycastBlocks(world, { x: -3.5, y: 1.5, z: 1.5 }, { x: 1, y: 0, z: 0 }, Infinity)
  assert.deepEqual([fromOutside.x, fromOutside.y, fromOutside.z], [1, 1, 1], 'rays entering from outside still hit')
})
