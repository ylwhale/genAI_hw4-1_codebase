const SKIN = 1e-4; // gap kept between the box and block faces
const EDGE = 1e-7; // treats exactly-touching faces as non-overlapping

/**
 * A falling, colliding axis-aligned box (feet-centred `position`) used for
 * creatures. It resolves movement one axis at a time against the same voxel
 * solidity the player uses (world edges and the rock base are solid), so a
 * creature can never pass through blocks, trees or out of the world.
 */
export class Body {
  constructor(world, width, height) {
    this.world = world;
    this.half = width / 2;
    this.height = height;
    this.position = { x: 0, y: 0, z: 0 };
    this.prevPosition = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.onGround = false;
  }

  place(x, y, z) {
    this.position.x = x;
    this.position.y = y + SKIN;
    this.position.z = z;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.onGround = false;
    this.unstick();
    this.syncPrevious();
  }

  syncPrevious() {
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
  }

  getBox(pos = this.position) {
    return {
      minX: pos.x - this.half, maxX: pos.x + this.half,
      minY: pos.y, maxY: pos.y + this.height,
      minZ: pos.z - this.half, maxZ: pos.z + this.half,
    };
  }

  /** Inclusive cell range overlapped by the box (same rule as collision). */
  cellRange(b = this.getBox()) {
    return {
      x0: Math.floor(b.minX), x1: Math.floor(b.maxX - EDGE),
      y0: Math.floor(b.minY), y1: Math.floor(b.maxY - EDGE),
      z0: Math.floor(b.minZ), z1: Math.floor(b.maxZ - EDGE),
    };
  }

  overlapsCell(x, y, z) {
    const r = this.cellRange();
    return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 && z >= r.z0 && z <= r.z1;
  }

  collidesAt(pos = this.position) {
    const r = this.cellRange(this.getBox(pos));
    for (let y = r.y0; y <= r.y1; y++) {
      for (let z = r.z0; z <= r.z1; z++) {
        for (let x = r.x0; x <= r.x1; x++) {
          if (this.world.isSolidForCollision(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  /** Lifts the body to the nearest free space if it is embedded in blocks. */
  unstick() {
    if (!this.collidesAt()) return false;
    const startY = this.position.y;
    for (let lift = 1; lift <= this.world.height + 4; lift++) {
      this.position.y = Math.floor(startY) + lift + SKIN;
      if (!this.collidesAt()) {
        this.velocity.y = 0;
        return true;
      }
    }
    this.position.y = startY;
    return false;
  }

  moveAxis(axis, delta) {
    if (delta === 0) return false;
    const p = this.position;
    p[axis] += delta;
    const r = this.cellRange();
    let hit = false;
    let limit = delta > 0 ? Infinity : -Infinity;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let z = r.z0; z <= r.z1; z++) {
        for (let x = r.x0; x <= r.x1; x++) {
          if (!this.world.isSolidForCollision(x, y, z)) continue;
          hit = true;
          const c = axis === 'x' ? x : axis === 'y' ? y : z;
          limit = delta > 0 ? Math.min(limit, c) : Math.max(limit, c + 1);
        }
      }
    }
    if (!hit) return false;
    if (axis === 'y') p.y = delta > 0 ? limit - this.height - SKIN : limit + SKIN;
    else p[axis] = delta > 0 ? limit - this.half - SKIN : limit + this.half + SKIN;
    this.velocity[axis] = 0;
    return true;
  }

  /**
   * Applies gravity and moves by the current velocity. Returns which
   * horizontal axes were blocked this step.
   */
  integrate(dt, gravity, terminal) {
    this.velocity.y = Math.max(-terminal, this.velocity.y - gravity * dt);
    const dy = this.velocity.y * dt;
    const hitY = this.moveAxis('y', dy);
    this.onGround = hitY && dy < 0;
    const hitX = this.moveAxis('x', this.velocity.x * dt);
    const hitZ = this.moveAxis('z', this.velocity.z * dt);
    return { hitX, hitZ };
  }
}
