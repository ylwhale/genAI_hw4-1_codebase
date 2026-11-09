import { SIZE, HEIGHT } from './world.js';

export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.75;
export const EYE_HEIGHT = 1.6;
export const STEP = 1 / 120;
const EPSILON = 0.00001;

export function createPlayer(spawn) {
  return { ...spawn, velocityY: 0, grounded: false, yaw: 0, pitch: 0 };
}

export function playerIntersectsBlock(player, x, y, z) {
  const radius = player.radius ?? PLAYER_RADIUS, height = player.height ?? PLAYER_HEIGHT;
  return player.x + radius > x + EPSILON && player.x - radius < x + 1 - EPSILON
    && player.y + height > y + EPSILON && player.y < y + 1 - EPSILON
    && player.z + radius > z + EPSILON && player.z - radius < z + 1 - EPSILON;
}

function solid(world, x, y, z) {
  if (x < 0 || x >= SIZE || z < 0 || z >= SIZE || y < 0) return true;
  return y < HEIGHT && world.get(x, y, z) !== 0;
}

export function collides(world, player) {
  const radius = player.radius ?? PLAYER_RADIUS, height = player.height ?? PLAYER_HEIGHT;
  for (let y = Math.floor(player.y + EPSILON); y <= Math.floor(player.y + height - EPSILON); y++) {
    for (let z = Math.floor(player.z - radius + EPSILON); z <= Math.floor(player.z + radius - EPSILON); z++) {
      for (let x = Math.floor(player.x - radius + EPSILON); x <= Math.floor(player.x + radius - EPSILON); x++) {
        if (solid(world, x, y, z)) return true;
      }
    }
  }
  return false;
}

export function moveAxis(world, player, axis, amount) {
  if (!amount) return false;
  player[axis] += amount;
  const radius = player.radius ?? PLAYER_RADIUS, height = player.height ?? PLAYER_HEIGHT;
  let hit = false;
  const minX = Math.floor(player.x - radius + EPSILON);
  const maxX = Math.floor(player.x + radius - EPSILON);
  const minZ = Math.floor(player.z - radius + EPSILON);
  const maxZ = Math.floor(player.z + radius - EPSILON);
  const minY = Math.floor(player.y + EPSILON);
  const maxY = Math.floor(player.y + height - EPSILON);
  for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    if (!solid(world, x, y, z)) continue;
    const coordinate = axis === 'x' ? x : axis === 'y' ? y : z;
    const lowerExtent = axis === 'y' ? 0 : radius;
    const upperExtent = axis === 'y' ? height : radius;
    player[axis] = amount > 0
      ? Math.min(player[axis], coordinate - upperExtent)
      : Math.max(player[axis], coordinate + 1 + lowerExtent);
    hit = true;
  }
  return hit;
}

export function stepPlayer(world, player, input, dt = STEP) {
  let forward = Number(input.forward) - Number(input.backward);
  let strafe = Number(input.right) - Number(input.left);
  const length = Math.hypot(forward, strafe);
  if (length) { forward /= length; strafe /= length; }
  const speed = 4.5;
  const dx = (-Math.sin(player.yaw) * forward + Math.cos(player.yaw) * strafe) * speed * dt;
  const dz = (-Math.cos(player.yaw) * forward - Math.sin(player.yaw) * strafe) * speed * dt;
  moveAxis(world, player, 'x', dx);
  moveAxis(world, player, 'z', dz);
  if (input.jump && player.grounded) player.velocityY = 7.6;
  player.velocityY = Math.max(-30, player.velocityY - 22 * dt);
  const falling = player.velocityY <= 0;
  const verticalHit = moveAxis(world, player, 'y', player.velocityY * dt);
  player.grounded = verticalHit && falling;
  if (verticalHit) player.velocityY = 0;
}

export function findSafeSpawn(world) {
  const player = createPlayer(world.spawn);
  // Saved edits may occupy the original clearing. Search upward first, then other columns.
  for (let y = world.spawn.y; y < HEIGHT; y++) {
    player.y = y;
    if (!collides(world, player)) return { x: player.x, y, z: player.z };
  }
  for (let z = 1; z < SIZE - 1; z++) for (let x = 1; x < SIZE - 1; x++) {
    player.x = x + 0.5; player.z = z + 0.5; player.y = world.surface(x, z) + 1;
    if (!collides(world, player)) return { x: player.x, y: player.y, z: player.z };
  }
  return { x: world.spawn.x, y: HEIGHT, z: world.spawn.z };
}
