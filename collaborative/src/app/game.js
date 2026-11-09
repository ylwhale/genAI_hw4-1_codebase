// Connects input, simulation, views, and menus, and runs the frame loop.
// Pointer lock controls play/pause; free look is the fallback when capture fails.

import { MAX_FRAME_DT, STORAGE_KEY } from '../config.js'
import { HOTBAR_BLOCKS, getBlockType } from '../world/blocks.js'
import { TOOLS } from '../interaction/tools.js'
import { MOB_TYPES } from '../mobs/mobTypes.js'
import { BLOCK_FACES } from '../render/textures.js'
import { createHud } from '../ui/hud.js'
import { createScreens } from '../ui/screens.js'
import { blockIconSize, createBlockIcon } from '../ui/icons.js'
import { createInput } from './input.js'
import { createGameState } from '../game/gameState.js'
import { createSimulation } from '../game/simulation.js'
import { createGameView } from './gameView.js'

const MOVE_KEYS = Object.freeze({ forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space' })
const SLOT_KEYS = Object.freeze(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'])
export const LOCK_GRACE_MS = 1200 // after a respawn, show Resume if the lock never arrives

export const NOTICES = Object.freeze({
  lockFailed: "Couldn't capture the mouse. Wait a moment, then click again.",
  freeLookHint: 'Mouse not captured: move the mouse over the game to look around. Press Esc to pause.',
  reset: 'World reset to its original terrain.',
  synced: 'World updated from another tab.',
})

const RESTORE_NOTICES = Object.freeze({
  corrupt: 'Your saved world could not be read, so a fresh world was generated.',
  incompatible: "Your saved world doesn't match this version of the game, so a fresh world was generated.",
  unavailable: 'Browser storage is unavailable: world edits will not be saved.',
})

// One isometric icon per hotbar block, drawn at `size` device pixels.
function hotbarIcons(atlas, size, doc) {
  return HOTBAR_BLOCKS.map((blockId) => {
    const faces = BLOCK_FACES[blockId]
    return createBlockIcon(atlas.tilePixels(faces.top), atlas.tilePixels(faces.side), size, { doc })
  })
}

function hotbarSlots(icons) {
  return HOTBAR_BLOCKS.map((blockId, index) => ({ blockId, name: getBlockType(blockId).name, icon: icons[index] }))
}

// The interface's GUI scale (#ui --px, in CSS px) and the display's pixel
// ratio decide how many device pixels a hotbar icon covers.
function iconSizeFor(win, uiRoot) {
  const artPixel = Number.parseFloat(win.getComputedStyle?.(uiRoot)?.getPropertyValue?.('--px'))
  return blockIconSize(artPixel, win.devicePixelRatio)
}

// Event-driven HUD updates; per-frame values are pushed in frame().
function bindHud(events, hud, notify) {
  events.on('hotbar:select', ({ index }) => hud.setSelectedSlot(index))
  events.on('tool:change', ({ tool }) => hud.setTool(tool))
  events.on('player:damaged', ({ amount, health, maxHealth }) => {
    hud.setHealth(health, maxHealth)
    hud.flashDamage(amount)
  })
  events.on('player:swing', ({ hit }) => hit && hud.flashHit(false))
  events.on('mob:killed', ({ mob }) => {
    hud.flashHit(true)
    hud.showToast(`${MOB_TYPES[mob.type]?.name ?? 'Monster'} defeated`)
  })
  events.on('player:respawned', () => hud.flashRespawn())
  events.on('world:reset', () => notify(NOTICES.reset))
}

function readControls(input) {
  const move = {}
  for (const [name, code] of Object.entries(MOVE_KEYS)) move[name] = input.isDown(code)
  return {
    move,
    look: input.consumeLook(),
    primaryPressed: input.consumeMousePress(0),
    primaryHeld: input.isMouseDown(0),
    secondaryPressed: input.consumeMousePress(2),
  }
}

export function createGame({
  appRoot,
  uiRoot,
  storage,
  doc = globalThis.document,
  win = globalThis.window,
  createSim = createSimulation,
  createView = createGameView,
  timers = globalThis,
}) {
  const sim = createSim({ storage })
  const view = createView({ container: appRoot, sim })
  const state = createGameState()
  const input = createInput(view.domElement, { win, doc, enabled: false }) // menus first: play enables it
  let iconSize = iconSizeFor(win, uiRoot)
  const hud = createHud(uiRoot, { slots: hotbarSlots(hotbarIcons(view.atlas, iconSize, doc)), tools: TOOLS, doc, timers })
  const screens = createScreens(uiRoot, {
    onPlay: requestPlay,
    onResume: requestPlay,
    onPlayUnlocked: playUnlocked,
    onResetWorld: resetWorld,
    onRespawn: respawn,
    doc,
    timers,
  })
  const pointerLockSupported = typeof view.domElement?.requestPointerLock === 'function'
  let lastTime = null
  const reportedErrors = new Set()

  function syncHud() {
    hud.setSelectedSlot(sim.selectedSlot)
    hud.setTool(sim.toolbelt.current)
    hud.setHealth(sim.player.health.current, sim.player.health.max)
  }

  // A visible menu gets the message as its notice: the HUD is hidden or
  // covered there, and a toast would only surface, stale, once play starts.
  function notify(text, tone = 'info') {
    if (screens.current) screens.setNotice(text)
    else hud.showToast(text, { tone })
  }

  function requestPlay() {
    screens.setNotice(null)
    if (pointerLockSupported) input.requestLock()
    else playUnlocked() // no Pointer Lock API at all: free look straight away
  }

  // Fallback when the browser refuses (or lacks) pointer lock.
  function playUnlocked() {
    if (state.mode !== 'title' && state.mode !== 'paused') return
    screens.setNotice(null)
    input.setFreeLook(true)
    hud.setHint(NOTICES.freeLookHint)
    enterPlay()
  }

  function enterPlay() {
    const action = state.mode === 'title' ? 'play' : 'resume'
    if (!state.dispatch(action)) return
    input.clear()
    input.setEnabled(true)
    lastTime = null
    doc.activeElement?.blur?.()
    screens.show(null)
    // Never sit in 'playing' with a dead player (e.g. killed on a pause frame).
    if (sim.player.health.isDead) onDeath()
  }

  function pause() {
    if (state.mode !== 'playing') return
    sim.cancelAction('pause')
    state.dispatch('pause')
    input.clear()
    input.setEnabled(false)
    screens.show('pause')
  }

  function onDeath() {
    if (!state.dispatch('die')) return
    input.clear()
    input.setEnabled(false)
    screens.show('death')
    input.exitLock()
  }

  // Respawn immediately; gameplay resumes as soon as the mouse is recaptured.
  function respawn() {
    if (state.mode !== 'dead') return
    sim.respawn()
    state.dispatch('respawn')
    syncHud()
    screens.show(null)
    requestPlay()
    timers.setTimeout(showPauseIfStillWaiting, LOCK_GRACE_MS)
  }

  function showPauseIfStillWaiting() {
    if (state.mode === 'paused' && screens.current === null) screens.show('pause')
  }

  function resetWorld() {
    sim.resetWorld()
    syncHud()
  }

  function onLockChange(locked) {
    if (!locked) {
      pause()
      return
    }
    hud.setHint(null) // the input has left free look: the mouse is captured now
    enterPlay()
  }

  function onLockError() {
    if (state.mode !== 'title' && state.mode !== 'paused') return
    screens.show(state.mode === 'title' ? 'title' : 'pause')
    screens.setNotice(NOTICES.lockFailed, { offerUnlocked: true })
  }

  // Another tab saved the world: adopt its edits so the tabs stop
  // overwriting each other (null key = that tab cleared all storage).
  function onStorage(event) {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    const result = sim.reloadSavedEdits()
    const status = typeof result === 'string' ? result : result?.status
    notify(RESTORE_NOTICES[status] ?? NOTICES.synced)
  }

  // Re-render the hotbar icons when the GUI scale or pixel ratio changes.
  function refreshIcons() {
    const size = iconSizeFor(win, uiRoot)
    if (size === iconSize) return
    iconSize = size
    hud.setSlotIcons(hotbarIcons(view.atlas, size, doc))
  }

  function handleSelectionKeys() {
    SLOT_KEYS.forEach((code, index) => input.consumePress(code) && sim.selectSlot(index))
    if (input.consumePress('KeyQ')) sim.cycleTool()
    const wheelSteps = input.consumeWheel()
    for (let i = 0; i < Math.abs(wheelSteps); i++) sim.cycleSlot(wheelSteps)
    // Without pointer lock the browser does not pause for us on Escape.
    if (input.consumePress('Escape') && !input.isLocked) pause()
  }

  // Selection keys may pause (Esc without lock), so the mode is checked again
  // before stepping: a paused frame never advances physics, AI or damage.
  function stepGameplay(dt) {
    if (!state.isSimulating) {
      input.consumeLook()
      return
    }
    handleSelectionKeys()
    if (state.isSimulating) sim.update(dt, readControls(input))
  }

  function reportOnce(error) {
    const key = String(error?.stack ?? error)
    if (reportedErrors.has(key)) return
    reportedErrors.add(key)
    console.error('Voxel Grove frame error:', error)
  }

  // The loop keeps running even if one frame throws, so a single bad frame
  // can never freeze the game.
  function frame(time) {
    const dt = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, MAX_FRAME_DT)
    lastTime = time
    try {
      stepGameplay(dt)
      hud.setAttackCooldown(sim.combat.cooldownFraction)
      hud.setTarget(state.isSimulating && sim.lastFrame.mobTarget ? 'mob' : null)
      view.update(dt, state.mode)
    } catch (error) {
      reportOnce(error)
    }
  }

  input.onLockChange(onLockChange)
  input.onLockError(onLockError)
  doc.addEventListener('visibilitychange', () => doc.hidden && pause())
  // Without capture nothing else notices the player leaving the window.
  win.addEventListener('blur', () => input.freeLook && pause())
  win.addEventListener('storage', onStorage)
  win.addEventListener('resize', refreshIcons)
  sim.events.on('player:died', onDeath)
  state.onChange(({ mode }) => hud.setVisible(mode !== 'title'))
  bindHud(sim.events, hud, notify)

  syncHud()
  hud.setVisible(false)
  screens.show('title')
  screens.setNotice(RESTORE_NOTICES[sim.restoreResult.status] ?? null)
  // Subscribed once the title is up: a save that is already failing reports
  // immediately, and lands as the title notice rather than a hidden toast.
  sim.persistence.onSaveError(() => notify(RESTORE_NOTICES.unavailable, 'warn'))
  view.renderer.setAnimationLoop(frame)

  return {
    sim,
    state,
    view,
    input,
    hud,
    screens,
    // Automation hook: enter gameplay without pointer lock (used for
    // scripted browser verification where the lock cannot be granted).
    forcePlay: enterPlay,
    playUnlocked,
    pause,
  }
}
