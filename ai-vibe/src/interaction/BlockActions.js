import { INTERACTION } from '../config.js';
import { AIR } from '../world/blocks.js';

/** Distance from point `p` to the closest point of the unit cell (x, y, z). */
export function distanceToCell(p, x, y, z) {
  const dx = Math.max(x - p.x, 0, p.x - (x + 1));
  const dy = Math.max(y - p.y, 0, p.y - (y + 1));
  const dz = Math.max(z - p.z, 0, p.z - (z + 1));
  return Math.hypot(dx, dy, dz);
}

/**
 * Timed block interactions: mining takes BREAK_DURATION seconds and
 * construction PLACE_DURATION seconds before the world changes.
 *
 * Rules:
 *   - only one action can be active at a time (new starts are rejected);
 *   - an action is validated with the normal BlockInteraction rules when it
 *     starts, is locked to its cell, and is re-checked every frame (block
 *     still there / cell still free, player not in the way, still in reach);
 *   - the world is only changed when the action completes, through the same
 *     validated BlockInteraction methods, so an action that is cancelled or
 *     invalidated never modifies the world;
 *   - a world reload (reset / restore) cancels the active action.
 *
 * Listeners receive { type: 'start' | 'complete' | 'cancel', action, result?, reason? }.
 */
export class BlockActions {
  constructor(world, player, interaction, options = {}) {
    this.world = world;
    this.player = player;
    this.interaction = interaction;
    this.reach = interaction.reach;
    this.durations = {
      break: options.breakDuration ?? INTERACTION.BREAK_DURATION,
      place: options.placeDuration ?? INTERACTION.PLACE_DURATION,
    };
    this.active = null;
    this.listeners = new Set();
    world.onChange((event) => {
      if (event.type === 'reload') this.cancel('world-reloaded');
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  get busy() {
    return this.active !== null;
  }

  /** 0..1 completion of the active action (0 when idle). */
  get progress() {
    return this.active ? this.active.elapsed / this.active.duration : 0;
  }

  /** Begins mining the raycast `target`. Returns { ok, action } or { ok: false, reason }. */
  startBreak(target) {
    if (this.active) return { ok: false, reason: 'busy' };
    const check = this.interaction.validateBreak(target);
    if (!check.ok) return check;
    return this.begin({
      kind: 'break',
      x: check.x, y: check.y, z: check.z,
      id: check.id,
      normal: [...target.normal],
    });
  }

  /**
   * Begins constructing `blockId` against the raycast `target`'s face. The
   * block type is captured now, so changing the hotbar mid-action has no effect.
   */
  startPlace(target, blockId) {
    if (this.active) return { ok: false, reason: 'busy' };
    const check = this.interaction.validatePlace(blockId, target);
    if (!check.ok) return check;
    return this.begin({
      kind: 'place',
      x: check.x, y: check.y, z: check.z,
      id: blockId,
      normal: [...target.normal],
    });
  }

  begin(fields) {
    this.active = { ...fields, elapsed: 0, duration: this.durations[fields.kind] };
    this.emit({ type: 'start', action: this.active });
    return { ok: true, action: this.active };
  }

  /** Why the active action can no longer finish, or null if it is still valid. */
  invalidReason(eye) {
    const a = this.active;
    if (!this.world.inBounds(a.x, a.y, a.z)) return 'out-of-bounds';
    if (!(distanceToCell(eye, a.x, a.y, a.z) <= this.reach)) return 'too-far';
    if (a.kind === 'break') {
      if (this.world.getBlock(a.x, a.y, a.z) !== a.id) return 'changed';
    } else {
      if (this.world.getBlock(a.x, a.y, a.z) !== AIR) return 'occupied';
      if (this.player.intersectsBlock(a.x, a.y, a.z)) return 'inside-player';
      if (this.interaction.isOccupiedByEntity?.(a.x, a.y, a.z)) return 'inside-creature';
    }
    return null;
  }

  /**
   * Advances the active action by `dt` seconds. `eye` is the camera position
   * used for the reach check. Completes or cancels the action when due.
   */
  update(dt, eye) {
    const a = this.active;
    if (!a) return;
    const reason = this.invalidReason(eye);
    if (reason) {
      this.cancel(reason);
      return;
    }
    a.elapsed = Math.min(a.duration, a.elapsed + Math.max(0, dt || 0));
    if (a.elapsed >= a.duration) this.complete(eye);
  }

  complete(eye) {
    const a = this.active;
    const distance = distanceToCell(eye, a.x, a.y, a.z);
    const [nx, ny, nz] = a.normal;
    const result =
      a.kind === 'break'
        ? this.interaction.breakBlock({ x: a.x, y: a.y, z: a.z, normal: a.normal, distance, editable: true })
        : this.interaction.placeBlock(a.id, { x: a.x - nx, y: a.y - ny, z: a.z - nz, normal: a.normal, distance, editable: true });
    this.active = null;
    if (result.ok) this.emit({ type: 'complete', action: a, result });
    else this.emit({ type: 'cancel', action: a, reason: result.reason });
    return result;
  }

  /** Cancels the active action (if any) without touching the world. */
  cancel(reason = 'cancelled') {
    const a = this.active;
    if (!a) return false;
    this.active = null;
    this.emit({ type: 'cancel', action: a, reason });
    return true;
  }
}
