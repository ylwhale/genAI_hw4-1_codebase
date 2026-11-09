export function createControls(canvas, player, onLockChange = () => {}, onToolCycle = () => {}) {
  const keys = new Set();
  let jumpRequested = false;
  const locked = () => document.pointerLockElement === canvas;
  const clear = () => { keys.clear(); jumpRequested = false; };
  document.addEventListener('keydown', event => {
    if (!locked()) return;
    if (event.code === 'KeyQ') {
      event.preventDefault();
      if (!event.repeat) onToolCycle();
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.code === 'Space' && !event.repeat) jumpRequested = true;
  });
  document.addEventListener('keyup', event => keys.delete(event.code));
  document.addEventListener('mousemove', event => {
    if (!locked()) return;
    player.yaw -= event.movementX * 0.002;
    player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch - event.movementY * 0.002));
  });
  document.addEventListener('pointerlockchange', () => { clear(); onLockChange(locked()); });
  window.addEventListener('blur', () => {
    clear();
    if (locked()) document.exitPointerLock();
  });
  return {
    locked,
    clear,
    read() {
      const input = { forward: keys.has('KeyW'), backward: keys.has('KeyS'), left: keys.has('KeyA'), right: keys.has('KeyD'), jump: jumpRequested };
      jumpRequested = false;
      return input;
    },
  };
}
