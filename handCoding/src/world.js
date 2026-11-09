export const SIZE = 32;
export const HEIGHT = 48;
export const SEED = 42;
export const BLOCK = Object.freeze({ AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5 });
export const BLOCK_NAMES = ['Air', 'Grass', 'Dirt', 'Stone', 'Wood', 'Leaves'];

export function inBounds(x, y, z) {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
    && x >= 0 && x < SIZE && z >= 0 && z < SIZE && y >= 0 && y < HEIGHT;
}

export function blockIndex(x, y, z) { return x + SIZE * (z + SIZE * y); }

export function randomAt(x, z, seed = SEED) {
  let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function noise(x, z, scale, seed) {
  const ix = Math.floor(x / scale), iz = Math.floor(z / scale);
  const smooth = t => t * t * (3 - 2 * t);
  const tx = smooth(x / scale - ix), tz = smooth(z / scale - iz);
  const mix = (a, b, t) => a + (b - a) * t;
  return mix(mix(randomAt(ix, iz, seed), randomAt(ix + 1, iz, seed), tx),
    mix(randomAt(ix, iz + 1, seed), randomAt(ix + 1, iz + 1, seed), tx), tz);
}

export class VoxelWorld {
  constructor(seed = SEED) {
    this.seed = seed;
    this.blocks = new Uint8Array(SIZE * SIZE * HEIGHT);
    this.spawn = { x: 16.5, y: 0, z: 25.5 };
    this.generate();
    this.original = this.blocks.slice();
  }

  get(x, y, z) { return inBounds(x, y, z) ? this.blocks[blockIndex(x, y, z)] : BLOCK.AIR; }

  set(x, y, z, type) {
    if (!inBounds(x, y, z) || !Number.isInteger(type) || type < 0 || type > 5) return false;
    this.blocks[blockIndex(x, y, z)] = type;
    return true;
  }

  surface(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) if (this.get(x, y, z)) return y;
    return -1;
  }

  generate() {
    const heights = [];
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        heights[x + z * SIZE] = Math.floor(4 + noise(x, z, 11, this.seed) * 7
          + noise(x, z, 5, this.seed + 1) * 3);
      }
    }
    const spawnHeight = heights[16 + 25 * SIZE];
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const h = Math.abs(x - 16) <= 2 && Math.abs(z - 25) <= 2 ? spawnHeight : heights[x + z * SIZE];
        for (let y = 0; y <= h; y++) {
          this.set(x, y, z, y === h ? BLOCK.GRASS : y >= h - 2 ? BLOCK.DIRT : BLOCK.STONE);
        }
      }
    }
    this.spawn.y = spawnHeight + 1;

    // Grid candidates keep tree crowns separated without an elaborate placement system.
    for (let gz = 3; gz < SIZE - 3; gz += 5) {
      for (let gx = 3; gx < SIZE - 3; gx += 5) {
        const x = gx + Math.floor(randomAt(gx, gz, this.seed + 2) * 3) - 1;
        const z = gz + Math.floor(randomAt(gx, gz, this.seed + 3) * 3) - 1;
        if (Math.hypot(x - 16, z - 25) < 6 || randomAt(x, z, this.seed + 4) < 0.22) continue;
        const ground = this.surface(x, z);
        const trunkHeight = 3 + Math.floor(randomAt(x, z, this.seed + 5) * 2);
        const crownY = ground + trunkHeight;
        for (let dy = -1; dy <= 2; dy++) {
          const radius = dy === 2 ? 1 : 2;
          for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
              if (!this.get(x + dx, crownY + dy, z + dz)) this.set(x + dx, crownY + dy, z + dz, BLOCK.LEAVES);
            }
          }
        }
        for (let y = ground + 1; y <= crownY; y++) this.set(x, y, z, BLOCK.WOOD);
      }
    }
  }
}
