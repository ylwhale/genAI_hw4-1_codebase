import * as THREE from 'three';
import './style.css';
import { VoxelWorld } from './world.js';
import { createWorldMesh, createWorldGeometry } from './world-mesh.js';
import { createPlayer, stepPlayer, STEP, EYE_HEIGHT, findSafeSpawn } from './physics.js';
import { createControls } from './controls.js';
import { targetBlock } from './interactions.js';
import { createUI } from './ui.js';
import { loadWorldEdits, saveWorldEdits, resetWorld } from './storage.js';
import { createBlockAtlas } from './textures.js';
import { addAtmosphere } from './atmosphere.js';
import { createFirstPersonView } from './first-person.js';
import { createInteractionController, INTERACTION_DURATION } from './interaction-controller.js';
import { createInteractionEffects } from './interaction-effects.js';
import { createEnemies, updateEnemies, enemyOccupiesBlock } from './mobs.js';
import { createMobView } from './mob-view.js';
import { createHealth, damagePlayer } from './health.js';
import { createCombat } from './combat.js';
import { respawnPlayer } from './respawn.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#bcd8dd');
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.setAttribute('aria-label', 'Voxel Grove 3D world');
document.querySelector('#app').append(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdceee6, 0x6c7250, 2));
const sunlight = new THREE.DirectionalLight(0xffe5b5, 3.2);
sunlight.position.set(-18, 48, 38);
sunlight.target.position.set(16, 0, 16);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
Object.assign(sunlight.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 100 });
sunlight.shadow.bias = -0.00015;
sunlight.shadow.normalBias = 0.035;
scene.add(sunlight);
scene.add(sunlight.target);

const world = new VoxelWorld();
let storage;
try { storage = window.localStorage; } catch { /* Private browsing may deny even the storage getter. */ }
const saved = loadWorldEdits(world, storage);
const blockAtlas = createBlockAtlas();
const worldMesh = createWorldMesh(world, blockAtlas);
scene.add(worldMesh);
const atmosphere = addAtmosphere(scene, world);
const player = createPlayer(findSafeSpawn(world));
const health = createHealth();
let damageFlash = 0;
const enemies = createEnemies(world, player);
const mobView = createMobView(scene, enemies);
const combat = createCombat({ world, worldMesh, enemies, mobView });
const firstPerson = createFirstPersonView(camera);
const effects = createInteractionEffects(scene, { atlas: blockAtlas });
let interaction;
let selected = 1;
let hasStarted = false;
let ui;
const controls = createControls(renderer.domElement, player, playing => {
  if (!playing) interaction?.cancel('Paused');
  ui.setPlaying(playing);
  firstPerson.setPlaying(playing && !health.dead);
  if (playing) { hasStarted = true; ui.setStarted(); }
}, () => {
  if (!gameplayActive()) return;
  interaction?.cancel('Tool changed');
  ui.tool(firstPerson.cycleTool());
});
ui = createUI({
  async onPlay() {
    if (health.dead) return;
    ui.message('Click Play to capture the mouse. Escape returns here.');
    try { await renderer.domElement.requestPointerLock(); }
    catch { ui.message('Mouse capture is unavailable in this browser. Open the local game in desktop Chrome or Edge.'); }
  },
  onReset() {
    if (controls.locked()) return;
    interaction.cancel('World reset');
    const result = resetWorld(world, storage);
    rebuildWorld();
    respawnPlayer(world, player, health, enemies);
    combat.reset(); damageFlash = 0; ui.health(health); ui.damageFlash(0);
    controls.clear();
    ui.message(result.ok ? 'A fresh grove. The original seed 42 world is restored.' : 'World restored for this session. Browser storage is unavailable.');
    ui.saveStatus(result.ok ? 'Saved locally' : 'Session only · saving unavailable');
  },
  async onRespawn() {
    if (!health.dead) return;
    interaction.cancel('Respawn'); firstPerson.cancelSwing(); effects.clear();
    respawnPlayer(world, player, health, enemies);
    combat.reset(); controls.clear(); damageFlash = 0;
    ui.health(health); ui.damageFlash(0); ui.setDead(false);
    syncPlayerCamera();
    // Keep the click's user activation for pointer capture. If unavailable, Resume remains usable.
    try { await renderer.domElement.requestPointerLock(); }
    catch { ui.message('Respawned safely. Click Resume to capture the mouse.'); }
  },
});
ui.enableReset();
ui.health(health);
ui.saveStatus(saved.status === 'unavailable' ? 'Session only · saving unavailable' : 'Saved locally');
if (saved.status === 'restored' && saved.count) ui.message('Welcome back. Your changes are right where you left them.');
if (saved.status === 'corrupt') ui.message('The saved world could not be read. A fresh grove is ready.');
if (saved.status === 'unavailable') ui.message('Browser storage is unavailable. You can play, but changes will last only this session.');
document.addEventListener('pointerlockerror', () => ui.message('Mouse capture was blocked. Try Play again, or open the game in desktop Chrome or Edge.'));
function gameplayActive() { return controls.locked() && !document.hidden && !health.dead; }
function receiveDamage(amount) {
  const result = damagePlayer(health, amount, gameplayActive());
  if (result.amount) {
    damageFlash = 0.35; ui.health(health); ui.notify(`−${result.amount} HP`);
    if (result.killed) {
      interaction.cancel('Player died'); firstPerson.cancelSwing(); effects.clear();
      controls.clear(); combat.reset(); player.velocityY = 0;
      firstPerson.setPlaying(false); ui.setDead(true);
      if (controls.locked()) document.exitPointerLock();
    }
  }
  return !health.dead;
}
function finishEdit() {
  firstPerson.cancelSwing(); effects.clear(); ui.interaction(null);
  rebuildWorld();
  const save = saveWorldEdits(world, storage);
  ui.saveStatus(save.ok ? 'Saved locally' : 'Session only · saving unavailable');
  if (!save.ok) ui.notify('Browser storage unavailable. Your changes are kept for this session.');
}
interaction = createInteractionController({
  world, player,
  canPlace: cell => !enemyOccupiesBlock(enemies, cell),
  onStart(operation) {
    firstPerson.beginSwing(operation.action, INTERACTION_DURATION);
    effects.begin(operation); ui.interaction(operation);
  },
  onProgress(operation) { ui.interaction(operation); },
  onCancel() { firstPerson.cancelSwing(); effects.clear(); ui.interaction(null); },
  onComplete: finishEdit,
});
window.addEventListener('blur', () => interaction.cancel('Focus lost'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    interaction.cancel('Tab hidden');
    controls.clear();
    if (controls.locked()) document.exitPointerLock();
  }
});

const lookDirection = new THREE.Vector3();
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008, 1.008, 1.008)),
  new THREE.LineBasicMaterial({ color: 0xfff4d6 }),
);
outline.visible = false;
scene.add(outline);
function rebuildWorld() {
  const old = worldMesh.geometry;
  worldMesh.geometry = createWorldGeometry(world, true);
  old.dispose();
  renderer.shadowMap.needsUpdate = true;
}
function syncPlayerCamera() {
  camera.position.set(player.x, player.y + EYE_HEIGHT, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld();
}
function currentTarget() {
  camera.getWorldDirection(lookDirection);
  return targetBlock(world, worldMesh, camera.position, lookDirection);
}

document.addEventListener('keydown', event => {
  if (!gameplayActive()) return;
  const number = Number(event.key);
  if (Number.isInteger(number) && number >= 1 && number <= 5) {
    selected = number;
    ui.select(selected);
  }
});
renderer.domElement.addEventListener('mousedown', event => {
  if (!gameplayActive() || (event.button !== 0 && event.button !== 2)) return;
  event.preventDefault();
  if (interaction.active || firstPerson.swinging) return;
  syncPlayerCamera();
  camera.getWorldDirection(lookDirection);
  if (event.button === 0) {
    const focus = combat.target(camera.position, lookDirection);
    if (focus.kind === 'enemy') {
      const hit = combat.attack(camera.position, lookDirection, gameplayActive());
      if (hit.ok) {
        firstPerson.beginSwing('attack', 0.32);
        ui.notify(hit.killed ? `${hit.enemy.name} defeated` : `${hit.enemy.name} −${hit.damage} HP`);
      } else ui.notify(hit.reason);
      return;
    }
    if (focus.kind === 'out-of-reach') { ui.notify('Move closer to attack'); return; }
  }
  const result = interaction.start(currentTarget(), event.button === 0 ? 'remove' : 'place', selected);
  if (!result.ok) ui.notify(result.reason);
});
renderer.domElement.addEventListener('contextmenu', event => { if (controls.locked()) event.preventDefault(); });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let previousTime = performance.now();
let accumulator = 0;
let moving = false;
renderer.setAnimationLoop(time => {
  const frameSeconds = Math.max(0, (time - previousTime) / 1000);
  const dt = Math.min(frameSeconds, 0.1);
  previousTime = time;
  if (gameplayActive()) {
    accumulator += dt;
    while (accumulator >= STEP && gameplayActive()) {
      const input = controls.read();
      const oldX = player.x, oldZ = player.z;
      stepPlayer(world, player, input);
      combat.update(STEP, gameplayActive());
      updateEnemies(world, enemies, player, STEP, { active: gameplayActive(), onAttack: receiveDamage });
      moving = Math.hypot(player.x - oldX, player.z - oldZ) > 0.00001;
      accumulator -= STEP;
    }
    syncPlayerCamera();
  } else {
    accumulator = 0;
    if (!hasStarted) {
      const orbit = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.sin(time * 0.000035) * 0.15;
      camera.position.set(16 + Math.sin(0.8 + orbit) * 43, 30, 16 + Math.cos(0.8 + orbit) * 43);
      camera.lookAt(14, 6, 15);
    } else syncPlayerCamera();
  }
  const target = gameplayActive() ? currentTarget() : null;
  const focus = gameplayActive() ? combat.target(camera.position, lookDirection, target) : null;
  interaction.update(frameSeconds, focus?.kind === 'block' ? target : null, gameplayActive());
  effects.update(frameSeconds);
  outline.visible = focus?.kind === 'block';
  if (target) outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  if (focus?.enemy) ui.enemyTarget(focus);
  else ui.target(target, target ? world.get(target.x, target.y, target.z) : 0);
  atmosphere.update(time / 1000, dt);
  mobView.update();
  firstPerson.update(frameSeconds, moving && player.grounded);
  damageFlash = Math.max(0, damageFlash - frameSeconds);
  ui.damageFlash(damageFlash / 0.35);
  renderer.render(scene, camera);
  firstPerson.render(renderer);
});
