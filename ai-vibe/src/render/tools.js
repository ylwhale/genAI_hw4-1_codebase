import { mulberry32 } from '../utils/random.js';
import { buildVoxelModel } from './voxelModel.js';

/**
 * The three cosmetic tools. Each is drawn as 16 x 16 pixel art (generated
 * from simple shape functions, then outlined and bevel-shaded like classic
 * voxel-game item sprites) and extruded into a two-voxel-thick 3D model. The
 * same sprite is used for the HUD icon, so the held tool and the UI match.
 */
export const TOOLS = [
  // `grip` fine-tunes how each tool sits in the hand (radians, applied on
  // top of the shared grip): the axe is turned so its blade faces the camera.
  { id: 'pickaxe', name: 'Pickaxe', grip: { x: 0, y: 0, z: 0 } },
  { id: 'axe', name: 'Axe', grip: { x: 0.05, y: -0.5, z: 0.04 } },
  { id: 'shovel', name: 'Shovel', grip: { x: 0, y: -0.1, z: 0 } },
];

const N = 16;
const SQRT1_2 = Math.SQRT1_2;

const PALETTES = {
  wood: { base: '#8a5a2e', light: '#ad7640', dark: '#62401f', outline: '#2c1b0c' },
  diamond: { base: '#4fd6c8', light: '#b8fff5', dark: '#2a9e94', outline: '#0f3d3a' },
  iron: { base: '#c3c9d0', light: '#f1f4f7', dark: '#878f99', outline: '#474d55' },
  edge: { base: '#f4f7fa', light: '#ffffff', dark: '#c9d0d8', outline: '#5a616a' },
  gold: { base: '#f0c24a', light: '#fff1a8', dark: '#c08a1e', outline: '#4a3208' },
};

// Shapes are described in a frame aligned with the handle: `u` runs from the
// bottom-left end of the handle towards the top-right, `v` across it
// (positive towards the bottom-right). Each returns a material key or null.
const ORIGIN = { x: 1.5, y: 14.5 };

function handle(u, v, length) {
  return u >= -0.3 && u <= length && Math.abs(v) <= 0.75 ? 'wood' : null;
}

const SHAPES = {
  pickaxe(u, v) {
    // Crescent head arcing across the top of the handle (an arc around the
    // handle's base), thick in the middle and tapering to points.
    const r = Math.hypot(u, v);
    const a = Math.atan2(v, u); // 0 along the handle
    if (Math.abs(a) <= 0.78) {
      const half = 0.75 + 1.05 * Math.cos((a / 0.78) * (Math.PI / 2));
      if (Math.abs(r - 13.4) <= half) return 'diamond';
    }
    return handle(u, v, 12.6);
  },
  axe(u, v) {
    // Broad blade on one side of the handle top with a bright, slightly
    // convex cutting edge, and a small butt on the other side.
    if (u >= 7.8 && u <= 15.6) {
      const t = (u - 11.8) / 3.9;
      const reach = 4.1 + 2.7 * Math.sqrt(Math.max(0, 1 - t * t));
      if (v <= -0.4 && v >= -reach) return v <= -(reach - 1.6) ? 'edge' : 'iron';
    }
    if (u >= 11.4 && u <= 14.6 && v >= 0.4 && v <= 2.3) return 'iron';
    return handle(u, v, 15);
  },
  shovel(u, v) {
    // Rounded spade blade at the end of a shorter handle, with a collar.
    if (u >= 10.4 && u <= 18.4) {
      const w = u < 15.2 ? 2.9 : Math.sqrt(Math.max(0, 2.9 ** 2 - ((u - 15.2) * 0.92) ** 2));
      if (Math.abs(v) <= w) return 'gold';
    }
    if (u >= 9.4 && u < 10.4 && Math.abs(v) <= 1.6) return 'gold';
    return handle(u, v, 10);
  },
};

const sprites = new Map();
const sideSprites = new Map();

/**
 * 16 x 16 sprite for a tool: an array of rows (row 0 at the top), each an
 * array of sRGB hex colours or null. Deterministic and cached.
 */
export function getToolSprite(id) {
  if (sprites.has(id)) return sprites.get(id);
  const shape = SHAPES[id];
  const mats = [];
  for (let y = 0; y < N; y++) {
    const row = [];
    for (let x = 0; x < N; x++) {
      const px = x + 0.5 - ORIGIN.x;
      const py = y + 0.5 - ORIGIN.y;
      const u = (px - py) * SQRT1_2;
      const v = (px + py) * SQRT1_2;
      row.push(shape(u, v));
    }
    mats.push(row);
  }

  const at = (x, y) => (x >= 0 && y >= 0 && x < N && y < N ? mats[y][x] : null);
  // Extruded side faces use the material's shade rather than the near-black
  // outline, so the 3D model's silhouette stays readable.
  sideSprites.set(id, mats.map((row) => row.map((mat) => (mat ? PALETTES[mat].dark : null))));
  const rand = mulberry32(id.length * 7919 + id.charCodeAt(0));
  const sprite = mats.map((row, y) =>
    row.map((mat, x) => {
      if (!mat) return null;
      const p = PALETTES[mat];
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
      if (edge) return p.outline;
      if (mat === 'wood') return rand() < 0.3 ? p.dark : rand() < 0.3 ? p.light : p.base;
      // Bevel: light from the top-left, shade towards the bottom-right.
      const nearTopLeft = !at(x - 2, y) || !at(x, y - 2) || !at(x - 1, y - 1);
      const nearBottomRight = !at(x + 2, y) || !at(x, y + 2) || !at(x + 1, y + 1);
      if (nearTopLeft && !nearBottomRight) return p.light;
      if (nearBottomRight && !nearTopLeft) return p.dark;
      return rand() < 0.15 ? p.light : p.base;
    }),
  );
  sprites.set(id, sprite);
  return sprite;
}

/**
 * Extruded 3D geometry for a tool. The model lies in the XY plane (Y up),
 * `voxel` units per pixel, two voxels thick, with the grip point — where the
 * hand holds the handle — at the origin. The handle points along +X+Y.
 */
export function buildToolGeometry(id, voxel) {
  const sprite = getToolSprite(id);
  // Grip roughly a quarter of the way up the handle.
  const grip = { u: 3.2 };
  const gx = ORIGIN.x + grip.u * SQRT1_2;
  const gy = ORIGIN.y - grip.u * SQRT1_2;
  const side = sideSprites.get(id);
  return buildVoxelModel(
    N, N, 2,
    (x, y) => sprite[N - 1 - y][x],
    voxel,
    { x: gx, y: N - gy, z: 1 },
    (x, y) => side[N - 1 - y][x],
  );
}

/** Draws a tool sprite onto a new canvas (for the HUD). */
export function drawToolIcon(id, scale = 4) {
  const sprite = getToolSprite(id);
  const canvas = document.createElement('canvas');
  canvas.width = N * scale;
  canvas.height = N * scale;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = sprite[y][x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas;
}
