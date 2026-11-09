import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BufferGeometry, Mesh, MeshLambertMaterial, Scene } from 'three'
import { createWorldView } from '../src/render/worldView.js'
import { meshChunk } from '../src/render/chunkMesher.js'
import { createBlockAtlas } from '../src/render/textures.js'
import { createWorld } from '../src/world/world.js'
import { BLOCK } from '../src/world/blocks.js'
import { createRng } from '../src/core/rng.js'
import { CHUNK_SIZE } from '../src/config.js'
import { createFlatWorld } from './helpers.js'

const atlas = createBlockAtlas()

// 16x16 world with 8x8 chunks -> a 2x2 chunk grid.
function setup({ size = 16, height = 8, groundTop = 2 } = {}) {
  const world = createFlatWorld({ size, height, groundTop })
  const scene = new Scene()
  const view = createWorldView({ world, scene, atlas, chunkSize: 8 })
  return { world, scene, view }
}

const keys = (chunks) => chunks.map(({ cx, cz }) => `${cx},${cz}`)

// Every chunk mesh must equal a fresh mesh of the current world data.
function assertMatchesWorld(world, view, chunkSize = 8) {
  const columns = Math.ceil(world.size / chunkSize)
  for (let cz = 0; cz < columns; cz++) {
    for (let cx = 0; cx < columns; cx++) {
      const expected = meshChunk(world, cx * chunkSize, cz * chunkSize, chunkSize, atlas.uvFor)
      const mesh = view.meshAt(cx, cz)
      if (expected.faceCount === 0) {
        assert.equal(mesh, null, `chunk ${cx},${cz} has no mesh when empty`)
        continue
      }
      const { attributes, index } = mesh.geometry
      assert.deepEqual(attributes.position.array, expected.positions, `chunk ${cx},${cz} positions`)
      assert.deepEqual(attributes.color.array, expected.colors, `chunk ${cx},${cz} AO colours`)
      assert.deepEqual(attributes.uv.array, expected.uvs, `chunk ${cx},${cz} uvs`)
      assert.deepEqual(index.array, expected.indices, `chunk ${cx},${cz} indices`)
    }
  }
}

test('builds one shadowed mesh per non-empty chunk with a shared textured Lambert material', () => {
  const { world, scene, view } = setup()
  assert.ok(scene.children.includes(view.group))
  assert.equal(view.chunkCount, 4)
  assert.equal(view.meshCount, 4)
  assert.equal(view.geometryCount, 4)
  assert.deepEqual(view.dirtyChunks(), [], 'built immediately on creation')

  assert.ok(view.material instanceof MeshLambertMaterial)
  assert.equal(view.material.map, atlas.texture)
  assert.equal(view.material.vertexColors, true)
  for (const mesh of view.group.children) {
    assert.ok(mesh instanceof Mesh)
    assert.ok(mesh.geometry instanceof BufferGeometry)
    assert.equal(mesh.material, view.material)
    assert.equal(mesh.castShadow, true)
    assert.equal(mesh.receiveShadow, true)
    assert.ok(mesh.geometry.boundingSphere, 'bounding sphere ready for frustum culling')
    for (const name of ['position', 'normal', 'uv', 'color']) assert.ok(mesh.geometry.attributes[name], name)
  }
  assertMatchesWorld(world, view)
})

test('default chunk size comes from config and covers the whole world', () => {
  const world = createWorld()
  const view = createWorldView({ world, scene: new Scene(), atlas })
  const perAxis = Math.ceil(world.size / CHUNK_SIZE)
  assert.equal(view.chunkCount, perAxis * perAxis)
  assert.equal(view.meshCount, 0, 'an empty world has no meshes')
})

test('an interior edit marks only its own chunk', () => {
  const { world, view } = setup()
  world.setBlock(3, 3, 3, BLOCK.STONE)
  assert.deepEqual(keys(view.dirtyChunks()), ['0,0'])
})

test('an edit on a chunk edge marks the neighbour across that edge', () => {
  const { world, view } = setup()
  world.setBlock(7, 3, 3, BLOCK.STONE)
  assert.deepEqual(keys(view.dirtyChunks()), ['0,0', '1,0'])
  view.update()
  world.setBlock(3, 3, 8, BLOCK.STONE)
  assert.deepEqual(keys(view.dirtyChunks()), ['0,0', '0,1'])
})

test('an edit on a chunk corner marks all four chunks, including the diagonal', () => {
  const { world, view } = setup()
  world.setBlock(8, 3, 8, BLOCK.STONE)
  assert.deepEqual(keys(view.dirtyChunks()), ['0,0', '1,0', '0,1', '1,1'])
  view.update()
  world.setBlock(7, 3, 7, BLOCK.AIR) // no change: nothing marked
  assert.deepEqual(view.dirtyChunks(), [])
  world.setBlock(7, 2, 7, BLOCK.AIR)
  assert.equal(view.dirtyChunks().length, 4)
})

test('edits on the world border never mark chunks outside the world', () => {
  const { world, view } = setup()
  world.setBlock(0, 3, 0, BLOCK.STONE)
  assert.deepEqual(keys(view.dirtyChunks()), ['0,0'])
  view.update()
  world.setBlock(15, 3, 15, BLOCK.STONE)
  assert.deepEqual(keys(view.dirtyChunks()), ['1,1'])
})

test('a reset marks every chunk and update() rebuilds them all', () => {
  const { world, view } = setup()
  const fresh = createFlatWorld({ size: 16, height: 8, groundTop: 5 })
  world.replaceAll(fresh.snapshot())
  assert.equal(view.dirtyChunks().length, 4)
  assert.equal(view.update(), 4)
  assert.equal(view.update(), 0, 'nothing left to rebuild')
  assertMatchesWorld(world, view)
})

test('edits only show after update(), which rebuilds each dirty chunk once', () => {
  const { world, view } = setup()
  const before = view.meshAt(0, 0).geometry
  for (let x = 1; x < 6; x++) world.setBlock(x, 3, 3, BLOCK.WOOD)
  assert.equal(view.meshAt(0, 0).geometry, before, 'no rebuild until update()')
  assert.equal(view.update(), 1, 'five edits in one chunk -> one rebuild')
  assert.notEqual(view.meshAt(0, 0).geometry, before)
  assertMatchesWorld(world, view)
})

test('meshes always match the world after random edits and updates', () => {
  const { world, view } = setup({ size: 24, height: 10 })
  const rng = createRng(99)
  const ids = [BLOCK.AIR, BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.WOOD, BLOCK.LEAVES]
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < 15; i++) world.setBlock(rng.int(0, 23), rng.int(0, 9), rng.int(0, 23), rng.pick(ids))
    view.update()
    assertMatchesWorld(world, view)
  }
})

test('rebuilds dispose replaced geometries, so repeated edits never leak', () => {
  const { world, view } = setup()
  const disposed = []
  const first = view.meshAt(1, 1).geometry
  first.addEventListener('dispose', () => disposed.push(first))
  for (let i = 0; i < 50; i++) {
    world.setBlock(12, 3, 12, i % 2 ? BLOCK.AIR : BLOCK.STONE)
    view.update()
    assert.equal(view.geometryCount, view.meshCount, `edit ${i}: one live geometry per mesh`)
  }
  assert.deepEqual(disposed, [first], 'the original geometry was disposed')
  assert.equal(view.geometryCount, 4)
})

test('a chunk that becomes empty loses its mesh and regains it when built on', () => {
  const { world, view } = setup({ groundTop: 0 })
  for (let z = 8; z < 16; z++) for (let x = 8; x < 16; x++) world.setBlock(x, 0, z, BLOCK.AIR)
  view.update()
  assert.equal(view.meshAt(1, 1), null)
  assert.equal(view.meshCount, 3)
  assert.equal(view.geometryCount, 3)
  world.setBlock(12, 4, 12, BLOCK.LEAVES)
  view.update()
  assert.ok(view.meshAt(1, 1))
  assert.equal(view.meshAt(1, 1).geometry.index.count, 36)
  assertMatchesWorld(world, view)
})

test('rebuildAll() regenerates every chunk on demand', () => {
  const { world, view } = setup()
  const before = view.group.children.map((mesh) => mesh.geometry)
  assert.equal(view.rebuildAll(), 4)
  view.group.children.forEach((mesh, i) => assert.notEqual(mesh.geometry, before[i]))
  assert.equal(view.geometryCount, 4)
  assertMatchesWorld(world, view)
})

test('works without an atlas (untextured fallback)', () => {
  const world = createFlatWorld({ size: 8, height: 4, groundTop: 1 })
  const view = createWorldView({ world, scene: new Scene(), chunkSize: 8 })
  assert.equal(view.material.map, null)
  assert.equal(view.meshCount, 1)
})

test('rejects invalid chunk sizes', () => {
  const world = createWorld({ size: 8, height: 4 })
  for (const chunkSize of [0, -8, 2.5, Number.NaN]) {
    assert.throws(() => createWorldView({ world, scene: new Scene(), atlas, chunkSize }), RangeError)
  }
})

test('dispose() frees everything, leaves the scene, and ignores later world events', () => {
  const { world, scene, view } = setup()
  let materialDisposed = false
  view.material.addEventListener('dispose', () => (materialDisposed = true))
  view.dispose()
  assert.ok(!scene.children.includes(view.group))
  assert.equal(view.geometryCount, 0)
  assert.equal(view.meshCount, 0)
  assert.ok(materialDisposed)
  world.setBlock(3, 3, 3, BLOCK.STONE)
  assert.deepEqual(view.dirtyChunks(), [])
  assert.equal(view.update(), 0)
  view.dispose() // idempotent
})
