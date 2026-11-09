import * as THREE from 'three';
import '../src/style.css';
import { VoxelWorld } from '../src/world.js';
import { createWorldMesh, createWorldGeometry } from '../src/world-mesh.js';
import { createBlockAtlas } from '../src/textures.js';
import { createEnemies, updateEnemies, updateEnemyEffects } from '../src/mobs.js';
import { createMobView } from '../src/mob-view.js';
import { collides } from '../src/physics.js';
import { createHealth, damagePlayer } from '../src/health.js';
import { createUI } from '../src/ui.js';
import { createCombat } from '../src/combat.js';
import { createFirstPersonView } from '../src/first-person.js';
import { respawnPlayer } from '../src/respawn.js';
import { saveWorldEdits, loadWorldEdits } from '../src/storage.js';

const panel = document.querySelector('#combat-panel');
const results = document.querySelector('#combat-results');
function check(label, condition) {
  const p = document.createElement('p'); p.className = condition ? 'pass' : 'fail'; p.textContent = `${condition ? 'PASS' : 'FAIL'} · ${label}`; results.append(p);
  if (!condition) throw Error(label);
}
function button(label, action) {
  const element = document.createElement('button'); element.textContent = label; element.addEventListener('click', action); document.querySelector('#combat-buttons').append(element); return element;
}

const world = new VoxelWorld(); world.blocks.fill(0); world.spawn.y = 1;
for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) world.set(x, 0, z, 1);
const enemies = createEnemies(world);
check('Four enemies spawn with valid clear volumes', enemies.length === 4 && enemies.every(enemy => !collides(world, enemy)));
check('Every initial enemy is at least eight horizontal units from spawn', enemies.every(enemy => Math.hypot(enemy.x - world.spawn.x, enemy.z - world.spawn.z) >= 8));
// A display arrangement makes both original models easy to inspect together.
enemies.forEach((enemy, i) => Object.assign(enemy, { x: 10.5 + i * 2, y: 1, z: 12.5, yaw: 0 }));
const scene = new THREE.Scene(); scene.background = new THREE.Color('#bed5cb');
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 200);
camera.position.set(13.5, 3, 18.5); camera.lookAt(13.5, 1.4, 12.5);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
document.querySelector('#app').append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xdceee6, 0x6c7250, 2));
const light = new THREE.DirectionalLight(0xffe5b5, 3.2); light.position.set(-18, 48, 38); scene.add(light);
const worldMesh = createWorldMesh(world, createBlockAtlas()); scene.add(worldMesh);
const view = createMobView(scene, enemies);
const combat = createCombat({ world, worldMesh, enemies, mobView: view });
const hand = createFirstPersonView(camera); hand.setPlaying(true);
const direction = new THREE.Vector3();
const player = { x: 1, y: 1, z: 1 };
let active = false, attacks = 0, simulateEnemies = false, wall = null;
let resourceCheck = null;
const observedDeaths = new Set();
const health = createHealth(); let damageFlash = 0;
let respawnSnapshot = null, respawnSave = null;
const testSaveKey = 'voxel-grove:combat-check:v1';
const ui = createUI({
  onPlay() { if (!health.dead) { active = true; ui.setPlaying(true); hand.setPlaying(true); } }, onReset() {},
  onRespawn() {
    respawnPlayer(world, player, health, enemies); combat.reset(); active = true; simulateEnemies = false;
    ui.health(health); ui.setDead(false); ui.setPlaying(true); hand.setPlaying(true); damageFlash = 0;
    camera.position.set(player.x, player.y + 1.6, player.z); camera.lookAt(player.x, player.y + 1.6, player.z - 1);
    check('Respawn restores 100 HP and all four enemies', health.current === 100 && enemies.length === 4 && enemies.every(e => e.health === e.maxHealth));
    check('Respawn position is clear and enemies are distant', !collides(world, player) && enemies.every(e => !collides(world, e) && Math.hypot(e.x - player.x, e.z - player.z) >= 8));
    if (respawnSnapshot) {
      const restored = new VoxelWorld(); const loaded = loadWorldEdits(restored, localStorage, testSaveKey);
      check('Respawn preserves world bytes and browser save', world.blocks.every((value, i) => value === respawnSnapshot[i]) && localStorage.getItem(testSaveKey) === respawnSave && loaded.status === 'restored' && restored.blocks.every((value, i) => value === respawnSnapshot[i]));
      localStorage.removeItem(testSaveKey); respawnSnapshot = null;
    }
  },
});
ui.setPlaying(true); ui.health(health);
function receiveDamage(amount) {
  const result = damagePlayer(health, amount, active);
  if (result.amount) {
    damageFlash = 0.35; ui.health(health);
    if (result.killed) { active = false; combat.reset(); hand.setPlaying(false); ui.setDead(true); }
  }
  return !health.dead;
}
function aimAt(enemy) { simulateEnemies = false; active = true; camera.position.set(enemy.x, enemy.y + 0.6, enemy.z + 2.4); camera.lookAt(enemy.x, enemy.y + 0.6, enemy.z); }
button('Show Mossling', () => aimAt(enemies[0]));
button('Show Stoneguard', () => aimAt(enemies[3]));
button('Wander preview', () => { Object.assign(player, { x: 1, y: 1, z: 1 }); active = simulateEnemies = true; });
button('Chase preview', () => { Object.assign(player, { x: 13.5, y: 1, z: 18.5 }); active = simulateEnemies = true; });
button('Attack preview', () => { Object.assign(player, { x: enemies[0].x, y: enemies[0].y, z: enemies[0].z + 1 }); active = simulateEnemies = true; });
button('Pause simulation', () => { active = false; });
button('Check four-enemy resources', () => {
  active = simulateEnemies = true; Object.assign(player, { x: 1, y: 1, z: 1 });
  resourceCheck = { start: performance.now(), frames: 0, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
});
button('Take Mossling hit', () => {
  active = true; const before = health.current; receiveDamage(10);
  check('Mossling damage synchronizes health UI', health.current === Math.max(0, before - 10) && document.querySelector('#player-health').getAttribute('aria-valuenow') === String(health.current));
});
button('Check paused damage', () => {
  active = false; const before = health.current; receiveDamage(15);
  check('Paused player takes no damage', health.current === before);
});
button('Defeat player', () => {
  saveWorldEdits(world, localStorage, testSaveKey); respawnSnapshot = world.blocks.slice(); respawnSave = localStorage.getItem(testSaveKey);
  active = true; receiveDamage(health.current);
  // Pointer-lock release calls setPlaying(false) in the real game; it must not replace the death dialog.
  ui.setPlaying(false);
  check('Zero HP displays death dialog and stops damage', health.dead && !document.querySelector('.death-screen').hidden && document.querySelector('.menu').hidden && document.querySelector('.game-hud').hidden && damagePlayer(health, 10, false).amount === 0);
});
button('Melee attack', () => {
  const previous = enemies.map(enemy => enemy.health);
  const hit = combat.attack(camera.position, camera.getWorldDirection(direction), active && !health.dead);
  panel.dataset.lastMelee = hit.ok ? `${hit.enemy.name}: ${hit.enemy.health} HP` : hit.reason;
  if (hit.ok) {
    hand.beginSwing('attack', 0.32);
    check('Melee applies 25 damage without changing blocks', hit.enemy.health === Math.max(0, previous[enemies.indexOf(hit.enemy)] - 25));
  } else if (wall) check('A nearer wall blocks melee', combat.target(camera.position, direction).kind === 'block' && enemies.every((enemy, i) => enemy.health === previous[i]));
});
button('Toggle wall', () => {
  if (wall) { world.set(wall.x, 1, wall.z, 0); world.set(wall.x, 2, wall.z, 0); wall = null; }
  else {
    aimAt(enemies[0]); wall = { x: Math.floor(enemies[0].x), z: Math.floor(enemies[0].z + 1.2) };
    world.set(wall.x, 1, wall.z, 3); world.set(wall.x, 2, wall.z, 3);
  }
  worldMesh.geometry.dispose(); worldMesh.geometry = createWorldGeometry(world, true); combat.reset();
});
let lastTime = performance.now();
renderer.setAnimationLoop(time => {
  const seconds = Math.max(0, (time - lastTime) / 1000), dt = Math.min(seconds, 0.1); lastTime = time;
  combat.update(seconds, active && !health.dead);
  updateEnemies(world, enemies, player, dt, { active: active && simulateEnemies && !health.dead, onAttack(amount) { attacks++; return receiveDamage(amount); } });
  if (!simulateEnemies) updateEnemyEffects(enemies, seconds, active && !health.dead);
  damageFlash = Math.max(0, damageFlash - seconds); ui.damageFlash(damageFlash / 0.35);
  hand.update(seconds); view.update();
  const focus = combat.target(camera.position, camera.getWorldDirection(direction));
  if (focus.enemy) ui.enemyTarget(focus); else ui.target(null, 0);
  renderer.render(scene, camera); hand.render(renderer);
  enemies.forEach(enemy => {
    if (enemy.health === 0 && enemy.deathTime > 0 && enemy.deathTime < 0.4) observedDeaths.add(enemy.id);
  });
  if (resourceCheck) {
    resourceCheck.frames++;
    if (resourceCheck.frames >= 120 || time - resourceCheck.start >= 15000) {
      const memory = renderer.info.memory;
      check(`Four-enemy rendering keeps resource counts stable (${resourceCheck.frames} frames)`, memory.geometries === resourceCheck.geometries && memory.textures === resourceCheck.textures);
      panel.dataset.resourceFrames = resourceCheck.frames; panel.dataset.geometries = memory.geometries; panel.dataset.textures = memory.textures;
      resourceCheck = null;
    }
  }
  panel.dataset.states = enemies.map(enemy => enemy.state).join(','); panel.dataset.attacks = attacks;
  panel.dataset.mossX = enemies[0].x.toFixed(3); panel.dataset.mossZ = enemies[0].z.toFixed(3);
  panel.dataset.health = health.current;
  panel.dataset.mossHP = enemies[0].health; panel.dataset.stoneHP = enemies[3].health;
  panel.dataset.cooldown = combat.cooldown.toFixed(3);
  panel.dataset.deathAnimations = [...observedDeaths].join(',');
  panel.dataset.deathVisible = view.models.filter(model => model.enemy.health === 0 && model.root.visible).length;
  panel.dataset.hitFlash = enemies[0].hitFlash.toFixed(3);
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
panel.dataset.status = 'ready';
