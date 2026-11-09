import { SIZE } from './world.js';

export function clearVoxelLine(world, from, to) {
  if (![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite)) return false;
  if ([from, to].some(p => p.x < 0 || p.x >= SIZE || p.z < 0 || p.z >= SIZE || p.y < 0)) return false;
  const cell = [Math.floor(from.x), Math.floor(from.y), Math.floor(from.z)];
  const end = [Math.floor(to.x), Math.floor(to.y), Math.floor(to.z)];
  const origin = [from.x, from.y, from.z], delta = [to.x - from.x, to.y - from.y, to.z - from.z];
  const step = delta.map(Math.sign);
  const stride = delta.map(d => d ? Math.abs(1 / d) : Infinity);
  const next = delta.map((d, axis) => d > 0 ? (cell[axis] + 1 - origin[axis]) / d : d < 0 ? (origin[axis] - cell[axis]) / -d : Infinity);
  // Traverse crossed cells instead of sampling, so even a thin corner intersection blocks a hit.
  for (let i = 0; i < 256; i++) {
    if (world.get(...cell)) return false;
    if (cell.every((value, axis) => value === end[axis])) return true;
    const axis = next[0] <= next[1] && next[0] <= next[2] ? 0 : next[1] <= next[2] ? 1 : 2;
    cell[axis] += step[axis]; next[axis] += stride[axis];
  }
  return false;
}
