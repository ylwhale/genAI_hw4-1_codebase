import * as THREE from 'three';
import { randomAt } from './world.js';
import { tileForFace, TILE_COUNT } from './textures.js';

const PARTICLE_CAPACITY = 48;
const BLOCK_COLORS = [0xffffff, 0x86a44f, 0x9b7653, 0x929e98, 0x967046, 0x6c964b];

export function createCrackTextures() {
  const segments = [
    [16,16, 10,11], [10,11, 7,5], [16,16, 20,10], [20,10, 25,7],
    [16,16, 19,22], [19,22, 16,28], [10,11, 3,13], [20,10, 18,3],
    [16,16, 9,20], [9,20, 3,23], [19,22, 26,24], [26,24, 29,30],
    [7,5, 10,1], [25,7, 31,9], [3,13, 0,9], [16,28, 11,31],
    [9,20, 10,27], [26,24, 30,19], [19,22, 24,17], [3,23, 0,29],
  ];
  return [5, 10, 15, 20].map(count => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#243226'; ctx.lineWidth = 1.6; ctx.lineCap = 'square';
    ctx.beginPath();
    for (const [x, y, nx, ny] of segments.slice(0, count)) { ctx.moveTo(x, y); ctx.lineTo(nx, ny); }
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

export function createInteractionEffects(scene, { atlas = null, crackTextures = createCrackTextures() } = {}) {
  const group = new THREE.Group(); group.name = 'Temporary interaction effects'; scene.add(group);
  const crackGeometry = new THREE.BoxGeometry(1.008, 1.008, 1.008);
  const crackMaterial = new THREE.MeshBasicMaterial({ map: crackTextures[0], transparent: true, depthWrite: false, opacity: 0.9 });
  const crackOverlay = new THREE.Mesh(crackGeometry, crackMaterial);
  crackOverlay.visible = false; group.add(crackOverlay);
  const previewGeometry = new THREE.BoxGeometry(1, 1, 1);
  const baseUV = previewGeometry.attributes.uv.array.slice();
  const previewMaterial = new THREE.MeshLambertMaterial({ map: atlas, transparent: true, opacity: 0.3, depthWrite: false });
  const preview = new THREE.Mesh(previewGeometry, previewMaterial); preview.visible = false; group.add(preview);
  const previewEdges = new THREE.LineSegments(new THREE.EdgesGeometry(previewGeometry), new THREE.LineBasicMaterial({ color: 0xe3edb8, transparent: true, opacity: 0.7, depthWrite: false }));
  previewEdges.visible = false; group.add(previewEdges);
  const particleGeometry = new THREE.BoxGeometry(1, 1, 1);
  const particleMaterial = new THREE.MeshLambertMaterial();
  const particles = new THREE.InstancedMesh(particleGeometry, particleMaterial, PARTICLE_CAPACITY);
  particles.frustumCulled = false; particles.visible = false; group.add(particles);
  const slots = Array.from({ length: PARTICLE_CAPACITY }, () => ({ age: 0, life: 0, origin: new THREE.Vector3(), velocity: new THREE.Vector3(), size: 0, building: false }));
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  const origin = new THREE.Vector3(), normal = new THREE.Vector3();
  let operation = null, emission = 0, cursor = 0, serial = 0, liveCount = 0, stage = 0;
  function spawn() {
    const slot = slots[cursor];
    const r = seed => randomAt(serial, cursor, seed);
    slot.age = 0; slot.life = 0.28 + r(80) * 0.25; slot.size = 0.035 + r(81) * 0.04;
    slot.building = operation.action === 'place';
    if (slot.building) {
      slot.velocity.set(r(82) - 0.5, r(83) - 0.5, r(84) - 0.5).normalize();
      slot.origin.copy(origin).addScaledVector(slot.velocity, 0.8 + r(85) * 0.4);
      slot.velocity.subVectors(origin, slot.origin).divideScalar(slot.life);
    } else {
      slot.origin.set(origin.x + (r(82) - 0.5) * 0.35, origin.y + (r(83) - 0.5) * 0.35, origin.z + (r(84) - 0.5) * 0.35);
      slot.velocity.set((r(85) - 0.5) * 2, 0.7 + r(86) * 1.8, (r(87) - 0.5) * 2).addScaledVector(normal, 0.8);
    }
    color.setHex(BLOCK_COLORS[slot.building ? operation.selected : operation.sourceType]).multiplyScalar(0.8 + r(88) * 0.4);
    particles.setColorAt(cursor, color);
    cursor = (cursor + 1) % PARTICLE_CAPACITY; serial++;
  }
  function clear() {
    operation = null; emission = 0; liveCount = 0; stage = 0;
    crackOverlay.visible = false; particles.visible = false; preview.visible = false; previewEdges.visible = false;
    slots.forEach(slot => { slot.life = 0; });
  }
  return {
    group, crackOverlay, particles, preview,
    get particleCount() { return liveCount; },
    get crackStage() { return stage; },
    begin(op) {
      clear(); operation = op;
      const { source, destination } = op;
      normal.set(source.normal?.x ?? 0, source.normal?.y ?? 1, source.normal?.z ?? 0);
      if (op.action === 'place') {
        origin.set(destination.x + 0.5, destination.y + 0.5, destination.z + 0.5);
        preview.position.copy(origin); previewEdges.position.copy(origin);
        preview.visible = true; previewEdges.visible = true;
        previewMaterial.color.setHex(atlas ? 0xffffff : BLOCK_COLORS[op.selected]);
        const uv = previewGeometry.attributes.uv;
        for (let face = 0; face < 6; face++) {
          const tile = tileForFace(op.selected, [0, 0, 1, -1, 0, 0][face]);
          for (let vertex = 0; vertex < 4; vertex++) {
            const index = face * 4 + vertex;
            uv.setXY(index, (tile + 0.02 + baseUV[index * 2] * 0.96) / TILE_COUNT, 0.02 + baseUV[index * 2 + 1] * 0.96);
          }
        }
        uv.needsUpdate = true;
      } else {
        origin.set(source.x + 0.5, source.y + 0.5, source.z + 0.5).addScaledVector(normal, 0.51);
        if (source.point) origin.set(source.point.x, source.point.y, source.point.z).addScaledVector(normal, 0.01);
        crackOverlay.position.set(source.x + 0.5, source.y + 0.5, source.z + 0.5);
        crackOverlay.visible = true;
      }
      for (let i = 0; i < 5; i++) spawn();
      this.update(0);
    },
    update(dt) {
      if (!operation || !Number.isFinite(dt) || dt < 0) return;
      if (operation.action === 'remove') {
        stage = Math.min(crackTextures.length - 1, Math.floor(operation.progress * crackTextures.length));
        crackMaterial.map = crackTextures[stage];
      } else {
        const p = operation.progress, smooth = p * p * (3 - 2 * p);
        preview.scale.setScalar(0.82 + smooth * 0.18);
        previewEdges.scale.copy(preview.scale);
        previewMaterial.opacity = 0.26 + smooth * 0.3;
      }
      slots.forEach(slot => { slot.age += dt; });
      emission += dt * 34;
      const count = Math.min(8, Math.floor(emission)); emission -= count;
      for (let i = 0; i < count; i++) spawn();
      liveCount = 0;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot.age < slot.life) {
          liveCount++;
          dummy.position.copy(slot.origin).addScaledVector(slot.velocity, slot.age);
          if (!slot.building) dummy.position.y -= 3 * slot.age * slot.age;
          dummy.rotation.set(slot.age * 6 + i, slot.age * 4, slot.age * 3);
          dummy.scale.setScalar(slot.size * (1 - slot.age / slot.life));
        } else dummy.scale.setScalar(0);
        dummy.updateMatrix(); particles.setMatrixAt(i, dummy.matrix);
      }
      particles.visible = liveCount > 0; particles.instanceMatrix.needsUpdate = true;
      if (particles.instanceColor) particles.instanceColor.needsUpdate = true;
    },
    clear,
    dispose() {
      clear(); scene.remove(group);
      crackGeometry.dispose(); crackMaterial.dispose();
      previewGeometry.dispose(); previewMaterial.dispose();
      previewEdges.geometry.dispose(); previewEdges.material.dispose();
      particleGeometry.dispose(); particleMaterial.dispose(); particles.dispose();
      crackTextures.forEach(texture => texture.dispose());
    },
  };
}
