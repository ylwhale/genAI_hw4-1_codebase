import { VoxelWorld } from '../src/world.js';
import { editBlock } from '../src/interactions.js';
import { createPlayer } from '../src/physics.js';
import { loadWorldEdits, saveWorldEdits, resetWorld } from '../src/storage.js';
import * as THREE from 'three';
import { createUI } from '../src/ui.js';
import { createWorldMesh, createWorldGeometry } from '../src/world-mesh.js';
import { createBlockAtlas } from '../src/textures.js';
import { addAtmosphere } from '../src/atmosphere.js';
import { createFirstPersonView, TOOL_NAMES } from '../src/first-person.js';
import { targetBlock } from '../src/interactions.js';
import { createInteractionController } from '../src/interaction-controller.js';
import { createInteractionEffects } from '../src/interaction-effects.js';
import '../src/style.css';

const key = 'voxel-grove:browser-verification:v1';
const stageKey = `${key}:stage`;
const animationKey = `${key}:animated`;
const animationExpectedKey = `${animationKey}:expected`;
const results = document.querySelector('#results');
function check(label, condition) {
  const line = document.createElement('p');
  line.className = condition ? 'pass' : 'fail';
  line.textContent = `${condition ? 'PASS' : 'FAIL'} · ${label}`;
  results.append(line);
  if (!condition) throw Error(label);
}

try {
  const expectedAnimation = sessionStorage.getItem(animationExpectedKey);
  if (expectedAnimation) {
    const restored = new VoxelWorld();
    check('Animated edits survive an actual browser reload byte-for-byte', loadWorldEdits(restored, localStorage, animationKey).status === 'restored'
      && JSON.stringify(Array.from(restored.blocks)) === expectedAnimation);
    check('Animated test reset clears its save and restores the seed', resetWorld(restored, localStorage, animationKey).ok
      && restored.blocks.every((type, i) => type === restored.original[i]) && localStorage.getItem(animationKey) === null);
    sessionStorage.removeItem(animationExpectedKey);
  }
  const world = new VoxelWorld();
  if (sessionStorage.getItem(stageKey) === 'awaiting-reload') {
    const loaded = loadWorldEdits(world, localStorage, key);
    check('Real localStorage edits restored after browser reload', loaded.status === 'restored' && loaded.count === 2);
    check('Removed grass remains removed', world.get(17, world.spawn.y - 1, 25) === 0);
    check('Placed wood remains placed', world.get(15, world.spawn.y, 25) === 4);
    check('Reset clears the saved key', resetWorld(world, localStorage, key).ok && localStorage.getItem(key) === null);
    check('Reset restores every original block', world.blocks.every((type, i) => type === world.original[i]));
    sessionStorage.removeItem(stageKey);
    results.dataset.status = 'passed-after-reload';
  } else {
    const player = createPlayer(world.spawn);
    const target = (x, z) => ({ x, y: world.spawn.y - 1, z, normal: { x: 0, y: 1, z: 0 }, distance: 2 });
    check('Remove a real terrain block', editBlock(world, player, target(17, 25), 'remove').ok);
    check('Place selected wood beside the player', editBlock(world, player, target(15, 25), 'place', 4).ok);
    const saved = saveWorldEdits(world, localStorage, key);
    check('Browser localStorage accepts exactly two edits', saved.ok && saved.count === 2);
    sessionStorage.setItem(stageKey, 'awaiting-reload');
    const reload = document.querySelector('#reload');
    reload.hidden = false;
    reload.addEventListener('click', () => location.reload());
    results.dataset.status = 'awaiting-reload';
  }
  const ui = createUI({
    onPlay() { ui.setPlaying(true); firstPerson.setPlaying(true); },
    onReset() {
      interaction.cancel('Preview reset');
      resetWorld(world, localStorage, animationKey); sessionStorage.removeItem(animationExpectedKey);
      Object.assign(testPlayer, createPlayer(world.spawn)); rebuild();
      ui.message('Isolated preview world reset. The playable save is unchanged.');
    },
  });
  ui.enableReset();
  check('Title screen initially visible with Play', !document.querySelector('.menu').hidden && document.querySelector('#play').textContent.includes('Play'));
  ui.setPlaying(true);
  check('Playing state reveals hotbar and hides menu', !document.querySelector('.game-hud').hidden && document.querySelector('.menu').hidden);
  let selectionWorks = document.querySelectorAll('.slot').length === 5;
  for (let type = 1; type <= 5; type++) {
    ui.select(type);
    selectionWorks &&= document.querySelectorAll('.slot.selected').length === 1
      && Number(document.querySelector('.slot.selected').dataset.block) === type;
  }
  check('Each of five materials has exactly one selected hotbar slot', selectionWorks);
  ui.target({ distance: 4.2 }, 4);
  check('Target label shows block type and camera distance', document.querySelector('#target-label').textContent === 'Wood · 4.2 m');
  ui.setStarted(); ui.setPlaying(false);
  check('Pause returns menu and offers Resume', document.querySelector('.game-hud').hidden && !document.querySelector('.menu').hidden && document.querySelector('#play').textContent.includes('Resume'));
  ui.setPlaying(true); ui.target(null, 0); ui.saveStatus('Component preview');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 200);
  camera.rotation.order = 'YXZ';
  camera.position.set(world.spawn.x, world.spawn.y + 1.6, world.spawn.z);
  camera.rotation.set(-0.12, -0.55, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  document.querySelector('#app').prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xdceee6, 0x6c7250, 2));
  const light = new THREE.DirectionalLight(0xffe5b5, 3.2);
  light.position.set(-18, 48, 38); light.target.position.set(16, 0, 16); light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 100 });
  light.shadow.bias = -0.00015; light.shadow.normalBias = 0.035;
  const blockAtlas = createBlockAtlas();
  const worldMesh = createWorldMesh(world, blockAtlas);
  scene.add(light, light.target, worldMesh);
  const atmosphere = addAtmosphere(scene, world);
  const firstPerson = createFirstPersonView(camera);
  firstPerson.setPlaying(true);
  const toolButtons = document.createElement('p');
  TOOL_NAMES.forEach((name, index) => {
    const button = document.createElement('button');
    button.textContent = name;
    button.addEventListener('click', () => { interaction.cancel('Tool changed'); ui.tool(firstPerson.setTool(index)); });
    toolButtons.append(button, ' ');
  });
  document.querySelector('#results-panel').append(toolButtons);
  const swingButton = document.createElement('button');
  swingButton.textContent = 'Preview swing';
  swingButton.addEventListener('click', () => firstPerson.beginSwing('remove'));
  toolButtons.append(swingButton);
  check('Camera-child hand is visible with Pickaxe selected', firstPerson.rig.parent === camera && firstPerson.rig.visible && firstPerson.toolName === 'Pickaxe');
  const effects = createInteractionEffects(scene, { atlas: blockAtlas });
  const testPlayer = createPlayer(world.spawn);
  const direction = new THREE.Vector3();
  const panel = document.querySelector('#results-panel');
  let savedBefore, blocksBefore;
  const reloadAnimation = document.createElement('button'); reloadAnimation.textContent = 'Reload timed save'; reloadAnimation.hidden = true;
  reloadAnimation.addEventListener('click', () => location.reload());
  function rebuild() { worldMesh.geometry.dispose(); worldMesh.geometry = createWorldGeometry(world, true); renderer.shadowMap.needsUpdate = true; }
  function target() { camera.updateMatrixWorld(); return targetBlock(world, worldMesh, camera.position, camera.getWorldDirection(direction)); }
  const interaction = createInteractionController({
    world, player: testPlayer,
    onStart(op) {
      savedBefore = localStorage.getItem(animationKey); blocksBefore = world.blocks.slice();
      firstPerson.cancelSwing(); firstPerson.beginSwing(op.action); effects.begin(op); ui.interaction(op);
    },
    onProgress(op) {
      ui.interaction(op); panel.dataset.progress = op.progress.toFixed(3);
      panel.dataset.blockDuring = world.get(op.source.x, op.source.y, op.source.z);
      panel.dataset.destinationDuring = world.get(op.destination.x, op.destination.y, op.destination.z);
      panel.dataset.saveUnchangedDuring = String(localStorage.getItem(animationKey) === savedBefore);
    },
    onCancel() {
      firstPerson.cancelSwing(); effects.clear(); ui.interaction(null); panel.dataset.operation = 'cancelled';
      check('Cancelled action leaves world and save unchanged', world.blocks.every((type, i) => type === blocksBefore[i]) && localStorage.getItem(animationKey) === savedBefore);
    },
    onComplete(result, op) {
      rebuild(); firstPerson.cancelSwing(); effects.clear(); ui.interaction(null);
      const label = op.action === 'place' ? 'wood placement' : `${op.sourceType === 1 ? 'grass' : op.sourceType === 3 ? 'stone' : 'wood'} removal`;
      check(`Animated ${label} completed with no remaining effects`, world.get(result.x, result.y, result.z) === (op.action === 'remove' ? 0 : op.selected) && effects.particleCount === 0 && effects.group.children.every(child => !child.visible));
      check('Animation reaches completion before saving', localStorage.getItem(animationKey) === savedBefore);
      check('Completed animated edit saves in real localStorage', saveWorldEdits(world, localStorage, animationKey).ok);
      sessionStorage.setItem(animationExpectedKey, JSON.stringify(Array.from(world.blocks)));
      reloadAnimation.hidden = false;
      panel.dataset.operation = 'completed';
    },
  });
  const effectButtons = document.createElement('p');
  for (const [label, type] of [['Break grass', 1], ['Break stone', 3], ['Break wood', 4]]) {
    const button = document.createElement('button'); button.textContent = label;
    button.addEventListener('click', () => {
      interaction.cancel('New fixture');
      const cell = { x: 16, y: world.spawn.y + 1, z: 21 };
      world.set(cell.x, cell.y, cell.z, type); rebuild();
      camera.lookAt(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      const result = interaction.start(target(), 'remove');
      panel.dataset.operation = result.ok ? 'running' : result.reason;
      check(`${label} begins without changing the block`, result.ok && world.get(cell.x, cell.y, cell.z) === type);
    }); effectButtons.append(button, ' ');
  }
  panel.append(effectButtons);
  const buildButton = document.createElement('button'); buildButton.textContent = 'Build wood';
  buildButton.addEventListener('click', () => {
    interaction.cancel('New fixture');
    const y = world.spawn.y + 1;
    world.set(16, y, 21, 3); world.set(16, y, 22, 0); rebuild();
    camera.lookAt(16.5, y + 0.5, 21.5);
    ui.select(4);
    const result = interaction.start(target(), 'place', 4);
    panel.dataset.operation = result.ok ? 'running' : result.reason;
    check('Wood preview begins while destination remains empty', result.ok && world.get(16, y, 22) === 0 && effects.preview.visible);
  }); effectButtons.append(buildButton);
  const selectButton = document.createElement('button'); selectButton.textContent = 'Select grass';
  selectButton.addEventListener('click', () => ui.select(1)); effectButtons.append(' ', selectButton);
  const cancelButton = document.createElement('button'); cancelButton.textContent = 'Cancel action';
  cancelButton.addEventListener('click', () => interaction.cancel('Preview cancelled')); effectButtons.append(' ', cancelButton);
  const pauseButton = document.createElement('button'); pauseButton.textContent = 'Pause preview';
  pauseButton.addEventListener('click', () => { interaction.cancel('Preview paused'); firstPerson.setPlaying(false); ui.setPlaying(false); });
  effectButtons.append(' ', pauseButton, ' ', reloadAnimation);
  const resumeButton = document.createElement('button'); resumeButton.textContent = 'Resume preview';
  resumeButton.addEventListener('click', () => { firstPerson.setPlaying(true); ui.setPlaying(true); }); effectButtons.append(' ', resumeButton);
  let previousTime = performance.now();
  renderer.setAnimationLoop(time => {
    const seconds = Math.max(0, (time - previousTime) / 1000), dt = Math.min(seconds, 0.1); previousTime = time;
    atmosphere.update(time / 1000, dt); interaction.update(seconds, target()); effects.update(seconds); firstPerson.update(seconds);
    panel.dataset.particles = effects.particleCount;
    panel.dataset.crackStage = effects.crackStage;
    panel.dataset.swinging = String(firstPerson.swinging);
    panel.dataset.preview = String(effects.preview.visible);
    panel.dataset.handVisible = String(firstPerson.rig.visible);
    renderer.render(scene, camera); firstPerson.render(renderer);
    panel.dataset.geometries = renderer.info.memory.geometries;
    panel.dataset.textures = renderer.info.memory.textures;
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  });
} catch (error) {
  results.dataset.status = 'failed';
  const line = document.createElement('p'); line.className = 'fail'; line.textContent = error.message; results.append(line);
}
