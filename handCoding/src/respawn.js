import { createPlayer, findSafeSpawn } from './physics.js';
import { restoreHealth } from './health.js';
import { resetEnemies } from './mobs.js';

// Only session entities change here. World edits and storage belong to the editor.
export function respawnPlayer(world, player, health, enemies) {
  Object.assign(player, createPlayer(findSafeSpawn(world)));
  restoreHealth(health);
  resetEnemies(world, enemies, player);
}
