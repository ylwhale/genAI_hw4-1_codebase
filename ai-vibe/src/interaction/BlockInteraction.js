import { INTERACTION } from '../config.js';
import { AIR, isValidBlockId } from '../world/blocks.js';
import { raycastVoxels } from './raycast.js';

/**
 * Validates and applies block edits. Every rule from the spec lives here so
 * an invalid action always leaves the world exactly as it was:
 *   - only the block under the crosshair, within REACH of the camera
 *   - never outside the 32 x 32 x HEIGHT world
 *   - never place a block that would overlap the player's collision box
 *
 * Methods return { ok: true, ... } or { ok: false, reason }.
 */
export class BlockInteraction {
  constructor(world, player, reach = INTERACTION.REACH) {
    this.world = world;
    this.player = player;
    this.reach = reach;
    this.target = null;
    /** Optional (x, y, z) => boolean: a creature occupies the cell. */
    this.isOccupiedByEntity = null;
  }

  /** Recomputes the targeted block from the camera ray. */
  updateTarget(origin, direction) {
    this.target = raycastVoxels(this.world, origin, direction, this.reach);
    return this.target;
  }

  /**
   * Checks whether `target` may be broken, without changing anything.
   * Returns { ok: true, x, y, z, id } or { ok: false, reason }.
   */
  validateBreak(target = this.target) {
    if (!target) return { ok: false, reason: 'no-target' };
    if (!target.editable) return { ok: false, reason: 'unbreakable' };
    if (!(target.distance <= this.reach)) return { ok: false, reason: 'too-far' };
    const { x, y, z } = target;
    if (!this.world.inBounds(x, y, z)) return { ok: false, reason: 'out-of-bounds' };
    const id = this.world.getBlock(x, y, z);
    if (id === AIR) return { ok: false, reason: 'no-target' };
    return { ok: true, x, y, z, id };
  }

  /**
   * Checks whether `blockId` may be placed against `target`'s face, without
   * changing anything. Returns { ok: true, x, y, z, id } (the cell that would
   * be filled) or { ok: false, reason }.
   */
  validatePlace(blockId, target = this.target) {
    if (!isValidBlockId(blockId) || blockId === AIR) return { ok: false, reason: 'invalid-block' };
    if (!target) return { ok: false, reason: 'no-target' };
    if (!(target.distance <= this.reach)) return { ok: false, reason: 'too-far' };
    const [nx, ny, nz] = target.normal;
    if (nx === 0 && ny === 0 && nz === 0) return { ok: false, reason: 'no-face' };
    const x = target.x + nx;
    const y = target.y + ny;
    const z = target.z + nz;
    if (!this.world.inBounds(x, y, z)) return { ok: false, reason: 'out-of-bounds' };
    if (this.world.getBlock(x, y, z) !== AIR) return { ok: false, reason: 'occupied' };
    if (this.player.intersectsBlock(x, y, z)) return { ok: false, reason: 'inside-player' };
    if (this.isOccupiedByEntity?.(x, y, z)) return { ok: false, reason: 'inside-creature' };
    return { ok: true, x, y, z, id: blockId };
  }

  /** Validates, then removes the block. */
  breakBlock(target = this.target) {
    const check = this.validateBreak(target);
    if (check.ok) this.world.setBlock(check.x, check.y, check.z, AIR);
    return check;
  }

  /** Validates, then fills the cell in front of the targeted face. */
  placeBlock(blockId, target = this.target) {
    const check = this.validatePlace(blockId, target);
    if (check.ok) this.world.setBlock(check.x, check.y, check.z, blockId);
    return check;
  }
}
