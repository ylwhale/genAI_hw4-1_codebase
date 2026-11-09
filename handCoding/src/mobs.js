import { SIZE, randomAt } from './world.js';
import { collides, moveAxis, playerIntersectsBlock, STEP } from './physics.js';
import { clearVoxelLine } from './visibility.js';

export const ENEMY_ATTACK_RANGE = 1.75;
export const ENEMY_ATTACK_COOLDOWN = 1.5;
export const MOB_DEATH_DURATION = 0.4;

export const MOB_TYPES = Object.freeze({
  mossling: { name: 'Mossling', maxHealth: 40, damage: 10, speed: 1.3, radius: 0.32, height: 0.9 },
  stoneguard: { name: 'Stoneguard', maxHealth: 60, damage: 15, speed: 0.8, radius: 0.48, height: 1.65 },
});

export function createEnemies(world, avoid = world.spawn) {
  const enemies = [];
  const columns = [];
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const y = world.surface(x, z);
    const type = world.get(x, y, z);
    columns.push({ x: x + 0.5, y: y + 1, z: z + 0.5, priority: (type === 4 || type === 5 ? 2 : 0) + randomAt(x, z, 144) });
  }
  columns.sort((a, b) => a.priority - b.priority);
  for (const [id, type] of ['mossling', 'mossling', 'mossling', 'stoneguard'].entries()) {
    const config = MOB_TYPES[type];
    const position = columns.find(p => Math.hypot(p.x - world.spawn.x, p.z - world.spawn.z) >= 8
      && Math.hypot(p.x - avoid.x, p.z - avoid.z) >= 8
      && enemies.every(enemy => Math.hypot(p.x - enemy.x, p.z - enemy.z) >= 2)
      && !collides(world, { ...p, ...config }));
    if (!position) continue;
    enemies.push({ id, type, ...config, x: position.x, y: position.y, z: position.z,
      health: config.maxHealth, state: 'wander', yaw: randomAt(id, 0, 145) * Math.PI * 2,
      velocityY: 0, grounded: true, moving: false, attackCooldown: 0, attackAnimation: 0,
      hitFlash: 0, deathTime: 0, animationTime: 0, wanderTime: 0, decisions: 0 });
  }
  return enemies;
}

export function resetEnemies(world, enemies, avoid = world.spawn) {
  const fresh = createEnemies(world, avoid);
  // Keep object identities so render views and hit meshes remain connected.
  for (let i = 0; i < fresh.length; i++) {
    if (enemies[i]) Object.assign(enemies[i], fresh[i]);
    else enemies.push(fresh[i]);
  }
  enemies.length = fresh.length;
}

export function enemyOccupiesBlock(enemies, cell) {
  return enemies.some(enemy => enemy.health > 0 && playerIntersectsBlock(enemy, cell.x, cell.y, cell.z));
}

export function updateEnemyEffects(enemies, dt, active = true) {
  if (!active || !Number.isFinite(dt) || dt <= 0) return;
  for (const enemy of enemies) {
    enemy.animationTime += dt;
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    enemy.attackAnimation = Math.max(0, enemy.attackAnimation - dt);
    if (enemy.health <= 0) enemy.deathTime = Math.min(MOB_DEATH_DURATION, enemy.deathTime + dt);
  }
}

function stepEnemy(world, enemy, player, dt, onAttack) {
  if (enemy.health <= 0) return;
  enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
  const distance = Math.hypot(player.x - enemy.x, player.y - enemy.y, player.z - enemy.z);
  const attackPath = distance <= ENEMY_ATTACK_RANGE && clearVoxelLine(world,
    { x: enemy.x, y: enemy.y + enemy.height * 0.6, z: enemy.z },
    { x: player.x, y: player.y + 0.9, z: player.z });
  enemy.state = attackPath ? 'attack' : distance <= 10 ? 'chase' : 'wander';
  if (enemy.state !== 'wander') enemy.yaw = Math.atan2(player.x - enemy.x, player.z - enemy.z);
  else {
    enemy.wanderTime -= dt;
    if (enemy.wanderTime <= 0) {
      enemy.decisions++;
      enemy.yaw = randomAt(enemy.id, enemy.decisions, 151) * Math.PI * 2;
      enemy.wanderTime = 1.5 + randomAt(enemy.id, enemy.decisions, 152) * 2;
    }
  }
  if (enemy.state === 'attack' && enemy.attackCooldown <= 1e-9) {
    enemy.attackCooldown = ENEMY_ATTACK_COOLDOWN;
    enemy.attackAnimation = 0.3;
    if (onAttack(enemy.damage, enemy) === false) return false;
  }
  const speed = enemy.state === 'attack' ? 0 : enemy.state === 'chase' ? enemy.speed : enemy.decisions % 4 === 0 ? 0 : enemy.speed * 0.35;
  const oldX = enemy.x, oldZ = enemy.z;
  moveAxis(world, enemy, 'x', Math.sin(enemy.yaw) * speed * dt);
  moveAxis(world, enemy, 'z', Math.cos(enemy.yaw) * speed * dt);
  enemy.moving = Math.hypot(enemy.x - oldX, enemy.z - oldZ) > 1e-6;
  if (speed && !enemy.moving) enemy.wanderTime = Math.min(enemy.wanderTime, 0.3);
  enemy.velocityY = Math.max(-30, enemy.velocityY - 22 * dt);
  const falling = enemy.velocityY <= 0;
  const hit = moveAxis(world, enemy, 'y', enemy.velocityY * dt);
  enemy.grounded = hit && falling;
  if (hit) enemy.velocityY = 0;
}

export function updateEnemies(world, enemies, player, dt, { active = true, onAttack = () => true } = {}) {
  if (!active || !Number.isFinite(dt) || dt <= 0) return;
  let remaining = dt;
  while (remaining > 1e-9) {
    const step = Math.min(STEP, remaining);
    updateEnemyEffects(enemies, step);
    for (const enemy of enemies) if (stepEnemy(world, enemy, player, step, onAttack) === false) return;
    remaining -= step;
  }
}
