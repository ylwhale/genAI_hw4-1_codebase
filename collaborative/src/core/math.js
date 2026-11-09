export const TAU = Math.PI * 2

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

// Clamp to [0, 1]; non-finite input counts as 0.
export function clamp01(value) {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

// Hermite smoothstep of `value` between two edges, clamped to [0, 1].
export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

// Frame-rate independent exponential approach of `current` toward `target`.
export function approach(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt)
}

export function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

// Wrap an angle into [-PI, PI).
export function wrapAngle(angle) {
  return angle - TAU * Math.floor((angle + Math.PI) / TAU) || 0
}

// Yaw that faces along the horizontal direction (x, z); yaw 0 looks toward -Z,
// matching lookDirection() in core/geometry.js.
export function yawFromDirection(x, z) {
  return Math.atan2(-x, -z)
}
