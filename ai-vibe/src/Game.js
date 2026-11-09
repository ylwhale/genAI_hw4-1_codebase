import * as THREE from 'three';
import { COMBAT, INTERACTION, PHYSICS, PLAYER } from './config.js';
import { World } from './world/World.js';
import { HOTBAR_BLOCKS } from './world/blocks.js';
import { MATERIAL_KEYS } from './world/mesher.js';
import { createTextureCanvases, createTextures } from './render/textures.js';
import { WorldRenderer } from './render/WorldRenderer.js';
import { Environment } from './render/Environment.js';
import { BlockHighlight } from './render/effects.js';
import { VoxelParticles } from './render/particles.js';
import { CrackOverlay, ConstructionGhost } from './render/actionEffects.js';
import { FirstPersonRig } from './render/FirstPersonRig.js';
import { TOOLS } from './render/tools.js';
import { MobRenderer } from './render/MobRenderer.js';
import { Player } from './player/Player.js';
import { Health } from './player/Health.js';
import { MobManager } from './entities/MobManager.js';
import { PlayerCombat } from './entities/PlayerCombat.js';
import { BlockInteraction } from './interaction/BlockInteraction.js';
import { BlockActions } from './interaction/BlockActions.js';
import { raycastVoxels } from './interaction/raycast.js';
import { Input } from './input/Input.js';
import { UI } from './ui/UI.js';
import { loadEdits, saveEdits, clearSave, getStorage, canWrite } from './persistence/storage.js';

const SPAWN_YAW = 0.95; // look down the meadow towards the trees and a distant islet
const PLAY_CLICK_GRACE_MS = 350;
const RESPAWN_GRACE_MS = 700; // the death screen ignores input this long

const REJECTION_MESSAGES = {
  'inside-player': "You can't place a block inside yourself",
  'out-of-bounds': 'That is beyond the edge of the world',
  unbreakable: "The island's rock base can't be broken",
  'inside-creature': 'A creature is in the way',
};

// Why an action in progress was stopped (only the ones worth telling the player).
const CANCEL_MESSAGES = {
  'inside-player': "Building stopped — you're standing in the way",
  'too-far': 'Too far away — action stopped',
  occupied: 'Building stopped — that space was filled',
  changed: 'Mining stopped — the block changed',
  'inside-creature': 'Building stopped — a creature is in the way',
};

const DEATH_CAUSES = {
  mossling: 'A Mossling got the better of you.',
  stoneguard: 'The Stoneguard flattened you.',
};

/**
 * Top-level orchestration: owns the renderer, scene and subsystems, runs the
 * frame loop, and drives the title -> playing <-> paused state machine.
 * Gameplay input is only honoured in the 'playing' state.
 */
export class Game {
  constructor(root) {
    this.root = root;
    this.state = 'title';
    this.selectedSlot = 0;
    this.lastTime = 0;
    this.accumulator = 0;
    this.elapsed = 0;
    this.forcedPlay = false; // dev/test mode without pointer lock
    this.playStartedAt = -Infinity;
    this.armed = { 0: false, 2: false }; // mouse buttons pressed during play
    this.toolIndex = 0;
    this.strikesShown = 0;
    this.handLight = 1;
    this.lightTimer = 0;
    this.prevYaw = 0;
    this.prevPitch = 0;
    this.airSpeed = 0;
    this.wasOnGround = true;
    this.walkBlend = 0;
    this.hurtRoll = 0; // camera kick when hit
    this.deathT = 0; // seconds since death (camera fall-over)
    this.resumeForced = false;
    this.diedAt = -Infinity;
    this.pauseWhenHidden = true; // (dev tools can switch this off for automated testing)
    this.tmpTarget = {};
    this.tmpEye = new THREE.Vector3();
    this.tmpDir = new THREE.Vector3();
  }

  start() {
    this.createRenderer();
    this.canvases = createTextureCanvases();
    this.textures = createTextures(this.canvases, this.renderer);
    this.materials = MATERIAL_KEYS.map(
      (key) =>
        new THREE.MeshLambertMaterial({
          map: this.textures[key],
          vertexColors: true,
          alphaTest: key === 'leaves' ? 0.5 : 0,
        }),
    );

    this.scene = new THREE.Scene();
    const aspect = window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 9;
    this.camera = new THREE.PerspectiveCamera(72, aspect || 16 / 9, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';

    this.world = new World();
    this.storage = getStorage();
    const restore = this.restoreSave();

    this.worldRenderer = new WorldRenderer(this.scene, this.world, this.materials);
    this.environment = new Environment(this.scene, this.world.size, this.materials);
    this.player = new Player(this.world);
    const spawn = this.world.findSpawnPoint();
    this.player.spawn(spawn, SPAWN_YAW);
    this.health = new Health(COMBAT.PLAYER_MAX_HEALTH);
    this.mobs = new MobManager(this.world);
    this.mobs.spawnAll(spawn);
    this.mobs.on((event) => this.onMobEvent(event));
    this.combat = new PlayerCombat(this.world, this.mobs);
    this.interaction = new BlockInteraction(this.world, this.player);
    // Blocks may never be placed inside a creature.
    this.interaction.isOccupiedByEntity = (x, y, z) => this.mobs.occupiesCell(x, y, z);
    this.actions = new BlockActions(this.world, this.player, this.interaction);
    this.actions.on((event) => this.onActionEvent(event));
    this.highlight = new BlockHighlight(this.scene);
    this.particles = new VoxelParticles(this.scene, this.world);
    this.crack = new CrackOverlay(this.scene);
    this.ghost = new ConstructionGhost(this.scene, this.textures);
    this.mobRenderer = new MobRenderer(this.scene, this.world, this.particles);
    this.rig = new FirstPersonRig();
    this.rig.setAspect(this.camera.aspect);

    this.ui = new UI(this.canvases, {
      onPlay: () => this.requestPlay(),
      onReset: () => this.resetWorld(),
      onRespawn: () => this.respawn(),
    });
    this.ui.setHealth(this.health.current, this.health.max);
    this.ui.setMonsterCount(this.mobs.aliveCount, this.mobs.mobs.length);
    this.ui.setSaveStatus(restore.status);
    if (restore.message) this.ui.setMenuMessage(restore.message);

    this.input = new Input();
    this.bindEvents();
    this.selectSlot(0, false);
    this.selectTool(0, false);
    this.ui.showMenu('title');

    this.worldRenderer.update();
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setAnimationLoop((t) => this.frame(t));

    if (import.meta.env.DEV) window.__voxelGrove = this;
  }

  createRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping; // keeps the sky and grass saturated
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // The sun never moves, so the shadow map only re-renders after edits.
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    // The shadow map only re-renders on demand, so redraw it after the GPU
    // context is lost and restored (driver reset, GPU switch).
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      renderer.shadowMap.needsUpdate = true;
    });
    renderer.domElement.id = 'game-canvas';
    renderer.domElement.tabIndex = -1;
    this.root.prepend(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
  }

  // ------------------------------------------------------------ persistence

  restoreSave() {
    if (!this.storage) {
      return { status: "Browser storage is unavailable — edits won't be saved", message: '' };
    }
    const writable = canWrite(this.storage);
    const saved = loadEdits(this.storage);
    let result = { status: 'Fresh island · seed 42', message: '' };
    if (saved.status === 'corrupt') {
      result.message = 'Saved world data was unreadable, so the original island was loaded instead.';
    } else if (saved.status === 'ok' && saved.edits.length > 0) {
      const applied = this.world.applyEdits(saved.edits);
      const extra = saved.dropped > 0 ? ` (${saved.dropped} invalid entries skipped)` : '';
      result.status = `Restored ${applied} saved block edit${applied === 1 ? '' : 's'}${extra}`;
    }
    if (!writable) result.message = 'Browser storage is full or blocked, so new edits may not be saved.';
    return result;
  }

  persist() {
    if (!this.storage) return;
    const edits = this.world.getEdits();
    if (saveEdits(edits, this.storage)) {
      this.ui.showSaved();
      const n = edits.length;
      this.ui.setSaveStatus(n ? `${n} block edit${n === 1 ? '' : 's'} saved` : 'Fresh island · seed 42');
    } else if (!this.saveWarned) {
      this.saveWarned = true;
      this.ui.toast("Couldn't save — browser storage is full or unavailable", 'warn');
    }
  }

  resetWorld() {
    this.actions.cancel('reset');
    const cleared = !this.storage || clearSave(this.storage);
    this.world.resetToBase();
    this.particles.clear();
    const spawn = this.world.findSpawnPoint();
    this.player.spawn(spawn, SPAWN_YAW);
    // A fresh island also means fresh health and fresh creatures.
    this.restoreCombat(spawn);
    this.interaction.target = null;
    this.ui.setSaveStatus('Fresh island · seed 42');
    this.ui.setMenuMessage(
      cleared
        ? 'The island has been restored to its original state.'
        : "The island was restored, but the old save couldn't be deleted from browser storage.",
    );
  }

  // ----------------------------------------------------------------- combat

  /** Full health, creatures back at their spawn spots, cooldowns cleared. */
  restoreCombat(spawn) {
    this.health.reset();
    this.mobs.spawnAll(spawn);
    this.combat.reset();
    this.hurtRoll = 0;
    this.deathT = 0;
    this.ui.setHealth(this.health.current, this.health.max);
    this.ui.setMonsterCount(this.mobs.aliveCount, this.mobs.mobs.length);
  }

  onMobEvent({ type, mob }) {
    if (type === 'killed') {
      this.ui.toast(`${mob.type.name} defeated!`);
      this.ui.setMonsterCount(this.mobs.aliveCount, this.mobs.mobs.length);
      return;
    }
    if (type !== 'hit' || this.state !== 'playing') return; // no damage outside play
    const lost = this.health.damage(mob.type.damage);
    if (lost <= 0) return;
    this.ui.setHealth(this.health.current, this.health.max, { hurt: true });
    this.rig.hurt();
    // Knock the player back away from the attacker and kick the camera.
    const p = this.player;
    const dx = p.position.x - mob.position.x;
    const dz = p.position.z - mob.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const push = mob.type.id === 'stoneguard' ? 6 : 4;
    p.velocity.x += (dx / d) * push;
    p.velocity.z += (dz / d) * push;
    if (p.onGround) p.velocity.y = Math.max(p.velocity.y, 4);
    const side = Math.sign((dx / d) * Math.cos(p.yaw) - (dz / d) * Math.sin(p.yaw)) || 1;
    this.hurtRoll = 0.09 * side;
    if (this.health.dead) this.die(DEATH_CAUSES[mob.type.id] ?? 'You were defeated.');
  }

  /** Player death: freeze gameplay, release the mouse, show the death screen. */
  die(cause) {
    if (this.state === 'dead') return;
    this.resumeForced = this.forcedPlay;
    this.state = 'dead';
    this.diedAt = performance.now();
    this.forcedPlay = false;
    this.actions.cancel('died');
    this.input.reset();
    this.armed[0] = this.armed[2] = false;
    this.interaction.target = null;
    this.rig.reset();
    this.deathT = 0;
    this.ui.setHostileTarget(false);
    this.ui.setAttackCooldown(null);
    this.ui.showDeath(cause);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * Respawn button: full health, safe spawn point, creatures reset. The world
   * (and its saved edits) is left untouched. Play resumes once the mouse is
   * captured again; if the browser refuses, the pause menu offers Resume.
   */
  respawn() {
    if (this.state !== 'dead') return;
    // Ignore clicks that were really part of the fight (the cursor reappears
    // over the button the moment the mouse is released).
    if (performance.now() - this.diedAt < RESPAWN_GRACE_MS) return;
    const spawn = this.world.findSpawnPoint();
    this.player.spawn(spawn, SPAWN_YAW);
    this.restoreCombat(spawn);
    this.particles.clear();
    this.ui.hideDeath();
    this.state = 'paused';
    this.ui.showMenu('paused');
    if (this.resumeForced) {
      this.enterPlay(true);
      return;
    }
    this.requestPlay();
  }

  // ----------------------------------------------------------------- states

  requestPlay() {
    this.ui.setMenuMessage('');
    const canvas = this.canvas;
    if (!canvas.requestPointerLock) {
      this.ui.setMenuMessage('This browser does not support mouse capture (Pointer Lock).');
      return;
    }
    try {
      const result = canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch((error) => this.onPointerLockError(error));
    } catch (error) {
      this.onPointerLockError(error);
    }
  }

  onPointerLockError(error) {
    if (this.state === 'playing') return;
    // Embedded views (iframes/webviews without permission) can never lock the
    // pointer; a normal tab only refuses briefly right after Esc is pressed.
    const blocked = error && (error.name === 'WrongDocumentError' || error.name === 'NotSupportedError');
    this.ui.setMenuMessage(
      blocked
        ? 'This page cannot capture the mouse here. Open Voxel Grove in a regular Chrome or Edge tab to play.'
        : "The browser didn't capture the mouse. Wait a moment and click " +
            (this.state === 'paused' ? 'Resume' : 'Play') + ' again.',
    );
  }

  enterPlay(forced = false) {
    this.forcedPlay = forced;
    this.state = 'playing';
    this.playStartedAt = performance.now();
    this.input.reset();
    this.armed[0] = this.armed[2] = false;
    this.rig.reset();
    this.ui.hideMenu();
    this.player.syncPrevious();
    this.accumulator = 0;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.forcedPlay = false;
    this.actions.cancel('paused'); // interrupted gameplay never edits the world
    this.input.reset();
    this.armed[0] = this.armed[2] = false;
    this.interaction.target = null;
    this.rig.reset();
    this.ui.showMenu('paused');
  }

  /** Dev/test helper: enter play mode without pointer lock. */
  debugPlay() {
    this.enterPlay(true);
  }

  // ----------------------------------------------------------------- events

  bindEvents() {
    // Never simulate (or take damage) in a background tab.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && this.pauseWhenHidden) this.pause();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.canvas) this.enterPlay(false);
      else if (this.state === 'playing' && !this.forcedPlay) this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      // The promise rejection (if any) carries a more specific error; this
      // event covers browsers that only report failures this way.
      if (!this.ui.el.menuMessage.textContent) this.onPointerLockError();
    });

    // No browser context menu anywhere in the game (right click places blocks).
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    this.input.on('keydown', (e) => {
      // Keys still held from the fight (e.g. Space auto-repeat) must not
      // activate the death screen's Respawn button.
      if (this.state === 'dead' && (e.repeat || performance.now() - this.diedAt < RESPAWN_GRACE_MS)) {
        e.preventDefault();
        return;
      }
      if (this.state !== 'playing') return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
      if (digit) this.selectSlot(Number(digit[1]) - 1);
      if (e.code === 'KeyQ' && !e.repeat) this.selectTool((this.toolIndex + 1) % TOOLS.length);
      if (e.code === 'Escape' && this.forcedPlay) this.pause();
    });

    this.input.on('mousedown', (e) => {
      if (this.state !== 'playing') return;
      e.preventDefault();
      // Ignore the rest of the click (or double-click) that pressed Play/Resume.
      if (performance.now() - this.playStartedAt < PLAY_CLICK_GRACE_MS) return;
      if (e.button === 0 || e.button === 2) {
        this.armed[e.button] = true;
        this.tryStartAction(e.button, false);
      }
    });
    this.input.on('mouseup', (e) => {
      if (e.button in this.armed) this.armed[e.button] = false;
    });
    this.input.on('wheel', (e) => {
      if (this.state !== 'playing') return;
      e.preventDefault();
      if (e.deltaY === 0) return;
      const n = HOTBAR_BLOCKS.length;
      this.selectSlot((this.selectedSlot + (e.deltaY > 0 ? 1 : -1) + n) % n);
    });

    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // A minimised or collapsed window can report 0 x 0; keep the last good
    // size rather than producing NaN projection matrices.
    if (!(w > 0 && h > 0)) return;
    // Zoom or moving to another display changes the device pixel ratio.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.rig.setAspect(w / h);
  }

  selectSlot(index, announce = true) {
    if (!(index >= 0 && index < HOTBAR_BLOCKS.length)) return;
    this.selectedSlot = index;
    this.ui.selectSlot(index, announce);
  }

  /** Tools are cosmetic: they change the held model, never the interaction. */
  selectTool(index, announce = true) {
    if (!(index >= 0 && index < TOOLS.length)) return;
    this.toolIndex = index;
    this.rig.setTool(TOOLS[index].id, announce);
    this.ui.setTool(index, announce);
  }

  get activeTool() {
    return TOOLS[this.toolIndex];
  }

  get selectedBlock() {
    return HOTBAR_BLOCKS[this.selectedSlot];
  }

  // ------------------------------------------------------------ interaction

  /** Refreshes the crosshair target from the current camera. */
  aim() {
    this.camera.getWorldDirection(this.tmpDir);
    return this.interaction.updateTarget(this.camera.position, this.tmpDir);
  }

  /**
   * Starts mining (button 0) or building (button 2) on the block under the
   * crosshair. Returns true if an action started. `silent` suppresses the
   * rejection toast (used when a held button tries to continue).
   */
  tryStartAction(button, silent) {
    if (this.state !== 'playing') return false;
    // Left click on a creature in reach is a melee attack instead of mining.
    if (button === 0) {
      this.camera.getWorldDirection(this.tmpDir);
      const foe = this.combat.findTarget(this.camera.position, this.tmpDir);
      if (foe) {
        // This press now belongs to combat: it will never fall back to
        // mining (e.g. the block behind a creature that just died).
        if (this.armed[0]) this.armed[0] = 'combat';
        return this.attack(foe);
      }
      if (this.armed[0] === 'combat') return false;
    }
    if (this.actions.busy) return false;
    const target = this.aim();
    const result =
      button === 0 ? this.actions.startBreak(target) : this.actions.startPlace(target, this.selectedBlock);
    if (!result.ok && !silent && REJECTION_MESSAGES[result.reason]) {
      this.ui.toast(REJECTION_MESSAGES[result.reason], 'warn');
    }
    return result.ok;
  }

  /** Melee strike (respecting the cooldown). Returns true if it landed. */
  attack(foe) {
    const origin = this.camera.position;
    const result = this.combat.attack(origin, this.tmpDir, this.elapsed);
    if (!result.ok) return false; // on cooldown: a click on a creature never mines behind it
    // A swing interrupts any mining/building in progress (cleanly, no world change).
    if (this.actions.busy) this.actions.cancel('attack');
    this.rig.attack();
    const d = this.tmpDir;
    this.mobRenderer.hitEffect(result.mob, {
      x: origin.x + d.x * foe.distance,
      y: origin.y + d.y * foe.distance,
      z: origin.z + d.z * foe.distance,
    });
    return true;
  }

  onActionEvent({ type, action: a, reason }) {
    if (type === 'start') {
      this.strikesShown = 0;
      if (a.kind === 'break') this.crack.show(a.x, a.y, a.z);
      else this.ghost.show(a.x, a.y, a.z, a.id, a.normal);
      return;
    }
    // complete or cancel: every effect tied to the action is removed.
    this.crack.hide();
    this.ghost.hide();
    this.ui.setActionProgress(null);
    if (type === 'complete') {
      if (a.kind === 'break') this.particles.shatter(a.x, a.y, a.z, a.id);
      else this.particles.settle(a.x, a.y, a.z, a.id);
      this.persist();
      return;
    }
    // Cancelled: sparks still converging on the abandoned cell would look
    // like construction carrying on, so they go too. (Chips that were already
    // knocked off a block are real debris and simply finish falling.)
    this.particles.clearConstruction();
    if (CANCEL_MESSAGES[reason]) {
      this.ui.toast(CANCEL_MESSAGES[reason], 'warn');
    }
  }

  /** Drives the crack overlay, ghost, particles and progress ring from the action timeline. */
  updateActionEffects(dt) {
    const a = this.actions.active;
    if (a) {
      const p = a.elapsed / a.duration;
      this.ui.setActionProgress(a.kind, p);
      if (a.kind === 'break') {
        this.crack.setProgress(p);
        // A strike lands every duration / STRIKES; the final one breaks the block.
        const strikes = Math.floor(p * INTERACTION.BREAK_STRIKES + 1e-6);
        while (this.strikesShown < Math.min(strikes, INTERACTION.BREAK_STRIKES - 1)) {
          this.strikesShown++;
          this.particles.chips(a.x, a.y, a.z, a.normal, a.id);
          this.crack.strike();
        }
      } else {
        this.ghost.setProgress(p);
        this.particles.construct(a.x, a.y, a.z, a.id, dt);
      }
    }
    this.crack.update(dt);
    this.ghost.update(dt);
  }

  // ------------------------------------------------------------------ frame

  frame(timeMs) {
    const now = timeMs / 1000;
    let dt = this.lastTime ? now - this.lastTime : 0;
    this.lastTime = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, PHYSICS.MAX_FRAME_TIME);
    this.elapsed += dt;

    const playing = this.state === 'playing';
    let alpha = 1;

    if (playing) {
      const mouse = this.input.consumeMouse();
      if (mouse.x || mouse.y) this.player.look(mouse.x, mouse.y);

      const k = this.input;
      const moveInput = {
        forward: (k.isDown('KeyW') ? 1 : 0) - (k.isDown('KeyS') ? 1 : 0),
        strafe: (k.isDown('KeyD') ? 1 : 0) - (k.isDown('KeyA') ? 1 : 0),
        jump: k.isDown('Space'),
      };
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= PHYSICS.STEP && steps < 20) {
        this.player.syncPrevious();
        this.player.step(PHYSICS.STEP, moveInput);
        // Creatures share the fixed step; they can only target a living, playing player.
        this.mobs.update(PHYSICS.STEP, MobManager.playerTarget(this.player, this.tmpTarget));
        this.mobs.separatePlayer(this.player); // collision-safe push-out
        this.accumulator -= PHYSICS.STEP;
        steps++;
        if (this.state !== 'playing') break; // died during this step
      }
      alpha = this.state === 'playing' ? this.accumulator / PHYSICS.STEP : 1;
    } else {
      this.input.consumeMouse();
    }

    this.updateCamera(dt, alpha);

    if (this.state === 'playing') {
      // A held left button attacks a creature that comes into reach, even
      // while mining (the swing cancels the mining cleanly).
      if (this.actions.busy && this.armed[0] && this.input.buttons.has(0)) {
        this.camera.getWorldDirection(this.tmpDir);
        const foe = this.combat.findTarget(this.camera.position, this.tmpDir);
        if (foe && this.combat.ready(this.elapsed)) {
          this.armed[0] = 'combat';
          this.attack(foe);
        }
      }
      // Holding a button keeps mining / building, one block at a time.
      if (!this.actions.busy) {
        for (const button of [0, 2]) {
          if (this.armed[button] && this.input.buttons.has(button) && this.tryStartAction(button, true)) break;
        }
      }
      this.actions.update(dt, this.camera.position);
      this.updateActionEffects(dt);
      this.aim();
      const a = this.actions.active;
      const foe = this.combat.findTarget(this.camera.position, this.tmpDir);
      this.ui.setHostileTarget(!!foe);
      this.ui.setAttackCooldown(this.combat.lastAttack > -Infinity ? this.combat.cooldownProgress(this.elapsed) : null);
      // While mining, the outline stays on the block being mined; while
      // building, the construction ghost shows the cell instead; with a
      // creature in the crosshair, no block is outlined.
      const cell = a ? (a.kind === 'break' ? a : null) : foe ? null : this.interaction.target;
      this.highlight.update(cell, this.elapsed);
    } else {
      this.highlight.update(null, this.elapsed);
    }

    this.mobRenderer.update(this.mobs.mobs, alpha, this.elapsed, dt, this.camera);

    this.particles.update(dt);
    this.environment.update(dt, this.camera.position);
    if (this.worldRenderer.update()) this.renderer.shadowMap.needsUpdate = true;

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.updateRig(dt, this.state === 'playing');
  }

  /** Feeds the first-person rig and draws it on top of the world (play only). */
  updateRig(dt, playing) {
    const p = this.player;
    const lookYaw = wrapAngle(this.prevYaw - p.yaw);
    const lookPitch = this.prevPitch - p.pitch;
    this.prevYaw = p.yaw;
    this.prevPitch = p.pitch;
    if (!playing) return; // the hand is hidden (and frozen) while a menu is open

    // Landing dips the hand in proportion to the fall speed.
    if (!p.onGround) this.airSpeed = Math.max(0, -p.velocity.y);
    if (p.onGround && !this.wasOnGround) this.rig.land(this.airSpeed);
    this.wasOnGround = p.onGround;

    // Darken the hand when the sun is blocked (trees, overhangs, tunnels).
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.15;
      const blocked = raycastVoxels(this.world, this.camera.position, this.environment.sunDirection, 64);
      this.handLight = blocked ? 0.45 : 1;
    }

    const speed = Math.hypot(p.velocity.x, p.velocity.z) / PLAYER.WALK_SPEED;
    this.rig.update(dt, {
      action: this.actions.active,
      strikes: INTERACTION.BREAK_STRIKES,
      taps: INTERACTION.PLACE_TAPS,
      walkPhase: p.walkDistance * 1.9,
      walkAmount: this.walkBlend, // smoothed, shared with the camera bob
      lookYaw,
      lookPitch,
      light: this.handLight,
    });
    this.rig.render(this.renderer);
  }

  updateCamera(dt, alpha) {
    const cam = this.camera;
    if (this.state === 'title') {
      // Slow cinematic orbit around the island behind the title screen.
      const t = this.elapsed * 0.045 + 2.2;
      const c = this.world.size / 2;
      cam.position.set(c + Math.cos(t) * 40, 31, c + Math.sin(t) * 40);
      cam.lookAt(c, 9, c);
      return;
    }

    const p = this.player;
    p.getEyePosition(alpha, this.tmpEye);
    this.hurtRoll *= Math.exp(-8 * dt);
    if (this.state === 'dead') {
      // Fall over: the view rolls and sinks towards the ground.
      this.deathT += dt;
      const e = 1 - Math.pow(1 - Math.min(1, this.deathT / 0.8), 3);
      cam.rotation.set(p.pitch * (1 - e) + 0.25 * e, p.yaw, 1.15 * e, 'YXZ');
      cam.position.set(this.tmpEye.x, this.tmpEye.y - 1.25 * e, this.tmpEye.z);
      cam.updateMatrixWorld();
      return;
    }
    // Gentle head bob while walking on the ground.
    const speed = Math.hypot(p.velocity.x, p.velocity.z) / PLAYER.WALK_SPEED;
    const target = p.onGround && this.state === 'playing' ? Math.min(1, speed) : 0;
    this.walkBlend += (target - this.walkBlend) * (1 - Math.exp(-10 * dt));
    const phase = p.walkDistance * 1.9;
    const bobY = Math.sin(phase * 2) * 0.035 * this.walkBlend;
    const bobX = Math.cos(phase) * 0.02 * this.walkBlend;

    cam.rotation.set(p.pitch, p.yaw, this.hurtRoll, 'YXZ');
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    cam.position.set(this.tmpEye.x + cos * bobX, this.tmpEye.y + bobY, this.tmpEye.z - sin * bobX);
    cam.updateMatrixWorld();
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
