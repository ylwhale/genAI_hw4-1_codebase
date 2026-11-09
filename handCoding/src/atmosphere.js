import * as THREE from 'three';
import { randomAt } from './world.js';

export function addAtmosphere(scene, world) {
  scene.fog = new THREE.Fog(0xcbdaca, 42, 125);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(130, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color('#9fc3c6') },
      horizon: { value: new THREE.Color('#e5e7d0') },
    },
    vertexShader: 'varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; varying vec3 vDirection;
      void main() {
        float height = normalize(vDirection).y;
        gl_FragColor = vec4(mix(horizon, zenith, smoothstep(-0.08, 0.8, height)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.position.set(16, 0, 16);
  scene.add(sky);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(220, 220, 70, 70), new THREE.MeshLambertMaterial({
    color: 0x8eb7ad, transparent: true, opacity: 0.88,
  }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(16, 0.35, 16);
  scene.add(water);
  const waterPositions = water.geometry.attributes.position;
  const waterBase = waterPositions.array.slice();

  const cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xfff9e7, transparent: true, opacity: 0.85 });
  const cloudGeometry = new THREE.BoxGeometry(1, 1, 1);
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const group = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(cloudGeometry, cloudMaterial);
      puff.scale.set(4 + randomAt(i, j, 91) * 5, 0.8 + randomAt(i, j, 92) * 1.2, 3 + randomAt(i, j, 93) * 3);
      puff.position.set(j * 3.2, randomAt(i, j, 94) * 0.6, randomAt(i, j, 95) * 2.5);
      group.add(puff);
    }
    group.position.set(-52 + randomAt(i, 0, 98) * 100, 28 + randomAt(i, 0, 99) * 8, -45 + randomAt(i, 0, 100) * 105);
    clouds.push(group);
    scene.add(group);
  }

  const sun = new THREE.Mesh(new THREE.SphereGeometry(3.2, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff4cf, fog: false }));
  sun.position.set(-62, 58, -60);
  scene.add(sun);

  const motes = new Float32Array(54 * 3);
  for (let i = 0; i < 54; i++) {
    const x = 1 + randomAt(i, 0, 131) * 30, z = 1 + randomAt(i, 0, 132) * 30;
    motes.set([x, world.surface(Math.floor(x), Math.floor(z)) + 1 + randomAt(i, 0, 133) * 4, z], i * 3);
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motes, 3));
  const particles = new THREE.Points(moteGeometry, new THREE.PointsMaterial({
    color: 0xffedb5, size: 0.055, transparent: true, opacity: 0.6, depthWrite: false,
  }));
  scene.add(particles);
  const moteBase = motes.slice();
  let waterTime = 0;
  return {
    update(time, dt) {
      for (let i = 0; i < clouds.length; i++) {
        clouds[i].position.x += dt * (0.2 + i * 0.012);
        if (clouds[i].position.x > 78) clouds[i].position.x = -65;
      }
      waterTime += dt;
      if (waterTime >= 1 / 12) {
        waterTime = 0;
        for (let i = 0; i < waterPositions.count; i++) {
          const x = waterBase[i * 3], y = waterBase[i * 3 + 1];
          waterPositions.array[i * 3 + 2] = Math.sin(x * 0.24 + time * 0.35) * 0.065 + Math.cos(y * 0.28 + time * 0.23) * 0.045;
        }
        waterPositions.needsUpdate = true;
      }
      for (let i = 0; i < 54; i++) {
        motes[i * 3] = moteBase[i * 3] + Math.sin(time * 0.2 + i) * 0.3;
        motes[i * 3 + 1] = moteBase[i * 3 + 1] + Math.sin(time * 0.5 + i * 3) * 0.25;
      }
      moteGeometry.attributes.position.needsUpdate = true;
    },
  };
}
