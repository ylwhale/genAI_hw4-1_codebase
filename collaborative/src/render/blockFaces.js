// Block faces for world-space effects: which faces of a cell are open to the
// air, points just outside them, and debris launched outward through them.
// Every particle starts entirely outside the cell, so the particle collision
// never traps it inside a solid block where nobody can see it.

import { clamp } from '../core/math.js'

const CUBE_FACES = Object.freeze(
  [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ].map(Object.freeze),
)
export const TOP_FACE = CUBE_FACES[2]

export function sameCell(a, b) {
  return Boolean(a && b) && a.x === b.x && a.y === b.y && a.z === b.z
}

// Faces of `cell` whose neighbour is not solid. Without a world to ask, the
// sides and the top (never the bottom, which usually rests on the ground).
export function exposedFaces(world, cell) {
  if (!world) return CUBE_FACES.filter(([, y]) => y >= 0)
  return CUBE_FACES.filter(([x, y, z]) => !world.isSolid(cell.x + x, cell.y + y, cell.z + z))
}

// A random point `outset` beyond face `normal` of `cell`, at least `margin`
// away from the face's edges across it.
function facePoint(rng, cell, [nx, ny, nz], outset, margin = 0.15) {
  const along = (n) => (n === 0 ? rng.range(margin, 1 - margin) : n > 0 ? 1 + outset : -outset)
  return { x: cell.x + along(nx), y: cell.y + along(ny), z: cell.z + along(nz) }
}

// Launches `count` cubes out of the given faces of `cell`. Recipe (ranges are
// [min, max]): outset (gap between the face and the cube), margin, push
// (speed along the normal), scatter (± sideways speed), lift (upward speed,
// skipped on downward faces so nothing is thrown back into the block), life,
// size, brightness (± jitter), gravity. Returns how many spawned.
export function emitFromFaces(particles, rng, cell, faces, color, count, recipe) {
  const total = Number.isFinite(count) ? clamp(Math.floor(count), 0, particles.capacity) : 0
  if (faces.length === 0) return 0
  for (let n = 0; n < total; n++) {
    const normal = rng.pick(faces)
    const size = rng.range(...recipe.size)
    const start = facePoint(rng, cell, normal, recipe.outset + size / 2, recipe.margin)
    const [nx, ny, nz] = normal
    const lift = ny < 0 ? 0 : rng.range(...recipe.lift)
    particles.spawn({
      ...start,
      vx: nx * rng.range(...recipe.push) + rng.range(-recipe.scatter, recipe.scatter),
      vy: ny * rng.range(...recipe.push) + lift,
      vz: nz * rng.range(...recipe.push) + rng.range(-recipe.scatter, recipe.scatter),
      life: rng.range(...recipe.life),
      size,
      gravity: recipe.gravity,
      color,
      brightness: 1 + rng.range(-recipe.brightness, recipe.brightness),
    })
  }
  return total
}
