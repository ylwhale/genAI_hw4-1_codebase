import { COMBAT, PLAYER } from '../config.js';
import { mulberry32 } from '../utils/random.js';
import { GRASS, DIRT, STONE } from '../world/blocks.js';
import { raycastVoxels } from '../interaction/raycast.js';
import { MOB_TYPES, SPAWN_LIST } from './mobTypes.js';
import { Mob } from './Mob.js';

const GROUND_BLOCKS = new Set([GRASS, DIRT, STONE]);
const SPAWN_MARGIN = 1; // extra distance beyond SPAWN_MIN_DISTANCE so the whole body is clear
const MIN_SPACING = 5; // between spawned creatures
const MAX_PLAYER_PUSH = 0.2; // per physics step when separating player and creature

/**
 * Owns the creatures: spawning in safe places, the fixed-step AI update,
 * ray targeting for player attacks, and line-of-sight checks. Pure logic
 * (no rendering), so it can be tested in Node.
 *
 * Events (via on()): { type: 'attack-start' | 'hit' | 'miss' | 'killed', mob }
 */
export class MobManager {
  constructor(world, { seed = world.seed } = {}) {
    this.world = world;
    this.seed = seed;
    this.listeners = new Set();
    this.mobs = SPAWN_LIST.map((typeId, i) => new Mob(MOB_TYPES[typeId], world, i, seed * 101 + i * 7 + 1));
    this.tmpA = {};
    this.tmpB = {};
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, mob) {
    for (const l of this.listeners) l({ type, mob });
  }

  get aliveCount() {
    return this.mobs.filter((m) => m.alive).length;
  }

  // ------------------------------------------------------------- spawning

  /**
   * Places every creature at a fresh safe spot: standing on natural ground
   * (grass, dirt or stone — never on trees), with clear headroom, fully inside
   * the world, more than SPAWN_MIN_DISTANCE horizontally from `playerSpawn`,
   * and spread apart. Deterministic for a given world state.
   */
  spawnAll(playerSpawn) {
    const spots = this.findSpawnSpots(playerSpawn);
    this.mobs.forEach((mob, i) => {
      const s = spots[i];
      if (s) mob.respawn(s.x, s.y, s.z);
      else {
        mob.respawn(0.5, this.world.height, 0.5);
        mob.state = 'dead'; // no valid place left (heavily edited world)
      }
    });
    return spots;
  }

  findSpawnSpots(playerSpawn) {
    const w = this.world;
    const candidates = [];
    const minDist = COMBAT.SPAWN_MIN_DISTANCE + SPAWN_MARGIN;
    for (let z = 1; z < w.size - 1; z++) {
      for (let x = 1; x < w.size - 1; x++) {
        const cx = x + 0.5;
        const cz = z + 0.5;
        if (Math.hypot(cx - playerSpawn.x, cz - playerSpawn.z) < minDist) continue;
        const top = w.topY(x, z);
        if (top < 0 || !GROUND_BLOCKS.has(w.getBlock(x, top, z))) continue;
        candidates.push({ x: cx, y: top + 1, z: cz });
      }
    }
    // Seeded shuffle: same world -> same spawn spots.
    const rand = mulberry32(this.seed * 31 + 5);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const chosen = [];
    for (const mob of this.mobs) {
      let spot = null;
      for (const spacing of [MIN_SPACING, 2, 0]) {
        spot = candidates.find(
          (c) =>
            !chosen.includes(c) &&
            this.fits(mob, c) &&
            chosen.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= spacing),
        );
        if (spot) break;
      }
      chosen.push(spot ?? null);
    }
    return chosen;
  }

  /** Would `mob`'s body fit standing at `spot` (no overlap, room above)? */
  fits(mob, spot) {
    const b = mob.body;
    const pos = { x: spot.x, y: spot.y + 1e-4, z: spot.z };
    if (pos.y + b.height >= this.world.height) return false;
    return !b.collidesAt(pos);
  }

  // --------------------------------------------------------------- update

  /**
   * Fixed-step update. `target` is the player's body centre {x, y, z} while
   * the player can be attacked, or null (creatures then just wander).
   */
  update(dt, target) {
    const ctx = {
      player: target,
      others: this.mobs,
      lineOfSight: (mob) => (target ? this.lineOfSight(mob, target) : false),
      onAttackStart: (mob) => this.emit('attack-start', mob),
      onHit: (mob) => this.emit('hit', mob),
      onMiss: (mob) => this.emit('miss', mob),
    };
    for (const mob of this.mobs) {
      mob.body.syncPrevious();
      mob.update(dt, ctx);
    }
  }

  /** True if no solid block lies between the mob's eye and `point`. */
  lineOfSight(mob, point) {
    const from = mob.eye(this.tmpA);
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const dz = point.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) return true;
    const hit = raycastVoxels(this.world, from, { x: dx, y: dy, z: dz }, dist);
    return !hit || hit.distance >= dist - 1e-6;
  }

  // ------------------------------------------------------------ targeting

  /**
   * Nearest living creature whose box the ray enters within `maxDistance`.
   * Returns { mob, distance } or null. (Walls are checked by the caller.)
   */
  raycast(origin, dir, maxDistance) {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (!(len > 0)) return null;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    let best = null;
    for (const mob of this.mobs) {
      if (!mob.alive) continue;
      const b = mob.body.getBox();
      // A slightly padded box decides whether the crosshair is "on" the
      // creature (forgiving aim); range and wall order use the real body.
      const pad = 0.06;
      const tPad = rayBox(origin, d, b.minX - pad, b.minY - pad, b.minZ - pad, b.maxX + pad, b.maxY + pad, b.maxZ + pad);
      if (tPad === null) continue;
      const tReal = rayBox(origin, d, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
      const t = tReal ?? tPad + pad;
      if (t <= maxDistance && (!best || t < best.distance)) best = { mob, distance: t };
    }
    return best;
  }

  /** True if a living creature's body overlaps the unit cell (blocks placement). */
  occupiesCell(x, y, z) {
    return this.mobs.some((m) => m.alive && m.body.overlapsCell(x, y, z));
  }

  /**
   * Pushes the player out of any creature's body (creatures don't collide
   * with the player). Every move goes through collision, so nobody ends up in
   * blocks. Rules: separate along the axis needing the smaller move, by the
   * distance actually needed; the player moves at most MAX_PLAYER_PUSH per
   * step (no camera snaps); a creature dropping onto the player (shallow
   * vertical overlap) is moved instead of the player; a push that is blocked
   * by terrain or would shove the player into another creature is undone and
   * the next option is tried. A few passes handle several creatures at once.
   */
  separatePlayer(player) {
    this.pushBudget = MAX_PLAYER_PUSH; // shared by every pass this step
    for (let pass = 0; pass < 3; pass++) {
      let any = false;
      for (const mob of this.mobs) {
        if (!mob.alive) continue;
        const o = this.overlapWith(player, mob);
        if (!o) continue;
        any = true;
        this.pushApart(player, mob, o);
      }
      if (!any) return;
    }
  }

  overlapWith(player, mob) {
    const pb = player.getBox();
    const mb = mob.body.getBox();
    const oy = Math.min(pb.maxY, mb.maxY) - Math.max(pb.minY, mb.minY);
    if (oy <= 0) return null;
    const ox = Math.min(pb.maxX, mb.maxX) - Math.max(pb.minX, mb.minX);
    const oz = Math.min(pb.maxZ, mb.maxZ) - Math.max(pb.minZ, mb.minZ);
    return ox > 0 && oz > 0 ? { pb, mb, oy } : null;
  }

  pushApart(player, mob, { pb, mb, oy }) {
    const dirX = player.position.x < mob.position.x ? -1 : 1;
    const dirZ = player.position.z < mob.position.z ? -1 : 1;
    const needX = (dirX > 0 ? mb.maxX - pb.minX : pb.maxX - mb.minX) + 1e-3;
    const needZ = (dirZ > 0 ? mb.maxZ - pb.minZ : pb.maxZ - mb.minZ) + 1e-3;
    const [short, long] = needX <= needZ ? [['x', dirX, needX], ['z', dirZ, needZ]] : [['z', dirZ, needZ], ['x', dirX, needX]];
    // Smallest moves first. A creature dropping onto the player (shallow
    // vertical overlap) is moved before the player is.
    const plan = oy < 0.25
      ? [['mob', short], ['mob', long], ['player', short], ['player', long]]
      : [['player', short], ['mob', short], ['player', long], ['mob', long]];
    for (const [mover, [axis, dir, need]] of plan) {
      if (mover === 'player') {
        const step = Math.min(need, this.pushBudget ?? MAX_PLAYER_PUSH);
        if (step <= 1e-4) continue;
        const before = player.position[axis];
        player.moveAxis(axis, dir * step);
        const moved = Math.abs(player.position[axis] - before);
        const intoOther = this.mobs.some((m) => m !== mob && m.alive && this.overlapWith(player, m));
        if (moved > 1e-4 && !intoOther) {
          this.pushBudget = (this.pushBudget ?? MAX_PLAYER_PUSH) - moved;
          return;
        }
        player.position[axis] = before;
      } else {
        const before = mob.body.position[axis];
        mob.body.moveAxis(axis, -dir * need);
        if (Math.abs(mob.body.position[axis] - before) > 1e-4) return;
      }
    }
  }

  /** Player body centre helper. */
  static playerTarget(player, out = {}) {
    out.x = player.position.x;
    out.y = player.position.y + PLAYER.HEIGHT / 2;
    out.z = player.position.z;
    return out;
  }
}

/** Slab-method ray/box intersection; returns the entry distance (0 if inside) or null. */
export function rayBox(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const [oa, da, lo, hi] of [
    [o.x, d.x, minX, maxX],
    [o.y, d.y, minY, maxY],
    [o.z, d.z, minZ, maxZ],
  ]) {
    if (Math.abs(da) < 1e-12) {
      if (oa < lo || oa > hi) return null;
      continue;
    }
    let t1 = (lo - oa) / da;
    let t2 = (hi - oa) / da;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return Math.max(0, tmin);
}
