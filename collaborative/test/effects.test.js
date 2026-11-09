// The effects composer: one group with particles, highlight, crack and
// preview, driven through the public createEffects() API.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Color, DataTexture, DynamicDrawUsage, NearestFilter, Scene } from 'three'
import { createEffects } from '../src/render/effects.js'
import { BURST_DEFAULTS } from '../src/render/particles.js'
import { CRACK_STAGES } from '../src/render/crackOverlay.js'
import { BLOCK, getBlockType } from '../src/world/blocks.js'
import { createFlatWorld } from './helpers.js'
import { fakeAtlas, livePositions, overlapsCell } from './render-helpers.js'

const ORIGIN = Object.freeze({ x: 4.5, y: 6.5, z: 4.5 })

function particleMesh(effects) {
  return effects.group.children.find((child) => child.isInstancedMesh)
}

test('createEffects adds one group to the scene with a dynamic, unculled particle InstancedMesh', () => {
  const scene = new Scene()
  const effects = createEffects(scene)
  assert.ok(scene.children.includes(effects.group))
  const mesh = particleMesh(effects)
  assert.equal(mesh.frustumCulled, false)
  assert.equal(mesh.instanceMatrix.usage, DynamicDrawUsage)
  assert.ok(mesh.instanceColor, 'per-instance colours')
  assert.ok(mesh.instanceMatrix.count >= 300)
  assert.equal(mesh.count, 0)
})

test('update writes live particles into the instance buffers', () => {
  const effects = createEffects(new Scene())
  const mesh = particleMesh(effects)
  assert.equal(effects.burst(ORIGIN, 0x6aa84f, 20), 20)
  const matrixVersion = mesh.instanceMatrix.version
  const colorVersion = mesh.instanceColor.version
  effects.update(1 / 60)
  assert.equal(mesh.count, 20)
  assert.equal(effects.particleCount, 20)
  assert.ok(mesh.instanceMatrix.version > matrixVersion)
  assert.ok(mesh.instanceColor.version > colorVersion)
  const green = new Color(0x6aa84f)
  const red = mesh.instanceColor.getX(0)
  assert.ok(Math.abs(red / green.r - mesh.instanceColor.getY(0) / green.g) < 1e-3, 'colour keeps the block hue')
  effects.update(1 / 60)
  assert.ok(mesh.instanceMatrix.version > matrixVersion + 1, 'flagged every frame')
  effects.update(2)
  assert.equal(mesh.count, 0)
})

test('burst tolerates bad colours and burstBlock targets the block centre', () => {
  const effects = createEffects(new Scene())
  assert.equal(effects.burst(ORIGIN, 'green', 5), 5)
  assert.equal(effects.burstBlock({ x: 2, y: 3, z: 4 }, BLOCK.STONE, 10), 10)
  assert.equal(effects.burstBlock({ x: 2, y: 3, z: 4 }, BLOCK.AIR), 0)
  assert.equal(effects.burstBlock(null, BLOCK.STONE), 0)
  assert.equal(effects.burstBlock({ x: 2.5, y: 3, z: 4 }, BLOCK.STONE), 0)
  const positions = livePositions(effects.particles).slice(-10)
  for (const p of positions) assert.ok(Math.hypot(p.x - 2.5, p.y - 3.5, p.z - 4.5) <= BURST_DEFAULTS.spread + 1e-6)
})

test('setHighlight outlines the target block and hides for null or invalid blocks', () => {
  const effects = createEffects(new Scene())
  const highlight = effects.group.getObjectByName('effects:highlight')
  assert.equal(highlight.visible, false)
  effects.setHighlight({ x: 1, y: 2, z: 3 })
  assert.equal(highlight.visible, true)
  assert.deepEqual(highlight.position.toArray(), [1.5, 2.5, 3.5])
  assert.equal(highlight.material.depthWrite, false)
  highlight.geometry.computeBoundingBox()
  assert.ok(highlight.geometry.boundingBox.max.x > 0.5, 'slightly enlarged so it never z-fights')
  effects.setHighlight(null)
  assert.equal(highlight.visible, false)
  effects.setHighlight({ x: 1.5, y: 2, z: 3 })
  assert.equal(highlight.visible, false)
})

test('setCrack shows the stage for the progress on an enlarged, offset overlay', () => {
  const effects = createEffects(new Scene())
  const crack = effects.group.getObjectByName('effects:crack')
  effects.setCrack({ x: 4, y: 5, z: 6 }, 0.5)
  assert.equal(crack.visible, true)
  assert.equal(effects.crackStage, CRACK_STAGES / 2)
  assert.deepEqual(crack.position.toArray(), [4.5, 5.5, 6.5])
  assert.equal(crack.material.polygonOffset, true)
  assert.equal(crack.material.depthWrite, false)
  assert.ok(crack.material.map instanceof DataTexture)
  assert.equal(crack.material.map.magFilter, NearestFilter)
  const half = crack.material.map
  effects.setCrack({ x: 4, y: 5, z: 6 }, 0.95)
  assert.notEqual(crack.material.map, half, 'deeper cracks swap texture')
  effects.setCrack(null)
  assert.equal(crack.visible, false)
  assert.equal(effects.crackStage, -1)
  effects.setCrack({ x: 'a', y: 5, z: 6 }, 0.5)
  assert.equal(crack.visible, false)
})

test('mining chips fly off on each swing impact, in the block colour', () => {
  const effects = createEffects(new Scene())
  const block = { x: 4, y: 5, z: 6 }
  effects.setCrack(block, 0, BLOCK.STONE)
  assert.equal(effects.particleCount, 0)
  effects.setCrack(block, 0.08, BLOCK.STONE)
  const first = effects.particleCount
  assert.ok(first > 0, 'first impact')
  effects.setCrack(block, 0.1, BLOCK.STONE)
  assert.equal(effects.particleCount, first, 'no chips between impacts')
  effects.setCrack(block, 0.33, BLOCK.STONE)
  assert.equal(effects.particleCount, first * 2, 'second impact')
  const stone = new Color(getBlockType(BLOCK.STONE).particle)
  effects.update(0)
  const mesh = particleMesh(effects)
  assert.ok(Math.abs(mesh.instanceColor.getX(0) / stone.r - mesh.instanceColor.getZ(0) / stone.b) < 1e-3)

  const silent = createEffects(new Scene())
  silent.setCrack(block, 0.5)
  assert.equal(silent.particleCount, 0, 'no colour known, no chips')
})

test('chips spawn outside the block on faces that are open to the air', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  const effects = createEffects(new Scene(), { world })
  const block = { x: 8, y: 3, z: 8 } // only its top face is exposed
  effects.setCrack(block, 0.9)
  const chips = livePositions(effects.particles)
  assert.ok(chips.length >= 4, 'colour taken from the world')
  for (const chip of chips) assert.ok(chip.y > 4, 'spawned above the exposed top face')
})

test('restarting the crack on a new block resets the stage and impact counter', () => {
  const effects = createEffects(new Scene())
  effects.setCrack({ x: 1, y: 1, z: 1 }, 0.9, BLOCK.DIRT)
  const after = effects.particleCount
  effects.setCrack({ x: 2, y: 1, z: 1 }, 0.01, BLOCK.DIRT)
  assert.equal(effects.crackStage, 0)
  effects.setCrack({ x: 2, y: 1, z: 1 }, 0.08, BLOCK.DIRT)
  assert.ok(effects.particleCount > after)
})

test('the placement preview is a translucent ghost with a rising fill and glowing frame', () => {
  const effects = createEffects(new Scene())
  const preview = effects.group.getObjectByName('effects:preview')
  const [ghost, fill, frame, ring] = preview.children
  effects.setPlacementPreview({ x: 3, y: 4, z: 5 }, BLOCK.WOOD, 0)
  assert.equal(preview.visible, true)
  assert.deepEqual(preview.position.toArray(), [3.5, 4, 5.5])
  assert.equal(ghost.material.transparent, true)
  assert.equal(ghost.material.depthWrite, false)
  assert.ok(ghost.material.opacity < 0.5)
  assert.equal(fill.visible, false, 'nothing built yet')

  effects.setPlacementPreview({ x: 3, y: 4, z: 5 }, BLOCK.WOOD, 0.5)
  assert.equal(fill.visible, true)
  assert.equal(fill.scale.y, 0.5)
  assert.equal(ring.visible, true)
  assert.equal(ring.position.y, 0.5, 'the scan line sits on top of the fill')
  const before = frame.material.opacity
  effects.setPlacementPreview({ x: 3, y: 4, z: 5 }, BLOCK.WOOD, 0.9)
  effects.update(0.016)
  assert.notEqual(frame.material.opacity, before, 'the frame glows brighter as it builds')

  effects.setPlacementPreview({ x: 3, y: 4, z: 5 }, BLOCK.WOOD, 1)
  assert.equal(ring.visible, false)
  assert.equal(fill.scale.y, 1)
})

test('the construction emits rising sparkles only while it is in progress', () => {
  const effects = createEffects(new Scene())
  effects.setPlacementPreview({ x: 3, y: 4, z: 5 }, BLOCK.LEAVES, 0)
  effects.update(0.5)
  assert.equal(effects.particleCount, 0)
  effects.setPlacementPreview({ x: 3, y: 4, z: 5 }, BLOCK.LEAVES, 0.4)
  effects.update(0.25)
  assert.ok(effects.particleCount >= 3)
})

test('the preview hides for null cells, invalid blocks; bad progress counts as 0', () => {
  const effects = createEffects(new Scene())
  const preview = effects.group.getObjectByName('effects:preview')
  effects.setPlacementPreview({ x: 1, y: 1, z: 1 }, BLOCK.STONE, 0.5)
  effects.setPlacementPreview(null, BLOCK.STONE, 0.5)
  assert.equal(preview.visible, false)
  effects.setPlacementPreview({ x: 1, y: 1, z: 1 }, BLOCK.AIR, 0.5)
  assert.equal(preview.visible, false)
  effects.setPlacementPreview({ x: 1, y: 1, z: 1 }, 42, 0.5)
  assert.equal(preview.visible, false)
  effects.setPlacementPreview({ x: 1, y: 1, z: 1 }, BLOCK.STONE, Number.NaN)
  assert.equal(preview.visible, true)
  assert.equal(preview.children[1].visible, false)
  effects.setPlacementPreview({ x: 1, y: 1, z: 1 }, BLOCK.STONE, 7)
  assert.equal(preview.children[1].scale.y, 1, 'progress clamps to 1')
})

test('without an atlas the preview is tinted with the block colour', () => {
  const effects = createEffects(new Scene())
  const fill = effects.group.getObjectByName('effects:preview').children[1]
  effects.setPlacementPreview({ x: 1, y: 1, z: 1 }, BLOCK.DIRT, 0.3)
  assert.equal(fill.material.map, null)
  assert.equal(fill.material.color.getHex(), getBlockType(BLOCK.DIRT).particle)
})

test('with an atlas the preview uses the block texture, cropped to the built height', () => {
  const atlas = fakeAtlas()
  const effects = createEffects(new Scene(), { atlas })
  const [ghost, fill] = effects.group.getObjectByName('effects:preview').children
  effects.setPlacementPreview({ x: 1, y: 1, z: 1 }, BLOCK.GRASS, 0.25)
  assert.equal(ghost.material.map, atlas.texture)
  assert.equal(fill.material.map, atlas.texture)
  assert.equal(ghost.geometry.attributes.uv.getY(8), atlas.rects.top.v1, 'ghost top face samples the top tile')
  const side = atlas.rects.side
  assert.ok(Math.abs(fill.geometry.attributes.uv.getY(0) - (side.v0 + 0.25 * (side.v1 - side.v0))) < 1e-9)
})

test('clear() removes every particle and overlay', () => {
  const effects = createEffects(new Scene())
  effects.burst(ORIGIN, 0xffffff, 50)
  effects.setHighlight({ x: 1, y: 1, z: 1 })
  effects.setCrack({ x: 1, y: 1, z: 1 }, 0.5)
  effects.setPlacementPreview({ x: 2, y: 1, z: 1 }, BLOCK.STONE, 0.5)
  effects.update(1 / 60)
  effects.clear()
  assert.equal(effects.particleCount, 0)
  assert.equal(particleMesh(effects).count, 0)
  for (const name of ['effects:highlight', 'effects:crack', 'effects:preview']) {
    assert.equal(effects.group.getObjectByName(name).visible, false, name)
  }
  assert.equal(effects.crackStage, -1)
  effects.setPlacementPreview({ x: 2, y: 1, z: 1 }, BLOCK.STONE, 0.5)
  assert.equal(effects.group.getObjectByName('effects:preview').visible, true, 'usable again after clear')
})

test('update ignores invalid dt; dispose removes the group and frees GPU resources', () => {
  const scene = new Scene()
  const effects = createEffects(scene)
  effects.burst(ORIGIN, 0xffffff, 10)
  effects.update(Number.NaN)
  effects.update(-1)
  assert.equal(effects.particleCount, 10)
  const mesh = particleMesh(effects)
  let disposed = 0
  mesh.geometry.addEventListener('dispose', () => disposed++)
  mesh.material.addEventListener('dispose', () => disposed++)
  effects.dispose()
  assert.equal(scene.children.includes(effects.group), false)
  assert.equal(disposed, 2)
})

// --- placement puff and mining dust (owned by effects) ----------------------------

test('burstPlaced: no particle starts inside the placed block, and none gets trapped in it', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  const effects = createEffects(new Scene(), { world })
  const cell = { x: 8, y: 4, z: 8 }
  world.setBlock(cell.x, cell.y, cell.z, BLOCK.WOOD) // 'block:placed' fires after the block is set
  world.setBlock(cell.x + 1, cell.y, cell.z, BLOCK.STONE) // a wall on its +X side
  assert.equal(effects.burstPlaced(cell, BLOCK.WOOD), 14)
  const puff = livePositions(effects.particles)
  assert.equal(puff.length, 14)
  for (const p of puff) {
    assert.ok(!overlapsCell(p, cell), 'starts outside the placed block')
    assert.ok(!world.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), 'starts in open air')
  }
  for (let frame = 0; frame < 30; frame++) {
    effects.update(1 / 60)
    for (const p of livePositions(effects.particles)) assert.ok(!overlapsCell(p, cell), `frame ${frame}`)
  }
})

test('burstPlaced flies outward from the open faces in the block colour', () => {
  const effects = createEffects(new Scene())
  const cell = { x: 2, y: 3, z: 4 }
  const spawned = []
  const spawn = effects.particles.spawn
  effects.particles.spawn = (p) => spawned.push(p) && spawn(p)
  assert.equal(effects.burstPlaced(cell, BLOCK.STONE, 40), 40)
  for (const p of spawned) {
    assert.equal(p.color, getBlockType(BLOCK.STONE).particle)
    assert.ok(!overlapsCell(p, cell))
    assert.ok(p.y - p.size / 2 >= cell.y, 'without a world, never out of the bottom face')
    // The face it left is the axis on which it sits furthest from the centre.
    const out = { x: p.x - (cell.x + 0.5), y: p.y - (cell.y + 0.5), z: p.z - (cell.z + 0.5) }
    const axis = ['x', 'y', 'z'].reduce((best, key) => (Math.abs(out[key]) > Math.abs(out[best]) ? key : best))
    assert.ok(p[`v${axis}`] * out[axis] > 0, 'moves away from its face')
  }
  assert.equal(effects.burstPlaced({ x: 2.5, y: 3, z: 4 }, BLOCK.STONE), 0)
  assert.equal(effects.burstPlaced(cell, BLOCK.AIR), 0)
  assert.equal(effects.burstPlaced(cell, BLOCK.STONE, Number.NaN), 0)
})

test('setCrack takes the crosshair hit and owns the mining dust', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  const effects = createEffects(new Scene(), { world })
  const block = { x: 8, y: 3, z: 8 }
  const hit = { ...block, normal: { x: 0, y: 1, z: 0 }, point: { x: 8.3, y: 4, z: 8.7 } }
  effects.setCrack(block, 0, BLOCK.STONE, hit)
  assert.equal(effects.particleCount, 0, 'dust waits for a running frame')
  effects.update(1 / 60)
  const dust = livePositions(effects.particles)
  assert.equal(dust.length, 4)
  for (const p of dust) {
    assert.ok(p.y - p.size / 2 > 4, 'above the hit face')
    assert.ok(Math.hypot(p.x - 8.3, p.z - 8.7) < 0.1, 'at the crosshair point')
  }
  effects.clear()
  effects.update(1 / 60)
  assert.equal(effects.particleCount, 0, 'clear() stops the dust')
})

test('the highlight and every preview part draw after the sea (render order 3)', () => {
  const effects = createEffects(new Scene())
  const highlight = effects.group.getObjectByName('effects:highlight')
  const preview = effects.group.getObjectByName('effects:preview')
  assert.equal(highlight.renderOrder, 3)
  assert.equal(preview.children.length, 4)
  for (const part of preview.children) assert.equal(part.renderOrder, 3, part.type)
})
