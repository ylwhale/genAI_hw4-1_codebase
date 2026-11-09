import * as THREE from 'three';

export const TOOL_NAMES = ['Pickaxe', 'Axe', 'Shovel'];

export function createFirstPersonView(camera) {
  const scene = new THREE.Scene();
  // The game camera can render the world without belonging to that scene.
  // Owning it here makes every hand/tool transform camera-relative.
  scene.add(camera, new THREE.HemisphereLight(0xfff4dd, 0x657a64, 2.4));
  const light = new THREE.DirectionalLight(0xffebc8, 2.6);
  light.position.set(-2, 4, 3);
  camera.add(light, light.target);
  light.target.position.set(0, 0, -1);
  const rig = new THREE.Group();
  rig.name = 'First-person hand';
  rig.scale.setScalar(0.7);
  camera.add(rig);
  rig.visible = false;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = {
    skin: new THREE.MeshLambertMaterial({ color: 0xc9956d }),
    sleeve: new THREE.MeshLambertMaterial({ color: 0x4b6e58 }),
    cuff: new THREE.MeshLambertMaterial({ color: 0x769078 }),
    wood: new THREE.MeshLambertMaterial({ color: 0x8d643d }),
    grip: new THREE.MeshLambertMaterial({ color: 0x5d4632 }),
    metal: new THREE.MeshLambertMaterial({ color: 0xabbab2 }),
    edge: new THREE.MeshLambertMaterial({ color: 0xd7dfd2 }),
    collar: new THREE.MeshLambertMaterial({ color: 0x777e65 }),
  };
  function box(parent, size, position, material) {
    const mesh = new THREE.Mesh(geometry, materials[material]);
    mesh.scale.set(...size);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  }
  box(rig, [0.19, 0.43, 0.2], [0, -0.23, 0.05], 'sleeve');
  box(rig, [0.21, 0.1, 0.22], [0, -0.035, 0.04], 'cuff');
  box(rig, [0.2, 0.22, 0.21], [0, 0.105, 0], 'skin');
  box(rig, [0.08, 0.13, 0.12], [-0.115, 0.095, -0.045], 'skin');

  const tools = TOOL_NAMES.map(name => {
    const tool = new THREE.Group();
    tool.name = name;
    tool.position.set(0, 0.12, -0.12);
    tool.rotation.set(0.12, -0.12, -0.28);
    box(tool, [0.065, 0.57, 0.065], [0, 0.17, 0], 'wood');
    box(tool, [0.083, 0.15, 0.083], [0, -0.025, 0], 'grip');
    box(tool, [0.095, 0.1, 0.095], [0, 0.4, 0], 'collar');
    if (name === 'Pickaxe') {
      box(tool, [0.47, 0.09, 0.1], [0, 0.45, 0], 'metal');
      box(tool, [0.08, 0.17, 0.1], [-0.23, 0.37, 0], 'edge').rotation.z = -0.35;
      box(tool, [0.08, 0.17, 0.1], [0.23, 0.37, 0], 'edge').rotation.z = 0.35;
    } else if (name === 'Axe') {
      box(tool, [0.26, 0.24, 0.1], [-0.14, 0.43, 0], 'metal');
      box(tool, [0.065, 0.2, 0.12], [-0.3, 0.43, 0], 'edge');
      box(tool, [0.12, 0.1, 0.09], [0.06, 0.43, 0], 'metal');
    } else {
      box(tool, [0.26, 0.21, 0.075], [0, 0.53, 0], 'metal');
      box(tool, [0.19, 0.07, 0.085], [0, 0.67, 0], 'edge');
      box(tool, [0.12, 0.05, 0.08], [0, 0.73, 0], 'edge');
    }
    rig.add(tool);
    return tool;
  });
  let toolIndex = 0;
  let idleTime = 0;
  let swing = null;
  function restPose(bob = 0) {
    rig.position.set(Math.min(0.54, camera.aspect * 0.3), -0.43 + bob, -0.8);
    rig.rotation.set(-0.06, -0.12, -0.12);
  }
  function cancelSwing() { swing = null; restPose(); }
  function setTool(index) {
    cancelSwing();
    toolIndex = ((index % tools.length) + tools.length) % tools.length;
    tools.forEach((tool, i) => { tool.visible = i === toolIndex; });
    return TOOL_NAMES[toolIndex];
  }
  setTool(0);
  return {
    scene, rig, tools,
    get toolName() { return TOOL_NAMES[toolIndex]; },
    get swinging() { return swing !== null; },
    get swingProgress() { return swing ? swing.elapsed / swing.duration : 0; },
    cycleTool() { return setTool(toolIndex + 1); },
    setTool,
    setPlaying(playing) { rig.visible = playing; if (!playing) cancelSwing(); },
    beginSwing(action, duration = 1) {
      if (!rig.visible || swing || !['remove', 'place', 'attack'].includes(action) || !Number.isFinite(duration) || duration <= 0) return false;
      swing = { action, duration, elapsed: 0 };
      return true;
    },
    cancelSwing,
    update(dt, moving = false) {
      if (!rig.visible) return;
      if (!Number.isFinite(dt) || dt < 0) return;
      idleTime += dt;
      const bob = moving ? Math.sin(idleTime * 10) * 0.012 : Math.sin(idleTime * 1.8) * 0.003;
      restPose(bob);
      if (!swing) return;
      swing.elapsed = Math.min(swing.duration, swing.elapsed + dt);
      const progress = swing.elapsed / swing.duration;
      if (progress >= 1 - 1e-9) { swing = null; return; }
      const envelope = Math.sin(progress * Math.PI);
      const stroke = swing.action === 'remove'
        ? envelope * (0.55 - 0.45 * Math.cos(progress * Math.PI * 6)) : envelope;
      const breaking = swing.action !== 'place';
      rig.position.x -= stroke * (breaking ? 0.16 : 0.07);
      rig.position.y += stroke * 0.05;
      rig.position.z -= stroke * (breaking ? 0.06 : 0.13);
      rig.rotation.x -= stroke * (breaking ? 0.75 : 0.35);
      rig.rotation.z += stroke * (breaking ? 0.65 : 0.18);
    },
    render(renderer) {
      if (!rig.visible) return;
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.autoClear = previousAutoClear;
    },
    dispose() {
      camera.remove(rig, light, light.target);
      scene.remove(camera);
      geometry.dispose();
      Object.values(materials).forEach(material => material.dispose());
    },
  };
}
