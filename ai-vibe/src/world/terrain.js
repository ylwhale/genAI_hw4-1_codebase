import { createNoise2D, fbm2, mulberry32 } from '../utils/random.js';
import { AIR, GRASS, DIRT, STONE, WOOD, LEAVES } from './blocks.js';

/**
 * Deterministic terrain generator.
 *
 * Height comes from layered gradient noise plus two hand-placed "landmark"
 * hills so the small 32 x 32 world always has a recognisable silhouette.
 * The area around the spawn (world centre) is gently flattened into a meadow.
 * High, steep ground becomes exposed stone. Trees are scattered with a seeded
 * RNG using minimum spacing so they never overlap or leave the world.
 */
export function generateTerrain(blocks, size, height, seed) {
  const noise = createNoise2D(seed);
  const detail = createNoise2D(seed + 1013);
  const rockNoise = createNoise2D(seed + 2027);
  const layer = size * size;
  const idx = (x, y, z) => x + z * size + y * layer;

  const center = (size - 1) / 2;
  const heights = new Int16Array(layer);

  // --- heightmap -----------------------------------------------------------
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let h = 7;
      h += fbm2(noise, x / 20 + 3.1, z / 20 + 7.7, 4) * 5;
      h += detail(x / 7, z / 7) * 1.2;

      // Landmark hills: a tall one in the north-east, a softer one south-west.
      h += 9.5 * gauss(x - 24, z - 8, 7);
      h += 5.5 * gauss(x - 7, z - 23, 6);

      // Round the island off: the ground slopes down towards the rim.
      const rim = Math.min(x, z, size - 1 - x, size - 1 - z);
      h -= 3.2 * (1 - smoothstep(0, 6, rim));

      // Flatten a meadow around the spawn point.
      const ds = Math.hypot(x - center, z - center);
      const meadow = smoothstep(7, 2.5, ds);
      h = h * (1 - meadow) + 8 * meadow;

      heights[x + z * size] = clamp(Math.round(h), 2, height - 12);
    }
  }

  // --- columns -------------------------------------------------------------
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const h = heights[x + z * size];
      const slope = maxSlope(heights, size, x, z);
      const rocky = h >= 14 && (slope >= 2 || rockNoise(x / 5, z / 5) > 0.15);
      const cliff = slope >= 3;
      const dirtDepth = 2 + Math.round((detail(x / 4 + 11, z / 4 - 5) + 1) * 1);

      for (let y = 0; y <= h; y++) {
        let id;
        if (y === h) id = rocky || cliff ? STONE : GRASS;
        else if (y >= h - dirtDepth && !rocky) id = DIRT;
        else id = STONE;
        blocks[idx(x, y, z)] = id;
      }
    }
  }

  // --- trees ---------------------------------------------------------------
  const rand = mulberry32(seed * 7919 + 17);
  const trees = [];
  const minSpacing = 5;
  for (let attempt = 0; attempt < 220 && trees.length < 11; attempt++) {
    const x = 2 + Math.floor(rand() * (size - 4));
    const z = 2 + Math.floor(rand() * (size - 4));
    const trunk = 4 + Math.floor(rand() * 3);
    const shapeSeed = rand();
    const ground = heights[x + z * size];

    if (blocks[idx(x, ground, z)] !== GRASS) continue;
    if (Math.hypot(x - center, z - center) < 4.5) continue; // keep spawn open
    if (maxSlope(heights, size, x, z) > 1) continue;
    if (ground + trunk + 3 >= height) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < minSpacing)) continue;

    trees.push({ x, z });
    placeTree(blocks, size, height, x, ground, z, trunk, mulberry32(Math.floor(shapeSeed * 1e9)));
  }
}

function placeTree(blocks, size, height, x, ground, z, trunk, rand) {
  const layer = size * size;
  const set = (bx, by, bz, id, overwrite) => {
    if (bx < 0 || bz < 0 || bx >= size || bz >= size || by < 0 || by >= height) return;
    const i = bx + bz * size + by * layer;
    if (overwrite || blocks[i] === AIR) blocks[i] = id;
  };

  // The grass under a trunk turns to dirt, as in real soil.
  set(x, ground, z, DIRT, true);
  const top = ground + trunk;
  for (let y = ground + 1; y <= top; y++) set(x, y, z, WOOD, true);

  // Canopy: two wide layers, one narrow layer, and a cap.
  for (let dy = -2; dy <= 1; dy++) {
    const y = top + dy;
    const r = dy < 0 ? 2 : 1;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (dy === 1 || rand() < 0.55)) continue;
        set(x + dx, y, z + dz, LEAVES, false);
      }
    }
  }
}

function gauss(dx, dz, radius) {
  return Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function maxSlope(heights, size, x, z) {
  const h = heights[x + z * size];
  let m = 0;
  if (x > 0) m = Math.max(m, Math.abs(h - heights[x - 1 + z * size]));
  if (x < size - 1) m = Math.max(m, Math.abs(h - heights[x + 1 + z * size]));
  if (z > 0) m = Math.max(m, Math.abs(h - heights[x + (z - 1) * size]));
  if (z < size - 1) m = Math.max(m, Math.abs(h - heights[x + (z + 1) * size]));
  return m;
}
