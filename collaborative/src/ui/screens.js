// Title, pause, and death menus. Hidden screens stay mounted.
// Menu clicks cannot reach the game; button callbacks suppress double clicks.

import { hash3 } from '../core/rng.js'
import { HEART_PIXELS, element, pixelSprite } from './icons.js'

export const SCREEN_NAMES = Object.freeze(['title', 'pause', 'death'])
const LOGO_TEXT = 'VOXEL GROVE'
export const CONFIRM_TIMEOUT = 5000 // ms before an armed reset quietly disarms
export const REARM_DELAY = 2000 // ms; a button that fired works again if nothing happened

// All player-facing copy in one place.
const COPY = Object.freeze({
  tagline: 'Dig, build and defend a tiny island grove.',
  tip: 'Mosslings and Stoneguards roam the island. Strike first and keep an eye on your hearts.',
  footnote: 'Your world saves automatically in this browser.',
  pauseTitle: 'Paused',
  pauseText: 'The grove waits for you. Your world is saved.',
  deathTitle: 'You were defeated',
  deathText: 'The creatures of the grove got the better of you. Respawn to return with full health. Your builds are safe.',
  resetIdle: 'Reset world',
  resetArmed: 'Yes, reset world',
  resetCancel: 'Keep it',
  resetWarning: 'This erases every block you placed or mined.',
  playUnlocked: 'Play without mouse capture',
})

// Heading ids that name each dialog for assistive technology.
export const SCREEN_HEADINGS = Object.freeze({ title: 'vg-title-heading', pause: 'vg-pause-heading', death: 'vg-death-heading' })
export const UNLOCKED_BUTTON_ID = 'play-unlocked-button'

export const FATAL_COPY = Object.freeze({
  title: "Voxel Grove can't start",
  webgl:
    'Voxel Grove needs WebGL 2. Turn on hardware acceleration in your browser settings (or try another browser), then reload the page.',
  generic: 'Something went wrong while starting the game. Reload the page to try again.',
})

export const CONTROL_ROWS = Object.freeze(
  [
    { keys: ['W', 'A', 'S', 'D'], action: 'Move' },
    { keys: ['Mouse'], action: 'Look around' },
    { keys: ['Space'], action: 'Jump' },
    { keys: ['Esc'], action: 'Pause, free mouse' },
    { keys: ['Left click'], action: 'Mine / attack' },
    { keys: ['Right click'], action: 'Place block' },
    { keys: ['1–5', 'Wheel'], action: 'Choose block' },
    { keys: ['Q'], action: 'Switch tool' },
  ].map((row) => Object.freeze({ keys: Object.freeze(row.keys), action: row.action })),
)

// Bold 6 x 7 pixel glyphs for the logo (only the letters it needs).
export const LOGO_GLYPHS = Object.freeze({
  V: ['##..##', '##..##', '##..##', '##..##', '##..##', '.####.', '..##..'],
  O: ['.####.', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
  X: ['##..##', '##..##', '.####.', '..##..', '.####.', '##..##', '##..##'],
  E: ['######', '##....', '##....', '#####.', '##....', '##....', '######'],
  L: ['##....', '##....', '##....', '##....', '##....', '##....', '######'],
  G: ['.#####', '##....', '##....', '##.###', '##..##', '##..##', '.#####'],
  R: ['#####.', '##..##', '##..##', '#####.', '##.##.', '##..##', '##..##'],
})
const GLYPH_HEIGHT = 7
const LETTER_GAP = '.'
const WORD_GAP = '...'

const PLAY_PIXELS = ['#....', '##...', '###..', '####.', '#####', '####.', '###..', '##...', '#....']
const PLAY_PALETTE = Object.freeze({ '#': 'currentColor' })
// The death screen's heart, split down the middle by a jagged crack.
const CRACK = new Set(['4,1', '5,2', '4,3', '5,4', '4,5', '5,6', '4,7'])
const CRACK_EDGE = '#1a0809'
const DEATH_HEART_PALETTE = Object.freeze({ l: '#b8292c', r: '#b8292c', h: '#ff9d93', s: '#7d1a1d' })

// Logo rows: glyphs joined by one empty column, words by three.
export function logoRows(text = LOGO_TEXT) {
  const rows = Array.from({ length: GLYPH_HEIGHT }, () => [])
  for (const char of String(text).toUpperCase()) {
    const glyph = char === ' ' ? null : LOGO_GLYPHS[char]
    if (char !== ' ' && !glyph) throw new RangeError(`No logo glyph for '${char}'`)
    rows.forEach((row, y) => row.push(glyph ? glyph[y] : WORD_GAP))
  }
  return rows.map((parts) => parts.join(LETTER_GAP))
}

// Letters look like grass blocks: a bright turf top, a ragged grass fringe,
// then speckled earth darkening toward the bottom.
export function logoColor(_key, x, y) {
  const speckle = hash3(x, y, 7, 42)
  if (y === 0) return '#b6ee7f'
  if (y === 1) return '#72c84a'
  if (y === 2) return speckle < 0.55 ? '#4e9d33' : '#94623a'
  if (y === GLYPH_HEIGHT - 1) return '#5e3a20'
  return speckle < 0.28 ? '#7b4e2d' : '#94623a'
}

// Two-step confirmation: idle --press--> armed --press--> idle + confirmed.
// Any other event ('cancel', 'timeout', 'reset') returns to idle.
export function nextConfirmState(state, event) {
  if (event !== 'press') return { state: 'idle', confirmed: false }
  return state === 'armed' ? { state: 'idle', confirmed: true } : { state: 'armed', confirmed: false }
}

// Callbacks wrapped by `wrap` fire once until rearm() (called on every show)
// or until REARM_DELAY passes, so a request that silently failed can be retried.
function createOncePerShow(timers) {
  const fired = new Map()

  function rearm() {
    for (const timer of fired.values()) timers?.clearTimeout?.(timer)
    fired.clear()
  }

  function wrap(key, callback) {
    return () => {
      if (fired.has(key)) return
      fired.set(key, timers?.setTimeout?.(() => fired.delete(key), REARM_DELAY))
      if (typeof callback === 'function') callback()
    }
  }

  return { wrap, rearm }
}

function makeButton(doc, { id, label, variant = 'primary', icon = null, large = false }) {
  const attrs = { type: 'button' }
  if (id) attrs.id = id
  const className = `vg-button vg-button-${variant}${large ? ' vg-button-large' : ''}`
  const text = element(doc, 'span', { className: 'vg-button-label', text: label })
  return element(doc, 'button', { className, attrs }, [icon, text])
}

// The big green call to action used by Play and Resume.
function playButton(doc, id, label) {
  const icon = pixelSprite(doc, PLAY_PIXELS, PLAY_PALETTE, 'vg-button-icon')
  return makeButton(doc, { id, label, icon, large: true })
}

// Reset World with an inline confirmation instead of window.confirm().
function createConfirmButton(ctx, { id, onConfirm }) {
  const { doc, timers } = ctx
  const button = makeButton(doc, { id, label: COPY.resetIdle, variant: 'stone' })
  const label = button.querySelector('.vg-button-label')
  const cancel = makeButton(doc, { label: COPY.resetCancel, variant: 'ghost' })
  const warningId = `${id}-warning`
  const warning = element(doc, 'p', { className: 'vg-confirm-warning', text: COPY.resetWarning, attrs: { id: warningId } })
  button.setAttribute('aria-describedby', warningId)
  const row = element(doc, 'div', { className: 'vg-confirm-row' }, [button, cancel])
  const node = element(doc, 'div', { className: 'vg-confirm' }, [row, warning])
  let state = 'idle'
  let timer = null

  function render() {
    const armed = state === 'armed'
    label.textContent = armed ? COPY.resetArmed : COPY.resetIdle
    button.classList.toggle('is-armed', armed)
    cancel.hidden = !armed
    warning.hidden = !armed
  }

  function apply(event) {
    const next = nextConfirmState(state, event)
    timers?.clearTimeout?.(timer)
    timer = next.state === 'armed' ? timers?.setTimeout?.(() => apply('timeout'), CONFIRM_TIMEOUT) : null
    state = next.state
    render()
    if (next.confirmed) onConfirm()
  }

  button.addEventListener('click', () => apply('press'))
  cancel.addEventListener('click', () => apply('cancel'))
  render()
  return {
    node,
    reset: () => apply('reset'),
    get state() {
      return state
    },
  }
}

function buildControls(doc) {
  const keyCap = (key) => element(doc, 'kbd', { className: 'vg-key', text: key })
  const rows = CONTROL_ROWS.map(({ keys, action }) =>
    element(doc, 'li', { className: 'vg-control' }, [
      element(doc, 'span', { className: 'vg-control-keys' }, keys.map(keyCap)),
      element(doc, 'span', { className: 'vg-control-action', text: action }),
    ]),
  )
  return element(doc, 'section', { className: 'vg-controls', attrs: { 'aria-label': 'Controls' } }, [
    element(doc, 'h3', { className: 'vg-section-title', text: 'Controls' }),
    element(doc, 'ul', { className: 'vg-control-list' }, rows),
  ])
}

// A notice line plus room for the shared "play without mouse capture" offer,
// which show() moves into whichever screen is visible (its id is unique).
function buildNotice(ctx, name) {
  const text = element(ctx.doc, 'p', { className: 'vg-notice', attrs: { role: 'status' } })
  const slot = element(ctx.doc, 'div', { className: 'vg-notice-slot' }, [text])
  text.hidden = true
  slot.hidden = true
  ctx.notices.push({ name, slot, text })
  return slot
}

function buildLogo(doc) {
  return element(doc, 'h1', { className: 'vg-logo', attrs: { id: SCREEN_HEADINGS.title } }, [
    element(doc, 'span', { className: 'vg-visually-hidden', text: 'Voxel Grove' }),
    pixelSprite(doc, logoRows(), logoColor, 'vg-logo-art'),
  ])
}

function screenNode(doc, name, children) {
  const attrs = { 'data-screen': name, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': SCREEN_HEADINGS[name] }
  const inner = element(doc, 'div', { className: 'vg-screen-inner' }, children)
  const node = element(doc, 'section', { className: `vg-screen vg-screen-${name}`, attrs }, [inner])
  node.hidden = true
  return node
}

function buildTitleScreen(ctx, { onPlay, onResetWorld }) {
  const { doc, guard } = ctx
  const play = playButton(doc, 'play-button', 'Play')
  play.addEventListener('click', guard.wrap('play', onPlay))
  const reset = createConfirmButton(ctx, { id: 'reset-button', onConfirm: guard.wrap('title-reset', onResetWorld) })
  ctx.confirms.push(reset)

  const card = element(doc, 'div', { className: 'vg-card vg-card-grass' }, [
    play,
    buildNotice(ctx, 'title'),
    buildControls(doc),
    element(doc, 'p', { className: 'vg-tip', text: COPY.tip }),
    reset.node,
  ])
  return screenNode(doc, 'title', [
    buildLogo(doc),
    element(doc, 'p', { className: 'vg-tagline', text: COPY.tagline }),
    card,
    element(doc, 'p', { className: 'vg-footnote', text: COPY.footnote }),
  ])
}

function buildPauseScreen(ctx, { onResume, onResetWorld }) {
  const { doc, guard } = ctx
  const resume = playButton(doc, 'resume-button', 'Resume')
  resume.addEventListener('click', guard.wrap('resume', onResume))
  const reset = createConfirmButton(ctx, { id: 'pause-reset-button', onConfirm: guard.wrap('pause-reset', onResetWorld) })
  ctx.confirms.push(reset)

  return screenNode(doc, 'pause', [
    element(doc, 'div', { className: 'vg-card vg-card-stone' }, [
      element(doc, 'h2', { className: 'vg-heading', text: COPY.pauseTitle, attrs: { id: SCREEN_HEADINGS.pause } }),
      element(doc, 'p', { className: 'vg-subheading', text: COPY.pauseText }),
      resume,
      buildNotice(ctx, 'pause'),
      buildControls(doc),
      reset.node,
    ]),
  ])
}

function crackedHeartColor(key, x, y) {
  return key === 'k' || CRACK.has(`${x},${y}`) ? CRACK_EDGE : DEATH_HEART_PALETTE[key]
}

function buildDeathScreen(ctx, { onRespawn }) {
  const { doc, guard } = ctx
  const respawn = makeButton(doc, { id: 'respawn-button', label: 'Respawn', variant: 'danger', large: true })
  respawn.addEventListener('click', guard.wrap('respawn', onRespawn))

  return screenNode(doc, 'death', [
    element(doc, 'div', { className: 'vg-card vg-card-danger' }, [
      pixelSprite(doc, HEART_PIXELS, crackedHeartColor, 'vg-death-heart'),
      element(doc, 'h2', { className: 'vg-heading vg-heading-danger', text: COPY.deathTitle, attrs: { id: SCREEN_HEADINGS.death } }),
      element(doc, 'p', { className: 'vg-subheading', text: COPY.deathText }),
      respawn,
    ]),
  ])
}

// Menu clicks must never count as game input (mining, placing, looking).
// 'mouseup' is left alone so a button held in-game is still released.
const SWALLOWED_EVENTS = Object.freeze(['mousedown', 'click', 'dblclick', 'contextmenu', 'wheel'])

function swallowPointer(event) {
  event.stopPropagation()
  if (event.type === 'contextmenu') event.preventDefault()
}

// Secondary action offered after the browser refused the pointer lock.
function buildUnlockedOffer(ctx, onPlayUnlocked) {
  const button = makeButton(ctx.doc, { id: UNLOCKED_BUTTON_ID, label: COPY.playUnlocked, variant: 'ghost' })
  button.addEventListener('click', ctx.guard.wrap('play-unlocked', onPlayUnlocked))
  button.hidden = true
  return button
}

export function createScreens(root, options = {}) {
  const { onPlay, onResume, onPlayUnlocked, onResetWorld, onRespawn, timers = globalThis } = options
  const doc = options.doc ?? root?.ownerDocument ?? globalThis.document
  const ctx = { doc, timers, guard: createOncePerShow(timers), notices: [], confirms: [] }
  const screens = {
    title: buildTitleScreen(ctx, { onPlay, onResetWorld }),
    pause: buildPauseScreen(ctx, { onResume, onResetWorld }),
    death: buildDeathScreen(ctx, { onRespawn }),
  }
  const offer = buildUnlockedOffer(ctx, onPlayUnlocked)
  ctx.notices[0].slot.appendChild(offer)
  const container = element(doc, 'div', { className: 'vg-screens' }, Object.values(screens))
  for (const type of SWALLOWED_EVENTS) container.addEventListener(type, swallowPointer)
  container.hidden = true
  root.appendChild(container)
  let current = null
  let notice = null
  let offering = false

  function show(name) {
    const next = name ?? null
    if (next !== null && !SCREEN_NAMES.includes(next)) return false
    doc?.activeElement?.blur?.()
    ctx.guard.rearm()
    for (const confirm of ctx.confirms) confirm.reset()
    for (const [key, node] of Object.entries(screens)) node.hidden = key !== next
    ctx.notices.find((entry) => entry.name === next)?.slot.appendChild(offer)
    container.hidden = next === null
    current = next
    return true
  }

  // `offerUnlocked` adds the "play without mouse capture" button under the
  // notice; any later notice without it hides the button again.
  function setNotice(text, { offerUnlocked = false } = {}) {
    const next = text === null || text === undefined || text === '' ? null : String(text)
    const nextOffer = Boolean(offerUnlocked) && next !== null
    if (next === notice && nextOffer === offering) return
    notice = next
    offering = nextOffer
    offer.hidden = !nextOffer
    for (const { slot, text: line } of ctx.notices) {
      slot.hidden = next === null
      line.hidden = next === null
      line.textContent = next ?? ''
    }
  }

  return {
    element: container,
    show,
    setNotice,
    get current() {
      return current
    },
    get notice() {
      return notice
    },
    dispose() {
      ctx.guard.rearm()
      for (const confirm of ctx.confirms) confirm.reset()
      container.remove()
    },
  }
}

// The fatal message names WebGL when that is what failed (the usual cause).
export function fatalMessage(error) {
  const text = String(error?.message ?? error ?? '')
  return /webgl|context/i.test(text) ? FATAL_COPY.webgl : FATAL_COPY.generic
}

// Replaces everything in `root` with a readable start-up failure screen.
export function showFatalError(root, error, { doc = root?.ownerDocument ?? globalThis.document } = {}) {
  if (!root || !doc) return null
  const card = element(doc, 'div', { className: 'vg-card vg-card-danger' }, [
    element(doc, 'h2', { className: 'vg-heading vg-heading-danger', text: FATAL_COPY.title, attrs: { id: 'vg-fatal-heading' } }),
    element(doc, 'p', { className: 'vg-subheading', text: fatalMessage(error), attrs: { id: 'vg-fatal-message' } }),
  ])
  const attrs = { role: 'alertdialog', 'aria-labelledby': 'vg-fatal-heading', 'aria-describedby': 'vg-fatal-message' }
  const node = element(doc, 'section', { className: 'vg-screen vg-screen-fatal', attrs }, [
    element(doc, 'div', { className: 'vg-screen-inner' }, [card]),
  ])
  root.textContent = ''
  root.appendChild(node)
  return node
}
