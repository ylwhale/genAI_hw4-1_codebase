// Keyboard, mouse, and pointer-lock input. Losing focus or capture clears held state.
// Free look allows mouse input when pointer lock is unavailable.

export const LOOK_SPIKE_LIMIT = 300 // px per event; Chrome can report huge jumps right after locking
export const WHEEL_NOTCH = 100 // normalised wheel pixels per hotbar step
const WHEEL_GESTURE_GAP = 250 // ms of wheel silence that starts a new gesture
const WHEEL_LINE = WHEEL_NOTCH / 3 // a classic wheel notch scrolls three lines

const TEXT_ENTRY_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'])
const META_CODES = new Set(['MetaLeft', 'MetaRight', 'OSLeft', 'OSRight'])
const NO_DEFAULT_CODES = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const NAV_BUTTONS = new Set([3, 4]) // mouse back / forward: history navigation

// Keyboard events aimed at a menu control belong to that control, not the game.
export function isTextEntryTarget(target) {
  if (!target) return false
  return TEXT_ENTRY_TAGS.has(String(target.tagName ?? '').toUpperCase()) || target.isContentEditable === true
}

// Drops non-finite deltas and the oversized spikes some browsers emit.
export function filterLookDelta(dx, dy, limit = LOOK_SPIKE_LIMIT) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (Math.abs(dx) > limit || Math.abs(dy) > limit) return null
  return { dx, dy }
}

// Held buttons plus edge-triggered presses. A press is recorded once per
// physical press (auto-repeat ignored) and stays pending until consumed, so a
// tap shorter than a frame is never lost.
export function createPressState() {
  const held = new Set()
  const pressed = new Set()

  return {
    // Returns true for a fresh press. A repeat still proves the key is down.
    press(code, repeat = false) {
      const fresh = !repeat && !held.has(code)
      held.add(code)
      if (fresh) pressed.add(code)
      return fresh
    },
    release(code) {
      held.delete(code)
    },
    isDown(code) {
      return held.has(code)
    },
    consume(code) {
      return pressed.delete(code)
    },
    releaseAll() {
      held.clear()
    },
    clear() {
      held.clear()
      pressed.clear()
    },
    get heldCount() {
      return held.size
    },
  }
}

// Wheel delta in "pixels" whatever the browser's deltaMode (0 px, 1 lines, 2 pages).
export function normalizeWheelDelta(deltaY, deltaMode = 0) {
  if (!Number.isFinite(deltaY)) return 0
  if (deltaMode === 1) return deltaY * WHEEL_LINE
  if (deltaMode === 2) return deltaY * WHEEL_NOTCH
  return deltaY
}

// Turns wheel deltas into whole hotbar steps (positive = scroll down). The
// first event of a gesture always moves one step, so tiny mouse notches count;
// later events of the same gesture need a full notch each, so a trackpad
// swipe doesn't spin through the whole hotbar.
export function createWheelAccumulator({ notch = WHEEL_NOTCH, gestureGap = WHEEL_GESTURE_GAP } = {}) {
  let steps = 0
  let carry = 0
  let lastTime = -Infinity
  let lastSign = 0

  function push(delta, time) {
    if (!Number.isFinite(delta) || delta === 0) return
    const sign = Math.sign(delta)
    const continuing = time - lastTime <= gestureGap && sign === lastSign
    lastTime = time
    lastSign = sign
    if (!continuing) {
      steps += sign
      carry = 0
      return
    }
    carry += delta
    const whole = Math.trunc(carry / notch)
    steps += whole
    carry -= whole * notch
  }

  return {
    push,
    consume() {
      const result = steps
      steps = 0
      return result
    },
    clear() {
      steps = 0
      carry = 0
      lastTime = -Infinity
      lastSign = 0
    },
  }
}

export function createInput(element, { win = globalThis.window, doc = globalThis.document, enabled = true } = {}) {
  const keys = createPressState()
  const mouse = createPressState()
  const wheel = createWheelAccumulator()
  const look = { dx: 0, dy: 0 }
  const lockListeners = new Set()
  const errorListeners = new Set()
  const unbinders = []
  const keyTarget = win ?? doc
  let active = Boolean(enabled)
  let locked = isLocked()
  let lockErrorReported = false
  let freeLook = false
  let disposed = false

  function isLocked() {
    return Boolean(doc && element) && doc.pointerLockElement === element
  }

  function listen(target, type, handler, options) {
    if (typeof target?.addEventListener !== 'function') return
    target.addEventListener(type, handler, options)
    unbinders.push(() => target.removeEventListener(type, handler, options))
  }

  function clear() {
    keys.clear()
    mouse.clear()
    wheel.clear()
    look.dx = 0
    look.dy = 0
  }

  function notify(listeners, value) {
    for (const listener of [...listeners]) listener(value)
  }

  function onKeyDown(event) {
    if (!active || !event.code || isTextEntryTarget(event.target)) return
    if (NO_DEFAULT_CODES.has(event.code)) event.preventDefault()
    keys.press(event.code, event.repeat === true)
  }

  // Releases are always honoured (even from menu targets) so nothing sticks.
  function onKeyUp(event) {
    keys.release(event.code)
    // macOS never sends key-ups for keys released while Command is held.
    if (META_CODES.has(event.code)) keys.releaseAll()
  }

  // Back / forward side buttons would navigate away from the game mid-play.
  function blockNavButton(event) {
    if (active && NAV_BUTTONS.has(event.button)) event.preventDefault()
  }

  function onMouseDown(event) {
    if (!active) return
    blockNavButton(event)
    mouse.press(event.button)
  }

  function onMouseUp(event) {
    blockNavButton(event)
    mouse.release(event.button)
  }

  // Keyboard-opened menus (Menu key, Shift+F10) target the focused element,
  // not the canvas, so the document suppresses them too while playing.
  function onDocumentContextMenu(event) {
    if (active) event.preventDefault()
  }

  function onMouseMove(event) {
    if (!active || !(freeLook || isLocked())) return
    const delta = filterLookDelta(event.movementX ?? 0, event.movementY ?? 0)
    if (!delta) return
    look.dx += delta.dx
    look.dy += delta.dy
  }

  function onWheel(event) {
    if (!active) return
    event.preventDefault()
    wheel.push(normalizeWheelDelta(event.deltaY, event.deltaMode), event.timeStamp)
  }

  function onVisibilityChange() {
    if (doc?.hidden || doc?.visibilityState === 'hidden') clear()
  }

  function onLockChange() {
    const now = isLocked()
    if (now === locked) return
    locked = now
    if (now) freeLook = false // real capture replaces the fallback
    else clear()
    notify(lockListeners, now)
  }

  // Chrome may both reject the request promise and fire 'pointerlockerror';
  // listeners hear about each failed request once.
  function reportLockError(error) {
    if (lockErrorReported) return
    lockErrorReported = true
    notify(errorListeners, error instanceof Error ? error : new Error('Pointer lock request failed'))
  }

  function requestLock() {
    if (disposed) return Promise.resolve(false)
    if (isLocked()) return Promise.resolve(true)
    lockErrorReported = false
    if (typeof element?.requestPointerLock !== 'function') {
      reportLockError(new Error('Pointer lock is not supported'))
      return Promise.resolve(false)
    }
    try {
      return Promise.resolve(element.requestPointerLock()).then(
        () => true,
        (error) => {
          reportLockError(error)
          return false
        },
      )
    } catch (error) {
      reportLockError(error)
      return Promise.resolve(false)
    }
  }

  function exitLock() {
    if (!isLocked()) return
    try {
      doc.exitPointerLock?.()
    } catch {
      // Nothing to recover: the browser keeps whatever lock state it has.
    }
  }

  function subscribe(listeners, listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  listen(keyTarget, 'keydown', onKeyDown)
  listen(keyTarget, 'keyup', onKeyUp)
  listen(win, 'blur', clear)
  listen(keyTarget, 'mouseup', onMouseUp)
  listen(doc, 'visibilitychange', onVisibilityChange)
  listen(doc, 'pointerlockchange', onLockChange)
  listen(doc, 'pointerlockerror', () => reportLockError(null))
  listen(keyTarget, 'auxclick', blockNavButton)
  listen(element, 'mousedown', onMouseDown)
  listen(element, 'mousemove', onMouseMove)
  listen(element, 'wheel', onWheel, { passive: false })
  listen(element, 'contextmenu', (event) => event.preventDefault())
  listen(doc, 'contextmenu', onDocumentContextMenu)

  return {
    isDown: (code) => keys.isDown(code),
    consumePress: (code) => keys.consume(code),
    isMouseDown: (button) => mouse.isDown(button),
    consumeMousePress: (button) => mouse.consume(button),
    consumeLook() {
      const delta = { dx: look.dx, dy: look.dy }
      look.dx = 0
      look.dy = 0
      return delta
    },
    consumeWheel: () => wheel.consume(),
    requestLock,
    exitLock,
    get isLocked() {
      return isLocked()
    },
    get enabled() {
      return active
    },
    get freeLook() {
      return freeLook
    },
    onLockChange: (listener) => subscribe(lockListeners, listener),
    onLockError: (listener) => subscribe(errorListeners, listener),
    // Toggling drops all pending state so nothing carries over between modes.
    setEnabled(value) {
      const next = Boolean(value)
      if (next === active) return
      active = next
      clear()
    },
    // Free look: accumulate mouse movement without pointer lock (for browsers
    // or embeds that refuse the lock). Acquiring the lock turns it off.
    setFreeLook(value) {
      const next = Boolean(value) && !disposed
      if (next === freeLook) return
      freeLook = next
      look.dx = 0
      look.dy = 0
    },
    clear,
    dispose() {
      for (const unbind of unbinders.splice(0)) unbind()
      lockListeners.clear()
      errorListeners.clear()
      clear()
      active = false
      freeLook = false
      disposed = true
    },
  }
}
