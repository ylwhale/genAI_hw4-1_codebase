import * as THREE from 'three';
import { buildVoxelModel } from './voxelModel.js';
import { TOOLS, buildToolGeometry } from './tools.js';
import { mulberry32 } from '../utils/random.js';

// --------------------------------------------------------------- tuning

const ARM_VOXEL = 0.036; // the forearm is 4 x 4 x 12 voxels
const TOOL_VOXEL = 0.034; // tools are 16 x 16 x 2 voxels...
const TOOL_SCALE = 0.58; // ...shown at this scale (about 0.32 units long)
const GRIP = { x: -0.4, y: 0.32, z: Math.PI / 4 + 0.1 };
const BASE_FOV = 55; // vertical FOV of the hand camera at 4:3 and wider

/** Where the elbow sits in view space and how the forearm points. */
const REST = {
  position: new THREE.Vector3(0.42, -0.38, -0.26),
  rotation: new THREE.Euler(0.36, 0.34, 0.05, 'YXZ'),
};

// Poses are additive offsets applied on top of REST (radians / view units).
const pose = (px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) => ({ px, py, pz, rx, ry, rz });
const ZERO = pose();
const MINE_RAISED = pose(0.02, 0.05, 0.05, 0.5, -0.06, -0.12);
const MINE_IMPACT = pose(-0.05, -0.03, -0.1, -0.62, 0.22, 0.12);
// Building: the tool rolls outwards (out of the way of the new block) and
// the hand reaches forward with lighter, quicker taps than mining.
const BUILD_BASE = pose(0.03, -0.01, -0.01, -0.08, -0.1, -0.34);
const BUILD_LIFT = pose(0.0, 0.04, 0.02, 0.22, 0.0, 0.0);
const BUILD_TAP = pose(-0.03, -0.02, -0.08, -0.26, 0.1, 0.02);

// Melee attack: a single fast, wide swing.
const ATTACK_SWING = 0.3; // seconds
const SWING_RAISED = pose(0.04, 0.07, 0.06, 0.6, -0.12, -0.18);
const SWING_HIT = pose(-0.09, -0.05, -0.14, -0.8, 0.34, 0.22);

const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const easeInCubic = (t) => t * t * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function mix(a, b, t, out) {
  out.px = a.px + (b.px - a.px) * t;
  out.py = a.py + (b.py - a.py) * t;
  out.pz = a.pz + (b.pz - a.pz) * t;
  out.rx = a.rx + (b.rx - a.rx) * t;
  out.ry = a.ry + (b.ry - a.ry) * t;
  out.rz = a.rz + (b.rz - a.rz) * t;
  return out;
}

/**
 * A cycle of `count` repeated motions spread over `duration`: each cycle goes
 * start -> raised (wind-up) -> impact (strike). The first cycle starts from
 * `first`; later ones from the previous impact. Returns the pose at `elapsed`.
 */
function cyclePose(elapsed, duration, count, first, raised, impact, windup, out) {
  const cycles = Math.min(count - 1e-6, (elapsed / duration) * count);
  const index = Math.floor(cycles);
  const phase = cycles - index;
  const start = index === 0 ? first : impact;
  if (phase < windup) return mix(start, raised, easeOutQuad(phase / windup), out);
  return mix(raised, impact, easeInCubic((phase - windup) / (1 - windup)), out);
}

// ---------------------------------------------------------------- models

function buildArmGeometry() {
  const rand = mulberry32(31);
  const skin = ['#e3ae86', '#dca37a', '#e8b993'];
  const knuckle = '#c98f66';
  const sleeve = ['#2f86a8', '#2b7c9c', '#3592b5'];
  const cuff = '#e9e2cf';
  const colors = [];
  for (let z = 0; z < 12; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        let c;
        if (z < 4) {
          // The fist: knuckles along the front top edge, fingers wrapped below.
          c = skin[Math.floor(rand() * skin.length)];
          if (z === 0 && y >= 2) c = knuckle;
          if (z <= 1 && y === 0) c = knuckle;
        } else if (z === 4) {
          c = cuff;
        } else {
          c = sleeve[Math.floor(rand() * sleeve.length)];
          if ((z === 7 || z === 10) && rand() < 0.7) c = '#256c88';
        }
        colors.push(c);
      }
    }
  }
  // Grid origin at the elbow (back face, centred) so rotations pivot there.
  return buildVoxelModel(4, 4, 12, (x, y, z) => colors[x + y * 4 + z * 16], ARM_VOXEL, { x: 2, y: 2, z: 12 });
}

/**
 * The first-person arm and held tool, rendered in their own scene with
 * their own camera on top of the world (so they never clip into blocks).
 */
export class FirstPersonRig {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xdceaff, 0x5e4c37, 1.5);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
    this.sun.position.set(0.5, 1, 0.45);
    this.scene.add(this.hemi, this.sun);

    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.root = new THREE.Group();
    this.motion = new THREE.Group();
    this.root.add(this.motion);
    this.scene.add(this.root);

    this.arm = new THREE.Mesh(buildArmGeometry(), material);
    this.arm.name = 'arm';
    this.motion.add(this.arm);

    // The fist's centre, where the handle passes through.
    this.grip = new THREE.Group();
    this.grip.position.set(0, 0.004, -10 * ARM_VOXEL);
    this.motion.add(this.grip);

    this.tools = new Map();
    for (const tool of TOOLS) {
      const mesh = new THREE.Mesh(buildToolGeometry(tool.id, TOOL_VOXEL), material);
      mesh.name = tool.id;
      // The sprite's handle runs along +X+Y: stand it upright (+45° about Z),
      // then lean the head forward and turn it slightly, like a relaxed grip.
      mesh.rotation.set(GRIP.x + tool.grip.x, GRIP.y + tool.grip.y, GRIP.z + tool.grip.z, 'XYZ');
      mesh.scale.setScalar(TOOL_SCALE);
      mesh.visible = false;
      this.grip.add(mesh);
      this.tools.set(tool.id, mesh);
    }

    this.rest = REST;
    this.current = pose();
    this.target = pose();
    this.toolId = null;
    this.pendingTool = null;
    this.switchT = 1;
    this.lag = { yaw: 0, pitch: 0 };
    this.landKick = 0;
    this.landTarget = 0;
    this.attackT = Infinity;
    this.hurtKick = 0;
    this.light = 1;
    this.time = 0;
    this.setTool(TOOLS[0].id, false);
  }

  /**
   * Narrow or portrait windows would push the hand off the right edge, so
   * below 4:3 the vertical FOV widens to keep the horizontal FOV constant.
   */
  setAspect(aspect) {
    if (!(aspect > 0 && Number.isFinite(aspect))) return;
    const minAspect = 4 / 3;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));
    this.camera.fov = aspect >= minAspect
      ? BASE_FOV
      : THREE.MathUtils.radToDeg(2 * Math.atan((tanHalf * minAspect) / aspect));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Switches the held tool; with `animate` the hand dips out and back in. */
  setTool(id, animate = true) {
    if (!this.tools.has(id)) return;
    if (!animate || this.toolId === null) {
      this.showTool(id);
      this.pendingTool = null;
      this.switchT = 1;
      return;
    }
    this.pendingTool = id;
    // On the way back up (or idle)? Mirror the progress so the hand heads
    // down again from exactly where it is; the dip curve is symmetric, so
    // there is no jump, and the newest tool is swapped in at the bottom.
    if (this.switchT >= 0.5) this.switchT = 1 - this.switchT;
  }

  showTool(id) {
    for (const [key, mesh] of this.tools) mesh.visible = key === id;
    this.toolId = id;
  }

  /** Called when the player lands; harder landings dip the hand more. */
  land(impactSpeed) {
    this.landTarget = Math.min(0.06, Math.max(this.landTarget, impactSpeed * 0.0045));
  }

  /** Plays the melee swing. */
  attack() {
    this.attackT = 0;
  }

  /** Jolts the hand when the player is hurt. */
  hurt() {
    this.hurtKick = 1;
  }

  /** Clears all motion (used when gameplay pauses or resumes). */
  reset() {
    this.attackT = Infinity;
    this.hurtKick = 0;
    Object.assign(this.current, ZERO);
    this.lag.yaw = this.lag.pitch = 0;
    this.landKick = this.landTarget = 0;
    if (this.pendingTool) this.showTool(this.pendingTool);
    this.pendingTool = null;
    this.switchT = 1;
  }

  /**
   * @param {number} dt
   * @param {object} s  { action: {kind, elapsed, duration} | null, strikes, taps,
   *                      walkPhase, walkAmount, lookYaw, lookPitch, light }
   */
  update(dt, s) {
    this.time += dt;

    // --- action pose (target), followed with a fast critically-damped blend
    if (s.action && s.action.kind === 'break') {
      cyclePose(s.action.elapsed, s.action.duration, s.strikes, ZERO, MINE_RAISED, MINE_IMPACT, 0.55, this.target);
    } else if (s.action && s.action.kind === 'place') {
      cyclePose(s.action.elapsed, s.action.duration, s.taps, ZERO, BUILD_LIFT, BUILD_TAP, 0.5, this.target);
      const w = Math.min(1, s.action.elapsed / 0.12);
      this.target.px += BUILD_BASE.px * w;
      this.target.py += BUILD_BASE.py * w;
      this.target.pz += BUILD_BASE.pz * w;
      this.target.rx += BUILD_BASE.rx * w;
      this.target.ry += BUILD_BASE.ry * w;
      this.target.rz += BUILD_BASE.rz * w;
    } else if (this.attackT < ATTACK_SWING) {
      const t = this.attackT / ATTACK_SWING;
      if (t < 0.35) mix(ZERO, SWING_RAISED, easeOutQuad(t / 0.35), this.target);
      else if (t < 0.6) mix(SWING_RAISED, SWING_HIT, easeInCubic((t - 0.35) / 0.25), this.target);
      else mix(SWING_HIT, ZERO, easeInOut((t - 0.6) / 0.4), this.target);
    } else {
      Object.assign(this.target, ZERO);
    }
    this.attackT += dt;
    const fast = s.action || this.attackT < ATTACK_SWING + 0.1;
    const follow = 1 - Math.exp(-(fast ? 32 : 11) * dt);
    mix(this.current, this.target, follow, this.current);

    // --- tool switch: dip down, swap at the bottom, come back up
    let dip = 0;
    if (this.switchT < 1) {
      const before = this.switchT;
      this.switchT = Math.min(1, this.switchT + dt / 0.36);
      if (before < 0.5 && this.switchT >= 0.5 && this.pendingTool) {
        this.showTool(this.pendingTool);
        this.pendingTool = null;
      }
      dip = Math.sin(Math.PI * easeInOut(this.switchT));
    }

    // --- secondary motion: look lag, idle breathing, walk bob, landing
    const decay = Math.exp(-11 * dt);
    this.lag.yaw = THREE.MathUtils.clamp(this.lag.yaw * decay + (s.lookYaw || 0) * 0.55, -0.14, 0.14);
    this.lag.pitch = THREE.MathUtils.clamp(this.lag.pitch * decay + (s.lookPitch || 0) * 0.55, -0.1, 0.1);
    // The landing dip eases in quickly and recovers more slowly (no snapping).
    this.landTarget *= Math.exp(-7 * dt);
    this.landKick += (this.landTarget - this.landKick) * (1 - Math.exp(-26 * dt));
    this.hurtKick *= Math.exp(-6 * dt);
    const idle = Math.sin(this.time * 1.7);
    const walk = s.walkAmount || 0;
    const ph = s.walkPhase || 0;

    const c = this.current;
    this.motion.position.set(
      c.px + Math.cos(ph) * 0.022 * walk - this.lag.yaw * 0.12,
      c.py + idle * 0.004 - Math.abs(Math.sin(ph)) * 0.03 * walk - dip * 0.36 - this.landKick + this.lag.pitch * 0.06 - this.hurtKick * 0.035,
      c.pz,
    );
    this.motion.rotation.set(
      c.rx + Math.sin(this.time * 1.25) * 0.008 - dip * 0.5 + this.lag.pitch,
      c.ry + this.lag.yaw,
      c.rz + Math.cos(ph) * 0.03 * walk + Math.sin(this.time * 0.9) * 0.01 + this.hurtKick * 0.12,
      'YXZ',
    );
    this.root.position.copy(this.rest.position);
    this.root.rotation.copy(this.rest.rotation);

    // Match the world's lighting (darker under trees and overhangs).
    this.light += ((s.light ?? 1) - this.light) * (1 - Math.exp(-5 * dt));
    this.hemi.intensity = 1.5 * (0.55 + 0.45 * this.light);
    this.sun.intensity = 2.1 * this.light;
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
