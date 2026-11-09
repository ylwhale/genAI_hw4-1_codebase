import { COMBAT } from '../config.js';
import { raycastVoxels } from '../interaction/raycast.js';

/**
 * The player's melee attack. A creature is a valid target when the camera
 * ray enters its body within PLAYER_ATTACK_RANGE and before any solid block
 * (so you cannot hit through walls). Attacks deal PLAYER_DAMAGE and are
 * limited by PLAYER_ATTACK_COOLDOWN.
 */
export class PlayerCombat {
  constructor(world, mobs, options = {}) {
    this.world = world;
    this.mobs = mobs;
    this.damage = options.damage ?? COMBAT.PLAYER_DAMAGE;
    this.cooldown = options.cooldown ?? COMBAT.PLAYER_ATTACK_COOLDOWN;
    this.range = options.range ?? COMBAT.PLAYER_ATTACK_RANGE;
    this.lastAttack = -Infinity;
  }

  /** The creature under the crosshair that could be hit right now, or null. */
  findTarget(origin, dir) {
    const hit = this.mobs.raycast(origin, dir, this.range);
    if (!hit) return null;
    const wall = raycastVoxels(this.world, origin, dir, hit.distance);
    if (wall && wall.distance < hit.distance) return null;
    return hit;
  }

  ready(now) {
    return now - this.lastAttack >= this.cooldown - 1e-9;
  }

  /** 0 right after an attack, 1 when the next attack is available. */
  cooldownProgress(now) {
    return Math.max(0, Math.min(1, (now - this.lastAttack) / this.cooldown));
  }

  /**
   * Attacks the creature under the crosshair.
   * Returns { ok: true, mob, damage, killed } or { ok: false, reason }.
   */
  attack(origin, dir, now) {
    const target = this.findTarget(origin, dir);
    if (!target) return { ok: false, reason: 'no-target' };
    if (!this.ready(now)) return { ok: false, reason: 'cooldown', mob: target.mob };
    this.lastAttack = now;
    const mob = target.mob;
    const before = mob.health;
    const killed = mob.takeHit(this.damage, mob.position.x - origin.x, mob.position.z - origin.z);
    if (killed) this.mobs.emit('killed', mob);
    return { ok: true, mob, damage: before - mob.health, killed };
  }

  reset() {
    this.lastAttack = -Infinity;
  }
}
