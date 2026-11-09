import { BLOCKS, HOTBAR_BLOCKS } from '../world/blocks.js';
import { TOOLS, drawToolIcon } from '../render/tools.js';

/**
 * DOM interface: title/pause menu, HUD (crosshair, hotbar, toasts), and the
 * reset confirmation dialog. Game logic talks to it through small methods
 * and callbacks; it never touches the 3D scene.
 */
export class UI {
  constructor(textureCanvases, { onPlay, onReset, onRespawn }) {
    this.el = {
      menu: byId('menu'),
      menuTitle: byId('menu-title'),
      menuSubtitle: byId('menu-subtitle'),
      play: byId('play-btn'),
      reset: byId('reset-btn'),
      saveStatus: byId('save-status'),
      menuMessage: byId('menu-message'),
      hud: byId('hud'),
      hotbar: byId('hotbar'),
      blockName: byId('block-name'),
      toolName: byId('tool-name'),
      toolPanelName: byId('tool-panel-name'),
      toolIcon: byId('tool-icon'),
      actionRing: byId('action-ring'),
      health: byId('health'),
      hearts: byId('hearts'),
      healthValue: byId('health-value'),
      damageFlash: byId('damage-flash'),
      lowHealth: byId('low-health'),
      crosshair: byId('crosshair'),
      attackMeter: byId('attack-meter'),
      monsterCount: byId('monster-count'),
      death: byId('death'),
      deathCause: byId('death-cause'),
      deathMessage: byId('death-message'),
      respawn: byId('respawn-btn'),
      toast: byId('toast'),
      saved: byId('save-indicator'),
      confirm: byId('confirm'),
      confirmCancel: byId('confirm-cancel'),
      confirmReset: byId('confirm-reset'),
    };
    this.timers = {};

    this.el.play.addEventListener('click', () => onPlay());
    this.el.respawn.addEventListener('click', () => onRespawn?.());
    this.el.reset.addEventListener('click', () => this.showConfirm(true));
    this.el.confirmCancel.addEventListener('click', () => this.showConfirm(false));
    this.el.confirmReset.addEventListener('click', () => {
      this.showConfirm(false);
      onReset();
    });
    this.el.confirm.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.showConfirm(false);
    });

    this.buildHotbar(textureCanvases);
    this.toolIcons = TOOLS.map((tool) => drawToolIcon(tool.id, 4));
    this.ringFill = this.el.actionRing.querySelector('.ring-fill');
    this.ringLength = 2 * Math.PI * 17;
    this.ringShown = null;
    this.buildHearts(10);
    this.attackFill = this.el.attackMeter.querySelector('span');
    this.hostile = false;
    this.meterShown = false;
  }

  // ------------------------------------------------------------------ menu

  showMenu(mode) {
    const paused = mode === 'paused';
    this.el.menu.classList.remove('hidden');
    this.el.menu.classList.toggle('paused', paused);
    this.el.menuTitle.hidden = paused;
    this.el.menuSubtitle.textContent = paused ? 'Paused' : 'A tiny floating-island sandbox';
    this.el.play.textContent = paused ? 'Resume' : 'Play';
    this.el.hud.classList.add('hidden');
    this.el.play.focus({ preventScroll: true });
  }

  hideMenu() {
    this.el.menu.classList.add('hidden');
    this.showConfirm(false);
    this.el.hud.classList.remove('hidden');
    this.setMenuMessage('');
  }

  setMenuMessage(text) {
    this.el.menuMessage.textContent = text;
    this.el.menuMessage.hidden = !text;
  }

  setSaveStatus(text) {
    this.el.saveStatus.textContent = text;
  }

  showConfirm(visible) {
    this.el.confirm.classList.toggle('hidden', !visible);
    if (visible) this.el.confirmCancel.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- hotbar

  buildHotbar(canvases) {
    this.slots = HOTBAR_BLOCKS.map((id, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.block = BLOCKS[id].name.toLowerCase();
      slot.setAttribute('role', 'listitem');
      slot.setAttribute('aria-label', `${i + 1}: ${BLOCKS[id].name}`);

      const icon = drawBlockIcon(canvases, BLOCKS[id].faces);
      icon.className = 'slot-icon';
      const key = document.createElement('span');
      key.className = 'slot-key';
      key.textContent = String(i + 1);

      slot.append(icon, key);
      this.el.hotbar.appendChild(slot);
      return slot;
    });
  }

  selectSlot(index, announce = true) {
    this.slots.forEach((slot, i) => {
      slot.classList.toggle('selected', i === index);
      slot.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    if (announce) {
      this.el.blockName.textContent = BLOCKS[HOTBAR_BLOCKS[index]].name;
      this.flash('blockName', 1400);
    }
  }

  // ----------------------------------------------------------------- tools

  /** Shows the active tool's icon and name; `announce` also flashes the name. */
  setTool(index, announce = true) {
    const tool = TOOLS[index];
    const ctx = this.el.toolIcon.getContext('2d');
    ctx.clearRect(0, 0, this.el.toolIcon.width, this.el.toolIcon.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.toolIcons[index], 0, 0, this.el.toolIcon.width, this.el.toolIcon.height);
    this.el.toolPanelName.textContent = tool.name;
    if (announce) {
      this.el.toolIcon.classList.remove('swap');
      void this.el.toolIcon.offsetWidth; // restart the CSS animation
      this.el.toolIcon.classList.add('swap');
      this.el.toolName.textContent = tool.name;
      this.flash('toolName', 1200);
    }
  }

  /** Progress ring around the crosshair; `kind` null hides it. */
  setActionProgress(kind, progress) {
    const ring = this.el.actionRing;
    if (!kind) {
      if (this.ringShown !== null) {
        ring.classList.remove('active');
        this.ringShown = null;
      }
      return;
    }
    if (this.ringShown !== kind) {
      ring.dataset.kind = kind;
      ring.classList.add('active');
      this.ringShown = kind;
    }
    const p = Math.max(0, Math.min(1, progress));
    this.ringFill.style.strokeDashoffset = String(this.ringLength * (1 - p));
  }

  // ---------------------------------------------------------------- health

  buildHearts(count) {
    const urls = drawHeartImages();
    this.heartUrls = urls;
    this.heartEls = Array.from({ length: count }, () => {
      const el = document.createElement('span');
      el.className = 'heart';
      this.el.hearts.appendChild(el);
      return el;
    });
  }

  /** Hearts (10 HP each, half hearts at 5) and the numeric value. */
  setHealth(current, max, { hurt = false } = {}) {
    const perHeart = max / this.heartEls.length;
    this.heartEls.forEach((el, i) => {
      const filled = current - i * perHeart;
      const kind = filled >= perHeart - 1e-9 ? 'full' : filled >= perHeart / 2 - 1e-9 ? 'half' : 'empty';
      if (el.dataset.kind !== kind) {
        el.dataset.kind = kind;
        el.className = `heart ${kind}`;
        el.style.backgroundImage = `url(${this.heartUrls[kind]})`;
      }
    });
    this.el.healthValue.textContent = String(Math.round(current));
    this.el.health.setAttribute('aria-valuenow', String(Math.round(current)));
    const low = current > 0 && current <= max * 0.3;
    this.el.health.classList.toggle('low', low);
    this.el.lowHealth.classList.toggle('on', low);
    if (hurt) {
      this.restartAnimation(this.el.health, 'hurt');
      this.restartAnimation(this.el.damageFlash, 'hit');
    }
  }

  restartAnimation(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the CSS animation plays again
    el.classList.add(cls);
  }

  /** Red crosshair while a monster is within reach. */
  setHostileTarget(on) {
    if (on === this.hostile) return;
    this.hostile = on;
    this.el.crosshair.classList.toggle('hostile', on);
  }

  /** Attack cooldown meter under the crosshair (null hides it). */
  setAttackCooldown(progress) {
    const show = progress !== null && progress < 1;
    if (show !== this.meterShown) {
      this.meterShown = show;
      this.el.attackMeter.classList.toggle('active', show);
    }
    if (show) this.attackFill.style.width = `${Math.round(progress * 100)}%`;
  }

  setMonsterCount(alive, total) {
    this.el.monsterCount.textContent = alive > 0 ? `Monsters left: ${alive} / ${total}` : 'All monsters defeated!';
  }

  // ----------------------------------------------------------------- death

  showDeath(cause) {
    this.el.deathCause.textContent = cause;
    this.el.deathMessage.hidden = true;
    this.el.death.classList.remove('hidden');
    this.el.respawn.focus({ preventScroll: true });
  }

  hideDeath() {
    this.el.death.classList.add('hidden');
  }

  setDeathMessage(text) {
    this.el.deathMessage.textContent = text;
    this.el.deathMessage.hidden = !text;
  }

  // ---------------------------------------------------------------- toasts

  toast(text, kind = 'info') {
    this.el.toast.textContent = text;
    this.el.toast.dataset.kind = kind;
    this.flash('toast', 1600);
  }

  showSaved() {
    this.flash('saved', 900);
  }

  flash(name, ms) {
    const node = this.el[name];
    node.classList.add('visible');
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(() => node.classList.remove('visible'), ms);
  }
}

function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}

/** Draws an isometric cube icon from the block's face textures. */
function drawBlockIcon(canvases, faces) {
  const S = 96;
  const k = S / 64; // icon geometry is authored on a 64px grid
  const T = 16; // texture size
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');

  // Each face is painted on its own layer so the shading overlay
  // ('source-atop') only darkens that face's pixels.
  const drawFace = (key, m, darken) => {
    const layer = document.createElement('canvas');
    layer.width = S;
    layer.height = S;
    const c = layer.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.setTransform((m[0] * k) / T, (m[1] * k) / T, (m[2] * k) / T, (m[3] * k) / T, m[4] * k, m[5] * k);
    c.drawImage(canvases[key], 0, 0);
    if (darken > 0) {
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = `rgba(0,0,0,${darken})`;
      c.fillRect(0, 0, T, T);
    }
    ctx.drawImage(layer, 0, 0);
  };

  // Top: rhombus L(6,19) T(32,6) R(58,19) B(32,32); sides drop by 28px.
  drawFace(faces.top, [26, -13, 26, 13, 6, 19], 0);
  drawFace(faces.side, [26, 13, 0, 28, 6, 19], 0.22);
  drawFace(faces.side, [26, -13, 0, 28, 32, 32], 0.4);
  return canvas;
}

/** 9x9 pixel-art hearts (full, half, empty) as data URLs. */
function drawHeartImages() {
  const shape = [
    '.##...##.',
    '#rr#.#rr#',
    '#rwr#rrr#',
    '#rrrrrrr#',
    '#rrrrrrr#',
    '.#rrrrr#.',
    '..#rrr#..',
    '...#r#...',
    '....#....',
  ];
  const make = (fillTo) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 9;
    const ctx = canvas.getContext('2d');
    shape.forEach((row, y) => {
      [...row].forEach((c, x) => {
        if (c === '.') return;
        const filled = x < fillTo;
        ctx.fillStyle =
          c === '#' ? '#2b0606' : !filled ? '#3c2a2a' : c === 'w' ? '#ffc4c4' : y >= 5 ? '#c62828' : '#ef3b36';
        ctx.fillRect(x, y, 1, 1);
      });
    });
    return canvas.toDataURL();
  };
  return { full: make(9), half: make(5), empty: make(0) };
}
