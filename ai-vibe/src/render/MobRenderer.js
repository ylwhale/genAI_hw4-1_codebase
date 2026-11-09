import * as THREE from 'three';
import { COMBAT } from '../config.js';
import { DEATH_DURATION } from '../entities/Mob.js';
import { buildMobModel } from './mobModels.js';

const FLASH_TIME = 0.22; // seconds of red-white flash after a hit
const BAR_SHOW_TIME = 4; // seconds the health bar stays after a hit

const easeOut = (t) => 1 - (1 - t) * (1 - t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function shadowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Draws and animates the creatures from the simulation state. It never
 * changes gameplay state: it reads mob position/state/timers each frame.
 */
export class MobRenderer {
  constructor(scene, world, particles) {
    this.scene = scene;
    this.world = world;
    this.particles = particles;
    this.visuals = new Map();
    this.shadowTex = shadowTexture();
    this.barGeometry = new THREE.PlaneGeometry(1, 1);
    this.tmp = new THREE.Vector3();
  }

  createVisual(mob) {
    const model = buildMobModel(mob.type.id, mob.seed);
    // Per-creature materials so each can flash independently.
    // A faint base glow keeps creatures readable in shade and against the light.
    const base = mob.type.id === 'stoneguard' ? [0.11, 0.11, 0.12] : [0.05, 0.09, 0.05];
    model.flashMaterials = model.flashMaterials.map((m) => {
      const own = m.clone();
      own.emissive = new THREE.Color(...base);
      return own;
    });
    model.baseEmissive = base;
    model.root.traverse((o) => {
      if (o.isMesh && o.material.isMeshLambertMaterial) {
        o.material = model.flashMaterials[0];
        o.receiveShadow = true;
      }
    });
    model.root.name = `${mob.type.id} ${mob.id}`;
    this.scene.add(model.root);

    const r = mob.type.width * 0.75;
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 2, r * 2),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1;
    this.scene.add(shadow);

    // Billboard health bar.
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(this.barGeometry, new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.75, depthWrite: false }));
    bg.scale.set(0.84, 0.12, 1);
    const fill = new THREE.Mesh(this.barGeometry, new THREE.MeshBasicMaterial({ color: 0x6fdc4a, transparent: true, depthWrite: false }));
    fill.position.z = 0.002;
    bar.add(bg, fill);
    bar.renderOrder = 3;
    bg.renderOrder = 3;
    fill.renderOrder = 4;
    this.scene.add(bar);

    const visual = { model, shadow, bar, fill, barAlpha: 0, wasDead: false, wasAlive: true, struckShown: false, flash: 0 };
    this.visuals.set(mob, visual);
    return visual;
  }

  /** Spray of chips and sparks where a creature was struck. */
  hitEffect(mob, point) {
    const c = mob.type.colors;
    this.particles.creatureHit(point.x, point.y, point.z, c);
  }

  update(mobs, alpha, time, dt, camera) {
    for (const mob of mobs) {
      const v = this.visuals.get(mob) ?? this.createVisual(mob);
      const root = v.model.root;
      const b = mob.body;

      // Respawned (alive again)?
      if (mob.alive && v.wasDead) {
        v.wasDead = false;
        root.visible = true;
        v.shadow.visible = true;
      }
      if (mob.state === 'dead') {
        if (!v.wasDead) {
          // The body bursts into voxel fragments and disappears.
          v.wasDead = true;
          const c = mob.center();
          this.particles.creatureDeath(c.x, c.y, c.z, mob.type.colors, mob.type.height);
        }
        root.visible = false;
        v.shadow.visible = false;
        v.bar.visible = false;
        continue;
      }

      const x = b.prevPosition.x + (b.position.x - b.prevPosition.x) * alpha;
      const y = b.prevPosition.y + (b.position.y - b.prevPosition.y) * alpha;
      const z = b.prevPosition.z + (b.position.z - b.prevPosition.z) * alpha;
      root.position.set(x, y, z);
      root.rotation.set(0, mob.yaw, 0);
      root.scale.setScalar(1);

      const speed = Math.hypot(b.velocity.x, b.velocity.z);
      const move = clamp01(speed / Math.max(0.01, mob.type.speed));
      if (mob.type.id === 'stoneguard') this.animateStoneguard(mob, v.model, move, time);
      else this.animateMossling(mob, v.model, move, time);

      // Dying: tip over, shrink and blink before bursting.
      if (mob.state === 'dying') {
        const t = clamp01(mob.deathT / DEATH_DURATION);
        root.rotation.z = easeOut(t) * (Math.PI / 2) * (mob.id % 2 ? 1 : -1);
        root.scale.setScalar(1 - 0.35 * t);
      }

      // Hit flash (red-white), quick blink while dying.
      let flash = mob.hurtT < FLASH_TIME ? 1 - mob.hurtT / FLASH_TIME : 0;
      if (mob.state === 'dying') flash = Math.max(flash, (Math.sin(mob.deathT * 40) + 1) * 0.35);
      const [br, bg, bb] = v.model.baseEmissive;
      for (const m of v.model.flashMaterials) m.emissive.setRGB(br + flash * 0.9, bg + flash * 0.25, bb + flash * 0.2);

      // Strike effects for the Stoneguard's slam (dust where its fists land).
      if (mob.state === 'attack' && mob.struck && !v.struckShown) {
        v.struckShown = true;
        if (mob.type.id === 'stoneguard') {
          const fx = x + Math.sin(mob.yaw) * 0.75;
          const fz = z + Math.cos(mob.yaw) * 0.75;
          this.particles.dust(fx, y + 0.05, fz, 14);
        }
      }
      if (mob.state !== 'attack') v.struckShown = false;

      this.updateShadow(v, x, y, z);
      this.updateBar(v, mob, x, y, z, dt, camera);
    }
  }

  animateMossling(mob, model, move, time) {
    const { body, eyes, sprout, feet } = model.parts;
    const phase = mob.walkDistance * 10;
    const hop = Math.abs(Math.sin(phase)) * 0.07 * move;
    let sy = 1 + Math.sin(time * 2.4 + mob.id) * 0.025 - Math.cos(phase * 2) * 0.05 * move;
    let lean = 0;
    let lunge = 0;
    if (mob.state === 'attack') {
      const t = mob.attackT;
      const w = COMBAT.ATTACK_WINDUP;
      if (t < w) {
        const k = easeOut(t / w);
        sy = 1 - 0.22 * k; // crouch
        lean = -0.3 * k;
      } else {
        const k = clamp01((t - w) / 0.12);
        const back = clamp01((t - w - 0.12) / (COMBAT.ATTACK_RECOVER - 0.12));
        sy = 0.78 + 0.4 * k - 0.18 * back;
        lean = -0.3 + 0.7 * k - 0.4 * back;
        lunge = 0.28 * k * (1 - back);
      }
    }
    body.position.set(0, hop, lunge);
    body.scale.set(1 + (1 - sy) * 0.5, sy, 1 + (1 - sy) * 0.5);
    body.rotation.x = lean;
    sprout.rotation.z = Math.sin(time * 3 + mob.id) * 0.12 + Math.cos(phase) * 0.15 * move;
    // Blink every few seconds.
    const blink = (time + mob.id * 1.7) % 3.7 < 0.12 ? 0.15 : 1;
    eyes.scale.y = blink;
    feet.forEach((f, i) => {
      const s = Math.sin(phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0));
      f.rotation.x = s * 0.6 * move;
      f.position.y = 0.12 + Math.max(0, s) * 0.04 * move;
    });
  }

  animateStoneguard(mob, model, move, time) {
    const { hips, legs, torso, neck, arms, core } = model.parts;
    const phase = mob.walkDistance * 5.5;
    const swing = Math.sin(phase) * 0.55 * move;
    legs[0].rotation.x = swing;
    legs[1].rotation.x = -swing;
    hips.position.y = 0.5 + Math.abs(Math.cos(phase)) * 0.035 * move;
    let armL = -swing * 0.6;
    let armR = swing * 0.6;
    let lean = Math.sin(time * 1.3 + mob.id) * 0.02;
    if (mob.state === 'attack') {
      // Both arms heave overhead, then slam down in front.
      const t = mob.attackT;
      const w = COMBAT.ATTACK_WINDUP;
      let a;
      if (t < w) {
        const k = easeOut(t / w);
        a = -3.0 * k;
        lean = -0.15 * k;
      } else {
        const k = clamp01((t - w) / 0.09);
        const back = clamp01((t - w - 0.12) / (COMBAT.ATTACK_RECOVER - 0.12));
        a = -3.0 + 2.1 * k + 0.9 * back;
        lean = -0.15 + 0.4 * k - 0.25 * back;
      }
      armL = armR = a;
    }
    arms[0].rotation.x = armL;
    arms[1].rotation.x = armR;
    arms[0].rotation.z = -0.08;
    arms[1].rotation.z = 0.08;
    torso.rotation.x = lean;
    torso.rotation.z = Math.sin(phase) * 0.04 * move;
    neck.rotation.y = mob.state === 'wander' ? Math.sin(time * 0.7 + mob.id) * 0.35 : 0;
    const pulse = 0.75 + Math.sin(time * 3) * 0.25;
    core.material.color.setRGB(1 * pulse + 0.2, 0.7 * pulse, 0.28 * pulse);
  }

  updateShadow(v, x, y, z) {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    let ground = -1;
    for (let gy = Math.floor(y + 0.01) - 1; gy >= Math.floor(y) - 6; gy--) {
      if (this.world.isSolidForCollision(cx, gy, cz)) {
        ground = gy + 1;
        break;
      }
    }
    if (ground < 0 && y >= 0) ground = 0;
    const lift = Math.max(0, y - ground);
    v.shadow.position.set(x, ground + 0.02, z);
    v.shadow.material.opacity = Math.max(0, 1 - lift / 3);
    v.shadow.visible = true;
  }

  updateBar(v, mob, x, y, z, dt, camera) {
    const engaged = mob.state === 'chase' || mob.state === 'attack';
    const show = mob.alive && (mob.hurtT < BAR_SHOW_TIME || engaged || mob.health < mob.type.maxHealth);
    v.barAlpha += ((show ? 1 : 0) - v.barAlpha) * (1 - Math.exp(-8 * dt));
    v.bar.visible = v.barAlpha > 0.02;
    if (!v.bar.visible) return;
    const f = mob.health / mob.type.maxHealth;
    v.bar.position.set(x, y + mob.type.height + 0.32, z);
    v.bar.quaternion.copy(camera.quaternion);
    v.fill.scale.set(Math.max(0.001, 0.78 * f), 0.075, 1);
    v.fill.position.x = -0.39 * (1 - f);
    v.fill.material.color.setHSL(0.33 * f, 0.75, 0.5);
    v.fill.material.opacity = v.barAlpha;
    v.bar.children[0].material.opacity = 0.75 * v.barAlpha;
  }
}
