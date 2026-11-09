// Thin dark outline around the block under the crosshair.

import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments } from 'three'
import { isCell } from '../core/geometry.js'
import { RENDER_ORDER } from './renderOrder.js'

// Edges of a cube of the given size, centred on the origin.
export function createBoxOutline(size, material) {
  const box = new BoxGeometry(size, size, size)
  const lines = new LineSegments(new EdgesGeometry(box), material)
  box.dispose()
  return lines
}

export function createBlockHighlight() {
  const material = new LineBasicMaterial({ color: 0x0c0c0c, transparent: true, opacity: 0.65, depthWrite: false })
  const outline = createBoxOutline(1.004, material) // slightly enlarged so it never z-fights
  outline.name = 'effects:highlight'
  outline.visible = false
  outline.renderOrder = RENDER_ORDER.overlay

  // block: integer {x,y,z}; anything else hides the outline.
  function set(block) {
    if (!isCell(block)) {
      outline.visible = false
      return
    }
    outline.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5)
    outline.visible = true
  }

  function dispose() {
    outline.geometry.dispose()
    material.dispose()
  }

  return { object: outline, set, dispose }
}
