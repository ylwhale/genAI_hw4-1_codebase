import { COMBAT, PLAYER } from '../config.js';
import { mulberry32 } from '../utils/random.js';
import { Body } from './Body.js';

export const DEATH_DURATION = 0.55; // seconds of death animation before the mob disappears
const TURN_RATE = 7; // radians / second when turning to face a direction
const STEER_RATE = 9; // horizontal velocity smoothing (1/s)

/**
 * One hostile creature: a collision body plus a small rule-based AI.
 *
 *   wander -> chase   when the player is within CHASE_RANGE
 *   chase  -> wander  when the player is beyond CHASE_GIVE_UP
 *   any    -> attack  when within ATTACK_RANGE, off cooldown, not stunned and
 *                     with a clear line of sight; the hit lands after a short
 *                     wind-up and only if the player is still in range and
 *                     visible (so attacks never pass through walls)
 *   any    -> dying -> dead   when health reaches 0
 *
 * All timers advance by `dt`, so behaviour is independent of frame rate.
 */
export class Mob {
  constructor(type, world, id, seed) {
    this.type = type;
    this.world = world;
    this.id = id;
    this.seed = seed;
    this.body = new Body(world, type.width, type.height);
    this.respawn(0, 0, 0);
  }

  /** Puts the mob back at full health, idle, at the given feet position. */
  respawn(x, y, z) {
    this.rand = mulberry32(this.seed);
    this.body.place(x, y, z);
    this.health = this.type.maxHealth;
    this.state = 'wander';
    this.yaw = this.rand() * Math.PI * 2;
    this.cooldown = 0.8 + this.rand() * 0.6; // brief grace period after spawning
    this.attackT = 0;
    this.struck = false;
    this.stun = 0;
    this.hurtT = Infinity; // time since last hit (for flash / health bar)
    this.deathT = 0;
    this.time = 0;
    this.walkDistance = 0;
    this.wander = { x: 0, z: 0, timer: 0.5 + this.rand() * 1.5, moving: false };
    this.sidestep = { x: 0, z: 0, timer: 0, side: 1 };
    this.chaseDir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    this.attackCount = 0;
  }

  get alive() {
    return this.state !== 'dying' && this.state !== 'dead';
  }

  get position() {
    return this.body.position;
  }

  /** Middle of the body (used for distances and line of sight). */
  center(out = {}) {
    out.x = this.body.position.x;
    out.y = this.body.position.y + this.type.height / 2;
    out.z = this.body.position.z;
    return out;
  }

  /** Eye point a little above the centre (line-of-sight origin). */
  eye(out = {}) {
    out.x = this.body.position.x;
    out.y = this.body.position.y + this.type.height * 0.75;
    out.z = this.body.position.z;
    return out;
  }

  /**
   * Applies damage from the player. `dirX/dirZ` is the horizontal direction
   * of the blow (for knockback). Returns true if this blow killed the mob.
   */
  takeHit(amount, dirX = 0, dirZ = 0) {
    if (!this.alive || !(amount > 0)) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtT = 0;
    this.stun = this.type.hitStun ?? COMBAT.HIT_STUN;
    const len = Math.hypot(dirX, dirZ) || 1;
    const kb = this.type.knockback;
    this.body.velocity.x = (dirX / len) * kb;
    this.body.velocity.z = (dirZ / len) * kb;
    if (this.body.onGround) this.body.velocity.y = Math.max(this.body.velocity.y, kb * 0.6);
    // A struck Mossling's wind-up is interrupted; the Stoneguard's is not
    // (it is too heavy to be stun-locked).
    if (this.state === 'attack' && !this.struck && this.type.interruptible !== false) this.struck = true;
    if (this.health <= 0) {
      this.state = 'dying';
      this.deathT = 0;
      return true;
    }
    return false;
  }

  /**
   * Advances the mob by `dt` seconds.
   * @param {object} ctx {
   *   player: { x, y, z } body centre, or null when the player can't be targeted,
   *   lineOfSight(mob) -> boolean,
   *   others: Mob[],
   *   onAttackStart(mob), onHit(mob), onMiss(mob)
   * }
   */
  update(dt, ctx) {
    this.time += dt;
    this.hurtT += dt;
    if (this.state === 'dead') return;
    if (this.state === 'dying') {
      this.deathT += dt;
      this.steer(0, 0, dt);
      this.body.integrate(dt, PLAYER.GRAVITY, PLAYER.TERMINAL_VELOCITY);
      if (this.deathT >= DEATH_DURATION) this.state = 'dead';
      return;
    }
    this.body.unstick();
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.stun = Math.max(0, this.stun - dt);

    const p = ctx.player;
    const c = this.center();
    let dx = 0;
    let dz = 0;
    let dist = Infinity;
    if (p) {
      dx = p.x - c.x;
      dz = p.z - c.z;
      dist = Math.hypot(dx, p.y - c.y, dz);
    }

    // ---------------------------------------------------------- decisions
    if (this.state === 'attack') {
      this.attackT += dt;
      if (!this.struck && this.attackT >= COMBAT.ATTACK_WINDUP) {
        this.struck = true;
        if (p && dist <= COMBAT.ATTACK_RANGE && ctx.lineOfSight(this)) ctx.onHit?.(this);
        else ctx.onMiss?.(this);
      }
      if (this.attackT >= COMBAT.ATTACK_WINDUP + COMBAT.ATTACK_RECOVER) {
        this.state = p && dist <= COMBAT.CHASE_GIVE_UP ? 'chase' : 'wander';
      }
    } else if (
      // Attacks start only with both feet on the ground, so a wind-up never
      // begins at the top of a hop and resolves out of reach after landing.
      p && this.body.onGround && dist <= COMBAT.ATTACK_RANGE && this.cooldown <= 0 && this.stun <= 0 &&
      ctx.lineOfSight(this)
    ) {
      this.state = 'attack';
      this.attackT = 0;
      this.struck = false;
      this.cooldown = COMBAT.ATTACK_COOLDOWN;
      this.attackCount++;
      ctx.onAttackStart?.(this);
    } else if (p && (dist <= COMBAT.CHASE_RANGE || (this.state === 'chase' && dist <= COMBAT.CHASE_GIVE_UP))) {
      this.state = 'chase';
    } else {
      this.state = 'wander';
    }

    // ----------------------------------------------------------- movement
    let wishX = 0;
    let wishZ = 0;
    let speed = 0;
    let faceYaw = null;

    if (this.state === 'attack') {
      faceYaw = Math.atan2(dx, dz); // rooted, facing the player
    } else if (this.state === 'chase') {
      const hd = Math.hypot(dx, dz);
      faceYaw = Math.atan2(dx, dz);
      // Settle only when standing still would actually allow an attack:
      // on the ground, within real (3D) reach, with a clear line of sight, and
      // close (or already touching). Otherwise keep closing in — into a step
      // (which triggers the hop below), or off a ledge above the player — and
      // never stop in mid-air, so a hop always carries the mob onto the step.
      const touching = hd <= this.body.half + PLAYER.WIDTH / 2 + 0.08;
      const inReach = dist <= COMBAT.ATTACK_RANGE - 0.1 && ctx.lineOfSight(this);
      const settle = this.body.onGround && inReach && (hd <= this.type.stopDistance || touching);
      // Touching on the ground with the player level or above (e.g. jumping):
      // hold position instead of walking underneath them, unless a step is
      // in the way (walking into it is what triggers the hop).
      const hold =
        !settle && this.body.onGround && touching && p.y >= c.y - 0.5 && hd > 0.05 &&
        !this.blockedAhead(dx / hd, dz / hd);
      if (hd > 0.3) {
        this.chaseDir.x = dx / hd;
        this.chaseDir.z = dz / hd;
      }
      if (!settle && !hold) {
        if (hd <= 0.3 && p.y < c.y - 0.5) {
          // Standing over the player's head on a ledge: walk off the blocks
          // underfoot (whatever direction that is) to drop down beside them —
          // unless there is no room down there (e.g. the player is in a 1x1
          // pit), in which case it waits on the rim.
          const off = this.offLedgeDir();
          const dir = off ?? this.chaseDir;
          if (!this.noRoomBeside(p)) {
            wishX = dir.x;
            wishZ = dir.z;
          }
        } else if (hd > 0.05) {
          wishX = dx / hd;
          wishZ = dz / hd;
        }
        speed = this.type.speed;
        if (this.sidestep.timer > 0) {
          this.sidestep.timer -= dt;
          wishX = this.sidestep.x;
          wishZ = this.sidestep.z;
        }
      }
    } else {
      this.wander.timer -= dt;
      if (this.wander.timer <= 0) this.pickWander();
      if (this.wander.moving) {
        wishX = this.wander.x;
        wishZ = this.wander.z;
        speed = this.type.wanderSpeed;
        if (this.dropAhead(wishX, wishZ) > 2) this.pickWander(true); // don't wander off cliffs
      }
    }

    // Keep a little personal space from other creatures.
    if (speed > 0 && ctx.others) {
      for (const o of ctx.others) {
        if (o === this || !o.alive) continue;
        const ox = this.body.position.x - o.body.position.x;
        const oz = this.body.position.z - o.body.position.z;
        const d = Math.hypot(ox, oz);
        const min = this.body.half + o.body.half + 0.25;
        if (d > 0 && d < min) {
          wishX += (ox / d) * (min - d) * 2;
          wishZ += (oz / d) * (min - d) * 2;
        }
      }
      const l = Math.hypot(wishX, wishZ);
      if (l > 1) {
        wishX /= l;
        wishZ /= l;
      }
    }

    this.steer(wishX * speed, wishZ * speed, dt);
    const before = { x: this.body.position.x, z: this.body.position.z };
    const { hitX, hitZ } = this.body.integrate(dt, PLAYER.GRAVITY, PLAYER.TERMINAL_VELOCITY);
    this.walkDistance += Math.hypot(this.body.position.x - before.x, this.body.position.z - before.z);

    // --------------------------------------------- obstacles: hop, or go around
    if ((hitX || hitZ) && speed > 0 && this.body.onGround) {
      const canAttackNow = this.state === 'chase' && p && dist <= COMBAT.ATTACK_RANGE && ctx.lineOfSight(this);
      if (canAttackNow) {
        // Already able to strike from here: stay grounded (no futile hop).
      } else if (
        this.canStepUp(wishX, wishZ) ||
        // On diagonal staircases the step that stopped us may be on just one axis.
        (hitX && wishX !== 0 && this.canStepUp(Math.sign(wishX), 0)) ||
        (hitZ && wishZ !== 0 && this.canStepUp(0, Math.sign(wishZ)))
      ) {
        this.body.velocity.y = this.type.jumpSpeed;
        this.body.onGround = false;
      } else if (this.state === 'chase') {
        // Slide along the face that was hit (towards the player's side when
        // that is clear), and only reverse if the slide itself is blocked.
        // This follows corridors and gets around trunks and walls.
        const st = this.sidestep;
        const slidingAlongZ = Math.abs(st.z) > Math.abs(st.x);
        if (st.timer <= 0) {
          const hd = Math.hypot(dx, dz) || 1;
          const alongZ = hitX && (!hitZ || Math.abs(dx) >= Math.abs(dz)); // x-face -> slide along z
          const along = alongZ ? dz / hd : dx / hd;
          if (Math.abs(along) > 0.3) st.side = Math.sign(along);
          st.x = alongZ ? 0 : st.side;
          st.z = alongZ ? st.side : 0;
          st.timer = 0.8;
        } else if (slidingAlongZ ? hitZ : hitX) {
          st.side *= -1;
          st.x = -st.x;
          st.z = -st.z;
          st.timer = 0.8;
        }
      } else {
        this.pickWander(true);
      }
    }

    // --------------------------------------------------------- facing
    if (faceYaw === null && Math.hypot(this.body.velocity.x, this.body.velocity.z) > 0.05) {
      faceYaw = Math.atan2(this.body.velocity.x, this.body.velocity.z);
    }
    if (faceYaw !== null) {
      let diff = faceYaw - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const maxTurn = TURN_RATE * dt;
      this.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    }

    if (this.body.position.y < -40) this.state = 'dead'; // can't happen (solid floor); safety only
  }

  /** Frame-rate-independent velocity smoothing towards the wished velocity. */
  steer(vx, vz, dt) {
    const k = 1 - Math.exp(-STEER_RATE * dt);
    this.body.velocity.x += (vx - this.body.velocity.x) * k;
    this.body.velocity.z += (vz - this.body.velocity.z) * k;
  }

  pickWander(turnAway = false) {
    const r = this.rand;
    if (!turnAway && r() < 0.35) {
      this.wander.moving = false;
      this.wander.timer = 1 + r() * 1.8;
      return;
    }
    // Turning away = roughly opposite to the blocked / unsafe wander direction.
    const a = turnAway ? Math.atan2(this.wander.x, this.wander.z) + Math.PI + (r() - 0.5) * 1.6 : r() * Math.PI * 2;
    this.wander.x = Math.sin(a);
    this.wander.z = Math.cos(a);
    this.wander.moving = true;
    this.wander.timer = 1.6 + r() * 2.4;
  }

  /** How far the ground falls away one step ahead (Infinity off the island). */
  dropAhead(dirX, dirZ) {
    const ax = this.body.position.x + dirX * (this.body.half + 0.45);
    const az = this.body.position.z + dirZ * (this.body.half + 0.45);
    const cx = Math.floor(ax);
    const cz = Math.floor(az);
    if (cx < 0 || cz < 0 || cx >= this.world.size || cz >= this.world.size) return Infinity;
    const feet = Math.floor(this.body.position.y + 0.01);
    for (let d = 0; d <= 4; d++) {
      if (this.world.isSolidForCollision(cx, feet - 1 - d, cz)) return d;
    }
    return Infinity;
  }

  /**
   * True if the body could not stand anywhere touching the player at the
   * player's feet level (e.g. the player fills a 1x1 pit). Samples every
   * side of the player finely: a Stoneguard fits a 1-wide trench with only
   * 0.1 to spare.
   */
  noRoomBeside(p) {
    const y = Math.floor(p.y - PLAYER.HEIGHT / 2 + 0.01) + 1e-4;
    const gap = this.body.half + PLAYER.WIDTH / 2 + 0.01;
    const q = { x: 0, y, z: 0 };
    for (let i = -20; i <= 20; i++) {
      const t = (i / 20) * gap;
      for (const [ox, oz] of [[gap, t], [-gap, t], [t, gap], [t, -gap]]) {
        q.x = p.x + ox;
        q.z = p.z + oz;
        if (!this.body.collidesAt(q)) return false;
      }
    }
    return true;
  }

  /** True if a solid block sits at foot level just ahead. */
  blockedAhead(dirX, dirZ) {
    const pos = this.body.position;
    const cx = Math.floor(pos.x + dirX * (this.body.half + 0.3));
    const cz = Math.floor(pos.z + dirZ * (this.body.half + 0.3));
    return this.world.isSolidForCollision(cx, Math.floor(pos.y + 0.01), cz);
  }

  /**
   * True if the obstacle ahead is one block high and the whole body would
   * fit one block up (here, and a little further on), so a hop can succeed.
   */
  canStepUp(dirX, dirZ) {
    const len = Math.hypot(dirX, dirZ) || 1;
    const ux = dirX / len;
    const uz = dirZ / len;
    if (!this.blockedAhead(ux, uz)) return false;
    const pos = this.body.position;
    const up = Math.floor(pos.y + 0.01) + 1 + 1e-4;
    if (this.body.collidesAt({ x: pos.x, y: up, z: pos.z })) return false;
    return !this.body.collidesAt({ x: pos.x + ux * 0.3, y: up, z: pos.z + uz * 0.3 });
  }

  /**
   * Direction from the solid cells under the body's footprint towards its
   * centre — the quickest way off a ledge — or null if not on a ledge edge.
   */
  offLedgeDir() {
    const r = this.body.cellRange();
    const y = Math.floor(this.body.position.y + 0.01) - 1;
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let z = r.z0; z <= r.z1; z++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if (this.world.isSolidForCollision(x, y, z)) {
          sx += x + 0.5;
          sz += z + 0.5;
          n++;
        }
      }
    }
    if (!n) return null;
    const dx = this.body.position.x - sx / n;
    const dz = this.body.position.z - sz / n;
    const l = Math.hypot(dx, dz);
    return l > 1e-3 ? { x: dx / l, z: dz / l } : null;
  }
}
