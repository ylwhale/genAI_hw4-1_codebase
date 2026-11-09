// Seeded 2D gradient noise and fractal sums for terrain, using hash3 gradients.

import { deriveSeed, hash3 } from '../core/rng.js'
import { TAU, clamp, lerp } from '../core/math.js'

const MAX_OCTAVES = 8

// Quintic fade: continuous slope and curvature, so hills have no creases.
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// Dot product of the unit gradient at lattice point (ix, iz) with the offset
// from that point to the sample.
function gradientDot(ix, iz, dx, dz, seed) {
  const angle = hash3(ix, iz, 0, seed) * TAU
  return Math.cos(angle) * dx + Math.sin(angle) * dz
}

// Returns noise2D(x, z) in [-1, 1]; zero at every integer lattice point and
// smooth in between (one feature per unit of input).
export function createNoise2D(seed) {
  const latticeSeed = seed | 0

  return function noise2D(x, z) {
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    const fx = x - ix
    const fz = z - iz
    const n00 = gradientDot(ix, iz, fx, fz, latticeSeed)
    const n10 = gradientDot(ix + 1, iz, fx - 1, fz, latticeSeed)
    const n01 = gradientDot(ix, iz + 1, fx, fz - 1, latticeSeed)
    const n11 = gradientDot(ix + 1, iz + 1, fx - 1, fz - 1, latticeSeed)
    const u = fade(fx)
    const value = lerp(lerp(n00, n10, u), lerp(n01, n11, u), fade(fz))
    // Unit gradients peak at sqrt(1/2); rescale to the full [-1, 1] range.
    return clamp(value * Math.SQRT2, -1, 1)
  }
}

// Fractal Brownian motion: `octaves` layers of noise, each `lacunarity` times
// the frequency and `gain` times the amplitude of the previous one, normalised
// back to [-1, 1]. Each octave has its own seed so lattice zeros don't align.
export function createFractalNoise2D(seed, { octaves = 3, lacunarity = 2, gain = 0.5 } = {}) {
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > MAX_OCTAVES) {
    throw new RangeError(`octaves must be an integer in 1..${MAX_OCTAVES}`)
  }
  const layers = Array.from({ length: octaves }, (_, i) => createNoise2D(deriveSeed(seed, `octave-${i}`)))
  const amplitudes = layers.map((_, i) => gain ** i)
  const total = amplitudes.reduce((sum, amplitude) => sum + amplitude, 0)

  return function fractalNoise2D(x, z) {
    let sum = 0
    let frequency = 1
    for (let i = 0; i < layers.length; i++) {
      sum += layers[i](x * frequency, z * frequency) * amplitudes[i]
      frequency *= lacunarity
    }
    return sum / total
  }
}
