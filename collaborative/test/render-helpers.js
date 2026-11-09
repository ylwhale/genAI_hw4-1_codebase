// Shared fixtures for the render tests (effects, particles, previews).

import { DataTexture } from 'three'

// Snapshot of every live particle of a particle system.
export function livePositions(system) {
  const result = []
  system.forEachLive((i, d) => result.push({ x: d.px[i], y: d.py[i], z: d.pz[i], age: d.age[i], life: d.life[i], size: d.size[i] }))
  return result
}

// A minimal block atlas: every block uses the same three face tiles.
export function fakeAtlas() {
  const rects = {
    top: { u0: 0, v0: 0.5, u1: 0.25, v1: 0.75 },
    side: { u0: 0.25, v0: 0.5, u1: 0.5, v1: 0.75 },
    bottom: { u0: 0.5, v0: 0.5, u1: 0.75, v1: 0.75 },
  }
  return { texture: new DataTexture(new Uint8Array(4), 1, 1), uvFor: (id, face) => rects[face], rects }
}

// True when a particle's cube overlaps the interior of the unit cell. The
// tolerance absorbs Float32 storage, so debris resting on a face is outside.
export function overlapsCell(p, cell, tolerance = 1e-4) {
  const half = p.size / 2
  return ['x', 'y', 'z'].every((axis) => p[axis] + half > cell[axis] + tolerance && p[axis] - half < cell[axis] + 1 - tolerance)
}
