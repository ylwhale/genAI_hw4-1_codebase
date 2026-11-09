// Seeded randomness for terrain, spawns, and mob behaviour.

// Mulberry32: small, fast, and good enough for procedural content.
export function createRng(seed) {
  let state = seed >>> 0

  function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    range(min, max) {
      return min + (max - min) * next()
    },
    int(min, maxInclusive) {
      return min + Math.floor(next() * (maxInclusive - min + 1))
    },
    chance(probability) {
      return next() < probability
    },
    pick(items) {
      return items[Math.floor(next() * items.length)]
    },
    shuffle(items) {
      const result = items.slice()
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[result[i], result[j]] = [result[j], result[i]]
      }
      return result
    },
  }
}

// Stateless integer hash of up to three coordinates plus a seed, in [0, 1).
export function hash3(x, y, z, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647)
  h = Math.imul(h ^ (seed | 0), 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1103515245)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// Derive an independent seed for a named subsystem (terrain, trees, mobs...).
export function deriveSeed(seed, label) {
  let h = seed >>> 0
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 16777619) >>> 0
  }
  return h
}
