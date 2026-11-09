import * as THREE from 'three';
import { AIR, BLOCKS, isCutout } from './blocks.js';
import { hash2 } from '../utils/random.js';

/** Texture keys, in material-index order, shared by every voxel mesh. */
export const MATERIAL_KEYS = ['grass_top', 'grass_side', 'dirt', 'stone', 'log_side', 'log_top', 'leaves'];
const MATERIAL_INDEX = Object.fromEntries(MATERIAL_KEYS.map((k, i) => [k, i]));

// Each face lists its 4 corners (bottom-left, bottom-right, top-right,
// top-left as seen from outside the block) so UV (0,0)-(1,1) maps upright and
// triangles wind counter-clockwise.
const FACES = [
  { dir: [1, 0, 0], key: 'side', corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { dir: [-1, 0, 0], key: 'side', corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { dir: [0, 1, 0], key: 'top', corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, -1, 0], key: 'bottom', corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 0, 1], key: 'side', corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], key: 'side', corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

// Precompute, per face and corner, the three neighbour offsets used for
// ambient occlusion (side A, side B, diagonal corner) in the layer the face
// looks into.
for (const face of FACES) {
  const normalAxis = face.dir.findIndex((v) => v !== 0);
  const tangents = [0, 1, 2].filter((a) => a !== normalAxis);
  face.ao = face.corners.map((corner) => {
    const s1 = corner[tangents[0]] === 1 ? 1 : -1;
    const s2 = corner[tangents[1]] === 1 ? 1 : -1;
    const a = [...face.dir];
    const b = [...face.dir];
    const c = [...face.dir];
    a[tangents[0]] += s1;
    b[tangents[1]] += s2;
    c[tangents[0]] += s1;
    c[tangents[1]] += s2;
    return [a, b, c];
  });
}

const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO_CURVE = [0.45, 0.64, 0.82, 1.0];
// Textures without a natural "up" get a random quarter-turn on top faces to
// hide tiling.
const ROTATABLE_TOPS = new Set(['grass_top', 'dirt', 'stone']);

/**
 * Builds a BufferGeometry for the voxels inside [min, max) using a culled,
 * ambient-occluded face mesher. Faces are grouped by material index.
 *
 * @param {object} bounds   {x0,x1,y0,y1,z0,z1} integer bounds, max exclusive
 * @param {Function} getId  (x,y,z) => block id for any coordinate
 */
export function buildVoxelGeometry(bounds, getId) {
  const perMaterial = MATERIAL_KEYS.map(() => ({ positions: [], normals: [], uvs: [], colors: [], count: 0 }));

  for (let y = bounds.y0; y < bounds.y1; y++) {
    for (let z = bounds.z0; z < bounds.z1; z++) {
      for (let x = bounds.x0; x < bounds.x1; x++) {
        const id = getId(x, y, z);
        if (id === AIR) continue;
        const def = BLOCKS[id];
        if (!def) continue;
        const selfCutout = isCutout(id);
        const tint = 0.95 + hash2(x * 7 + y, z * 13 - y, 99) * 0.08;

        for (const face of FACES) {
          const nid = getId(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
          // Hide faces against opaque neighbours. Faces touching see-through
          // leaves stay visible (including leaf-to-leaf, for fuller canopies).
          if (nid !== AIR && !isCutout(nid)) continue;
          if (nid !== AIR && selfCutout && nid !== id) continue;

          const texKey = def.faces[face.key];
          const bucket = perMaterial[MATERIAL_INDEX[texKey]];

          const ao = face.ao.map(([a, b, c]) => {
            const sa = getId(x + a[0], y + a[1], z + a[2]) !== AIR ? 1 : 0;
            const sb = getId(x + b[0], y + b[1], z + b[2]) !== AIR ? 1 : 0;
            const sc = getId(x + c[0], y + c[1], z + c[2]) !== AIR ? 1 : 0;
            return sa && sb ? 0 : 3 - (sa + sb + sc);
          });

          const rot = face.key === 'top' && ROTATABLE_TOPS.has(texKey) ? Math.floor(hash2(x, z, 7) * 4) : 0;
          // Flip the quad diagonal so AO gradients interpolate smoothly.
          const flip = ao[0] + ao[2] < ao[1] + ao[3];
          const order = flip ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];

          for (const k of order) {
            const corner = face.corners[k];
            bucket.positions.push(x + corner[0], y + corner[1], z + corner[2]);
            bucket.normals.push(face.dir[0], face.dir[1], face.dir[2]);
            const uv = UVS[(k + rot) % 4];
            bucket.uvs.push(uv[0], uv[1]);
            const light = AO_CURVE[ao[k]] * tint;
            bucket.colors.push(light, light, light);
          }
          bucket.count += 6;
        }
      }
    }
  }

  const total = perMaterial.reduce((s, b) => s + b.count, 0);
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const colors = new Float32Array(total * 3);
  const geometry = new THREE.BufferGeometry();

  let offset = 0;
  perMaterial.forEach((bucket, materialIndex) => {
    if (bucket.count === 0) return;
    positions.set(bucket.positions, offset * 3);
    normals.set(bucket.normals, offset * 3);
    uvs.set(bucket.uvs, offset * 2);
    colors.set(bucket.colors, offset * 3);
    geometry.addGroup(offset, bucket.count, materialIndex);
    offset += bucket.count;
  });

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
