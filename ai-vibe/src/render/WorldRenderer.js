import * as THREE from 'three';
import { WORLD } from '../config.js';
import { buildVoxelGeometry } from '../world/mesher.js';
import { createNoise2D } from '../utils/random.js';
import { STONE, AIR } from '../world/blocks.js';

/**
 * Turns the voxel world into chunked meshes. Edits only rebuild the chunks
 * they touch (plus neighbours whose faces or ambient occlusion change), so
 * placing or breaking a block costs a couple of milliseconds at most.
 */
export class WorldRenderer {
  constructor(scene, world, materials) {
    this.scene = scene;
    this.world = world;
    this.materials = materials;
    this.chunkSize = WORLD.CHUNK_SIZE;
    this.chunksX = Math.ceil(world.size / this.chunkSize);
    this.chunksZ = Math.ceil(world.size / this.chunkSize);
    this.chunks = new Map();
    this.dirty = new Set();
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);

    this.getId = (x, y, z) => world.getBlockForMeshing(x, y, z);

    world.onChange((event) => {
      if (event.type === 'reload') this.markAllDirty();
      else if (event.type === 'block') this.markDirtyAround(event.x, event.z);
    });

    this.markAllDirty();
    this.base = this.buildRockBase();
    scene.add(this.base);
  }

  key(cx, cz) {
    return cx + ',' + cz;
  }

  markAllDirty() {
    for (let cz = 0; cz < this.chunksZ; cz++) {
      for (let cx = 0; cx < this.chunksX; cx++) this.dirty.add(this.key(cx, cz));
    }
  }

  markDirtyAround(x, z) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bx = x + dx;
        const bz = z + dz;
        if (bx < 0 || bz < 0 || bx >= this.world.size || bz >= this.world.size) continue;
        this.dirty.add(this.key(Math.floor(bx / this.chunkSize), Math.floor(bz / this.chunkSize)));
      }
    }
  }

  /** Rebuilds dirty chunks. Returns true if any geometry changed. */
  update() {
    if (this.dirty.size === 0) return false;
    for (const k of this.dirty) {
      const [cx, cz] = k.split(',').map(Number);
      this.rebuildChunk(cx, cz);
    }
    this.dirty.clear();
    return true;
  }

  rebuildChunk(cx, cz) {
    const k = this.key(cx, cz);
    const x0 = cx * this.chunkSize;
    const z0 = cz * this.chunkSize;
    const geometry = buildVoxelGeometry(
      {
        x0, x1: Math.min(x0 + this.chunkSize, this.world.size),
        y0: 0, y1: this.world.height,
        z0, z1: Math.min(z0 + this.chunkSize, this.world.size),
      },
      this.getId,
    );

    let mesh = this.chunks.get(k);
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    } else {
      mesh = new THREE.Mesh(geometry, this.materials);
      mesh.name = `chunk ${k}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.chunks.set(k, mesh);
      this.group.add(mesh);
    }
  }

  /**
   * Decorative, non-interactive rock base hanging below the island, so the
   * world reads as a floating island rather than a flat slab. It is never
   * edited, and the player can't reach it (y < 0 is solid for collision).
   */
  buildRockBase() {
    const size = this.world.size;
    const noise = createNoise2D(this.world.seed + 31337);
    const c = (size - 1) / 2;
    const maxDepth = 20;
    const depth = new Int16Array(size * size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        // Inverted, jagged cone: shallow at the rim, deepest under the centre.
        const r = Math.min(1, Math.hypot(x - c, z - c) / (size * 0.53));
        const cone = Math.pow(1 - r, 0.9);
        const jag = noise(x / 3.2, z / 3.2) * 3 + noise(x / 8, z / 8) * 2.5;
        const tip = noise(x / 1.7 + 40, z / 1.7) > 0.45 ? 3 : 0;
        depth[x + z * size] = Math.max(1, Math.round(maxDepth * cone + jag * cone + tip * cone + 1));
      }
    }
    const getId = (x, y, z) => {
      if (y >= 0 || x < 0 || z < 0 || x >= size || z >= size) return AIR;
      const d = depth[x + z * size];
      return y < -d ? AIR : STONE;
    };
    const geometry = buildVoxelGeometry(
      { x0: 0, x1: size, y0: -maxDepth - 10, y1: 0, z0: 0, z1: size },
      getId,
    );
    const mesh = new THREE.Mesh(geometry, this.materials);
    mesh.name = 'rock base';
    mesh.receiveShadow = true;
    // Casting closes the island's shadow volume from below, so the underside
    // facing the sun is correctly shaded by the terrain above it.
    mesh.castShadow = true;
    return mesh;
  }
}
