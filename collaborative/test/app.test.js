// Browser glue (src/app/game.js) driven end to end: the fake DOM from
// ui-helpers.js, the real simulation with in-memory storage, and a stub view
// that only records the modes it was asked to draw. Covers the SPEC interface
// rules that live in the wiring: menus block gameplay, the lock gates play,
// pausing freezes the simulation, death and respawn, hidden tabs, other tabs,
// and the free-look fallback when the browser refuses the pointer lock.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STORAGE_KEY } from '../src/config.js'
import { LOCK_GRACE_MS, NOTICES, createGame } from '../src/app/game.js'
import { createSimulation } from '../src/game/simulation.js'
import { BLOCK } from '../src/world/blocks.js'
import { createFakeDom, createFakeTimers, fire, keyDown } from './ui-helpers.js'
import { memoryStorage } from './helpers.js'

const FRAME_MS = 1000 / 60

function stubView(element) {
  const view = {
    domElement: element,
    atlas: { tilePixels: () => new Uint8ClampedArray(16 * 16 * 4) },
    modes: [],
    loop: null,
    renderer: { setAnimationLoop: (fn) => (view.loop = fn) },
    update: (dt, mode) => view.modes.push(mode),
    dispose() {},
  }
  return view
}

function boot({ lock = 'grant', storage = memoryStorage(), canvas = 'none', createSim = createSimulation } = {}) {
  const dom = createFakeDom({ lock, canvas })
  const timers = createFakeTimers()
  const game = createGame({
    appRoot: dom.app,
    uiRoot: dom.ui,
    storage,
    doc: dom.doc,
    win: dom.win,
    timers,
    createSim,
    createView: () => stubView(dom.element),
  })
  let time = 0
  const frame = (ms = FRAME_MS) => {
    time += ms
    game.view.loop(time)
  }
  const frames = (count, ms) => {
    for (let i = 0; i < count; i++) frame(ms)
  }
  const byId = (id) => dom.doc.getElementById(id)
  return { ...dom, timers, game, sim: game.sim, frame, frames, byId, click: (id) => byId(id).click() }
}

// Lets the fake pointer-lock promise chains settle.
const settle = () => new Promise((resolve) => setImmediate(resolve))

async function playing(options) {
  const t = boot(options)
  t.click('play-button')
  await settle()
  assert.equal(t.game.state.mode, 'playing')
  t.frames(2)
  return t
}

// Everything a simulation step could change.
function snapshot(sim) {
  return JSON.stringify({
    player: sim.player.position,
    velocity: sim.player.velocity,
    health: sim.player.health.current,
    mobs: sim.mobs.mobs.map((mob) => [mob.position, mob.velocity, mob.health]),
  })
}

function kill(sim) {
  sim.player.health.damage(sim.player.health.current)
  sim.events.emit('player:died', {})
}

// ---------- pointer lock gates play ----------

test('Play enters the game only once the pointer lock is granted', async () => {
  const t = boot()
  t.frames(2)
  assert.equal(t.game.input.enabled, false, 'the title screen is a menu: no game input')
  t.click('play-button')
  assert.equal(t.game.state.mode, 'title', 'still on the title while the lock is pending')
  assert.equal(t.element.lockRequests, 1)
  await settle()
  assert.equal(t.game.state.mode, 'playing')
  assert.equal(t.game.screens.current, null)
  assert.equal(t.game.input.enabled, true)
  assert.equal(t.game.input.freeLook, false)
  assert.equal(t.ui.querySelector('.vg-hud').hidden, false)
})

test('a refused lock keeps the title up with a notice and the free-look offer', async () => {
  const t = boot({ lock: 'reject' })
  t.click('play-button')
  await settle()
  assert.equal(t.game.state.mode, 'title')
  assert.equal(t.game.screens.current, 'title')
  assert.equal(t.game.screens.notice, NOTICES.lockFailed)
  assert.equal(t.byId('play-unlocked-button').hidden, false)
})

// ---------- free-look fallback ----------

test('free look: play without capture turns the view, shows the Esc hint, and Esc pauses', async () => {
  const t = boot({ lock: 'reject' })
  t.click('play-button')
  await settle()
  t.click('play-unlocked-button')
  assert.equal(t.game.state.mode, 'playing')
  assert.equal(t.game.input.freeLook, true)
  const hint = t.ui.querySelector('.vg-hint')
  assert.equal(hint.hidden, false)
  assert.match(hint.textContent, /Esc to pause/)

  t.frames(2)
  const yaw = t.sim.player.yaw
  fire(t.element, 'mousemove', { movementX: 40, movementY: 0 })
  t.frame()
  assert.notEqual(t.sim.player.yaw, yaw, 'mouse movement turns the view without a lock')

  keyDown(t.doc.body, 'Escape')
  t.frame()
  assert.equal(t.game.state.mode, 'paused')
  assert.equal(t.game.screens.current, 'pause')
})

test('without the Pointer Lock API, Play goes straight to free look', () => {
  const t = boot({ lock: 'none' })
  t.click('play-button')
  assert.equal(t.game.state.mode, 'playing')
  assert.equal(t.game.input.freeLook, true)
  assert.match(t.ui.querySelector('.vg-hint').textContent, /Esc/)
})

test('in free look, leaving the window pauses (no lock loss will)', () => {
  const t = boot({ lock: 'none' })
  t.click('play-button')
  fire(t.win, 'blur')
  assert.equal(t.game.state.mode, 'paused')
})

test('acquiring the lock later turns free look off and clears the hint', async () => {
  const t = boot({ lock: 'reject' })
  t.click('play-button')
  await settle()
  t.click('play-unlocked-button')
  keyDown(t.doc.body, 'Escape')
  t.frame()
  assert.equal(t.game.state.mode, 'paused')
  // The browser now grants the lock.
  t.element.requestPointerLock = () => {
    t.doc.pointerLockElement = t.element
    fire(t.doc, 'pointerlockchange')
  }
  t.click('resume-button')
  await settle()
  assert.equal(t.game.state.mode, 'playing')
  assert.equal(t.game.input.freeLook, false)
  assert.equal(t.ui.querySelector('.vg-hint').hidden, true)
})

// ---------- pausing freezes the simulation ----------

test('losing the lock pauses and the simulation stops advancing', async () => {
  const t = await playing()
  t.sim.player.velocity.x = 3
  t.doc.revokePointerLock()
  assert.equal(t.game.state.mode, 'paused')
  assert.equal(t.game.screens.current, 'pause')
  const before = snapshot(t.sim)
  t.frames(30)
  assert.equal(snapshot(t.sim), before)
  assert.equal(t.game.view.modes.at(-1), 'paused', 'the view still draws the frozen scene')
})

// Regression: Esc without a lock paused, then the same frame still ran a full
// simulation step (mobs could hit the paused player, even lethally).
test('Escape without a lock pauses before the frame simulates', () => {
  const t = boot({ lock: 'none' })
  t.click('play-button')
  t.frames(3)
  const [mob] = t.sim.mobs.aliveMobs()
  Object.assign(mob.position, { x: t.sim.player.position.x + 1.2, y: t.sim.player.position.y, z: t.sim.player.position.z })
  t.sim.player.velocity.x = 3
  const before = snapshot(t.sim)
  keyDown(t.doc.body, 'Escape')
  t.frame(100)
  assert.equal(t.game.state.mode, 'paused')
  assert.equal(snapshot(t.sim), before, 'no physics, AI or damage on the pausing frame')
})

test('a hidden tab pauses and cancels the timed action', async () => {
  const t = await playing()
  const cancels = []
  t.sim.events.on('action:cancel', ({ reason }) => cancels.push(reason))
  t.sim.player.pitch = -1.4 // look at the ground in front of the feet
  fire(t.element, 'mousedown', { button: 0 })
  t.frame()
  assert.equal(t.sim.actions.active?.kind, 'break')
  t.doc.setHidden(true)
  assert.equal(t.game.state.mode, 'paused')
  assert.deepEqual(cancels, ['pause'])
})

// ---------- death and respawn ----------

test('death releases the lock and shows the death screen', async () => {
  const t = await playing()
  kill(t.sim)
  assert.equal(t.game.state.mode, 'dead')
  assert.equal(t.game.screens.current, 'death')
  assert.equal(t.doc.pointerLockElement, null)
  assert.equal(t.doc.exitCalls, 1)
  assert.equal(t.game.input.enabled, false)
  assert.equal(t.game.state.mode, 'dead', 'the lock loss caused by exitLock does not pause a dead player')
})

test('respawn waits, paused, for a new lock; the pause screen appears after the grace delay', async () => {
  const t = await playing()
  kill(t.sim)
  t.element.requestPointerLock = () => new Promise(() => {}) // the browser sits on the request
  t.click('respawn-button')
  assert.equal(t.game.state.mode, 'paused')
  assert.equal(t.game.screens.current, null, 'no menu while the lock may still arrive')
  assert.equal(t.sim.player.health.current, t.sim.player.health.max)
  const before = snapshot(t.sim)
  t.frames(20)
  assert.equal(snapshot(t.sim), before, 'frozen until the mouse is captured')
  t.timers.advance(LOCK_GRACE_MS - 1)
  assert.equal(t.game.screens.current, null)
  t.timers.advance(1)
  assert.equal(t.game.screens.current, 'pause')
})

test('respawn resumes play as soon as the lock is granted again', async () => {
  const t = await playing()
  kill(t.sim)
  t.click('respawn-button')
  assert.equal(t.game.state.mode, 'paused')
  await settle()
  assert.equal(t.game.state.mode, 'playing')
  t.timers.advance(LOCK_GRACE_MS)
  assert.equal(t.game.screens.current, null, 'the grace timer does not cover a running game')
})

// Regression hardening: a player who died on a pause frame must never sit in
// 'playing' (the simulation refuses to update a dead player).
test('resuming with a dead player goes straight to the death flow', async () => {
  const t = await playing()
  t.doc.revokePointerLock()
  t.sim.player.health.damage(t.sim.player.health.current) // killed without a 'player:died' in 'playing'
  t.click('resume-button')
  await settle()
  assert.equal(t.game.state.mode, 'dead')
  assert.equal(t.game.screens.current, 'death')
  assert.equal(t.doc.pointerLockElement, null, 'the lock is released for the Respawn button')
})

// ---------- menus never act as game input ----------

test('menu clicks never mine, place or swing', async () => {
  const t = boot()
  const acted = []
  for (const type of ['action:start', 'player:swing']) t.sim.events.on(type, () => acted.push(type))
  t.sim.player.pitch = -1.4 // a block is in reach, so any stray click would act
  for (const button of [0, 2]) fire(t.byId('play-button'), 'mousedown', { button })
  t.click('play-button')
  await settle()
  t.frames(10)
  t.doc.revokePointerLock()
  for (const button of [0, 2]) fire(t.byId('resume-button'), 'mousedown', { button })
  t.click('resume-button')
  await settle()
  t.frames(10)
  assert.equal(t.game.state.mode, 'playing')
  assert.deepEqual(acted, [])

  fire(t.element, 'mousedown', { button: 0 }) // control: a real game click does act
  t.frame()
  assert.deepEqual(acted, ['action:start'])
})

// ---------- notices ----------

// Regression: the reset confirmation was a toast in the hidden HUD, which
// then popped up stale once play started.
test('Reset World on the title shows a screen notice and no toast', async () => {
  const t = boot()
  t.sim.world.setBlock(16, 20, 16, BLOCK.STONE)
  t.click('reset-button')
  t.click('reset-button')
  assert.equal(t.sim.world.getBlock(16, 20, 16), BLOCK.AIR, 'the world was reset')
  assert.equal(t.game.screens.notice, NOTICES.reset)
  assert.deepEqual(t.game.hud.toastMessages(), [])
  t.click('play-button')
  await settle()
  assert.deepEqual(t.game.hud.toastMessages(), [], 'nothing stale appears in play')
})

test('Reset World from the pause screen shows the notice there', async () => {
  const t = await playing()
  t.doc.revokePointerLock()
  t.click('pause-reset-button')
  t.click('pause-reset-button')
  assert.equal(t.game.screens.current, 'pause')
  assert.equal(t.game.screens.notice, NOTICES.reset)
  assert.deepEqual(t.game.hud.toastMessages(), [])
})

test('a failing save warns once with a warn-toned toast during play', async () => {
  const quotaFull = () => {
    throw new Error('QuotaExceededError')
  }
  const storage = { ...memoryStorage(), setItem: quotaFull }
  const t = await playing({ storage })
  t.sim.world.setBlock(16, 20, 16, BLOCK.STONE)
  t.sim.world.setBlock(16, 21, 16, BLOCK.STONE)
  assert.deepEqual(t.game.hud.toastMessages(), ['Browser storage is unavailable: world edits will not be saved.'])
  assert.equal(t.ui.querySelector('.vg-toast').getAttribute('data-tone'), 'warn')
})

// ---------- other tabs ----------

test('a storage event for the save key reloads the saved edits', async () => {
  let reloads = 0
  const createSim = (options) => {
    const sim = createSimulation(options)
    const reload = sim.reloadSavedEdits
    sim.reloadSavedEdits = () => {
      reloads++
      return reload.call(sim)
    }
    return sim
  }
  const t = boot({ createSim })
  fire(t.win, 'storage', { key: 'something-else' })
  assert.equal(reloads, 0, 'unrelated keys are ignored')
  fire(t.win, 'storage', { key: STORAGE_KEY })
  assert.equal(reloads, 1)
  assert.equal(t.game.screens.notice, NOTICES.synced, 'shown on the title screen')

  t.click('play-button')
  await settle()
  fire(t.win, 'storage', { key: null }) // the other tab cleared all storage
  assert.equal(reloads, 2)
  assert.deepEqual(t.game.hud.toastMessages(), [NOTICES.synced])
})

test('two tabs sharing storage keep each other’s edits', async () => {
  const storage = memoryStorage()
  const a = boot({ storage })
  const b = boot({ storage })
  b.sim.world.setBlock(9, 20, 9, BLOCK.DIRT) // B saves; the browser tells A
  fire(a.win, 'storage', { key: STORAGE_KEY })
  assert.equal(a.sim.world.getBlock(9, 20, 9), BLOCK.DIRT, 'A adopted B’s edit')
  a.sim.world.setBlock(5, 20, 5, BLOCK.STONE)
  const reloaded = createSimulation({ storage })
  assert.equal(reloaded.world.getBlock(9, 20, 9), BLOCK.DIRT, 'A’s next save kept B’s edit')
  assert.equal(reloaded.world.getBlock(5, 20, 5), BLOCK.STONE)
})

// ---------- HUD values ----------

test('hotbar icons are drawn at the displayed size and redrawn when the GUI scale changes', () => {
  const t = boot({ canvas: 'ok' })
  const icons = () => t.ui.querySelectorAll('.vg-slot img').map((img) => img.getAttribute('src'))
  assert.ok(icons().length > 0)
  assert.ok(icons().every((src) => src.endsWith('FAKE32x32')), '16 art px x 2 px at a 1x pixel ratio')
  t.win.getComputedStyle = () => ({ getPropertyValue: (name) => (name === '--px' ? ' 3px' : '') })
  t.win.devicePixelRatio = 2
  fire(t.win, 'resize')
  assert.ok(icons().every((src) => src.endsWith('FAKE96x96')))
})

test('the attack-recharge indicator follows the combat cooldown fraction', async () => {
  const t = await playing()
  const meter = t.ui.querySelector('.vg-cooldown')
  assert.equal(meter.hidden, true)
  t.sim.combat.attack({ position: { x: 0, y: 0, z: 0 } }, () => ({ applied: 0, killed: false }))
  t.frame()
  assert.equal(meter.hidden, false)
  t.frames(60)
  assert.equal(meter.hidden, true, 'hidden again once ready')
})
