import * as THREE from 'three';
import { createOutlineGeometry } from './actionEffects.js';

/** Outline + soft glow around the targeted block. */
export class BlockHighlight {
  constructor(scene) {
    const outline = new THREE.Mesh(
      createOutlineGeometry(1.006, 0.028),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, fog: false }),
    );
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(1.004, 1.004, 1.004),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.group = new THREE.Group();
    this.group.name = 'highlight';
    this.group.add(outline, glow);
    this.group.visible = false;
    this.glow = glow;
    scene.add(this.group);
  }

  /** `cell` is {x, y, z, editable?} or null to hide. */
  update(cell, time) {
    if (!cell) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    // Rock-base hits (not breakable) get a fainter glow.
    this.glow.material.opacity = cell.editable === false ? 0.02 : 0.05 + Math.sin(time * 4) * 0.02;
  }
}
