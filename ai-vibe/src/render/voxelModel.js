import * as THREE from 'three';

/**
 * Builds a small vertex-coloured voxel model (used for the first-person arm
 * and the tools). Only faces between a filled voxel and an empty neighbour
 * are emitted.
 *
 * @param {number} sx, sy, sz      grid dimensions
 * @param {(x,y,z) => string|null} colorAt  sRGB hex colour or null for empty
 * @param {number} size            edge length of one voxel
 * @param {{x,y,z}} origin         grid coordinate that maps to (0, 0, 0)
 * @param {(x,y,z) => string} [sideColorAt]  colour for the ±X/±Y faces
 *        (defaults to colorAt), e.g. to keep extruded sprite edges readable
 */
export function buildVoxelModel(sx, sy, sz, colorAt, size, origin = { x: 0, y: 0, z: 0 }, sideColorAt = colorAt) {
  const filled = (x, y, z) =>
    x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && colorAt(x, y, z) != null;

  const FACES = [
    { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  ];

  const positions = [];
  const normals = [];
  const colors = [];
  const front = new THREE.Color();
  const side = new THREE.Color();
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const hex = colorAt(x, y, z);
        if (hex == null) continue;
        front.set(hex); // converted to the linear working colour space
        side.set(sideColorAt(x, y, z) ?? hex);
        for (const f of FACES) {
          if (filled(x + f.n[0], y + f.n[1], z + f.n[2])) continue;
          const color = f.n[2] !== 0 ? front : side;
          for (const k of [0, 1, 2, 0, 2, 3]) {
            const c = f.c[k];
            positions.push(
              (x + c[0] - origin.x) * size,
              (y + c[1] - origin.y) * size,
              (z + c[2] - origin.z) * size,
            );
            normals.push(f.n[0], f.n[1], f.n[2]);
            colors.push(color.r, color.g, color.b);
          }
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
