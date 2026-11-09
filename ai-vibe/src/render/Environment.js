import * as THREE from 'three';
import { createNoise2D, hash2, mulberry32 } from '../utils/random.js';
import { buildVoxelGeometry } from '../world/mesher.js';
import { AIR, GRASS, DIRT, STONE, WOOD, LEAVES } from '../world/blocks.js';
import { createGlowTexture } from './textures.js';

// Sky palette (sRGB hex, converted to linear by THREE.Color).
const PALETTE = {
  zenith: '#2a6fd6',
  horizon: '#a6d1f2',
  below: '#6fa6dc',
  sun: '#fff3d1',
  sunLight: '#fff0d8',
  skyLight: '#bcd8ff',
  groundLight: '#6e5b3f',
};

/**
 * Everything around the island: gradient sky with a sun, fog, sun + sky
 * lighting with soft shadows, drifting voxel clouds above and below the
 * island, distant floating islets, and glowing ambient motes.
 */
export class Environment {
  constructor(scene, worldSize, materials) {
    this.scene = scene;
    this.worldSize = worldSize;
    this.center = new THREE.Vector3(worldSize / 2, 12, worldSize / 2);
    this.sunDirection = new THREE.Vector3(0.62, 0.58, 0.53).normalize();
    this.time = 0;

    const horizon = new THREE.Color(PALETTE.horizon);
    scene.background = horizon.clone();
    scene.fog = new THREE.Fog(horizon.clone(), 55, 230);

    this.createSky();
    this.createLights();
    this.clouds = [
      this.createCloudLayer({ seed: 11, y: 58, thickness: 3, cell: 6, cells: 64, coverage: 0.36, opacity: 0.92, speed: 0.9 }),
      this.createCloudLayer({ seed: 23, y: -40, thickness: 4, cell: 6, cells: 64, coverage: 0.5, opacity: 0.9, speed: 0.45 }),
    ];
    this.createIslets(materials);
    this.createMotes();
  }

  // -------------------------------------------------------------------- sky

  createSky() {
    const uniforms = {
      zenithColor: { value: new THREE.Color(PALETTE.zenith) },
      horizonColor: { value: new THREE.Color(PALETTE.horizon) },
      belowColor: { value: new THREE.Color(PALETTE.below) },
      sunColor: { value: new THREE.Color(PALETTE.sun) },
      sunDirection: { value: this.sunDirection },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      // Untouched by tone mapping, so the horizon shows exactly the fog colour
      // and fogged distant geometry melts into it.
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // pin to the far plane
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 zenithColor;
        uniform vec3 horizonColor;
        uniform vec3 belowColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          vec3 col = h > 0.0
            ? mix(horizonColor, zenithColor, pow(smoothstep(0.0, 1.0, h), 0.55))
            : mix(horizonColor, belowColor, pow(smoothstep(0.0, 0.5, -h), 0.6));
          float s = max(dot(dir, normalize(sunDirection)), 0.0);
          col += sunColor * (pow(s, 6.0) * 0.18 + pow(s, 64.0) * 0.45);
          col = mix(col, sunColor * 2.2, smoothstep(0.9993, 0.9997, s));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), material);
    this.sky.name = 'sky';
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  // ----------------------------------------------------------------- lights

  createLights() {
    const hemi = new THREE.HemisphereLight(PALETTE.skyLight, PALETTE.groundLight, 1.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(PALETTE.sunLight, 2.6);
    sun.position.copy(this.center).addScaledVector(this.sunDirection, 60);
    sun.target.position.copy(this.center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    // Covers the island and the rock base hanging beneath it.
    cam.left = -36;
    cam.right = 36;
    cam.top = 48; // extra headroom: player builds reach up to the build limit
    cam.bottom = -36;
    cam.near = 1;
    cam.far = 140;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  // ----------------------------------------------------------------- clouds

  createCloudLayer({ seed, y, thickness, cell, cells, coverage, opacity, speed }) {
    // Two octaves of value noise whose lattice repeats exactly every `cells`
    // cells, so the pattern tiles seamlessly as the layer scrolls.
    const octaves = [
      { scale: cells / 8, period: 8, weight: 0.7 },
      { scale: cells / 16, period: 16, weight: 0.3 },
    ];
    const values = new Float32Array(cells * cells);
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        let v = 0;
        for (const o of octaves) v += o.weight * periodicValueNoise(i / o.scale, j / o.scale, o.period, seed);
        values[i + j * cells] = v;
      }
    }
    // Threshold at the quantile that gives exactly the requested coverage.
    const sorted = Float32Array.from(values).sort();
    const threshold = sorted[Math.floor((1 - coverage) * (sorted.length - 1))];
    const wrap = (v) => ((v % cells) + cells) % cells;
    const filled = (i, j) => values[wrap(i) + wrap(j) * cells] > threshold;

    const positions = [];
    const normals = [];
    const quad = (p, n) => {
      positions.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
      for (let k = 0; k < 6; k++) normals.push(...n);
    };
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        if (!filled(i, j)) continue;
        const x0 = i * cell, x1 = x0 + cell;
        const z0 = j * cell, z1 = z0 + cell;
        const y0 = 0, y1 = thickness;
        quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]);
        quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
        if (!filled(i + 1, j)) quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
        if (!filled(i - 1, j)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
        if (!filled(i, j + 1)) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
        if (!filled(i, j - 1)) quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0xdfe9f5,
      emissiveIntensity: 0.42,
      transparent: true,
      opacity,
      // Writing depth keeps faces inside a tile correctly occluded no matter
      // which order they were emitted in.
      depthWrite: true,
    });
    fadeWithDistance(material, this.worldSize / 2, CLOUD_FADE_START, CLOUD_FADE_END);
    const span = cells * cell;
    const group = new THREE.Group();
    group.name = 'clouds';
    // Three copies of the tileable pattern; the group scrolls by at most half
    // a span either side of the island, so the wrap-around always happens
    // more than a full span away (far beyond the fog) and is never visible.
    for (const offset of [-span, 0, span]) {
      const tile = new THREE.Mesh(geometry, material);
      tile.position.x = offset;
      group.add(tile);
    }
    group.position.set(0, y, this.worldSize / 2 - span / 2);
    this.scene.add(group);
    return { group, span, speed, offset: (seed * 37) % span };
  }

  // ----------------------------------------------------------------- islets

  /** Small decorative floating islands in the distance (not interactive). */
  createIslets(materials) {
    const rand = mulberry32(4242);
    const specs = [
      { angle: 0.35, dist: 95, y: 6, r: 6 },
      { angle: 1.6, dist: 120, y: 22, r: 5 },
      { angle: 2.55, dist: 88, y: -6, r: 4 },
      { angle: 3.7, dist: 130, y: 14, r: 7 },
      { angle: 4.6, dist: 100, y: 30, r: 4 },
      { angle: 5.5, dist: 115, y: 0, r: 5 },
    ];
    this.islets = [];
    specs.forEach((spec, n) => {
      const geometry = buildVoxelGeometry(
        { x0: -spec.r - 2, x1: spec.r + 3, y0: -spec.r * 2 - 2, y1: 9, z0: -spec.r - 2, z1: spec.r + 3 },
        makeIsletSampler(spec.r, 900 + n * 17, rand() < 0.75),
      );
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.name = `islet ${n}`;
      const cx = this.worldSize / 2 + Math.cos(spec.angle) * spec.dist;
      const cz = this.worldSize / 2 + Math.sin(spec.angle) * spec.dist;
      mesh.position.set(cx, spec.y, cz);
      mesh.rotation.y = rand() * Math.PI * 2;
      this.scene.add(mesh);
      this.islets.push({ mesh, baseY: spec.y, phase: rand() * Math.PI * 2 });
    });
  }

  // ------------------------------------------------------------------ motes

  createMotes() {
    const count = 140;
    const positions = new Float32Array(count * 3);
    const rand = mulberry32(777);
    this.moteSeeds = [];
    for (let i = 0; i < count; i++) {
      const seed = {
        x: rand() * (this.worldSize + 8) - 4,
        y: 9 + rand() * 16,
        z: rand() * (this.worldSize + 8) - 4,
        phase: rand() * Math.PI * 2,
        speed: 0.2 + rand() * 0.5,
        radius: 0.4 + rand() * 1.2,
      };
      this.moteSeeds.push(seed);
      positions[i * 3] = seed.x;
      positions[i * 3 + 1] = seed.y;
      positions[i * 3 + 2] = seed.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      size: 0.16,
      map: createGlowTexture(),
      color: 0xfff1b8,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.motes = new THREE.Points(geometry, material);
    this.motes.name = 'motes';
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 1; // additive glow lands on top of the (farther) clouds
    this.scene.add(this.motes);
  }

  // ----------------------------------------------------------------- update

  update(dt, cameraPosition) {
    this.time += dt;
    const t = this.time;
    this.sky.position.copy(cameraPosition);

    for (const layer of this.clouds) {
      const u = ((layer.offset + t * layer.speed) % layer.span) - layer.span / 2;
      layer.group.position.x = this.worldSize / 2 - layer.span / 2 + u;
    }

    for (const islet of this.islets) {
      islet.mesh.position.y = islet.baseY + Math.sin(t * 0.25 + islet.phase) * 0.6;
    }

    const pos = this.motes.geometry.attributes.position;
    for (let i = 0; i < this.moteSeeds.length; i++) {
      const s = this.moteSeeds[i];
      const a = t * s.speed + s.phase;
      pos.array[i * 3] = s.x + Math.sin(a) * s.radius;
      pos.array[i * 3 + 1] = s.y + Math.sin(a * 0.7 + s.phase) * 0.6;
      pos.array[i * 3 + 2] = s.z + Math.cos(a * 0.9) * s.radius;
    }
    pos.needsUpdate = true;
    this.motes.material.opacity = 0.55 + Math.sin(t * 1.3) * 0.15;
  }
}

// Clouds fade out by horizontal distance from the island so the edges of the
// (finite, scrolling) cloud field are never visible against the sky.
const CLOUD_FADE_START = 110;
const CLOUD_FADE_END = 175;

/** Multiplies a built-in material's alpha by a horizontal distance falloff. */
function fadeWithDistance(material, center, start, end) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFadeXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFadeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFadeXZ;')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        gl_FragColor.a *= 1.0 - smoothstep(${start.toFixed(1)}, ${end.toFixed(1)}, distance(vFadeXZ, vec2(${center.toFixed(1)})));
        if (gl_FragColor.a < 0.004) discard;`,
      );
  };
  material.customProgramCacheKey = () => `fade-${center}-${start}-${end}`;
}

/** Voxel sampler for a small round floating islet with an optional tree. */
function makeIsletSampler(radius, seed, withTree) {
  const noise = createNoise2D(seed);
  const top = (x, z) => Math.round(1 + noise(x / 3, z / 3) * 1.2);
  const inside = (x, z) => Math.hypot(x, z) <= radius + noise(x / 2.5 + 9, z / 2.5) * 1.1;
  const depthAt = (x, z) => {
    const r = Math.hypot(x, z) / (radius + 1);
    return Math.max(1, Math.round((1 - r * r) * radius * 1.8 + noise(x / 2, z / 2 + 4) * 1.5));
  };
  const trunkTop = top(0, 0) + 4;
  return (x, y, z) => {
    if (withTree) {
      if (x === 0 && z === 0 && y > top(0, 0) && y <= trunkTop) return WOOD;
      const dy = y - trunkTop;
      if (dy >= -2 && dy <= 1) {
        const r = dy < 0 ? 2 : 1;
        if (Math.abs(x) <= r && Math.abs(z) <= r && !(Math.abs(x) === r && Math.abs(z) === r && dy >= 0)) {
          if (!(x === 0 && z === 0 && dy <= 0)) return LEAVES;
        }
      }
    }
    if (!inside(x, z)) return AIR;
    const h = top(x, z);
    if (y > h) return AIR;
    if (y === h) return GRASS;
    if (y >= h - 2) return DIRT;
    return y >= h - depthAt(x, z) ? STONE : AIR;
  };
}

/** Smooth value noise in [0, 1] whose lattice wraps every `period` units. */
function periodicValueNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const wrap = (v) => ((v % period) + period) % period;
  const v = (i, j) => hash2(wrap(i), wrap(j), seed);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = v(xi, yi) + (v(xi + 1, yi) - v(xi, yi)) * sx;
  const bottom = v(xi, yi + 1) + (v(xi + 1, yi + 1) - v(xi, yi + 1)) * sx;
  return top + (bottom - top) * sy;
}
