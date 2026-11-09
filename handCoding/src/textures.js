import * as THREE from 'three';
import { randomAt } from './world.js';

export const TILE_COUNT = 7;

export function tileForFace(type, normalY) {
  if (type === 1) return normalY === 1 ? 0 : normalY === -1 ? 2 : 1;
  if (type === 2) return 2;
  if (type === 3) return 3;
  if (type === 4) return normalY ? 5 : 4;
  return 6;
}

export function createBlockAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_COUNT * 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  const bases = [[113,151,66], [142,105,68], [142,105,68], [138,147,143], [118,87,53], [167,135,85], [81,128,57]];
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let base = bases[tile];
      let shade = 0.87 + randomAt(x + tile * 17, y, 83) * 0.25;
      if (tile === 0) {
        if (randomAt(x, y, 101) > 0.88) shade *= 1.13;
      } else if (tile === 1) {
        const edge = 3 + Math.floor(randomAt(x, 0, 84) * 3);
        if (y < edge) base = bases[0];
        if (y === edge) shade *= 0.8;
      } else if (tile === 3) {
        shade *= 0.94 + randomAt(Math.floor(x / 4), Math.floor(y / 3), 12) * 0.13;
      } else if (tile === 4) {
        shade *= 0.75 + randomAt(Math.floor(x / 2), 0, 16) * 0.45;
        if ((y + Math.floor(x / 4) * 3) % 9 === 0) shade *= 0.8;
      } else if (tile === 5) {
        const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (Math.floor(ring) % 3 === 0) shade *= 0.77;
      } else if (tile === 6) {
        shade *= 0.76 + randomAt(Math.floor(x / 2), Math.floor(y / 2), 73) * 0.4;
      }
      ctx.fillStyle = `rgb(${base.map(v => Math.round(Math.min(255, v * shade))).join(',')})`;
      ctx.fillRect(tile * 16 + x, y, 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}
