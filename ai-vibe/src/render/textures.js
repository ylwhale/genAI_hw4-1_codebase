import * as THREE from 'three';
import { mulberry32 } from '../utils/random.js';

// Procedural 16x16 pixel-art textures, painted on canvases at startup.
// Nothing is loaded from disk, so every visual in the game is original.

const N = 16;

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  return canvas;
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function shade([r, g, b], f) {
  return [r * f, g * f, b * f];
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Paints a texture via a per-pixel callback returning [r,g,b] or [r,g,b,a]. */
function paint(seed, fn) {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N);
  const rand = mulberry32(seed);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = fn(x, y, rand);
      const i = (y * N + x) * 4;
      img.data[i] = clampByte(c[0]);
      img.data[i + 1] = clampByte(c[1]);
      img.data[i + 2] = clampByte(c[2]);
      img.data[i + 3] = c.length > 3 ? clampByte(c[3]) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// ---------------------------------------------------------------- palettes

const GRASS_TONES = ['#4f9a33', '#5aa83a', '#66b543', '#73bf4c', '#468c2e'].map(hexToRgb);
const DIRT_TONES = ['#7a5434', '#835b38', '#6d4a2d', '#8d6440', '#5f4128'].map(hexToRgb);
const STONE_TONES = ['#8b8e91', '#7f8285', '#96999b', '#75787b', '#a1a4a6'].map(hexToRgb);
const BARK_DARK = hexToRgb('#4a3320');
const BARK_MID = hexToRgb('#6b4a2b');
const BARK_LIGHT = hexToRgb('#7d5a36');
const RING_LIGHT = hexToRgb('#c19a63');
const RING_DARK = hexToRgb('#9a7442');
const LEAF_TONES = ['#2f7a26', '#3a8a2e', '#469c36', '#2a6b22', '#55aa40'].map(hexToRgb);

function pick(tones, rand, bias = 0) {
  const i = Math.min(tones.length - 1, Math.max(0, Math.floor(rand() * tones.length + bias)));
  return tones[i];
}

// ---------------------------------------------------------------- painters

function paintDirt(seed) {
  return paint(seed, (x, y, rand) => {
    let c = pick(DIRT_TONES, rand);
    if (rand() < 0.07) c = hexToRgb('#a07a52'); // pebbles
    if (rand() < 0.05) c = hexToRgb('#4d3420');
    return c;
  });
}

function paintGrassTop(seed) {
  return paint(seed, (x, y, rand) => {
    let c = pick(GRASS_TONES, rand);
    if (rand() < 0.06) c = hexToRgb('#86cc58'); // sun-lit blades
    if (rand() < 0.04) c = hexToRgb('#3c7d27');
    return c;
  });
}

function paintGrassSide(seed) {
  const dirt = paintDirt(seed + 1).getContext('2d').getImageData(0, 0, N, N).data;
  const rand = mulberry32(seed);
  // Irregular grass overhang depth per column.
  const depth = Array.from({ length: N }, () => 2 + Math.floor(rand() * 3));
  return paint(seed + 2, (x, y, r) => {
    if (y < depth[x]) {
      const c = pick(GRASS_TONES, r);
      return y === depth[x] - 1 ? shade(c, 0.82) : c;
    }
    const i = (y * N + x) * 4;
    return [dirt[i], dirt[i + 1], dirt[i + 2]];
  });
}

function paintStone(seed) {
  const rand = mulberry32(seed);
  // A few darker crack strokes on top of speckled noise.
  const cracks = new Set();
  for (let k = 0; k < 5; k++) {
    let cx = Math.floor(rand() * N);
    let cy = Math.floor(rand() * N);
    const len = 2 + Math.floor(rand() * 3);
    for (let s = 0; s < len; s++) {
      cracks.add(cx + cy * N);
      cx = (cx + (rand() < 0.5 ? 1 : 0)) % N;
      cy = (cy + (rand() < 0.6 ? 1 : 0)) % N;
    }
  }
  return paint(seed + 1, (x, y, r) => {
    let c = pick(STONE_TONES, r);
    if (cracks.has(x + y * N)) c = hexToRgb('#64676a');
    return c;
  });
}

function paintLogSide(seed) {
  const rand = mulberry32(seed);
  const stripe = Array.from({ length: N }, () => rand());
  return paint(seed + 1, (x, y, r) => {
    const s = stripe[x];
    let c = s < 0.25 ? BARK_DARK : s < 0.7 ? BARK_MID : BARK_LIGHT;
    if (r() < 0.12) c = shade(c, 0.85);
    if ((x + y * 3) % 11 === 0 && r() < 0.5) c = BARK_DARK;
    return c;
  });
}

function paintLogTop(seed) {
  return paint(seed, (x, y, r) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 6.6) return shade(BARK_MID, 0.9 + r() * 0.15);
    const ring = Math.floor(d * 0.95) % 2 === 0;
    let c = ring ? RING_LIGHT : RING_DARK;
    if (r() < 0.1) c = shade(c, 0.92);
    return c;
  });
}

function paintLeaves(seed) {
  return paint(seed, (x, y, r) => {
    const v = r();
    if (v < 0.13) return [0, 0, 0, 0]; // see-through gaps
    let c = pick(LEAF_TONES, r);
    if (v > 0.93) c = mix(c, hexToRgb('#8fd062'), 0.6);
    return c;
  });
}

// ---------------------------------------------------------------- public api

/** Raw canvases (also used to draw hotbar icons). */
export function createTextureCanvases() {
  return {
    grass_top: paintGrassTop(101),
    grass_side: paintGrassSide(202),
    dirt: paintDirt(303),
    stone: paintStone(404),
    log_side: paintLogSide(505),
    log_top: paintLogTop(606),
    leaves: paintLeaves(707),
  };
}

/** THREE textures with crisp pixel filtering and mipmaps for distance. */
export function createTextures(canvases, renderer) {
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  const textures = {};
  for (const [key, canvas] of Object.entries(canvases)) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, maxAniso);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    textures[key] = tex;
  }
  return textures;
}

/** Soft round sprite for ambient motes. */
export function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,250,220,0.8)');
  g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
