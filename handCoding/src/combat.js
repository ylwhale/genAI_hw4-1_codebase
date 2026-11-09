import * as THREE from 'three';
import { targetBlock, REACH } from './interactions.js';

export const MELEE_REACH = 3;
export const PLAYER_ATTACK_DAMAGE = 25;
export const PLAYER_ATTACK_COOLDOWN = 0.6;
const raycaster = new THREE.Raycaster();

export function createCombat({ world, worldMesh, enemies, mobView }) {
  let cooldown = 0;
  function target(origin, direction, block = undefined) {
    if (block === undefined) block = targetBlock(world, worldMesh, origin, direction);
    mobView.update();
    raycaster.set(origin, direction); raycaster.near = 0; raycaster.far = REACH;
    const meshes = mobView.hitMeshes.filter(mesh => enemies.some(enemy => enemy.id === mesh.userData.enemyId && enemy.health > 0));
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit && (!block || hit.distance < block.distance - 1e-6)) {
      return { kind: hit.distance <= MELEE_REACH + 1e-9 ? 'enemy' : 'out-of-reach',
        enemy: enemies.find(enemy => enemy.id === hit.object.userData.enemyId), distance: hit.distance, point: hit.point };
    }
    return block ? { kind: 'block', block } : { kind: 'none' };
  }
  return {
    target,
    get cooldown() { return cooldown; },
    update(dt, active = true) { if (active && Number.isFinite(dt) && dt >= 0) cooldown = Math.max(0, cooldown - dt); },
    reset() { cooldown = 0; },
    attack(origin, direction, active = true) {
      if (!active) return { ok: false, reason: 'Gameplay paused' };
      if (cooldown > 1e-9) return { ok: false, reason: 'Attack recovering' };
      // Recast at click time; a previous frame's target may now be behind a wall.
      const hit = target(origin, direction);
      if (hit.kind !== 'enemy') return { ok: false, reason: hit.kind === 'out-of-reach' ? 'Move closer to attack' : 'No visible enemy' };
      cooldown = PLAYER_ATTACK_COOLDOWN;
      hit.enemy.health = Math.max(0, hit.enemy.health - PLAYER_ATTACK_DAMAGE);
      hit.enemy.hitFlash = 0.2;
      if (!hit.enemy.health) { hit.enemy.state = 'dead'; hit.enemy.deathTime = 0; }
      return { ok: true, enemy: hit.enemy, damage: PLAYER_ATTACK_DAMAGE, killed: hit.enemy.health === 0 };
    },
  };
}
