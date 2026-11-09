// Builds the HUD once; setters cache values to avoid redundant DOM updates.
// The HUD does not receive pointer events.

import { PLAYER } from '../config.js'
import { clamp } from '../core/math.js'
import { getBlockType } from '../world/blocks.js'
import {
  HEART_PIXELS,
  HIT_MARKER_PIXELS,
  TOOL_SPRITES,
  cubeSpriteRows,
  element,
  pixelSprite,
  replayClass,
  shadeColor,
} from './icons.js'

export const HEART_COUNT = 10
export const TOAST_LIMIT = 3
export const TOAST_DURATION = 2600 // ms, matching the CSS toast animation
const TOAST_TONES = Object.freeze(['info', 'success', 'warn', 'danger'])

const HEART_PALETTE = Object.freeze({
  k: 'var(--heart-edge)',
  l: 'var(--heart-left)',
  h: 'var(--heart-shine)',
  r: 'var(--heart-right)',
  s: 'var(--heart-shade)',
})
const TOOL_PALETTE = Object.freeze({ w: '#a8733f', m: '#b9c1c8', h: '#f3f6f8' })
const HIT_PALETTE = Object.freeze({ x: 'var(--hit-color)' })
const CUBE_ROWS = cubeSpriteRows()
const FALLBACK_BLOCK_COLOR = 0x8a8f94

// Ten hearts in half-heart steps. Any health above zero shows at least half a
// heart, so the player never sees an empty row while still alive.
export function heartStates(current, max, count = HEART_COUNT) {
  const halves = filledHalves(current, max, count)
  return Array.from({ length: count }, (_, i) => {
    const filled = halves - i * 2
    if (filled >= 2) return 'full'
    return filled === 1 ? 'half' : 'empty'
  })
}

function filledHalves(current, max, count) {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0 || current <= 0) return 0
  return Math.ceil((Math.min(current, max) * count * 2) / max - 1e-9)
}

// Health shown as whole numbers, rounded up while alive ("1 / 100", never "0").
export function healthLabel(current, max) {
  const top = Number.isFinite(max) && max > 0 ? Math.round(max) : 0
  const value = Number.isFinite(current) && current > 0 ? Math.ceil(Math.min(current, top)) : 0
  return `${value} / ${top}`
}

export function healthTone(current, max) {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0 || current <= 0) return 'empty'
  const fraction = current / max
  if (fraction <= 0.25) return 'low'
  return fraction <= 0.5 ? 'mid' : 'ok'
}

// Remaining attack cooldown as an integer percentage; 0 means ready. Rounds up
// so the bar only disappears once the attack is truly available.
export function quantizeCooldown(fraction) {
  if (!(fraction > 0)) return 0
  return Math.min(100, Math.ceil(fraction * 100 - 1e-9))
}

function normalizeSlots(slots) {
  return (Array.isArray(slots) ? slots : []).map((slot, index) => ({
    blockId: slot?.blockId,
    name: slot?.name ?? getBlockType(slot?.blockId)?.name ?? `Slot ${index + 1}`,
    icon: typeof slot?.icon === 'string' ? slot.icon : '',
  }))
}

function cubePalette(blockId) {
  const base = getBlockType(blockId)?.particle ?? FALLBACK_BLOCK_COLOR
  return { t: shadeColor(base, 1.08), l: shadeColor(base, 0.8), r: shadeColor(base, 0.6) }
}

function slotIcon(doc, slot) {
  if (slot.icon) {
    return element(doc, 'img', { className: 'vg-slot-icon', attrs: { src: slot.icon, alt: '', draggable: 'false' } })
  }
  return pixelSprite(doc, CUBE_ROWS, cubePalette(slot.blockId), 'vg-slot-icon vg-slot-cube')
}

function buildHotbar(doc, slots) {
  const icons = slots.map((slot) => slotIcon(doc, slot))
  const nodes = slots.map((slot, index) =>
    element(doc, 'li', { className: 'vg-slot', attrs: { 'data-slot': index, 'aria-label': `${index + 1}: ${slot.name}` } }, [
      element(doc, 'span', { className: 'vg-slot-key', text: index + 1 }),
      icons[index],
    ]),
  )
  return { node: element(doc, 'ol', { className: 'vg-hotbar', attrs: { 'aria-label': 'Blocks' } }, nodes), slots: nodes, icons }
}

function buildToolChip(doc, tools) {
  const sprites = new Map()
  for (const tool of tools) {
    if (!TOOL_SPRITES[tool.key] || sprites.has(tool.key)) continue
    const sprite = pixelSprite(doc, TOOL_SPRITES[tool.key], TOOL_PALETTE, 'vg-tool-icon')
    sprite.hidden = true
    sprites.set(tool.key, sprite)
  }
  const name = element(doc, 'span', { className: 'vg-tool-name' })
  const pips = tools.map(() => element(doc, 'i', { className: 'vg-tool-pip' }))
  const node = element(doc, 'div', { className: 'vg-tool' }, [
    element(doc, 'kbd', { className: 'vg-key', text: 'Q' }),
    ...sprites.values(),
    element(doc, 'span', { className: 'vg-tool-text' }, [
      element(doc, 'span', { className: 'vg-tool-caption', text: 'Tool' }),
      name,
    ]),
    element(doc, 'span', { className: 'vg-tool-pips' }, pips),
  ])
  return { node, name, pips, sprites }
}

function buildVitals(doc) {
  const hearts = Array.from({ length: HEART_COUNT }, () => {
    const heart = pixelSprite(doc, HEART_PIXELS, HEART_PALETTE, 'vg-heart')
    heart.setAttribute('data-state', 'full')
    return heart
  })
  const heartRow = element(doc, 'div', { className: 'vg-hearts', attrs: { role: 'img' } }, hearts)
  const fill = element(doc, 'span', { className: 'vg-health-fill' })
  const text = element(doc, 'span', { className: 'vg-health-text' })
  const node = element(doc, 'div', { className: 'vg-vitals' }, [
    heartRow,
    element(doc, 'div', { className: 'vg-health-meter' }, [element(doc, 'span', { className: 'vg-health-track' }, [fill]), text]),
  ])
  return { node, heartRow, hearts, fill, text }
}

function buildReticle(doc) {
  const crosshair = element(doc, 'div', { className: 'vg-crosshair', attrs: { 'data-target': 'none' } }, [
    element(doc, 'i', { className: 'vg-crosshair-bar vg-crosshair-h' }),
    element(doc, 'i', { className: 'vg-crosshair-bar vg-crosshair-v' }),
  ])
  const hitMarker = pixelSprite(doc, HIT_MARKER_PIXELS, HIT_PALETTE, 'vg-hitmarker')
  const cooldownFill = element(doc, 'span', { className: 'vg-cooldown-fill' })
  const cooldown = element(doc, 'div', { className: 'vg-cooldown' }, [cooldownFill])
  cooldown.hidden = true
  const node = element(doc, 'div', { className: 'vg-reticle' }, [crosshair, hitMarker, cooldown])
  return { node, crosshair, hitMarker, cooldown, cooldownFill }
}

// Transient messages, newest last. Repeating a visible message refreshes it
// instead of stacking duplicates; the oldest is dropped beyond TOAST_LIMIT.
function createToastStack(doc, timers) {
  const node = element(doc, 'div', { className: 'vg-toasts', attrs: { role: 'status', 'aria-live': 'polite' } })
  const live = []

  function remove(entry) {
    const index = live.indexOf(entry)
    if (index === -1) return
    live.splice(index, 1)
    timers?.clearTimeout?.(entry.timer)
    entry.node.remove()
  }

  function show(text, { tone = 'info', duration = TOAST_DURATION } = {}) {
    const message = text === null || text === undefined ? '' : String(text).trim()
    if (!message) return false
    const previous = live.find((entry) => entry.text === message)
    if (previous) remove(previous)
    const ms = Number.isFinite(duration) && duration > 0 ? duration : TOAST_DURATION
    const toast = element(doc, 'div', {
      className: 'vg-toast',
      text: message,
      attrs: { 'data-tone': TOAST_TONES.includes(tone) ? tone : 'info' },
    })
    toast.style.animationDuration = `${ms}ms`
    const entry = { text: message, node: toast, timer: null }
    entry.timer = timers?.setTimeout?.(() => remove(entry), ms)
    live.push(entry)
    node.appendChild(toast)
    while (live.length > TOAST_LIMIT) remove(live[0])
    return true
  }

  function clear() {
    while (live.length) remove(live[0])
  }

  return { node, show, clear, messages: () => live.map((entry) => entry.text) }
}

export function createHud(root, options = {}) {
  const { slots, tools, timers = globalThis } = options
  const doc = options.doc ?? root?.ownerDocument ?? globalThis.document
  const slotList = normalizeSlots(slots)
  const toolList = Array.isArray(tools) ? tools.filter((tool) => tool && tool.key) : []
  const hotbar = buildHotbar(doc, slotList)
  const toolChip = buildToolChip(doc, toolList)
  const vitals = buildVitals(doc)
  const reticle = buildReticle(doc)
  const toasts = createToastStack(doc, timers)
  const label = element(doc, 'div', { className: 'vg-block-label', attrs: { 'aria-live': 'polite' } })
  const hint = element(doc, 'div', { className: 'vg-hint' })
  const vignette = element(doc, 'div', { className: 'vg-vignette' })
  const fade = element(doc, 'div', { className: 'vg-fade' })
  // Spacer | hotbar | tool chip: equal side columns keep the hotbar centred.
  const barRow = element(doc, 'div', { className: 'vg-bar-row' }, [
    element(doc, 'span', { className: 'vg-bar-spacer' }),
    hotbar.node,
    toolChip.node,
  ])
  hint.hidden = true

  const hud = element(doc, 'div', { className: 'vg-hud', attrs: { 'data-health': 'ok' } }, [
    vignette,
    element(doc, 'div', { className: 'vg-lowhp' }),
    reticle.node,
    toasts.node,
    element(doc, 'div', { className: 'vg-dock' }, [hint, label, vitals.node, barRow]),
    fade,
  ])
  root.appendChild(hud)

  const cache = new Map()
  let heartCache = vitals.hearts.map(() => 'full')

  // True (and remembered) when `value` differs from the last one for `key`.
  function changed(key, value) {
    if (cache.has(key) && Object.is(cache.get(key), value)) return false
    cache.set(key, value)
    return true
  }

  function setVisible(visible) {
    const next = Boolean(visible)
    if (changed('visible', next)) hud.hidden = !next
  }

  function setSelectedSlot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= slotList.length || !changed('slot', index)) return
    hotbar.slots.forEach((node, i) => {
      node.classList.toggle('is-selected', i === index)
      if (i === index) node.setAttribute('aria-current', 'true')
      else node.removeAttribute('aria-current')
    })
    label.textContent = slotList[index].name
    replayClass(label, 'is-popping')
  }

  function resolveTool(tool) {
    const key = typeof tool === 'string' ? tool : tool?.key
    if (!key) return null
    const index = toolList.findIndex((entry) => entry.key === key)
    return { key, index, name: tool?.name || toolList[index]?.name || key }
  }

  function setTool(tool) {
    const next = resolveTool(tool)
    if (!next || !changed('tool', next.key)) return
    toolChip.name.textContent = next.name
    toolChip.pips.forEach((pip, i) => pip.classList.toggle('is-active', i === next.index))
    for (const [key, sprite] of toolChip.sprites) sprite.hidden = key !== next.key
    toolChip.node.setAttribute('aria-label', `Tool: ${next.name} (press Q to switch)`)
    replayClass(toolChip.node, 'is-popping')
  }

  function renderHearts(current, max) {
    const states = heartStates(current, max)
    states.forEach((state, i) => {
      if (heartCache[i] !== state) vitals.hearts[i].setAttribute('data-state', state)
    })
    heartCache = states
  }

  function setHealth(current, max) {
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return
    const value = clamp(current, 0, max)
    if (!changed('health', `${value}/${max}`)) return
    const text = healthLabel(value, max)
    renderHearts(value, max)
    vitals.fill.style.transform = `scaleX(${value / max})`
    vitals.text.textContent = text
    vitals.heartRow.setAttribute('aria-label', `Health ${text}`)
    hud.setAttribute('data-health', healthTone(value, max))
  }

  // A brief red edge flash, stronger for bigger hits, plus a heart shake.
  function flashDamage(amount) {
    if (!(amount > 0) || !Number.isFinite(amount)) return
    const strength = Math.min(0.95, 0.45 + amount / 40)
    vignette.style.setProperty('--vg-hurt', strength.toFixed(2))
    replayClass(vignette, 'is-flashing')
    replayClass(vitals.node, 'is-hurt')
  }

  function flashHit(killed = false) {
    reticle.hitMarker.classList.remove('is-hit', 'is-kill')
    replayClass(reticle.hitMarker, killed ? 'is-kill' : 'is-hit')
  }

  function flashRespawn() {
    replayClass(fade, 'is-fading')
  }

  // Swap in icons rendered at a new size (GUI scale or pixel ratio changed).
  // Slots drawn with the CSS cube fallback keep it.
  function setSlotIcons(urls) {
    if (!Array.isArray(urls)) return
    hotbar.icons.forEach((icon, i) => {
      const url = urls[i]
      if (icon.tagName !== 'IMG' || typeof url !== 'string' || !url || !changed(`icon:${i}`, url)) return
      icon.setAttribute('src', url)
    })
  }

  function setHint(text) {
    const next = text === null || text === undefined || text === '' ? null : String(text)
    if (!changed('hint', next)) return
    hint.hidden = next === null
    if (next !== null) hint.textContent = next
  }

  // fraction = remaining cooldown / full cooldown; the bar refills to the right.
  function setAttackCooldown(fraction) {
    const percent = quantizeCooldown(fraction)
    if (!changed('cooldown', percent)) return
    reticle.cooldown.hidden = percent === 0
    reticle.cooldownFill.style.transform = `scaleX(${(100 - percent) / 100})`
  }

  // Optional crosshair tint: 'mob' when a creature is in melee reach.
  function setTarget(kind) {
    const next = kind === 'mob' || kind === 'block' ? kind : 'none'
    if (changed('target', next)) reticle.crosshair.setAttribute('data-target', next)
  }

  function dispose() {
    toasts.clear()
    hud.remove()
  }

  cache.set('visible', true)
  slotList.forEach((slot, i) => cache.set(`icon:${i}`, slot.icon))
  setSelectedSlot(0)
  if (toolList.length > 0) setTool(toolList[0])
  setHealth(PLAYER.maxHealth, PLAYER.maxHealth)

  return {
    element: hud,
    setVisible,
    setSelectedSlot,
    setTool,
    setHealth,
    flashDamage,
    flashHit,
    showToast: (text, options) => toasts.show(text, options),
    setHint,
    setSlotIcons,
    setAttackCooldown,
    flashRespawn,
    setTarget,
    toastMessages: toasts.messages,
    dispose,
  }
}
