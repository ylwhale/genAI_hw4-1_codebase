// Deterministic pseudo-random helpers. Everything procedural in the game
// (terrain, trees, textures, clouds) flows through these so a given seed
// always produces exactly the same world.

/** Mulberry32: small, fast, well-distributed 32-bit PRNG. Returns [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of 2D coordinates + seed, returns [0, 1). */
export function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Seeded 2D gradient (Perlin-style) noise. Output is roughly in [-1, 1].
 * A permutation table is shuffled with the seeded PRNG so the noise field is
 * fully determined by the seed.
 */
export function createNoise2D(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  // 8 evenly spaced unit gradients.
  const GX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071];
  const GY = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  return function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;

    const g00 = perm[X + perm[Y]] & 7;
    const g10 = perm[X + 1 + perm[Y]] & 7;
    const g01 = perm[X + perm[Y + 1]] & 7;
    const g11 = perm[X + 1 + perm[Y + 1]] & 7;

    const n00 = GX[g00] * xf + GY[g00] * yf;
    const n10 = GX[g10] * (xf - 1) + GY[g10] * yf;
    const n01 = GX[g01] * xf + GY[g01] * (yf - 1);
    const n11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);

    const u = fade(xf);
    const v = fade(yf);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.41;
  };
}

/** Fractal Brownian motion over a 2D noise function. Output roughly [-1, 1]. */
export function fbm2(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
