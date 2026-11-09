// Boxes are { minX, minY, minZ, maxX, maxY, maxZ } in world units.

export function isFinitePoint(value) {
  return value != null && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
}

// An integer block cell { x, y, z }.
export function isCell(value) {
  return value != null && Number.isInteger(value.x) && Number.isInteger(value.y) && Number.isInteger(value.z)
}

export function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

// Unit horizontal direction from `from` to `to` plus the horizontal length.
// Coincident points give { x: 0, z: 0, length: 0 }; callers pick a fallback.
export function horizontalDirection(from, to) {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return { x: 0, z: 0, length: 0 }
  return { x: dx / length, z: dz / length, length }
}

// Axis-aligned box for an entity whose position is the centre of its feet.
export function bodyBox(position, width, height) {
  const half = width / 2
  return {
    minX: position.x - half,
    minY: position.y,
    minZ: position.z - half,
    maxX: position.x + half,
    maxY: position.y + height,
    maxZ: position.z + half,
  }
}

// Unit box occupied by the block at integer coordinates (x, y, z).
export function blockBox(x, y, z) {
  return { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 }
}

export function boxesOverlap(a, b, epsilon = 0) {
  return (
    a.minX < b.maxX - epsilon &&
    a.maxX > b.minX + epsilon &&
    a.minY < b.maxY - epsilon &&
    a.maxY > b.minY + epsilon &&
    a.minZ < b.maxZ - epsilon &&
    a.maxZ > b.minZ + epsilon
  )
}

// Distance from a point to the nearest point of a box (0 when inside).
export function distanceToBox(point, box) {
  const dx = Math.max(box.minX - point.x, 0, point.x - box.maxX)
  const dy = Math.max(box.minY - point.y, 0, point.y - box.maxY)
  const dz = Math.max(box.minZ - point.z, 0, point.z - box.maxZ)
  return Math.hypot(dx, dy, dz)
}

// Slab-method ray/box test. `direction` must be normalised. Returns the entry
// distance along the ray (0 if the origin is inside), or null for a miss.
export function rayBoxDistance(origin, direction, box, maxDistance = Infinity) {
  let tMin = 0
  let tMax = maxDistance
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis]
    const d = direction[axis]
    const min = box[`min${axis.toUpperCase()}`]
    const max = box[`max${axis.toUpperCase()}`]
    if (Math.abs(d) < 1e-12) {
      if (o < min || o > max) return null
      continue
    }
    let t1 = (min - o) / d
    let t2 = (max - o) / d
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return null
  }
  return tMin
}

// Direction a first-person camera faces for a yaw/pitch pair. Yaw 0 looks
// toward -Z (the Three.js camera default); positive pitch looks up.
export function lookDirection(yaw, pitch) {
  const cosPitch = Math.cos(pitch)
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  }
}
