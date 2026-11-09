import * as THREE from 'three';
import { MOB_DEATH_DURATION } from './mobs.js';

export function createMobView(scene, enemies) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const hitColor = new THREE.Color(0xf4b69b);
  const group = new THREE.Group(); group.name = 'Grove creatures'; scene.add(group);
  const hitMeshes = [];
  const models = enemies.map(enemy => {
    const root = new THREE.Group(); root.name = enemy.name; group.add(root);
    const moss = enemy.type === 'mossling';
    // Fit rotated corners inside the axis-aligned collision footprint as well.
    root.scale.set(moss ? 0.85 : 0.9, 1, moss ? 0.85 : 0.9);
    const palette = moss ? [0x6e934b, 0x47683b, 0xa7ba64, 0xf1d787, 0x21352e] : [0x8d9992, 0x5d6c67, 0xb1b9a6, 0xe3bf77, 0x263b37];
    const materials = palette.map(color => new THREE.MeshLambertMaterial({ color }));
    function box(size, position, material) {
      const mesh = new THREE.Mesh(geometry, materials[material]);
      mesh.scale.set(...size); mesh.position.set(...position);
      mesh.receiveShadow = true; mesh.userData.enemyId = enemy.id;
      root.add(mesh); hitMeshes.push(mesh); return mesh;
    }
    const legs = [], arms = [];
    if (moss) {
      legs.push(box([0.2,0.19,0.29], [-0.17,0.095,0], 1), box([0.2,0.19,0.29], [0.17,0.095,0], 1));
      box([0.58,0.38,0.42], [0,0.36,0], 0);
      box([0.53,0.25,0.44], [0,0.65,0], 0);
      box([0.14,0.12,0.14], [-0.16,0.83,0.05], 2);
      box([0.12,0.08,0.13], [0.12,0.81,0], 2);
      box([0.11,0.085,0.035], [-0.14,0.68,0.237], 3);
      box([0.11,0.085,0.035], [0.14,0.68,0.237], 3);
      box([0.04,0.065,0.015], [-0.14,0.68,0.26], 4);
      box([0.04,0.065,0.015], [0.14,0.68,0.26], 4);
      box([0.13,0.035,0.035], [0,0.57,0.238], 1);
    } else {
      legs.push(box([0.25,0.34,0.33], [-0.19,0.17,0], 1), box([0.25,0.34,0.33], [0.19,0.17,0], 1));
      box([0.56,0.65,0.46], [0,0.69,0], 0);
      box([0.43,0.16,0.49], [0,0.71,0.005], 2);
      arms.push(box([0.18,0.6,0.26], [-0.37,0.74,0], 1), box([0.18,0.6,0.26], [0.37,0.74,0], 1));
      box([0.61,0.23,0.5], [0,1.05,0], 2);
      box([0.51,0.44,0.46], [0,1.39,0], 0);
      box([0.57,0.1,0.49], [0,1.6,0], 1);
      box([0.12,0.07,0.03], [-0.13,1.4,0.245], 3);
      box([0.12,0.07,0.03], [0.13,1.4,0.245], 3);
      box([0.055,0.16,0.03], [0,1.29,0.245], 1);
      box([0.045,0.22,0.03], [-0.1,0.91,0.25], 1);
    }
    return { enemy, root, materials, palette, legs, arms, widthScale: moss ? 0.85 : 0.9 };
  });
  return {
    group, models, hitMeshes,
    update() {
      for (const { enemy, root, materials, palette, legs, arms, widthScale } of models) {
        const death = enemy.health > 0 ? 0 : Math.min(1, enemy.deathTime / MOB_DEATH_DURATION);
        const attack = enemy.attackAnimation > 0 ? Math.sin(Math.PI * (1 - enemy.attackAnimation / 0.3)) : 0;
        const stride = enemy.moving && enemy.health > 0 ? Math.sin(enemy.animationTime * 9) * 0.4 : 0;
        const bob = enemy.moving ? Math.abs(stride) * 0.06 : Math.sin(enemy.animationTime * 2) * 0.006;
        root.position.set(enemy.x + Math.sin(enemy.yaw) * attack * 0.12, enemy.y + bob - death * 0.1, enemy.z + Math.cos(enemy.yaw) * attack * 0.12);
        root.rotation.set(-attack * 0.18, enemy.yaw, death * 0.4);
        root.scale.set(widthScale * (1 - death), (1 - death) * (1 - attack * 0.1), widthScale * (1 - death));
        root.visible = death < 1;
        legs.forEach((leg, i) => { leg.rotation.x = stride * (i === 0 ? 1 : -1); });
        arms.forEach((arm, i) => { arm.rotation.x = -attack * 1.2 - stride * (i === 0 ? 1 : -1); });
        materials.forEach((material, i) => material.color.setHex(palette[i]).lerp(hitColor, Math.min(1, enemy.hitFlash / 0.2)));
      }
      group.updateMatrixWorld(true);
    },
    dispose() {
      scene.remove(group); geometry.dispose();
      models.forEach(model => model.materials.forEach(material => material.dispose()));
    },
  };
}
