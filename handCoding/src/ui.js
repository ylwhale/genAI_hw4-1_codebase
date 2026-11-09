import { BLOCK_NAMES } from './world.js';

export function createUI({ onPlay, onReset, onRespawn = () => {} }) {
  const overlay = document.createElement('div');
  overlay.className = 'interface';
  overlay.innerHTML = `
    <header class="masthead">
      <div class="brand"><span class="brand-mark" aria-hidden="true"><svg width="28" height="32" viewBox="0 0 32 36"><path fill="#dce8b4" d="M16 1 31 9 16 17 1 9Z"/><path fill="#a2ba7d" d="m1 11 14 8v16L1 27Z"/><path fill="#7f9e65" d="m17 19 14-8v16l-14 8Z"/></svg></span><span>VOXEL GROVE<small>A world of your own</small></span></div>
      <div class="world-badge"><span class="status-dot"></span> SEED 42 <span class="badge-divider">/</span> 32 × 32</div>
    </header>
    <section class="menu" aria-labelledby="game-title">
      <div class="menu-content">
        <p class="eyebrow">A SMALL WORLD. ENDLESS POSSIBILITIES.</p>
        <h1 id="game-title">Voxel<br>Grove<span>.</span></h1>
        <p class="intro">Find your own little corner.<br>Explore the hills. Build something new.</p>
        <button id="play" class="play-button"><span class="play-icon" aria-hidden="true">▶</span><span>Play</span><span class="arrow" aria-hidden="true">↗</span></button>
        <p id="menu-message" class="menu-message" role="status">A quiet place to explore, one block at a time.</p>
        <div class="controls-guide" aria-label="Game controls">
          <div><kbd>W A S D</kbd><span>Move</span></div><div><kbd>Mouse</kbd><span>Look around</span></div>
          <div><kbd>Space</kbd><span>Jump</span></div><div><kbd>1 — 5</kbd><span>Select block</span></div>
          <div><kbd>L / R click</kbd><span>Attack, mine / build</span></div><div><kbd>Esc</kbd><span>Pause & release</span></div>
          <div><kbd>Q</kbd><span>Switch tool</span></div>
        </div>
        <button id="reset" class="reset-button" hidden>↺ Reset world</button>
      </div>
      <footer class="menu-footer"><span>TAKE YOUR TIME. MAKE IT YOURS.</span><span>CREATIVE SANDBOX</span></footer>
    </section>
    <section class="death-screen" role="dialog" aria-modal="true" aria-labelledby="death-title" hidden>
      <div class="death-card"><p class="eyebrow">BACK TO THE CLEARING</p><h2 id="death-title">You fell in<br>the grove.</h2><p>Your world and buildings are safe.<br>Return with full health and a fresh start.</p><button id="respawn" class="play-button">Respawn <span class="arrow" aria-hidden="true">↗</span></button></div>
    </section>
    <div class="game-hud" hidden>
      <div id="damage-flash" class="damage-flash" aria-hidden="true"></div>
      <div class="health-display" id="player-health" role="progressbar" aria-label="Player health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div class="health-caption"><span>HEALTH</span><span id="health-number">100 / 100</span></div><div class="health-track"><i id="health-fill"></i></div></div>
      <button class="pause-button" id="pause">Menu <kbd>Esc</kbd></button>
      <div class="tool-label"><kbd>Q</kbd><span id="tool-name">Pickaxe</span><small>switch tool</small></div>
      <div class="crosshair" aria-hidden="true"></div>
      <div class="target-label" id="target-label"></div>
      <div class="interaction-progress" id="interaction-progress" hidden><span id="interaction-label"></span><div class="progress-track"><i id="interaction-fill"></i></div></div>
      <div class="toast" id="toast" role="status"></div>
      <div class="hotbar-wrap">
        <div class="selected-label" id="selected-label">Grass</div>
        <div class="hotbar" role="group" aria-label="Block selection">
          ${BLOCK_NAMES.slice(1).map((name, i) => `<div class="slot ${i === 0 ? 'selected' : ''}" data-block="${i + 1}" aria-label="${i + 1}: ${name}" aria-current="${i === 0}"><span class="slot-number">${i + 1}</span><span class="block-icon block-${name.toLowerCase()}"><i></i><b></b><em></em></span><span class="slot-name">${name}</span></div>`).join('')}
        </div>
        <p class="game-hint">L click <span>attack / mine</span><i>·</i> R click <span>place</span><i>·</i> 1–5 <span>select</span></p>
      </div>
      <span class="save-status" id="save-status"></span>
    </div>`;
  document.querySelector('#app').append(overlay);
  const menu = overlay.querySelector('.menu');
  const hud = overlay.querySelector('.game-hud');
  const play = overlay.querySelector('#play');
  const message = overlay.querySelector('#menu-message');
  const toast = overlay.querySelector('#toast');
  const reset = overlay.querySelector('#reset');
  const deathScreen = overlay.querySelector('.death-screen');
  const respawn = overlay.querySelector('#respawn');
  let dead = false;
  let toastTimeout;
  let resetArmed = false;
  let resetTimeout;
  play.addEventListener('click', onPlay);
  respawn.addEventListener('click', onRespawn);
  overlay.querySelector('#pause').addEventListener('click', () => document.exitPointerLock());
  reset.addEventListener('click', () => {
    if (resetArmed) {
      clearTimeout(resetTimeout);
      resetArmed = false;
      reset.textContent = '↺ Reset world';
      onReset();
    } else {
      resetArmed = true;
      reset.textContent = 'Reset all changes? Click again to confirm';
      resetTimeout = setTimeout(() => { resetArmed = false; reset.textContent = '↺ Reset world'; }, 5000);
    }
  });
  return {
    setPlaying(playing) {
      playing = playing && !dead;
      menu.hidden = playing || dead;
      hud.hidden = !playing;
      overlay.classList.toggle('playing', playing);
      document.body.classList.toggle('playing', playing);
      if (!playing && !dead) play.focus({ preventScroll: true });
      if (playing) { resetArmed = false; clearTimeout(resetTimeout); reset.textContent = '↺ Reset world'; }
    },
    setDead(value) {
      dead = value;
      deathScreen.hidden = !dead;
      this.setPlaying(false);
      if (dead) respawn.focus({ preventScroll: true });
    },
    setStarted() { play.querySelector('span:nth-child(2)').textContent = 'Resume'; },
    message(text) { message.textContent = text; },
    select(type) {
      overlay.querySelectorAll('.slot').forEach(slot => {
        const active = Number(slot.dataset.block) === type;
        slot.classList.toggle('selected', active);
        slot.setAttribute('aria-current', String(active));
      });
      overlay.querySelector('#selected-label').textContent = BLOCK_NAMES[type];
    },
    target(target, type) {
      overlay.querySelector('#target-label').textContent = target ? `${BLOCK_NAMES[type]} · ${target.distance.toFixed(1)} m` : '';
    },
    enemyTarget(target) {
      overlay.querySelector('#target-label').textContent = `${target.enemy.name} · ${target.enemy.health}/${target.enemy.maxHealth} HP · ${target.distance.toFixed(1)} m`;
    },
    notify(text) {
      clearTimeout(toastTimeout);
      toast.textContent = text;
      toast.classList.add('visible');
      toastTimeout = setTimeout(() => toast.classList.remove('visible'), 1800);
    },
    enableReset() { reset.hidden = false; },
    tool(name) { overlay.querySelector('#tool-name').textContent = name; },
    health(health) {
      const element = overlay.querySelector('#player-health');
      element.setAttribute('aria-valuenow', String(health.current));
      element.classList.toggle('low-health', health.current <= 30);
      overlay.querySelector('#health-number').textContent = `${health.current} / ${health.max}`;
      overlay.querySelector('#health-fill').style.transform = `scaleX(${health.current / health.max})`;
    },
    damageFlash(intensity) { overlay.querySelector('#damage-flash').style.opacity = String(Math.max(0, Math.min(1, intensity))); },
    interaction(operation) {
      overlay.querySelector('#interaction-progress').hidden = !operation;
      if (!operation) return;
      overlay.querySelector('#interaction-label').textContent = `${operation.action === 'remove' ? 'Breaking' : 'Building'} ${Math.floor(operation.progress * 100)}%`;
      overlay.querySelector('#interaction-fill').style.transform = `scaleX(${operation.progress})`;
    },
    saveStatus(text) { overlay.querySelector('#save-status').textContent = text; },
  };
}
