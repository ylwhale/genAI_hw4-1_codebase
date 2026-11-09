import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AO_BRIGHTNESS, FACE_SHADING, meshChunk } from '../src/render/chunkMesher.js'
import { createWorld } from '../src/world/world.js'
import { BLOCK } from '../src/world/blocks.js'
import { createRng } from '../src/core/rng.js'
import { createBlockAtlas } from '../src/render/textures.js'
import { createFlatWorld } from './helpers.js'

const NORMALS = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
}

// Split the flat buffers back into quads (4 vertices + 6 indices each).
function collectFaces(mesh) {
  const faces = []
  for (let f = 0; f < mesh.faceCount; f++) {
    const corners = []
    for (let c = 0; c < 4; c++) {
      const v = f * 4 + c
      corners.push({
        x: mesh.positions[v * 3],
        y: mesh.positions[v * 3 + 1],
        z: mesh.positions[v * 3 + 2],
        u: mesh.uvs[v * 2],
        v: mesh.uvs[v * 2 + 1],
        light: mesh.colors[v * 3],
      })
    }
    const normal = [mesh.normals[f * 12], mesh.normals[f * 12 + 1], mesh.normals[f * 12 + 2]]
    const indices = [...mesh.indices.subarray(f * 6, f * 6 + 6)].map((i) => i - f * 4)
    faces.push({ corners, normal, indices })
  }
  return faces
}

function centroid(face) {
  const sum = face.corners.reduce((acc, c) => [acc[0] + c.x, acc[1] + c.y, acc[2] + c.z], [0, 0, 0])
  return sum.map((value) => value / 4)
}

// The face of block (x, y, z) pointing along `normal`, or undefined.
function findFace(faces, [x, y, z], normal) {
  const expected = [x + 0.5 + normal[0] / 2, y + 0.5 + normal[1] / 2, z + 0.5 + normal[2] / 2]
  return faces.find((face) => {
    const c = centroid(face)
    return face.normal.every((n, i) => n === normal[i]) && c.every((value, i) => Math.abs(value - expected[i]) < 1e-6)
  })
}

function cornerAt(face, x, y, z) {
  return face.corners.find((c) => c.x === x && c.y === y && c.z === z)
}

// Buffers are Float32, so compare against float64 expectations with a tolerance.
function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? 'value'}: ${actual} != ${expected}`)
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function vertex(mesh, i) {
  return [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]]
}

function groundWorld(size = 8, height = 8) {
  return createFlatWorld({ size, height, groundTop: 0 })
}

function randomWorld(seed, { size = 16, height = 10 } = {}) {
  const world = createFlatWorld({ size, height, groundTop: 2, block: BLOCK.DIRT })
  const rng = createRng(seed)
  const ids = [BLOCK.GRASS, BLOCK.STONE, BLOCK.WOOD, BLOCK.LEAVES, BLOCK.AIR]
  for (let i = 0; i < 500; i++) world.setBlock(rng.int(0, size - 1), rng.int(0, height - 1), rng.int(0, size - 1), rng.pick(ids))
  return world
}

test('an isolated block has six outward faces lit only by face shading', () => {
  const world = createWorld({ size: 8, height: 8 })
  world.setBlock(3, 3, 3, BLOCK.STONE)
  const mesh = meshChunk(world, 0, 0, 8)
  assert.equal(mesh.faceCount, 6)
  assert.equal(mesh.positions.length, 6 * 4 * 3)
  assert.equal(mesh.normals.length, 6 * 4 * 3)
  assert.equal(mesh.colors.length, 6 * 4 * 3)
  assert.equal(mesh.uvs.length, 6 * 4 * 2)
  assert.equal(mesh.indices.length, 6 * 6)

  const faces = collectFaces(mesh)
  const { x, z, top, bottom } = FACE_SHADING
  const shading = { px: x, nx: x, py: top, ny: bottom, pz: z, nz: z }
  for (const [name, normal] of Object.entries(NORMALS)) {
    const face = findFace(faces, [3, 3, 3], normal)
    assert.ok(face, `${name} face exists`)
    for (const corner of face.corners) assert.ok(Math.abs(corner.light - shading[name]) < 1e-6, `${name} brightness`)
  }
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) assert.ok(mesh.positions[i + a] === 3 || mesh.positions[i + a] === 4)
  }
})

test('output uses the contracted typed arrays and valid indices', () => {
  const mesh = meshChunk(randomWorld(7), 0, 0, 8)
  assert.ok(mesh.positions instanceof Float32Array)
  assert.ok(mesh.normals instanceof Float32Array)
  assert.ok(mesh.uvs instanceof Float32Array)
  assert.ok(mesh.colors instanceof Float32Array)
  assert.ok(mesh.indices instanceof Uint32Array)
  const vertexCount = mesh.positions.length / 3
  assert.equal(vertexCount, mesh.faceCount * 4)
  assert.equal(mesh.indices.length, mesh.faceCount * 6)
  for (const index of mesh.indices) assert.ok(index < vertexCount)
  for (const light of mesh.colors) assert.ok(light > 0 && light <= 1)
})

test('triangles wind counter-clockwise with normals pointing out of solid blocks into air', () => {
  const world = randomWorld(11)
  for (const [x0, z0] of [[0, 0], [8, 0], [0, 8], [8, 8]]) {
    const mesh = meshChunk(world, x0, z0, 8)
    assert.ok(mesh.faceCount > 0)
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => vertex(mesh, mesh.indices[t + k]))
      const n = cross(b.map((v, i) => v - a[i]), c.map((v, i) => v - a[i]))
      const normalIndex = mesh.indices[t]
      const expected = [0, 1, 2].map((i) => mesh.normals[normalIndex * 3 + i])
      const length = Math.hypot(...n)
      assert.ok(length > 0, 'non-degenerate triangle')
      expected.forEach((value, i) => assert.ok(Math.abs(n[i] / length - value) < 1e-6, 'winding matches the normal'))
    }
    for (const face of collectFaces(mesh)) {
      const c = centroid(face)
      const inside = c.map((value, i) => Math.floor(value - face.normal[i] * 0.5))
      const outside = c.map((value, i) => Math.floor(value + face.normal[i] * 0.5))
      assert.ok(world.isSolid(...inside), 'face belongs to a solid block')
      assert.ok(!world.isSolid(...outside), 'face looks into a non-solid cell')
    }
  }
})

test('faces between solid neighbours are culled', () => {
  const world = createWorld({ size: 8, height: 8 })
  world.setBlock(2, 2, 2, BLOCK.STONE)
  world.setBlock(3, 2, 2, BLOCK.DIRT)
  assert.equal(meshChunk(world, 0, 0, 8).faceCount, 10)

  const cube = createWorld({ size: 8, height: 8 })
  for (let x = 2; x < 5; x++) for (let y = 2; y < 5; y++) for (let z = 2; z < 5; z++) cube.setBlock(x, y, z, BLOCK.STONE)
  assert.equal(meshChunk(cube, 0, 0, 8).faceCount, 54, 'only the 3x3x3 surface is meshed; the buried centre adds nothing')
})

test('leaves are opaque: they cull neighbouring faces like any solid block', () => {
  const world = createWorld({ size: 8, height: 8 })
  world.setBlock(2, 2, 2, BLOCK.LEAVES)
  world.setBlock(2, 3, 2, BLOCK.STONE)
  const faces = collectFaces(meshChunk(world, 0, 0, 8))
  assert.equal(faces.length, 10)
  assert.equal(findFace(faces, [2, 2, 2], NORMALS.py), undefined)
  assert.equal(findFace(faces, [2, 3, 2], NORMALS.ny), undefined)
})

test('world-wall faces are emitted but the floor is never meshed from below', () => {
  const world = createWorld({ size: 8, height: 8 })
  world.setBlock(0, 0, 0, BLOCK.STONE)
  world.setBlock(7, 7, 7, BLOCK.STONE)
  world.setBlock(0, 4, 7, BLOCK.STONE)
  const faces = collectFaces(meshChunk(world, 0, 0, 8))
  assert.ok(findFace(faces, [0, 0, 0], NORMALS.nx), 'west wall face at x = 0')
  assert.ok(findFace(faces, [0, 0, 0], NORMALS.nz), 'north wall face at z = 0')
  assert.equal(findFace(faces, [0, 0, 0], NORMALS.ny), undefined, 'no bottom face at y = 0')
  assert.ok(findFace(faces, [7, 7, 7], NORMALS.py), 'top face at the world ceiling')
  assert.ok(findFace(faces, [7, 7, 7], NORMALS.px), 'east wall face at x = size - 1')
  assert.ok(findFace(faces, [0, 4, 7], NORMALS.ny), 'floating blocks keep their bottom face')
  assert.equal(faces.length, 5 + 6 + 6)
})

test('flat ground meshes to tops plus outer walls, culled across chunk borders', () => {
  const world = createFlatWorld({ size: 16, height: 8, groundTop: 3 })
  // Corner chunk: 64 tops + 8x4 faces on each of the two outer walls.
  assert.equal(meshChunk(world, 0, 0, 8).faceCount, 64 + 32 + 32)
  assert.equal(meshChunk(world, 8, 8, 8).faceCount, 64 + 32 + 32)
  const faces = collectFaces(meshChunk(world, 0, 0, 8))
  assert.ok(faces.every((face) => !(face.normal[0] === 1)), 'no +X faces against the solid neighbour chunk')
  assert.ok(faces.every((face) => face.normal[1] !== -1), 'no bottom faces')
})

test('chunks are clipped to the world and invalid requests produce empty meshes', () => {
  const world = createFlatWorld({ size: 16, height: 8, groundTop: 3 })
  assert.equal(meshChunk(world, 12, 12, 8).faceCount, 16 + 16 + 16, 'only columns 12..15 are meshed')
  assert.equal(meshChunk(world, -4, 0, 8).faceCount, 32 + 32 + 16, 'columns 0..3 of a chunk hanging off the west edge')
  for (const args of [[16, 0, 8], [-8, 0, 8], [0, 16, 8], [0, 0, 0], [0, 0, -2], [0, 0, 2.5], [Number.NaN, 0, 8], ['0', 0, 8]]) {
    const mesh = meshChunk(world, ...args)
    assert.equal(mesh.faceCount, 0, `args ${args}`)
    assert.equal(mesh.positions.length, 0)
    assert.ok(mesh.indices instanceof Uint32Array)
  }
  assert.equal(meshChunk(createWorld({ size: 8, height: 8 }), 0, 0, 8).faceCount, 0, 'an empty world has no faces')
})

test('ambient occlusion darkens ground vertices next to a block, including the diagonal', () => {
  const world = groundWorld()
  world.setBlock(3, 1, 3, BLOCK.STONE)
  const faces = collectFaces(meshChunk(world, 0, 0, 8))
  const top = FACE_SHADING.top

  const beside = findFace(faces, [4, 0, 3], NORMALS.py)
  assertClose(cornerAt(beside, 4, 1, 3).light, AO_BRIGHTNESS[1] * top)
  assertClose(cornerAt(beside, 4, 1, 4).light, AO_BRIGHTNESS[1] * top)
  assertClose(cornerAt(beside, 5, 1, 3).light, AO_BRIGHTNESS[0] * top)
  assertClose(cornerAt(beside, 5, 1, 4).light, AO_BRIGHTNESS[0] * top)

  const diagonal = findFace(faces, [4, 0, 4], NORMALS.py)
  assertClose(cornerAt(diagonal, 4, 1, 4).light, AO_BRIGHTNESS[1] * top, 'corner-only occluder')
  assertClose(cornerAt(diagonal, 5, 1, 5).light, AO_BRIGHTNESS[0] * top)

  assert.equal(findFace(faces, [3, 0, 3], NORMALS.py), undefined, 'ground under the block is hidden')
  const far = findFace(faces, [7, 0, 7], NORMALS.py)
  for (const c of far.corners) assertClose(c.light, top, 'open ground is unoccluded')
})

test('wall faces darken toward the ground they stand on', () => {
  const world = groundWorld()
  world.setBlock(3, 1, 3, BLOCK.STONE)
  const west = findFace(collectFaces(meshChunk(world, 0, 0, 8)), [3, 1, 3], NORMALS.nx)
  for (const corner of west.corners) {
    const expected = corner.y === 1 ? AO_BRIGHTNESS[2] : AO_BRIGHTNESS[0]
    assert.ok(Math.abs(corner.light - expected * FACE_SHADING.x) < 1e-6, `corner at y=${corner.y}`)
  }
})

test('an inside corner between two walls is fully occluded', () => {
  const world = groundWorld()
  world.setBlock(3, 1, 4, BLOCK.STONE)
  world.setBlock(4, 1, 3, BLOCK.STONE)
  const face = findFace(collectFaces(meshChunk(world, 0, 0, 8)), [4, 0, 4], NORMALS.py)
  assertClose(cornerAt(face, 4, 1, 4).light, AO_BRIGHTNESS[3] * FACE_SHADING.top)
  assert.ok(AO_BRIGHTNESS.every((value, i) => i === 0 || value < AO_BRIGHTNESS[i - 1]), 'AO is monotonic')
})

test('quad diagonal flips so a single dark corner never sits on the shared diagonal', () => {
  for (const [ox, oz] of [[3, 3], [5, 3], [5, 5], [3, 5]]) {
    const world = groundWorld()
    world.setBlock(ox, 1, oz, BLOCK.STONE)
    const face = findFace(collectFaces(meshChunk(world, 0, 0, 8)), [4, 0, 4], NORMALS.py)
    const dark = face.corners.findIndex((c) => c.light < FACE_SHADING.top)
    assert.ok(dark >= 0, `occluder at ${ox},${oz} darkens one corner`)
    assert.equal(face.indices.filter((i) => i === dark).length, 1, `dark corner ${dark} is used by one triangle only`)
    const counts = [0, 1, 2, 3].map((i) => face.indices.filter((k) => k === i).length)
    assert.equal(counts.filter((n) => n === 2).length, 2, 'two corners form the shared diagonal')
  }
})

test('uniformly lit quads keep the default 0-2 split (regression: stable output)', () => {
  const world = createWorld({ size: 8, height: 8 })
  world.setBlock(3, 3, 3, BLOCK.STONE)
  for (const face of collectFaces(meshChunk(world, 0, 0, 8))) assert.deepEqual(face.indices, [0, 1, 2, 0, 2, 3])
})

test('AO and culling read across chunk borders', () => {
  const world = createFlatWorld({ size: 16, height: 8, groundTop: 0 })
  world.setBlock(8, 1, 3, BLOCK.STONE) // in chunk (1, 0)
  const faces = collectFaces(meshChunk(world, 0, 0, 8))
  const top = findFace(faces, [7, 0, 3], NORMALS.py)
  assertClose(cornerAt(top, 8, 1, 3).light, AO_BRIGHTNESS[1] * FACE_SHADING.top)
  assertClose(cornerAt(top, 7, 1, 3).light, FACE_SHADING.top)
})

test('uvFor drives UVs: tile top maps to block top and sides are not mirrored', () => {
  const rects = {
    top: { u0: 0, v0: 0, u1: 0.25, v1: 0.25 },
    side: { u0: 0.5, v0: 0.5, u1: 0.75, v1: 0.75 },
    bottom: { u0: 0.25, v0: 0.75, u1: 0.5, v1: 1 },
  }
  const calls = []
  const uvFor = (id, face) => {
    calls.push([id, face])
    return rects[face]
  }
  const world = createWorld({ size: 8, height: 8 })
  world.setBlock(3, 3, 3, BLOCK.GRASS)
  const faces = collectFaces(meshChunk(world, 0, 0, 8, uvFor))
  assert.equal(calls.length, 6)
  assert.ok(calls.every(([id]) => id === BLOCK.GRASS))
  assert.deepEqual(calls.map(([, face]) => face).sort(), ['bottom', 'side', 'side', 'side', 'side', 'top'])

  const up = [0, 1, 0]
  for (const face of faces) {
    const kind = face.normal[1] === 1 ? 'top' : face.normal[1] === -1 ? 'bottom' : 'side'
    const rect = rects[kind]
    for (const c of face.corners) {
      assert.ok(c.u === rect.u0 || c.u === rect.u1)
      assert.ok(c.v === rect.v0 || c.v === rect.v1)
    }
    if (kind !== 'side') continue
    // Seen from outside, +u runs to the viewer's right and +v runs up.
    const right = cross(face.normal.map((n) => -n), up)
    for (const c of face.corners) {
      assert.equal(c.v, c.y === 4 ? rect.v1 : rect.v0, 'v1 at the block top')
      const along = c.x * right[0] + c.y * right[1] + c.z * right[2]
      const others = face.corners.filter((o) => o.u !== c.u)
      for (const o of others) {
        const otherAlong = o.x * right[0] + o.y * right[1] + o.z * right[2]
        assert.equal(c.u < o.u, along < otherAlong, 'u increases to the right')
      }
    }
  }
})

test('the real atlas maps grass side tops to the top of its tile', () => {
  const atlas = createBlockAtlas()
  const world = createWorld({ size: 8, height: 8 })
  world.setBlock(3, 3, 3, BLOCK.GRASS)
  const faces = collectFaces(meshChunk(world, 0, 0, 8, atlas.uvFor))
  const side = findFace(faces, [3, 3, 3], NORMALS.pz)
  const rect = atlas.uvFor(BLOCK.GRASS, 'side')
  for (const c of side.corners) assertClose(c.v, c.y === 4 ? rect.v1 : rect.v0, 'side v')
  const top = findFace(faces, [3, 3, 3], NORMALS.py)
  const topRect = atlas.uvFor(BLOCK.GRASS, 'top')
  const within = (value, min, max) => value >= Math.fround(min) && value <= Math.fround(max)
  assert.ok(top.corners.every((c) => within(c.u, topRect.u0, topRect.u1) && within(c.v, topRect.v0, topRect.v1)))
})

test('a missing UV rectangle falls back instead of dropping faces', () => {
  const world = createWorld({ size: 8, height: 8 })
  world.setBlock(3, 3, 3, BLOCK.STONE)
  const mesh = meshChunk(world, 0, 0, 8, () => null)
  assert.equal(mesh.faceCount, 6)
  for (const value of mesh.uvs) assert.ok(value >= 0 && value <= 1)
})

test('meshing is deterministic, reads only, and the module stays free of three.js', () => {
  const world = randomWorld(3)
  const before = world.snapshot()
  assert.deepEqual(meshChunk(world, 8, 0, 8), meshChunk(world, 8, 0, 8))
  assert.deepEqual(world.snapshot(), before)
  const source = readFileSync(new URL('../src/render/chunkMesher.js', import.meta.url), 'utf8')
  assert.ok(!/from\s+'three'/.test(source))
  assert.ok(!/\b(window|document)\b/.test(source))
})

test('every chunk of a 32x32 world meshes quickly enough for live edits', () => {
  const world = randomWorld(5, { size: 32, height: 32 })
  const start = performance.now()
  let faces = 0
  for (let z = 0; z < 32; z += 8) for (let x = 0; x < 32; x += 8) faces += meshChunk(world, x, z, 8).faceCount
  const elapsed = performance.now() - start
  assert.ok(faces > 0)
  assert.ok(elapsed < 1000, `full rebuild took ${elapsed.toFixed(1)} ms`)
})
