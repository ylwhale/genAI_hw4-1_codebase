// Input state with fake DOM targets: edge-triggered presses, held keys that
// never stick, pointer-locked look, wheel steps, and pointer-lock lifecycle.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOOK_SPIKE_LIMIT,
  WHEEL_NOTCH,
  createInput,
  createPressState,
  createWheelAccumulator,
  filterLookDelta,
  isTextEntryTarget,
  normalizeWheelDelta,
} from '../src/app/input.js'
import { createFakeDom, fire, keyDown, keyUp } from './ui-helpers.js'

function setup(options = {}) {
  const dom = createFakeDom(options)
  const input = createInput(dom.element, { win: dom.win, doc: dom.doc })
  return { ...dom, input }
}

async function lockedSetup(options = {}) {
  const context = setup(options)
  assert.equal(await context.input.requestLock(), true)
  assert.equal(context.input.isLocked, true)
  return context
}

const move = (target, movementX, movementY) => fire(target, 'mousemove', { movementX, movementY })

// ---------- pure helpers ----------

test('press state records one edge per physical press and ignores auto-repeat', () => {
  const state = createPressState()
  assert.equal(state.press('KeyQ'), true)
  assert.equal(state.press('KeyQ', true), false, 'auto-repeat is not a new press')
  assert.equal(state.press('KeyQ'), false, 'a second keydown while held is not a new press')
  assert.equal(state.isDown('KeyQ'), true)
  assert.equal(state.consume('KeyQ'), true)
  assert.equal(state.consume('KeyQ'), false, 'presses are consumed once')
  state.release('KeyQ')
  assert.equal(state.isDown('KeyQ'), false)
  assert.equal(state.press('KeyQ'), true, 'pressing again after release is a fresh press')
})

test('press state keeps a tap shorter than a frame until it is consumed', () => {
  const state = createPressState()
  state.press('Digit3')
  state.release('Digit3')
  assert.equal(state.isDown('Digit3'), false)
  assert.equal(state.consume('Digit3'), true)
  assert.equal(state.consume('Digit4'), false, 'unpressed codes report false')
})

test('press state: a repeat after a clear marks the key held without a press', () => {
  const state = createPressState()
  state.press('KeyW')
  state.clear()
  assert.equal(state.isDown('KeyW'), false)
  assert.equal(state.consume('KeyW'), false, 'clear drops pending presses')
  state.press('KeyW', true)
  assert.equal(state.isDown('KeyW'), true, 'the key is physically still down')
  assert.equal(state.consume('KeyW'), false, 'but it is not a fresh press')
  state.releaseAll()
  assert.equal(state.heldCount, 0)
})

test('look spike filter accepts the limit and rejects anything beyond it', () => {
  assert.equal(LOOK_SPIKE_LIMIT, 300)
  assert.deepEqual(filterLookDelta(12, -7), { dx: 12, dy: -7 })
  assert.deepEqual(filterLookDelta(300, -300), { dx: 300, dy: -300 }, 'boundary is inclusive')
  assert.equal(filterLookDelta(301, 0), null)
  assert.equal(filterLookDelta(0, -300.5), null)
  assert.equal(filterLookDelta(Number.NaN, 0), null)
  assert.equal(filterLookDelta(0, Infinity), null)
  assert.equal(filterLookDelta(50, 0, 40), null, 'custom limit')
})

test('text-entry targets are recognised by tag or contentEditable', () => {
  assert.equal(isTextEntryTarget({ tagName: 'BUTTON' }), true)
  assert.equal(isTextEntryTarget({ tagName: 'input' }), true)
  assert.equal(isTextEntryTarget({ tagName: 'TEXTAREA' }), true)
  assert.equal(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(isTextEntryTarget({ tagName: 'CANVAS' }), false)
  assert.equal(isTextEntryTarget(null), false)
  assert.equal(isTextEntryTarget({}), false)
})

test('wheel deltas normalise lines and pages to pixels', () => {
  assert.equal(normalizeWheelDelta(120, 0), 120)
  assert.equal(normalizeWheelDelta(3, 1), WHEEL_NOTCH, 'three lines make one notch')
  assert.equal(normalizeWheelDelta(-1, 2), -WHEEL_NOTCH)
  assert.equal(normalizeWheelDelta(Number.NaN, 0), 0)
})

test('wheel accumulator: first event of a gesture is one step, then one per notch', () => {
  const wheel = createWheelAccumulator()
  wheel.push(4, 0) // a tiny macOS mouse notch still counts
  assert.equal(wheel.consume(), 1)
  assert.equal(wheel.consume(), 0, 'consume resets')

  // Trackpad swipe: many small deltas close together.
  for (let i = 1; i <= 20; i++) wheel.push(15, 1000 + i * 16)
  assert.equal(wheel.consume(), 1 + Math.trunc((19 * 15) / WHEEL_NOTCH))

  wheel.push(-100, 5000)
  wheel.push(-100, 5050)
  assert.equal(wheel.consume(), -2, 'scrolling up gives negative steps')
})

test('wheel accumulator restarts on a direction change or after a quiet gap', () => {
  const wheel = createWheelAccumulator()
  wheel.push(40, 0)
  wheel.push(-40, 50) // reversed within the gap: new gesture
  assert.equal(wheel.consume(), 0, '+1 then -1')
  wheel.push(40, 100)
  wheel.push(40, 351) // more than 250 ms later: new gesture
  assert.equal(wheel.consume(), 2)
  wheel.push(0, 400)
  wheel.push(Number.NaN, 410)
  assert.equal(wheel.consume(), 0, 'zero and NaN deltas are ignored')
  wheel.push(10) // no timestamp: every event is its own gesture
  wheel.push(10)
  assert.equal(wheel.consume(), 2)
})

// ---------- keyboard ----------

test('keys are held while down and presses are edge-triggered', () => {
  const { input, doc } = setup()
  keyDown(doc.body, 'KeyW')
  assert.equal(input.isDown('KeyW'), true)
  keyDown(doc.body, 'KeyW', { repeat: true })
  keyDown(doc.body, 'KeyQ')
  assert.equal(input.consumePress('KeyQ'), true)
  assert.equal(input.consumePress('KeyQ'), false)
  keyDown(doc.body, 'KeyQ', { repeat: true })
  assert.equal(input.consumePress('KeyQ'), false, 'auto-repeat never re-triggers a press')
  keyUp(doc.body, 'KeyW')
  assert.equal(input.isDown('KeyW'), false)
})

test('a quick tap between two frames still registers one press', () => {
  const { input, doc } = setup()
  keyDown(doc.body, 'Digit2')
  keyUp(doc.body, 'Digit2')
  assert.equal(input.consumePress('Digit2'), true)
  assert.equal(input.isDown('Digit2'), false)
})

test('keys never stick after window blur, hidden tab, or pointer-lock loss', async () => {
  const { input, doc, win } = await lockedSetup()
  keyDown(doc.body, 'KeyW')
  fire(win, 'blur')
  assert.equal(input.isDown('KeyW'), false, 'blur clears held keys')

  keyDown(doc.body, 'KeyA')
  doc.setHidden(true)
  assert.equal(input.isDown('KeyA'), false, 'hidden tab clears held keys')
  doc.setHidden(false)

  keyDown(doc.body, 'KeyD')
  keyDown(doc.body, 'KeyQ')
  doc.revokePointerLock()
  assert.equal(input.isDown('KeyD'), false, 'lock loss clears held keys')
  assert.equal(input.consumePress('KeyQ'), false, 'and pending presses')
})

test('becoming visible again does not clear state', () => {
  const { input, doc } = setup()
  keyDown(doc.body, 'KeyS')
  doc.setHidden(true)
  keyDown(doc.body, 'KeyS')
  doc.setHidden(false)
  assert.equal(input.isDown('KeyS'), true)
})

test('releasing Command releases every key (macOS drops those key-ups)', () => {
  const { input, doc } = setup()
  keyDown(doc.body, 'KeyW')
  keyDown(doc.body, 'MetaLeft')
  keyUp(doc.body, 'MetaLeft')
  assert.equal(input.isDown('KeyW'), false)
})

test('keyboard events aimed at buttons or text fields are ignored, but releases still count', () => {
  const { input, doc, ui } = setup()
  const button = doc.createElement('button')
  const field = doc.createElement('input')
  ui.appendChild(button)
  ui.appendChild(field)

  const event = keyDown(button, 'Space')
  assert.equal(input.isDown('Space'), false)
  assert.equal(event.defaultPrevented, false, 'Space still activates the focused button')
  keyDown(field, 'KeyW')
  assert.equal(input.isDown('KeyW'), false)

  keyDown(doc.body, 'KeyD')
  keyUp(button, 'KeyD')
  assert.equal(input.isDown('KeyD'), false, 'a key-up from a menu control still releases the key')
})

test('Space and arrow keys do not scroll the page while playing', () => {
  const { input, doc } = setup()
  assert.equal(keyDown(doc.body, 'Space').defaultPrevented, true)
  assert.equal(keyDown(doc.body, 'ArrowDown').defaultPrevented, true)
  assert.equal(keyDown(doc.body, 'KeyW').defaultPrevented, false, 'ordinary keys keep their default')
  input.setEnabled(false)
  assert.equal(keyDown(doc.body, 'Space', { repeat: true }).defaultPrevented, false, 'menus keep normal keyboard behaviour')
})

test('events without a code are ignored', () => {
  const { input, doc } = setup()
  keyDown(doc.body, '')
  keyDown(doc.body, undefined)
  assert.equal(input.consumePress(''), false)
  assert.equal(input.consumePress(undefined), false)
})

// ---------- enable / disable ----------

test('disabled input ignores keys, buttons, wheel and look', async () => {
  const { input, doc, element } = await lockedSetup()
  input.setEnabled(false)
  assert.equal(input.enabled, false)
  keyDown(doc.body, 'KeyW')
  fire(element, 'mousedown', { button: 0 })
  fire(element, 'wheel', { deltaY: 100, deltaMode: 0, timeStamp: 1 })
  move(element, 30, 10)
  assert.equal(input.isDown('KeyW'), false)
  assert.equal(input.consumeMousePress(0), false)
  assert.equal(input.consumeWheel(), 0)
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 })
})

test('toggling enabled clears pending state; setting the same value does not', () => {
  const { input, doc } = setup()
  keyDown(doc.body, 'KeyQ')
  input.setEnabled(true) // unchanged: must not wipe this frame's press
  assert.equal(input.consumePress('KeyQ'), true)

  keyDown(doc.body, 'KeyE')
  input.setEnabled(false)
  input.setEnabled(true)
  assert.equal(input.consumePress('KeyE'), false, 'nothing carries over from before the pause')
})

test('input can start disabled', () => {
  const dom = createFakeDom()
  const input = createInput(dom.element, { win: dom.win, doc: dom.doc, enabled: false })
  keyDown(dom.doc.body, 'KeyW')
  assert.equal(input.isDown('KeyW'), false)
})

// ---------- mouse ----------

test('mouse presses are recorded only on the game element', () => {
  const { input, element, ui, doc } = setup()
  const menuButton = doc.createElement('button')
  ui.appendChild(menuButton)
  fire(menuButton, 'mousedown', { button: 0 })
  fire(doc.body, 'mousedown', { button: 2 })
  assert.equal(input.consumeMousePress(0), false, 'a menu click is not a game click')
  assert.equal(input.consumeMousePress(2), false)

  fire(element, 'mousedown', { button: 0 })
  assert.equal(input.isMouseDown(0), true)
  assert.equal(input.consumeMousePress(0), true)
  assert.equal(input.consumeMousePress(0), false, 'edge-triggered')
  assert.equal(input.isMouseDown(0), true, 'still held')
})

test('mouse releases are seen anywhere and buttons are tracked separately', () => {
  const { input, element, ui } = setup()
  fire(element, 'mousedown', { button: 0 })
  fire(element, 'mousedown', { button: 2 })
  fire(ui, 'mouseup', { button: 0 }) // released over the menu layer
  assert.equal(input.isMouseDown(0), false)
  assert.equal(input.isMouseDown(2), true)
  assert.equal(input.consumeMousePress(2), true)
})

test('held mouse buttons are dropped on blur and lock loss', async () => {
  const { input, element, win, doc } = await lockedSetup()
  fire(element, 'mousedown', { button: 0 })
  fire(win, 'blur')
  assert.equal(input.isMouseDown(0), false)
  fire(element, 'mousedown', { button: 2 })
  doc.revokePointerLock()
  assert.equal(input.isMouseDown(2), false)
  assert.equal(input.consumeMousePress(2), false)
})

test('Command release does not drop held mouse buttons', () => {
  const { input, element, doc } = setup()
  fire(element, 'mousedown', { button: 0 })
  keyUp(doc.body, 'MetaRight')
  assert.equal(input.isMouseDown(0), true)
})

test('the context menu is always prevented on the game element', () => {
  const { input, element } = setup()
  assert.equal(fire(element, 'contextmenu', { button: 2 }).defaultPrevented, true)
  input.setEnabled(false)
  assert.equal(fire(element, 'contextmenu', { button: 2 }).defaultPrevented, true)
})

// Regression: the Menu key / Shift+F10 open the menu on the focused element
// (<body> during play), which the canvas listener never sees.
test('a keyboard-opened context menu is prevented anywhere while playing', () => {
  const { input, doc, ui } = setup()
  assert.equal(fire(doc.body, 'contextmenu').defaultPrevented, true, 'body (focus during play)')
  assert.equal(fire(ui, 'contextmenu').defaultPrevented, true)
  input.setEnabled(false)
  assert.equal(fire(doc.body, 'contextmenu').defaultPrevented, false, 'menus keep the normal context menu')
})

// Regression: mouse back / forward buttons navigated away mid-game.
test('mouse back and forward buttons never navigate while playing', () => {
  const { input, element, doc } = setup()
  assert.equal(fire(element, 'mousedown', { button: 3 }).defaultPrevented, true)
  assert.equal(fire(doc.body, 'mouseup', { button: 3 }).defaultPrevented, true, 'mouseup is seen on the window')
  assert.equal(fire(element, 'mousedown', { button: 4 }).defaultPrevented, true)
  assert.equal(fire(element, 'auxclick', { button: 4 }).defaultPrevented, true)
  assert.equal(fire(doc.body, 'auxclick', { button: 3 }).defaultPrevented, true)
  assert.equal(fire(element, 'mousedown', { button: 0 }).defaultPrevented, false, 'ordinary buttons keep their default')
  assert.equal(fire(element, 'auxclick', { button: 1 }).defaultPrevented, false)
  input.setEnabled(false)
  assert.equal(fire(element, 'mousedown', { button: 3 }).defaultPrevented, false, 'menus keep normal navigation')
  assert.equal(fire(doc.body, 'mouseup', { button: 4 }).defaultPrevented, false)
  assert.equal(fire(element, 'auxclick', { button: 4 }).defaultPrevented, false)
})

// ---------- look ----------

test('mouse look accumulates only while pointer-locked', async () => {
  const { input, element } = setup()
  move(element, 25, 5)
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 }, 'unlocked movement is ignored')

  await input.requestLock()
  move(element, 25, 5)
  move(element, -5, 10)
  assert.deepEqual(input.consumeLook(), { dx: 20, dy: 15 })
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 }, 'consumeLook resets')
})

test('look ignores spikes and missing movement fields', async () => {
  const { input, element } = await lockedSetup()
  move(element, 400, 3) // Chrome's post-lock jump
  move(element, 10, -650)
  move(element, 300, -300)
  fire(element, 'mousemove', {})
  assert.deepEqual(input.consumeLook(), { dx: 300, dy: -300 })
})

test('free look accumulates mouse movement without pointer lock', () => {
  const { input, element } = setup({ lock: 'reject' })
  assert.equal(input.freeLook, false)
  move(element, 25, 5)
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 }, 'off by default')
  input.setFreeLook(true)
  assert.equal(input.freeLook, true)
  move(element, 25, 5)
  move(element, 400, 0) // spikes are still filtered
  move(element, -5, 10)
  assert.deepEqual(input.consumeLook(), { dx: 20, dy: 15 })
  input.setEnabled(false)
  move(element, 30, 0)
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 }, 'disabled input ignores look')
})

test('toggling free look drops pending look; acquiring the lock turns it off', async () => {
  const { input, element, doc } = setup()
  input.setFreeLook(true)
  move(element, 12, 0)
  input.setFreeLook(false)
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 })
  input.setFreeLook(true)
  await input.requestLock()
  assert.equal(input.freeLook, false, 'real capture replaces the fallback')
  move(element, 7, 0)
  assert.deepEqual(input.consumeLook(), { dx: 7, dy: 0 }, 'locked look still works')
  doc.revokePointerLock()
  move(element, 7, 0)
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 }, 'losing the lock does not fall back to free look')
})

test('free look is off after dispose', () => {
  const { input } = setup()
  input.setFreeLook(true)
  input.dispose()
  assert.equal(input.freeLook, false)
  input.setFreeLook(true)
  assert.equal(input.freeLook, false)
})

test('accumulated look is discarded when the lock is lost', async () => {
  const { input, element, doc } = await lockedSetup()
  move(element, 40, 0)
  doc.revokePointerLock()
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 })
})

// ---------- wheel ----------

test('wheel produces hotbar steps and does not scroll the page', () => {
  const { input, element } = setup()
  const event = fire(element, 'wheel', { deltaY: 100, deltaMode: 0, timeStamp: 10 })
  assert.equal(event.defaultPrevented, true)
  fire(element, 'wheel', { deltaY: 3, deltaMode: 1, timeStamp: 20 })
  assert.equal(input.consumeWheel(), 2)
  fire(element, 'wheel', { deltaY: -1, deltaMode: 2, timeStamp: 900 })
  assert.equal(input.consumeWheel(), -1)
  assert.equal(input.consumeWheel(), 0)
})

test('the wheel listener is registered as non-passive so it may prevent default', () => {
  const { element } = setup()
  const [entry] = element.listeners.get('wheel')
  assert.equal(entry.options?.passive, false)
})

// ---------- pointer lock ----------

test('requestLock resolves true and notifies lock listeners', async () => {
  const { input, element } = setup()
  const changes = []
  input.onLockChange((locked) => changes.push(locked))
  assert.equal(input.isLocked, false)
  assert.equal(await input.requestLock(), true)
  assert.equal(element.lockRequests, 1)
  assert.deepEqual(changes, [true])
  assert.equal(await input.requestLock(), true, 'already locked: resolves at once')
  assert.equal(element.lockRequests, 1, 'without asking the browser again')
})

test('exitLock releases the lock and notifies with false', async () => {
  const { input, doc } = await lockedSetup()
  const changes = []
  input.onLockChange((locked) => changes.push(locked))
  input.exitLock()
  assert.equal(doc.exitCalls, 1)
  assert.equal(input.isLocked, false)
  assert.deepEqual(changes, [false])
  input.exitLock()
  assert.equal(doc.exitCalls, 1, 'exit is a no-op when not locked')
})

test('lock changes for another element or repeated events notify only real transitions', async () => {
  const { input, doc } = setup()
  const changes = []
  input.onLockChange((locked) => changes.push(locked))
  doc.pointerLockElement = doc.createElement('div')
  fire(doc, 'pointerlockchange')
  fire(doc, 'pointerlockchange')
  assert.deepEqual(changes, [], 'locking a different element is not our lock')
  await input.requestLock()
  fire(doc, 'pointerlockchange')
  assert.deepEqual(changes, [true])
})

test('a rejected lock request resolves false and reports one error', async () => {
  const { input } = setup({ lock: 'reject' })
  const errors = []
  input.onLockError((error) => errors.push(error))
  assert.equal(await input.requestLock(), false)
  assert.equal(errors.length, 1, 'pointerlockerror and the rejection are reported once')
  assert.ok(errors[0] instanceof Error)
  assert.equal(await input.requestLock(), false)
  assert.equal(errors.length, 2, 'each new request can report again')
})

test('a synchronously throwing lock request is caught', async () => {
  const { input } = setup({ lock: 'throw' })
  const errors = []
  input.onLockError((error) => errors.push(error.message))
  assert.equal(await input.requestLock(), false)
  assert.deepEqual(errors, ['SecurityError: lock denied'])
})

test('legacy requestPointerLock without a promise still works', async () => {
  const { input } = setup({ lock: 'legacy' })
  assert.equal(await input.requestLock(), true)
  assert.equal(input.isLocked, true)
})

test('missing Pointer Lock API reports an error instead of throwing', async () => {
  const { input } = setup({ lock: 'none' })
  const errors = []
  input.onLockError((error) => errors.push(error.message))
  assert.equal(await input.requestLock(), false)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /not supported/)
})

test('a stray pointerlockerror event is reported to listeners', () => {
  const { input, doc } = setup()
  const errors = []
  input.onLockError((error) => errors.push(error))
  fire(doc, 'pointerlockerror')
  assert.equal(errors.length, 1)
})

test('listeners can unsubscribe and non-functions are ignored', async () => {
  const { input, doc } = setup()
  const changes = []
  const off = input.onLockChange((locked) => changes.push(locked))
  assert.equal(typeof input.onLockChange(null), 'function')
  off()
  await input.requestLock()
  doc.revokePointerLock()
  assert.deepEqual(changes, [])
})

// ---------- lifecycle ----------

test('clear() drops keys, buttons, presses, look and wheel', async () => {
  const { input, doc, element } = await lockedSetup()
  keyDown(doc.body, 'KeyW')
  fire(element, 'mousedown', { button: 0 })
  move(element, 9, 9)
  fire(element, 'wheel', { deltaY: 100, timeStamp: 5 })
  input.clear()
  assert.equal(input.isDown('KeyW'), false)
  assert.equal(input.consumePress('KeyW'), false)
  assert.equal(input.isMouseDown(0), false)
  assert.equal(input.consumeMousePress(0), false)
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 })
  assert.equal(input.consumeWheel(), 0)
})

test('dispose removes every listener and stops reacting', async () => {
  const { input, doc, win, element } = setup()
  const errors = []
  input.onLockError((error) => errors.push(error))
  input.dispose()
  assert.equal(win.listenerCount(), 0)
  assert.equal(doc.listenerCount(), 0)
  assert.equal(element.listenerCount(), 0)
  keyDown(doc.body, 'KeyW')
  assert.equal(input.isDown('KeyW'), false)
  assert.equal(await input.requestLock(), false)
  assert.equal(element.lockRequests, 0, 'no lock requests after dispose')
  assert.equal(errors.length, 0)
})

test('works without browser globals (Node) and without an element', async () => {
  assert.equal(globalThis.window, undefined)
  const input = createInput(null)
  assert.equal(input.isLocked, false)
  assert.equal(input.isDown('KeyW'), false)
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 })
  assert.equal(await input.requestLock(), false)
  input.exitLock()
  input.dispose()
})

test('keyboard falls back to the document when no window is given', () => {
  const dom = createFakeDom()
  const input = createInput(dom.element, { win: null, doc: dom.doc })
  keyDown(dom.doc.body, 'KeyA')
  assert.equal(input.isDown('KeyA'), true)
  fire(dom.element, 'mousedown', { button: 0 })
  fire(dom.doc.body, 'mouseup', { button: 0 })
  assert.equal(input.isMouseDown(0), false)
})

test('pause / resume cycle: nothing held before the pause survives the resume', async () => {
  const { input, doc, element } = await lockedSetup()
  keyDown(doc.body, 'KeyW')
  fire(element, 'mousedown', { button: 0 })
  doc.revokePointerLock() // Esc pressed: browser drops the lock, keys still physically down
  input.setEnabled(false)
  keyUp(doc.body, 'KeyW') // released while paused
  await input.requestLock()
  input.setEnabled(true)
  assert.equal(input.isDown('KeyW'), false)
  assert.equal(input.isMouseDown(0), false)
  assert.equal(input.consumeMousePress(0), false)
  keyDown(doc.body, 'KeyW', { repeat: true }) // a key genuinely still held resumes as held
  assert.equal(input.isDown('KeyW'), true)
  assert.equal(input.consumePress('KeyW'), false)
})
