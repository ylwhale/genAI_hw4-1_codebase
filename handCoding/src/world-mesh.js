import * as THREE from 'three';
import { SIZE, HEIGHT, randomAt } from './world.js';
import { TILE_COUNT, tileForFace } from './textures.js';

const FACES = [
  { normal: [1, 0, 0], corners: [[1,0,0], [1,1,0], [1,1,1], [1,0,1]], shade: 0.86 },
  { normal: [-1, 0, 0], corners: [[0,0,1], [0,1,1], [0,1,0], [0,0,0]], shade: 0.72 },
  { normal: [0, 1, 0], corners: [[0,1,1], [1,1,1], [1,1,0], [0,1,0]], shade: 1 },
  { normal: [0, -1, 0], corners: [[0,0,0], [1,0,0], [1,0,1], [0,0,1]], shade: 0.55 },
  { normal: [0, 0, 1], corners: [[1,0,1], [1,1,1], [0,1,1], [0,0,1]], shade: 0.9 },
  { normal: [0, 0, -1], corners: [[0,0,0], [0,1,0], [1,1,0], [1,0,0]], shade: 0.76 },
];
const COLORS = [0, 0x79a44d, 0x9b7656, 0x8a9193, 0x795334, 0x5a873d];

function cornerOcclusion(world, x, y, z, normal, corner) {
  const axes = [0, 1, 2].filter(axis => normal[axis] === 0);
  const center = [x + normal[0], y + normal[1], z + normal[2]];
  const sideA = [...center], sideB = [...center], diagonal = [...center];
  const a = axes[0], b = axes[1];
  sideA[a] += corner[a] ? 1 : -1;
  sideB[b] += corner[b] ? 1 : -1;
  diagonal[a] = sideA[a]; diagonal[b] = sideB[b];
  const occupiedA = Number(!!world.get(...sideA));
  const occupiedB = Number(!!world.get(...sideB));
  const occlusion = occupiedA && occupiedB ? 3 : occupiedA + occupiedB + Number(!!world.get(...diagonal));
  return 1 - occlusion * 0.12;
}

export function createWorldGeometry(world, textured = false) {
  const positions = [], normals = [], colors = [], indices = [], uvs = [];
  const color = new THREE.Color();
  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const type = world.get(x, y, z);
        if (!type) continue;
        for (const face of FACES) {
          const [nx, ny, nz] = face.normal;
          if (world.get(x + nx, y + ny, z + nz)) continue;
          color.setHex(textured ? 0xffffff : type === 1 && ny === 0 ? 0x8c8050 : COLORS[type]);
          color.multiplyScalar(face.shade * (0.96 + randomAt(x + y * 7, z) * 0.08));
          const first = positions.length / 3;
          const tile = tileForFace(type, ny);
          const faceUV = [[0.02,0.02], [0.02,0.98], [0.98,0.98], [0.98,0.02]];
          // Top/bottom faces use the same upright texture orientation as side faces.
          for (let i = 0; i < face.corners.length; i++) {
            const [cx, cy, cz] = face.corners[i];
            positions.push(x + cx, y + cy, z + cz);
            normals.push(nx, ny, nz);
            const shade = cornerOcclusion(world, x, y, z, face.normal, face.corners[i]);
            colors.push(color.r * shade, color.g * shade, color.b * shade);
            uvs.push((tile + faceUV[i][0]) / TILE_COUNT, faceUV[i][1]);
          }
          indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createWorldMesh(world, texture = null) {
  const mesh = new THREE.Mesh(createWorldGeometry(world, !!texture), new THREE.MeshLambertMaterial({ vertexColors: true, map: texture }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
