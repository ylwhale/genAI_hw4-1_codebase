import * as THREE from 'three';
import { buildVoxelModel } from './voxelModel.js';
import { mulberry32 } from '../utils/random.js';

// Original voxel creature designs built from vertex-coloured voxel meshes.
// Each builder returns { root, parts, flashMaterials } where `parts` are the
// pivots the animator moves. Creatures face +Z.

const V = 0.1; // voxel size

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

/**
 * Voxel box model, centred on x/z with its base at y = 0 by default. The
 * colour callback is evaluated exactly once per voxel (it may be random).
 */
function box(sx, sy, sz, colorAt, material, origin) {
  const colors = new Array(sx * sy * sz);
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) colors[x + y * sx + z * sx * sy] = colorAt(x, y, z);
    }
  }
  const geometry = buildVoxelModel(
    sx, sy, sz,
    (x, y, z) => colors[x + y * sx + z * sx * sy],
    V,
    origin ?? { x: sx / 2, y: 0, z: sz / 2 },
  );
  return new THREE.Mesh(geometry, material);
}

function glowMaterial(color) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false });
}

// ------------------------------------------------------------------ Mossling

/**
 * Mossling: a small, round, mossy blob with glowing lime eyes, a dark mouth,
 * four stubby feet and a leafy sprout with a tiny flower on top.
 */
export function buildMossling(seed = 1) {
  const rand = mulberry32(seed);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  // Deep olive-teal moss (reads clearly against the brighter grass), with a
  // sun-bleached mottled top.
  const moss = ['#2f6a3a', '#3a7a40', '#2a5e34', '#34703a', '#417f45'];
  const light = ['#8fbf4a', '#7cb544', '#a3c95a'];
  const dark = '#1f4426';

  const root = new THREE.Group();
  const body = new THREE.Group(); // squash / stretch pivot at the feet
  root.add(body);

  // 7 x 6 x 7 body with rounded (missing) corner columns and a lighter top.
  const W = 7;
  const H = 6;
  const bodyMesh = box(W, H, W, (x, y, z) => {
    const edgeX = x === 0 || x === W - 1;
    const edgeZ = z === 0 || z === W - 1;
    if (edgeX && edgeZ) return null; // rounded corners
    if ((edgeX || edgeZ) && (y === H - 1 || y === 0)) return null; // rounded top/bottom rim
    if (z === W - 1 && y === 1 && x >= 2 && x <= 4) return '#1d2a12'; // mouth
    if (y >= H - 2) return pick(rand, light);
    if (rand() < 0.12) return dark;
    return pick(rand, moss);
  }, material, { x: W / 2, y: 0, z: W / 2 });
  bodyMesh.position.y = 0.12;
  body.add(bodyMesh);

  // Glowing eyes with dark pupils on the front face.
  const eyeMat = glowMaterial(0xd8ff6a);
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x14220c });
  const eyes = new THREE.Group();
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.04), eyeMat);
    eye.position.set(side * 0.16, 0.12 + 0.42, W * V / 2 + 0.005);
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.02), pupilMat);
    pupil.position.set(side * 0.02, -0.02, 0.025);
    eye.add(pupil);
    eyes.add(eye);
  }
  body.add(eyes);

  // Leafy sprout + flower on top.
  const sprout = box(3, 3, 3, (x, y, z) => {
    if (y === 0) return x === 1 && z === 1 ? '#3c7d27' : null;
    if (y === 1) return (x === 1 || z === 1) ? pick(rand, ['#5aa83c', '#73bf4c']) : null;
    return x === 1 && z === 1 ? '#f27ca8' : null; // flower
  }, material, { x: 1.5, y: 0, z: 1.5 });
  sprout.position.set(0.05, 0.12 + H * V, -0.05);
  body.add(sprout);

  // Four stubby feet.
  const feet = [];
  for (const [fx, fz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(fx * 0.19, 0.12, fz * 0.19);
    const foot = box(2, 2, 2, () => dark, material, { x: 1, y: 2, z: 1 });
    pivot.add(foot);
    root.add(pivot);
    feet.push(pivot);
  }

  return { root, parts: { body, eyes, sprout, feet }, flashMaterials: [material], glowMaterials: [eyeMat] };
}

// ---------------------------------------------------------------- Stoneguard

/**
 * Stoneguard: a hulking stone golem with cracked grey slabs, moss growing on
 * its shoulders and head, a glowing amber core in its chest, glowing eye
 * slits, heavy arms and short thick legs.
 */
export function buildStoneguard(seed = 2) {
  const rand = mulberry32(seed);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const stone = ['#a3a6a9', '#989b9e', '#afb2b4', '#8e9194'];
  const crack = '#66696d';
  const mossy = ['#4f9a33', '#5aa83c', '#3c7d27'];
  const stoneAt = (mossChance = 0) => () => {
    if (rand() < mossChance) return pick(rand, mossy);
    return rand() < 0.1 ? crack : pick(rand, stone);
  };

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.5;
  root.add(hips);

  // Legs (pivot at the hip).
  const legs = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.2, 0, 0);
    const leg = box(3, 5, 3, stoneAt(0), material, { x: 1.5, y: 5, z: 1.5 });
    pivot.add(leg);
    hips.add(pivot);
    legs.push(pivot);
  }

  // Torso (pivot at the waist) with a glowing core.
  const torso = new THREE.Group();
  hips.add(torso);
  const torsoMesh = box(7, 7, 5, (x, y, z) => {
    if (y === 6 && (x <= 1 || x >= 5) && rand() < 0.75) return pick(rand, mossy); // mossy shoulders
    if (z === 4 && y >= 3 && y <= 4 && x >= 3 && x <= 3) return '#6b4a2b';
    return stoneAt(0.03)();
  }, material, { x: 3.5, y: 0, z: 2.5 });
  torso.add(torsoMesh);
  const coreMat = glowMaterial(0xffb347);
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.04), coreMat);
  core.position.set(0, 0.38, 0.255);
  torso.add(core);

  // Head (pivot at the neck) with a brow and eye slits.
  const neck = new THREE.Group();
  neck.position.y = 0.7;
  torso.add(neck);
  const headMesh = box(5, 4, 5, (x, y, z) => {
    if (y === 3 && rand() < 0.55) return pick(rand, mossy);
    if (z === 4 && y === 2) return '#5f6266'; // heavy brow
    return stoneAt(0)();
  }, material, { x: 2.5, y: 0, z: 2.5 });
  neck.add(headMesh);
  const eyeMat = glowMaterial(0xffd27a);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.03), eyeMat);
    eye.position.set(side * 0.11, 0.16, 0.255);
    neck.add(eye);
  }

  // Arms (pivot at the shoulder), with darker, chunkier fists.
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.47, 0.66, 0);
    const arm = box(3, 8, 3, (x, y) => (y <= 1 ? pick(rand, ['#64676a', '#5c5f63']) : stoneAt(0.04)()), material, { x: 1.5, y: 8, z: 1.5 });
    pivot.add(arm);
    torso.add(pivot);
    arms.push(pivot);
  }

  return {
    root,
    parts: { hips, legs, torso, neck, arms, core },
    flashMaterials: [material],
    glowMaterials: [coreMat, eyeMat],
  };
}

export function buildMobModel(typeId, seed) {
  return typeId === 'stoneguard' ? buildStoneguard(seed) : buildMossling(seed);
}
