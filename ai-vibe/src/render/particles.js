import * as THREE from 'three';
import { BLOCKS } from '../world/blocks.js';

const TAG_CONSTRUCTION = 1;

/**
 * Fixed-capacity particle pool backed by one InstancedMesh. Particles live in
 * flat typed arrays and are removed by swapping with the last live one, so
 * there is no per-frame allocation and memory use can never grow: when the
 * pool is full, new particles are simply dropped.
 */
class ParticlePool {
  constructor(scene, material, capacity, { gravity, collide }) {
    this.capacity = capacity;
    this.gravity = gravity;
    this.collide = collide;
    this.count = 0;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    this.tag = new Uint8Array(capacity); // lets a group of particles be removed together
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color()); // allocate instanceColor
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
  }

  emit(x, y, z, vx, vy, vz, color, life, size, tag = 0) {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    this.tag[i] = tag;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.spin[i] = (Math.random() - 0.5) * 12;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    return true;
  }

  remove(i) {
    const last = --this.count;
    if (i === last) return;
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size[i] = this.size[last];
    this.spin[i] = this.spin[last];
    this.tag[i] = this.tag[last];
  }

  /** Removes every live particle carrying `tag` (takes effect next update). */
  removeTagged(tag) {
    for (let i = this.count - 1; i >= 0; i--) if (this.tag[i] === tag) this.remove(i);
  }

  update(dt, world) {
    const { pos, vel } = this;
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i] || pos[i * 3 + 1] < -60) {
        this.remove(i);
        continue;
      }
      vel[i * 3 + 1] -= this.gravity * dt;
      const nx = pos[i * 3] + vel[i * 3] * dt;
      const ny = pos[i * 3 + 1] + vel[i * 3 + 1] * dt;
      const nz = pos[i * 3 + 2] + vel[i * 3 + 2] * dt;
      if (this.collide && world.isSolidForCollision(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        // Land on (or bounce off) whatever was hit, losing most energy.
        if (!world.isSolidForCollision(Math.floor(pos[i * 3]), Math.floor(ny), Math.floor(pos[i * 3 + 2]))) {
          pos[i * 3 + 1] = ny;
        } else {
          vel[i * 3 + 1] = Math.abs(vel[i * 3 + 1]) > 2 ? -vel[i * 3 + 1] * 0.25 : 0;
        }
        vel[i * 3] *= 0.5;
        vel[i * 3 + 2] *= 0.5;
        this.spin[i] *= 0.5;
      } else {
        pos[i * 3] = nx;
        pos[i * 3 + 1] = ny;
        pos[i * 3 + 2] = nz;
      }
    }

    const d = this.dummy;
    for (let i = 0; i < this.count; i++) {
      const t = this.life[i] / this.maxLife[i];
      const shrink = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
      d.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      d.rotation.set(this.life[i] * this.spin[i], this.life[i] * this.spin[i] * 0.7, 0);
      d.scale.setScalar(Math.max(0.0001, this.size[i] * shrink));
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      this.mesh.setColorAt(i, this.tmpColor.setRGB(this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]));
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.mesh.count = 0;
  }
}

/**
 * Voxel particle effects for block interactions: lit, falling block
 * fragments ("debris") and unlit, additive glowing sparks.
 */
export class VoxelParticles {
  constructor(scene, world) {
    this.world = world;
    this.debris = new ParticlePool(scene, new THREE.MeshLambertMaterial({ color: 0xffffff }), 480, {
      gravity: 20,
      collide: true,
    });
    this.debris.mesh.name = 'debris particles';
    this.sparks = new ParticlePool(
      scene,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      320,
      { gravity: 0, collide: false },
    );
    this.sparks.mesh.name = 'spark particles';
    this.sparks.mesh.renderOrder = 2;
    this.palettes = new Map();
    this.color = new THREE.Color();
  }

  palette(blockId) {
    if (!this.palettes.has(blockId)) {
      const hexes = BLOCKS[blockId]?.particle ?? ['#8a8a8a'];
      this.palettes.set(blockId, hexes.map((h) => new THREE.Color(h)));
    }
    return this.palettes.get(blockId);
  }

  pick(blockId, jitter = 0.12) {
    const list = this.palette(blockId);
    const base = list[Math.floor(Math.random() * list.length)];
    const f = 1 - jitter + Math.random() * jitter * 2;
    return this.color.setRGB(base.r * f, base.g * f, base.b * f);
  }

  /** Small chips knocked off the struck face of a block (one tool strike). */
  chips(x, y, z, normal, blockId, count = 7) {
    const [nx, ny, nz] = normal;
    for (let i = 0; i < count; i++) {
      // A point on the struck face, slightly outside it.
      const px = x + 0.5 + (nx !== 0 ? nx * 0.52 : (Math.random() - 0.5) * 0.7);
      const py = y + 0.5 + (ny !== 0 ? ny * 0.52 : (Math.random() - 0.5) * 0.7);
      const pz = z + 0.5 + (nz !== 0 ? nz * 0.52 : (Math.random() - 0.5) * 0.7);
      const speed = 1.6 + Math.random() * 2;
      this.debris.emit(
        px, py, pz,
        nx * speed + (Math.random() - 0.5) * 2.2,
        ny * speed + 1.4 + Math.random() * 1.8,
        nz * speed + (Math.random() - 0.5) * 2.2,
        this.pick(blockId),
        0.45 + Math.random() * 0.35,
        0.05 + Math.random() * 0.06,
      );
    }
    for (let i = 0; i < 3; i++) {
      this.sparks.emit(
        x + 0.5 + nx * 0.55 + (Math.random() - 0.5) * 0.4,
        y + 0.5 + ny * 0.55 + (Math.random() - 0.5) * 0.4,
        z + 0.5 + nz * 0.55 + (Math.random() - 0.5) * 0.4,
        nx * 2.5 + (Math.random() - 0.5) * 3, ny * 2.5 + Math.random() * 2, nz * 2.5 + (Math.random() - 0.5) * 3,
        this.color.setRGB(1, 0.92, 0.7),
        0.16 + Math.random() * 0.1,
        0.025,
      );
    }
  }

  /** The block shatters into a cloud of fragments. */
  shatter(x, y, z, blockId) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (let k = 0; k < n; k++) {
          const fx = (i + 0.5) / n;
          const fy = (j + 0.5) / n;
          const fz = (k + 0.5) / n;
          this.debris.emit(
            x + fx, y + fy, z + fz,
            (fx - 0.5) * 5 + (Math.random() - 0.5) * 1.5,
            (fy - 0.3) * 4 + 1.5 + Math.random() * 2,
            (fz - 0.5) * 5 + (Math.random() - 0.5) * 1.5,
            this.pick(blockId),
            0.7 + Math.random() * 0.6,
            0.1 + Math.random() * 0.09,
          );
        }
      }
    }
    for (let i = 0; i < 10; i++) {
      this.debris.emit(
        x + Math.random(), y + Math.random(), z + Math.random(),
        (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4,
        this.pick(blockId),
        0.5 + Math.random() * 0.4,
        0.05 + Math.random() * 0.04,
      );
    }
  }

  /**
   * Construction sparks: glowing motes that drift in from around the cell and
   * converge on the growing block, tinted with the block's colours.
   */
  construct(x, y, z, blockId, dt, rate = 34) {
    const expected = rate * dt;
    let n = Math.floor(expected);
    if (Math.random() < expected - n) n++;
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.75 + Math.random() * 0.45;
      const ox = Math.sin(phi) * Math.cos(theta) * r;
      const oy = Math.cos(phi) * r;
      const oz = Math.sin(phi) * Math.sin(theta) * r;
      const life = 0.35 + Math.random() * 0.2;
      const base = this.pick(blockId, 0);
      // Brighten towards white so the additive glow reads clearly.
      this.color.setRGB(base.r * 0.6 + 0.4, base.g * 0.6 + 0.4, base.b * 0.6 + 0.4);
      this.sparks.emit(
        x + 0.5 + ox, y + 0.5 + oy, z + 0.5 + oz,
        (-ox / life) * 0.85, (-oy / life) * 0.85, (-oz / life) * 0.85,
        this.color,
        life,
        0.035 + Math.random() * 0.03,
        TAG_CONSTRUCTION,
      );
    }
  }

  /** A puff of dust and sparks when a block finishes construction. */
  settle(x, y, z, blockId) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.debris.emit(
        x + 0.5 + Math.cos(a) * 0.55, y + 0.08, z + 0.5 + Math.sin(a) * 0.55,
        Math.cos(a) * 1.6, 0.8 + Math.random() * 1.2, Math.sin(a) * 1.6,
        this.pick(blockId),
        0.35 + Math.random() * 0.25,
        0.04 + Math.random() * 0.04,
      );
    }
    for (let i = 0; i < 14; i++) {
      this.sparks.emit(
        x + Math.random(), y + Math.random(), z + Math.random(),
        (Math.random() - 0.5) * 2.4, 0.6 + Math.random() * 1.6, (Math.random() - 0.5) * 2.4,
        this.color.setRGB(1, 1, 0.92),
        0.3 + Math.random() * 0.25,
        0.03,
      );
    }
  }

  /** Cached THREE.Color list for a list of hex strings. */
  colorList(hexes) {
    const key = hexes.join();
    if (!this.palettes.has(key)) this.palettes.set(key, hexes.map((h) => new THREE.Color(h)));
    return this.palettes.get(key);
  }

  pickFrom(hexes, jitter = 0.12) {
    const list = this.colorList(hexes);
    const base = list[Math.floor(Math.random() * list.length)];
    const f = 1 - jitter + Math.random() * jitter * 2;
    return this.color.setRGB(base.r * f, base.g * f, base.b * f);
  }

  /** A creature is struck: chunks of its body and a flash of sparks. */
  creatureHit(x, y, z, hexes) {
    for (let i = 0; i < 10; i++) {
      this.debris.emit(
        x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 3.5, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3.5,
        this.pickFrom(hexes),
        0.45 + Math.random() * 0.3,
        0.05 + Math.random() * 0.05,
      );
    }
    for (let i = 0; i < 8; i++) {
      this.sparks.emit(
        x, y, z,
        (Math.random() - 0.5) * 6, (Math.random() - 0.2) * 5, (Math.random() - 0.5) * 6,
        this.color.setRGB(1, 0.85, 0.75),
        0.14 + Math.random() * 0.12,
        0.03,
      );
    }
  }

  /** A defeated creature bursts into a cloud of its own voxels. */
  creatureDeath(x, y, z, hexes, height) {
    const n = height > 1 ? 46 : 30;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.4;
      this.debris.emit(
        x + Math.cos(a) * r, y + (Math.random() - 0.5) * height * 0.8, z + Math.sin(a) * r,
        Math.cos(a) * (1.5 + Math.random() * 3), 2 + Math.random() * 3.5, Math.sin(a) * (1.5 + Math.random() * 3),
        this.pickFrom(hexes),
        0.8 + Math.random() * 0.6,
        0.07 + Math.random() * 0.08,
      );
    }
    for (let i = 0; i < 18; i++) {
      this.sparks.emit(
        x + (Math.random() - 0.5) * 0.5, y + (Math.random() - 0.5) * height * 0.6, z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 3, 1 + Math.random() * 3, (Math.random() - 0.5) * 3,
        this.color.setRGB(1, 1, 0.9),
        0.35 + Math.random() * 0.3,
        0.035,
      );
    }
  }

  /** Puff of earth where something heavy slams the ground. */
  dust(x, y, z, count = 12) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      this.debris.emit(
        x + Math.cos(a) * 0.2, y, z + Math.sin(a) * 0.2,
        Math.cos(a) * (1.8 + Math.random()), 1 + Math.random() * 1.5, Math.sin(a) * (1.8 + Math.random()),
        this.pickFrom(['#7a5434', '#8d6440', '#8a8d90']),
        0.35 + Math.random() * 0.25,
        0.04 + Math.random() * 0.04,
      );
    }
  }

  /** Drops the construction sparks of a cancelled build. */
  clearConstruction() {
    this.sparks.removeTagged(TAG_CONSTRUCTION);
  }

  update(dt) {
    this.debris.update(dt, this.world);
    this.sparks.update(dt, this.world);
  }

  get liveCount() {
    return this.debris.count + this.sparks.count;
  }

  clear() {
    this.debris.clear();
    this.sparks.clear();
  }
}
