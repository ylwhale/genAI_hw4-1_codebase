// Combines block outlines, mining cracks, placement previews, and debris.
// Separate random streams keep changes to one effect from altering another.

import { Group } from 'three'
import { isCell } from '../core/geometry.js'
import { createRng, deriveSeed } from '../core/rng.js'
import { getBlockType } from '../world/blocks.js'
import { createBlockHighlight } from './blockHighlight.js'
import { emitFromFaces, exposedFaces } from './blockFaces.js'
import { createCrackOverlay } from './crackOverlay.js'
import { PARTICLE_CAPACITY, createParticleMesh, createParticleSystem } from './particles.js'
import { createPlacementPreview } from './placementPreview.js'

// The puff of a finished placement, thrown outward off the new block's open faces.
const PLACED_PUFF = Object.freeze({
  outset: 0.02,
  margin: 0.1,
  push: [0.7, 1.6],
  scatter: 0.6,
  lift: [0.9, 2.2],
  life: [0.375, 0.625],
  size: [0.077, 0.143],
  brightness: 0.14,
  gravity: 16,
})

export function createEffects(scene, { atlas = null, world = null, capacity = PARTICLE_CAPACITY, seed = 0x5eed } = {}) {
  const particles = createParticleSystem(capacity, { seed, world })
  const particleMesh = createParticleMesh(particles)
  const highlight = createBlockHighlight()
  const crack = createCrackOverlay({ particles, world, seed: deriveSeed(seed, 'crack') })
  const preview = createPlacementPreview({ atlas, particles, seed: deriveSeed(seed, 'preview') })
  const rng = createRng(deriveSeed(seed, 'placed'))

  const group = new Group()
  group.name = 'effects'
  group.add(particleMesh.mesh, highlight.object, crack.mesh, preview.group)
  scene.add(group)

  function burst(position, color = 0xffffff, count = 24, options = {}) {
    return particles.burst(position, Number.isInteger(color) ? color : 0xffffff, count, options)
  }

  // Debris explosion for a whole block that just broke (the cell is air now).
  function burstBlock(cell, blockId, count = 28, options = {}) {
    const type = getBlockType(blockId)
    if (!isCell(cell) || !type?.solid) return 0
    return burst({ x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 }, type.particle, count, options)
  }

  // Completion puff for a block that was just placed: the cell is solid now,
  // so the debris starts just outside its open faces and flies outward.
  function burstPlaced(cell, blockId, count = 14) {
    const type = getBlockType(blockId)
    if (!isCell(cell) || !type?.solid) return 0
    return emitFromFaces(particles, rng, cell, exposedFaces(world, cell), type.particle, count, PLACED_PUFF)
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) return
    preview.update(dt)
    crack.update(dt)
    particles.step(dt)
    particleMesh.sync()
  }

  function clear() {
    particles.clear()
    particleMesh.sync()
    highlight.set(null)
    crack.hide()
    preview.hide()
  }

  function dispose() {
    scene.remove(group)
    particleMesh.dispose()
    highlight.dispose()
    crack.dispose()
    preview.dispose()
  }

  return {
    group,
    particles,
    burst,
    burstBlock,
    burstPlaced,
    setHighlight: highlight.set,
    setCrack: crack.set,
    setPlacementPreview: preview.set,
    update,
    clear,
    dispose,
    get particleCount() {
      return particles.count
    },
    get crackStage() {
      return crack.stage
    },
  }
}
