import { PLAYER } from '../config.js';

const HALF = PLAYER.WIDTH / 2;
const SKIN = 1e-4; // gap kept between the player box and block faces
const EDGE = 1e-7; // treats exactly-touching faces as non-overlapping
const MAX_PITCH = Math.PI / 2 - 0.01;

/**
 * First-person player with an axis-aligned bounding box (0.6 x 1.8 x 0.6).
 * `position` is the centre of the feet. Physics runs at a fixed time step and
 * resolves collisions one axis at a time against solid voxels, which is
 * stable, cheap, and can never tunnel because a single step moves far less
 * than one block.
 */
export class Player {
  constructor(world) {
    this.world = world;
    this.position = { x: 0, y: 0, z: 0 };
    this.prevPosition = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.walkDistance = 0; // accumulates while walking on the ground (head bob)
  }

  spawn(point, yaw = this.yaw) {
    this.position.x = point.x;
    this.position.y = point.y + SKIN;
    this.position.z = point.z;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.yaw = yaw;
    this.pitch = -0.12;
    this.onGround = false;
    this.unstick();
    this.syncPrevious();
  }

  syncPrevious() {
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
  }

  look(dx, dy) {
    this.yaw -= dx * PLAYER.MOUSE_SENSITIVITY;
    this.pitch -= dy * PLAYER.MOUSE_SENSITIVITY;
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
    if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH;
    // Keep yaw bounded to avoid precision loss over long sessions.
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /** AABB at the current (or given) feet position. */
  getBox(pos = this.position) {
    return {
      minX: pos.x - HALF, maxX: pos.x + HALF,
      minY: pos.y, maxY: pos.y + PLAYER.HEIGHT,
      minZ: pos.z - HALF, maxZ: pos.z + HALF,
    };
  }

  /**
   * True if the unit cell at (x, y, z) overlaps the player's box. Uses exactly
   * the same cell range as the collision code, so a block that placement
   * allows can never be one the physics considers overlapping.
   */
  intersectsBlock(x, y, z) {
    const b = this.getBox();
    return (
      x >= Math.floor(b.minX) && x <= Math.floor(b.maxX - EDGE) &&
      y >= Math.floor(b.minY) && y <= Math.floor(b.maxY - EDGE) &&
      z >= Math.floor(b.minZ) && z <= Math.floor(b.maxZ - EDGE)
    );
  }

  /** True if the box at `pos` overlaps any solid voxel. */
  collidesAt(pos = this.position) {
    const b = this.getBox(pos);
    const x0 = Math.floor(b.minX), x1 = Math.floor(b.maxX - EDGE);
    const y0 = Math.floor(b.minY), y1 = Math.floor(b.maxY - EDGE);
    const z0 = Math.floor(b.minZ), z1 = Math.floor(b.maxZ - EDGE);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (this.world.isSolidForCollision(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  /**
   * Safety net: if the player is somehow inside terrain (which the placement
   * rules prevent), move them the smallest distance that frees them — a small
   * nudge first, and only as a last resort up to the next open space.
   */
  unstick() {
    if (!this.collidesAt()) return false;
    const p = this.position;
    const start = { x: p.x, y: p.y, z: p.z };
    const nudges = [0.002, 0.01, 0.05, 0.15, 0.3, 0.5, 0.75, 1];
    const dirs = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
    for (const d of nudges) {
      for (const [dx, dy, dz] of dirs) {
        p.x = start.x + dx * d;
        p.y = start.y + dy * d;
        p.z = start.z + dz * d;
        if (!this.collidesAt()) {
          if (dy) this.velocity.y = 0;
          return true;
        }
      }
    }
    p.x = start.x;
    p.z = start.z;
    const startY = start.y;
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

  /**
   * Advances the simulation by one fixed step.
   * @param {number} dt
   * @param {{forward:number, strafe:number, jump:boolean}} input
   */
  step(dt, input) {
    this.unstick();

    // --- horizontal intent relative to where the camera faces -------------
    let fx = input.forward;
    let sx = input.strafe;
    const mag = Math.hypot(fx, sx);
    if (mag > 1) {
      fx /= mag;
      sx /= mag;
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    const wishX = (-sin * fx + cos * sx) * PLAYER.WALK_SPEED;
    const wishZ = (-cos * fx - sin * sx) * PLAYER.WALK_SPEED;

    const rate = this.onGround ? PLAYER.GROUND_ACCEL : PLAYER.AIR_ACCEL;
    const blend = 1 - Math.exp(-rate * dt);
    this.velocity.x += (wishX - this.velocity.x) * blend;
    this.velocity.z += (wishZ - this.velocity.z) * blend;

    // --- vertical ---------------------------------------------------------
    if (input.jump && this.onGround) {
      this.velocity.y = PLAYER.JUMP_SPEED;
      this.onGround = false;
    }
    this.velocity.y -= PLAYER.GRAVITY * dt;
    if (this.velocity.y < -PLAYER.TERMINAL_VELOCITY) this.velocity.y = -PLAYER.TERMINAL_VELOCITY;

    // --- integrate with per-axis collision ---------------------------------
    const dy = this.velocity.y * dt;
    const hitY = this.moveAxis('y', dy);
    this.onGround = hitY && dy < 0;
    const beforeX = this.position.x;
    const beforeZ = this.position.z;
    this.moveAxis('x', this.velocity.x * dt);
    this.moveAxis('z', this.velocity.z * dt);

    if (this.onGround) {
      this.walkDistance += Math.hypot(this.position.x - beforeX, this.position.z - beforeZ);
    }

    // Safety net: never let the player drift out of the world.
    if (this.position.y < -32 || !Number.isFinite(this.position.y)) {
      this.spawn(this.world.findSpawnPoint());
    }
  }

  /** Moves along one axis and clamps against solid voxels. Returns true on contact. */
  moveAxis(axis, delta) {
    if (delta === 0) return false;
    const p = this.position;
    p[axis] += delta;

    const b = this.getBox();
    const x0 = Math.floor(b.minX), x1 = Math.floor(b.maxX - EDGE);
    const y0 = Math.floor(b.minY), y1 = Math.floor(b.maxY - EDGE);
    const z0 = Math.floor(b.minZ), z1 = Math.floor(b.maxZ - EDGE);

    let hit = false;
    let limit = delta > 0 ? Infinity : -Infinity;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!this.world.isSolidForCollision(x, y, z)) continue;
          hit = true;
          const c = axis === 'x' ? x : axis === 'y' ? y : z;
          if (delta > 0) limit = Math.min(limit, c);
          else limit = Math.max(limit, c + 1);
        }
      }
    }
    if (!hit) return false;

    if (axis === 'y') {
      p.y = delta > 0 ? limit - PLAYER.HEIGHT - SKIN : limit + SKIN;
    } else {
      p[axis] = delta > 0 ? limit - HALF - SKIN : limit + HALF + SKIN;
    }
    this.velocity[axis] = 0;
    return true;
  }

  /** Eye position, interpolated between physics steps for smooth rendering. */
  getEyePosition(alpha, out) {
    out.x = this.prevPosition.x + (this.position.x - this.prevPosition.x) * alpha;
    out.y = this.prevPosition.y + (this.position.y - this.prevPosition.y) * alpha + PLAYER.EYE_HEIGHT;
    out.z = this.prevPosition.z + (this.position.z - this.prevPosition.z) * alpha;
    return out;
  }
}
