/**
 * Raw keyboard/mouse state. It only records input; the Game decides whether
 * input is honoured (it is ignored entirely unless the game is in play mode).
 */
export class Input {
  constructor() {
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = new Set();
    this.handlers = { keydown: [], mousedown: [], mouseup: [], wheel: [] };

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.handlers.keydown.forEach((h) => h(e));
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());

    document.addEventListener('mousemove', (e) => {
      // Some browsers occasionally report a huge spike on pointer-lock
      // changes; ignore those so the camera never jerks.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    document.addEventListener('mousedown', (e) => {
      this.buttons.add(e.button);
      this.handlers.mousedown.forEach((h) => h(e));
    });
    document.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
      this.handlers.mouseup.forEach((h) => h(e));
    });
    document.addEventListener(
      'wheel',
      (e) => this.handlers.wheel.forEach((h) => h(e)),
      { passive: false },
    );
  }

  on(type, handler) {
    this.handlers[type].push(handler);
  }

  isDown(code) {
    return this.keys.has(code);
  }

  /** Returns and clears accumulated mouse movement. */
  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /** Forget all held keys/buttons (focus loss, pausing). */
  reset() {
    this.keys.clear();
    this.buttons.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
