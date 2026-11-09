import { AIR } from '../world/blocks.js';

/**
 * Voxel ray traversal (Amanatides & Woo DDA). Walks the grid cell by cell
 * along the ray, so the first block found is exactly the visible block under
 * the crosshair.
 *
 * Returns null when nothing is hit within `maxDistance`, otherwise:
 *   { x, y, z, normal: [nx, ny, nz], distance, id, editable }
 * `normal` is the face that was entered (placement goes at hit + normal).
 * Hits on the indestructible rock base below y = 0 are reported with
 * editable = false so blocks can be placed against it but it cannot be mined.
 */
export function raycastVoxels(world, origin, direction, maxDistance) {
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;
  let dx = direction.x;
  let dy = direction.y;
  let dz = direction.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  dx /= len;
  dy /= len;
  dz /= len;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = stepX > 0 ? (x + 1 - ox) / dx : stepX < 0 ? (ox - x) / -dx : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) / dy : stepY < 0 ? (oy - y) / -dy : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) / dz : stepZ < 0 ? (oz - z) / -dz : Infinity;

  const inColumn = (cx, cz) => cx >= 0 && cx < world.size && cz >= 0 && cz < world.size;

  // The origin cell itself (the camera is never inside a block during normal
  // play, but handle it gracefully: report it without a placement face).
  if (world.inBounds(x, y, z) && world.getBlock(x, y, z) !== AIR) {
    return { x, y, z, normal: [0, 0, 0], distance: 0, id: world.getBlock(x, y, z), editable: true };
  }

  let t = 0;
  const normal = [0, 0, 0];
  // Generous iteration cap; a 6-unit ray crosses at most ~20 cells.
  for (let i = 0; i < 512; i++) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal[0] = -stepX; normal[1] = 0; normal[2] = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal[0] = 0; normal[1] = -stepY; normal[2] = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal[0] = 0; normal[1] = 0; normal[2] = -stepZ;
    }

    if (t > maxDistance) return null;

    if (y < 0) {
      if (inColumn(x, z)) {
        return { x, y, z, normal: [...normal], distance: t, id: null, editable: false };
      }
      if (stepY < 0) return null; // heading down into the void
      continue;
    }
    if (y >= world.height && stepY >= 0) return null; // above the build limit, going up

    if (world.inBounds(x, y, z)) {
      const id = world.getBlock(x, y, z);
      if (id !== AIR) {
        return { x, y, z, normal: [...normal], distance: t, id, editable: true };
      }
    }
  }
  return null;
}
