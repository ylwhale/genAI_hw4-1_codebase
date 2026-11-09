import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../utils/random.js';
import { BLOCKS } from '../world/blocks.js';

export const CRACK_STAGES = 10;

/**
 * Procedural 16x16 crack textures. Cracks grow from the centre as random
 * branching walks; every pixel gets a "reveal time", and stage s shows the
 * pixels revealed by (s + 1) / CRACK_STAGES, so the damage is cumulative.
 */
export function createCrackTextures() {
  const N = 16;
  const reveal = new Float32Array(N * N).fill(Infinity);
  const rand = mulberry32(9001);
  const walkers = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rand() * 0.8;
    walkers.push({ x: 7.5 + Math.cos(a), y: 7.5 + Math.sin(a), a, t: rand() * 0.08 });
  }
  let steps = 0;
  while (walkers.length && steps < 600) {
    steps++;
    const w = walkers.shift();
    const ix = Math.floor(w.x);
    const iy = Math.floor(w.y);
    if (ix < 0 || iy < 0 || ix >= N || iy >= N || w.t > 1) continue;
    const i = ix + iy * N;
    reveal[i] = Math.min(reveal[i], w.t);
    w.a += (rand() - 0.5) * 0.9;
    w.x += Math.cos(w.a);
    w.y += Math.sin(w.a);
    w.t += 0.035 + rand() * 0.03;
    walkers.push(w);
    if (rand() < 0.1 && walkers.length < 14) {
      walkers.push({ x: w.x, y: w.y, a: w.a + (rand() < 0.5 ? 1 : -1) * (0.8 + rand() * 0.6), t: w.t + 0.05 });
    }
  }

  const textures = [];
  for (let s = 0; s < CRACK_STAGES; s++) {
    const limit = (s + 1) / CRACK_STAGES;
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const t = reveal[i];
      if (t > limit) continue;
      // Older cracks are darker and wider-looking; fresh tips are lighter.
      const age = Math.min(1, (limit - t) * 4);
      img.data[i * 4] = 18;
      img.data[i * 4 + 1] = 14;
      img.data[i * 4 + 2] = 10;
      img.data[i * 4 + 3] = Math.round(120 + 115 * age);
    }
    // Faint chipped edges next to cracks once the block is badly damaged.
    if (s >= 5) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = x + y * N;
          if (img.data[i * 4 + 3] !== 0) continue;
          const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;
            return nx >= 0 && ny >= 0 && nx < N && ny < N && reveal[nx + ny * N] <= limit - 0.3;
          });
          if (near) {
            img.data[i * 4] = 255;
            img.data[i * 4 + 1] = 248;
            img.data[i * 4 + 2] = 230;
            img.data[i * 4 + 3] = 46;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    textures.push(tex);
  }
  return textures;
}

/** Progressive cracks drawn on the block being mined. */
export class CrackOverlay {
  constructor(scene) {
    this.textures = createCrackTextures();
    this.material = new THREE.MeshBasicMaterial({
      map: this.textures[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: true,
    });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), this.material);
    this.mesh.name = 'crack overlay';
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
    this.stage = -1;
    this.kick = 0;
    scene.add(this.mesh);
  }

  show(x, y, z) {
    this.mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.mesh.visible = true;
    this.setProgress(0);
  }

  setProgress(progress) {
    const stage = Math.min(CRACK_STAGES - 1, Math.floor(progress * CRACK_STAGES));
    if (stage !== this.stage) {
      this.stage = stage;
      this.material.map = this.textures[stage];
    }
  }

  /** Brief swell on each tool strike so impacts read clearly. */
  strike() {
    this.kick = 1;
  }

  update(dt) {
    if (!this.mesh.visible) return;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.mesh.scale.setScalar(1 + this.kick * 0.035);
  }

  hide() {
    this.mesh.visible = false;
    this.stage = -1;
    this.kick = 0;
    this.mesh.scale.setScalar(1);
  }
}

/** 12 thin boxes forming a cube outline (shared by highlight-style effects). */
export function createOutlineGeometry(size = 1.006, thickness = 0.028) {
  const edges = [];
  for (const axis of [0, 1, 2]) {
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        const dims = [thickness, thickness, thickness];
        dims[axis] = size + thickness;
        const g = new THREE.BoxGeometry(...dims);
        const pos = [0, 0, 0];
        const others = [0, 1, 2].filter((v) => v !== axis);
        pos[others[0]] = (a * size) / 2;
        pos[others[1]] = (b * size) / 2;
        g.translate(pos[0], pos[1], pos[2]);
        edges.push(g);
      }
    }
  }
  return mergeGeometries(edges);
}

/**
 * Translucent "blueprint" of the block being built: a glowing outline of the
 * final cell, and a ghost of the selected block that grows out of the face
 * that was clicked and fades in until the real block takes its place.
 */
export class ConstructionGhost {
  constructor(scene, textures) {
    this.textures = textures;
    this.materialCache = new Map();
    this.group = new THREE.Group();
    this.group.name = 'construction ghost';
    this.group.visible = false;

    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), []);
    this.ghost.renderOrder = 1;
    this.outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0xbff4ff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    this.outline = new THREE.Mesh(createOutlineGeometry(1.01, 0.022), this.outlineMaterial);
    this.group.add(this.ghost, this.outline);
    scene.add(this.group);
    this.normal = [0, 1, 0];
    this.time = 0;
  }

  materialsFor(blockId) {
    if (!this.materialCache.has(blockId)) {
      const faces = BLOCKS[blockId].faces;
      const make = (key) =>
        new THREE.MeshLambertMaterial({
          map: this.textures[key],
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          alphaTest: 0.05,
          emissive: 0x9fdcff,
          emissiveIntensity: 0.18,
        });
      const side = make(faces.side);
      const top = make(faces.top);
      const bottom = make(faces.bottom);
      // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
      this.materialCache.set(blockId, [side, side, top, bottom, side, side]);
    }
    return this.materialCache.get(blockId);
  }

  show(x, y, z, blockId, normal) {
    this.group.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.ghost.material = this.materialsFor(blockId);
    this.normal = normal;
    this.group.visible = true;
    this.time = 0;
    this.setProgress(0);
  }

  setProgress(progress) {
    // Ease out so construction starts quickly and settles into place.
    const e = 1 - Math.pow(1 - progress, 3);
    const s = 0.06 + 0.94 * e;
    const [nx, ny, nz] = this.normal;
    // Scale along the normal axis only, anchored on the clicked face.
    this.ghost.scale.set(nx ? s : 1, ny ? s : 1, nz ? s : 1);
    this.ghost.position.set(-nx * (1 - s) * 0.5, -ny * (1 - s) * 0.5, -nz * (1 - s) * 0.5);
    const opacity = 0.2 + 0.7 * e;
    for (const m of this.ghost.material) m.opacity = opacity;
  }

  update(dt) {
    if (!this.group.visible) return;
    this.time += dt;
    this.outlineMaterial.opacity = 0.45 + Math.sin(this.time * 14) * 0.2;
  }

  hide() {
    this.group.visible = false;
  }
}
