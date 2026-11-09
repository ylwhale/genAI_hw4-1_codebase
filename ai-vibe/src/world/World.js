import { WORLD } from '../config.js';
import { AIR, GRASS, LEAVES, WOOD, STONE, isValidBlockId } from './blocks.js';
import { generateTerrain } from './terrain.js';

/**
 * Voxel storage for the 32 x 32 world.
 *
 * Blocks are kept in a flat Uint8Array indexed as x + z*SIZE + y*SIZE*SIZE.
 * A second array (`base`) keeps the freshly generated terrain so that edits
 * can be computed as a diff (for saving) and the world can be reset without
 * re-running generation.
 */
export class World {
  constructor({ size = WORLD.SIZE, height = WORLD.HEIGHT, seed = WORLD.SEED } = {}) {
    this.size = size;
    this.height = height;
    this.seed = seed;
    this.volume = size * size * height;
    this.blocks = new Uint8Array(this.volume);
    this.base = new Uint8Array(this.volume);
    this.listeners = new Set();
    this.generate();
  }

  // ---------------------------------------------------------------- indexing

  index(x, y, z) {
    return x + z * this.size + y * this.size * this.size;
  }

  coordsOf(index) {
    const layer = this.size * this.size;
    const y = Math.floor(index / layer);
    const rem = index - y * layer;
    const z = Math.floor(rem / this.size);
    const x = rem - z * this.size;
    return { x, y, z };
  }

  inBounds(x, y, z) {
    return (
      Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
      x >= 0 && x < this.size && z >= 0 && z < this.size && y >= 0 && y < this.height
    );
  }

  // ------------------------------------------------------------------ access

  /** Block id at integer coords; AIR outside the world. */
  getBlock(x, y, z) {
    if (x < 0 || x >= this.size || z < 0 || z >= this.size || y < 0 || y >= this.height) return AIR;
    return this.blocks[x + z * this.size + y * this.size * this.size];
  }

  /**
   * Solidity used by player collision. The world is a floating island with
   * invisible walls at its horizontal edges and an indestructible rock base
   * below y = 0, so the player can never leave the play area or fall out.
   */
  isSolidForCollision(x, y, z) {
    if (x < 0 || x >= this.size || z < 0 || z >= this.size) return true;
    if (y < 0) return true;
    if (y >= this.height) return false;
    return this.blocks[x + z * this.size + y * this.size * this.size] !== AIR;
  }

  /**
   * Block id used when deciding which faces/AO to draw. Horizontally outside
   * the world counts as air (the island's cliff sides are visible); below the
   * world (inside the footprint) counts as stone, covered by the decorative
   * rock base, so bottom faces are hidden without darkening the rim's AO.
   */
  getBlockForMeshing(x, y, z) {
    if (y < 0) return x < 0 || x >= this.size || z < 0 || z >= this.size ? AIR : STONE;
    return this.getBlock(x, y, z);
  }

  /**
   * Sets a block. Returns true if the world changed. Out-of-bounds coordinates
   * or invalid ids are rejected and leave the world untouched.
   */
  setBlock(x, y, z, id) {
    if (!this.inBounds(x, y, z) || !isValidBlockId(id)) return false;
    const i = this.index(x, y, z);
    const previous = this.blocks[i];
    if (previous === id) return false;
    this.blocks[i] = id;
    this.emit({ type: 'block', x, y, z, previous, id });
    return true;
  }

  // ------------------------------------------------------------- generation

  generate() {
    this.base.fill(AIR);
    generateTerrain(this.base, this.size, this.height, this.seed);
    this.blocks.set(this.base);
    this.emit({ type: 'reload' });
  }

  /** Restores the original generated terrain (deterministic for the seed). */
  resetToBase() {
    this.blocks.set(this.base);
    this.emit({ type: 'reload' });
  }

  // ------------------------------------------------------------------ edits

  /** List of [index, blockId] pairs that differ from the generated terrain. */
  getEdits() {
    const edits = [];
    const { blocks, base } = this;
    for (let i = 0; i < this.volume; i++) {
      if (blocks[i] !== base[i]) edits.push([i, blocks[i]]);
    }
    return edits;
  }

  /**
   * Applies a list of [index, blockId] edits on top of the generated terrain.
   * Invalid entries are skipped. Returns the number of edits applied.
   */
  applyEdits(edits) {
    this.blocks.set(this.base);
    let applied = 0;
    if (Array.isArray(edits)) {
      for (const entry of edits) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [i, id] = entry;
        if (!Number.isInteger(i) || i < 0 || i >= this.volume) continue;
        if (!isValidBlockId(id)) continue;
        this.blocks[i] = id;
        applied++;
      }
    }
    this.emit({ type: 'reload' });
    return applied;
  }

  // ------------------------------------------------------------------ queries

  /** Highest non-air y in a column, or -1 if the column is empty. */
  topY(x, z) {
    for (let y = this.height - 1; y >= 0; y--) {
      if (this.getBlock(x, y, z) !== AIR) return y;
    }
    return -1;
  }

  /**
   * Finds a safe spawn: the feet position on top of a natural grass column
   * near the world centre, clear of trees, with open sky above. Works on the
   * current (possibly edited) world.
   */
  findSpawnPoint() {
    const cx = Math.floor(this.size / 2);
    const cz = Math.floor(this.size / 2);
    const maxR = Math.ceil(this.size / 2);
    let fallback = null;
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring only
          const x = cx + dx;
          const z = cz + dz;
          if (x < 1 || z < 1 || x >= this.size - 1 || z >= this.size - 1) continue;
          const top = this.topY(x, z);
          const block = top >= 0 ? this.getBlock(x, top, z) : AIR;
          if (block === LEAVES || block === WOOD) continue;
          const spot = { x: x + 0.5, y: top + 1, z: z + 0.5 };
          if (block === GRASS && top + 3 < this.height) return spot;
          if (!fallback) fallback = spot;
        }
      }
    }
    return fallback ?? { x: cx + 0.5, y: this.topY(cx, cz) + 1, z: cz + 0.5 };
  }

  // ----------------------------------------------------------------- events

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }
}
