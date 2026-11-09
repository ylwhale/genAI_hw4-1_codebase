import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorld, voxelIndex } from '../src/world/world.js'
import { BLOCK, HOTBAR_BLOCKS, getBlockType, isSolidBlock, isValidBlockId } from '../src/world/blocks.js'
import { WORLD_SIZE } from '../src/config.js'

test('block registry exposes the five hotbar blocks in order', () => {
  assert.deepEqual(HOTBAR_BLOCKS.map((id) => getBlockType(id).key), ['grass', 'dirt', 'stone', 'wood', 'leaves'])
  assert.ok(!isSolidBlock(BLOCK.AIR))
  for (const id of HOTBAR_BLOCKS) assert.ok(isSolidBlock(id))
  assert.ok(!isValidBlockId(99))
  assert.ok(!isValidBlockId(1.5))
})

test('default world is 32 x 32 horizontally and starts empty', () => {
  const world = createWorld()
  assert.equal(world.size, WORLD_SIZE)
  assert.equal(world.size, 32)
  assert.equal(world.getBlock(0, 0, 0), BLOCK.AIR)
  assert.equal(world.surfaceHeight(5, 5), -1)
})

test('bounds: 0..31 valid, everything else rejected', () => {
  const world = createWorld()
  assert.ok(world.inBounds(0, 0, 0))
  assert.ok(world.inBounds(31, world.height - 1, 31))
  for (const [x, y, z] of [[-1, 0, 0], [32, 0, 0], [0, 0, 32], [0, -1, 0], [0, world.height, 0], [0.5, 0, 0]]) {
    assert.ok(!world.inBounds(x, y, z), `${x},${y},${z} should be out of bounds`)
    assert.equal(world.setBlock(x, y, z, BLOCK.STONE), false)
    assert.equal(world.getBlock(x, y, z), BLOCK.AIR)
  }
})

test('setBlock stores, reports changes, and emits events', () => {
  const world = createWorld({ size: 4, height: 4 })
  const events = []
  world.subscribe((event) => events.push(event))
  assert.equal(world.setBlock(1, 2, 3, BLOCK.WOOD), true)
  assert.equal(world.getBlock(1, 2, 3), BLOCK.WOOD)
  assert.equal(world.setBlock(1, 2, 3, BLOCK.WOOD), false, 'no-op writes are not changes')
  assert.equal(world.setBlock(1, 2, 3, 42), false, 'unknown ids are rejected')
  assert.deepEqual(events, [{ type: 'block', x: 1, y: 2, z: 3, previous: BLOCK.AIR, next: BLOCK.WOOD }])
  assert.equal(world.surfaceHeight(1, 3), 2)
})

test('collision view walls off the outside and the floor', () => {
  const world = createWorld({ size: 4, height: 4 })
  assert.ok(world.isSolidForCollision(-1, 1, 1))
  assert.ok(world.isSolidForCollision(4, 1, 1))
  assert.ok(world.isSolidForCollision(1, -1, 1))
  assert.ok(!world.isSolidForCollision(1, 4, 1))
  assert.ok(!world.isSolidForCollision(1, 1, 1))
})

test('replaceAll swaps data and emits a single reset event', () => {
  const world = createWorld({ size: 2, height: 2 })
  const events = []
  world.subscribe((event) => events.push(event.type))
  const data = world.snapshot()
  data.fill(BLOCK.DIRT)
  world.replaceAll(data)
  assert.equal(world.getBlock(1, 1, 1), BLOCK.DIRT)
  assert.deepEqual(events, ['reset'])
  assert.throws(() => world.replaceAll(new Uint8Array(3)))
})

test('world.index uses the shared voxelIndex layout', () => {
  const world = createWorld({ size: 8, height: 6 })
  for (const [x, y, z] of [[0, 0, 0], [7, 0, 0], [0, 5, 0], [0, 0, 7], [3, 2, 5]]) {
    assert.equal(world.index(x, y, z), voxelIndex(8, x, y, z))
  }
  world.setBlock(3, 2, 5, BLOCK.WOOD)
  assert.equal(world.snapshot()[voxelIndex(8, 3, 2, 5)], BLOCK.WOOD)
})
