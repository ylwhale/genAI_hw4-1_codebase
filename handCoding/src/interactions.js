import * as THREE from 'three';
import { inBounds } from './world.js';
import { playerIntersectsBlock } from './physics.js';

export const REACH = 6;
const raycaster = new THREE.Raycaster();

export function targetBlock(world, mesh, origin, direction) {
  raycaster.set(origin, direction);
  raycaster.near = 0;
  raycaster.far = REACH;
  mesh.updateMatrixWorld();
  const hit = raycaster.intersectObject(mesh, false)[0];
  if (!hit || hit.distance > REACH) return null;
  const normal = hit.face.normal.clone().round();
  // A face point lies exactly between cells. Move inward before flooring it.
  const cell = hit.point.clone().addScaledVector(normal, -0.0001).floor();
  if (!inBounds(cell.x, cell.y, cell.z) || !world.get(cell.x, cell.y, cell.z)) return null;
  return { x: cell.x, y: cell.y, z: cell.z, normal: { x: normal.x || 0, y: normal.y || 0, z: normal.z || 0 },
    point: { x: hit.point.x, y: hit.point.y, z: hit.point.z }, distance: hit.distance };
}

export function validateEdit(world, player, target, action, selected = 1) {
  const fail = reason => ({ ok: false, reason });
  if (!target || !Number.isFinite(target.distance) || target.distance < 0 || target.distance > REACH) return fail('Out of reach');
  let { x, y, z } = target;
  if (!inBounds(x, y, z) || !world.get(x, y, z)) return fail('No block here');
  if (action === 'place') {
    if (!Number.isInteger(selected) || selected < 1 || selected > 5) return fail('Invalid material');
    const n = target.normal;
    if (!n || ![n.x, n.y, n.z].every(Number.isInteger) || Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z) !== 1) return fail('Invalid face');
    x += n.x; y += n.y; z += n.z;
    if (!inBounds(x, y, z)) return fail('World boundary');
    if (world.get(x, y, z)) return fail('Space occupied');
    if (playerIntersectsBlock(player, x, y, z)) return fail('Too close to you');
  } else if (action !== 'remove') return fail('Invalid action');
  const type = action === 'remove' ? 0 : selected;
  return { ok: true, x, y, z, type };
}

export function editBlock(world, player, target, action, selected = 1) {
  const result = validateEdit(world, player, target, action, selected);
  if (result.ok) world.set(result.x, result.y, result.z, result.type);
  return result;
}
