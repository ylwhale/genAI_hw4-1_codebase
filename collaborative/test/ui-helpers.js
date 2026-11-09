// Minimal fake DOM for UI and input tests: EventTarget-style nodes that bubble
// element -> ... -> body -> document -> window, a document with pointer-lock
// and visibility state, an optional fake 2D canvas, and manual timers.

export class FakeEvent {
  constructor(type, init = {}) {
    Object.assign(this, init)
    this.type = type
    this.bubbles = init.bubbles ?? true
    this.defaultPrevented = false
    this.propagationStopped = false
    this.target = null
    this.currentTarget = null
  }

  preventDefault() {
    this.defaultPrevented = true
  }

  stopPropagation() {
    this.propagationStopped = true
  }
}

export class FakeEventTarget {
  constructor() {
    this.listeners = new Map()
  }

  addEventListener(type, listener, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    const list = this.listeners.get(type)
    if (!list.some((entry) => entry.listener === listener)) list.push({ listener, options })
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type) ?? []
    this.listeners.set(
      type,
      list.filter((entry) => entry.listener !== listener),
    )
  }

  listenerCount(type) {
    if (type) return this.listeners.get(type)?.length ?? 0
    let total = 0
    for (const list of this.listeners.values()) total += list.length
    return total
  }

  // Next target up the bubbling path (overridden by nodes).
  get eventParent() {
    return null
  }

  dispatchEvent(event) {
    event.target ??= this
    for (let node = this; node; node = node.eventParent) {
      event.currentTarget = node
      for (const { listener } of [...(node.listeners.get(event.type) ?? [])]) listener.call(node, event)
      if (!event.bubbles || event.propagationStopped) break
    }
    return !event.defaultPrevented
  }
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner
    this.names = new Set()
  }

  add(...names) {
    for (const name of names) this.names.add(name)
    this.owner.mutations++
  }

  remove(...names) {
    for (const name of names) this.names.delete(name)
    this.owner.mutations++
  }

  toggle(name, force) {
    const on = force === undefined ? !this.names.has(name) : Boolean(force)
    if (on) this.names.add(name)
    else this.names.delete(name)
    this.owner.mutations++
    return on
  }

  contains(name) {
    return this.names.has(name)
  }

  toString() {
    return [...this.names].join(' ')
  }
}

// style.foo = 'bar' and style.setProperty('--x', '1') both land in one record
// and count as mutations.
function createStyle(owner) {
  const values = {}
  const methods = {
    setProperty: (name, value) => {
      values[name] = String(value)
      owner.mutations++
    },
    getPropertyValue: (name) => values[name] ?? '',
    removeProperty: (name) => {
      delete values[name]
      owner.mutations++
    },
  }
  return new Proxy(values, {
    get: (target, prop) => (prop in methods ? methods[prop] : target[prop] ?? ''),
    set: (target, prop, value) => {
      target[prop] = String(value)
      owner.mutations++
      return true
    },
  })
}

const SELECTOR_PART = /([#.])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g

function matchesCompound(node, compound) {
  const tag = compound.match(/^[a-z][\w-]*/i)?.[0]
  if (tag && node.tagName !== tag.toUpperCase()) return false
  for (const [, prefix, name, attr, value] of compound.matchAll(SELECTOR_PART)) {
    if (prefix === '#' && node.id !== name) return false
    if (prefix === '.' && !node.classList.contains(name)) return false
    if (attr && !node.hasAttribute(attr)) return false
    if (attr && value !== undefined && node.getAttribute(attr) !== value) return false
  }
  return true
}

// Compound selectors with descendant combinators: 'section.vg-screen #play-button'.
function matchesSelector(node, selector) {
  const parts = selector.trim().split(/\s+/)
  if (!matchesCompound(node, parts.pop())) return false
  let ancestor = node.parentNode
  while (parts.length && ancestor) {
    if (matchesCompound(ancestor, parts[parts.length - 1])) parts.pop()
    ancestor = ancestor.parentNode
  }
  return parts.length === 0
}

export class FakeElement extends FakeEventTarget {
  constructor(ownerDocument, tagName) {
    super()
    this.ownerDocument = ownerDocument
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.parentNode = null
    this.attributes = new Map()
    this.classList = new FakeClassList(this)
    this.style = createStyle(this)
    this.mutations = 0
    this.text = ''
    this.hiddenValue = false
    this.isContentEditable = false
    this.reflows = 0
  }

  get eventParent() {
    if (this.parentNode) return this.parentNode
    return this === this.ownerDocument.body ? this.ownerDocument : null
  }

  get id() {
    return this.getAttribute('id') ?? ''
  }

  set id(value) {
    this.setAttribute('id', value)
  }

  get className() {
    return this.classList.toString()
  }

  set className(value) {
    this.classList.names = new Set(String(value).split(/\s+/).filter(Boolean))
    this.mutations++
  }

  get hidden() {
    return this.hiddenValue
  }

  set hidden(value) {
    this.hiddenValue = Boolean(value)
    this.mutations++
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join('')
  }

  set textContent(value) {
    for (const child of this.children) child.parentNode = null
    this.children = []
    this.text = String(value)
    this.mutations++
  }

  get offsetWidth() {
    this.reflows++
    return 0
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    this.mutations++
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
    this.mutations++
  }

  appendChild(child) {
    child.parentNode?.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    this.mutations++
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index === -1) throw new Error('Not a child of this node')
    this.children.splice(index, 1)
    child.parentNode = null
    this.mutations++
    return child
  }

  remove() {
    this.parentNode?.removeChild(this)
  }

  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true
    return false
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }

  matches(selector) {
    return matchesSelector(this, selector)
  }

  querySelectorAll(selector) {
    return this.descendants().filter((node) => node.matches(selector))
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  focus() {
    this.ownerDocument.activeElement = this
  }

  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body
  }

  click() {
    return this.dispatchEvent(new FakeEvent('click', { button: 0 }))
  }
}

// A canvas whose 2D context records the image it was given.
class FakeCanvas extends FakeElement {
  constructor(ownerDocument, mode) {
    super(ownerDocument, 'canvas')
    this.mode = mode
    this.width = 300
    this.height = 150
    this.drawn = null
  }

  getContext(kind) {
    if (this.mode === 'no-context' || kind !== '2d') return null
    return {
      createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image, x, y) => {
        this.drawn = { image, x, y }
      },
    }
  }

  toDataURL(type = 'image/png') {
    if (this.mode === 'throw') throw new Error('Canvas is tainted')
    return `data:${type};base64,FAKE${this.width}x${this.height}`
  }
}

export class FakeDocument extends FakeEventTarget {
  constructor({ canvas = 'none' } = {}) {
    super()
    this.canvasMode = canvas
    this.defaultView = null
    this.body = new FakeElement(this, 'body')
    this.activeElement = this.body
    this.pointerLockElement = null
    this.hidden = false
    this.visibilityState = 'visible'
    this.exitCalls = 0
  }

  get eventParent() {
    return this.defaultView
  }

  createElement(tag) {
    if (tag.toLowerCase() === 'canvas' && this.canvasMode !== 'none') return new FakeCanvas(this, this.canvasMode)
    return new FakeElement(this, tag)
  }

  getElementById(id) {
    return this.body.querySelector(`#${id}`)
  }

  querySelector(selector) {
    return this.body.querySelector(selector)
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector)
  }

  exitPointerLock() {
    this.exitCalls++
    if (!this.pointerLockElement) return
    this.pointerLockElement = null
    this.dispatchEvent(new FakeEvent('pointerlockchange'))
  }

  // Test helper: simulate the browser revoking the lock (Esc, alt-tab...).
  revokePointerLock() {
    this.pointerLockElement = null
    this.dispatchEvent(new FakeEvent('pointerlockchange'))
  }

  setHidden(hidden) {
    this.hidden = hidden
    this.visibilityState = hidden ? 'hidden' : 'visible'
    this.dispatchEvent(new FakeEvent('visibilitychange'))
  }
}

export class FakeWindow extends FakeEventTarget {
  constructor(document) {
    super()
    this.document = document
    document.defaultView = this
  }
}

// Pointer-lock behaviours for the game element:
//   'grant'  async success, like modern Chrome     'reject' fires pointerlockerror + rejects
//   'throw'  throws synchronously                  'legacy' returns undefined, grants at once
function installPointerLock(element, doc, behaviour) {
  element.lockRequests = 0
  element.requestPointerLock = function requestPointerLock() {
    element.lockRequests++
    const grant = () => {
      doc.pointerLockElement = element
      doc.dispatchEvent(new FakeEvent('pointerlockchange'))
    }
    if (behaviour === 'throw') throw new Error('SecurityError: lock denied')
    if (behaviour === 'legacy') return grant()
    if (behaviour === 'reject') {
      doc.dispatchEvent(new FakeEvent('pointerlockerror'))
      return Promise.reject(new Error('NotAllowedError: lock rejected'))
    }
    return Promise.resolve().then(grant)
  }
}

// A window + document + body with a game element (canvas-like <div>) and a
// separate UI root, mirroring index.html's #app / #ui.
export function createFakeDom({ lock = 'grant', canvas = 'none' } = {}) {
  const doc = new FakeDocument({ canvas })
  const win = new FakeWindow(doc)
  const app = doc.createElement('div')
  app.id = 'app'
  const ui = doc.createElement('div')
  ui.id = 'ui'
  const element = doc.createElement('div')
  element.className = 'game-canvas'
  app.appendChild(element)
  doc.body.appendChild(app)
  doc.body.appendChild(ui)
  if (lock !== 'none') installPointerLock(element, doc, lock)
  return { win, doc, app, ui, element }
}

export function fire(target, type, init = {}) {
  const event = new FakeEvent(type, init)
  target.dispatchEvent(event)
  return event
}

export function keyDown(target, code, init = {}) {
  return fire(target, 'keydown', { code, repeat: false, ...init })
}

export function keyUp(target, code, init = {}) {
  return fire(target, 'keyup', { code, ...init })
}

// Manual clock: setTimeout callbacks run only when advance() passes them.
export function createFakeTimers() {
  let now = 0
  let nextId = 1
  const pending = new Map()
  return {
    setTimeout(callback, delay = 0) {
      const id = nextId++
      pending.set(id, { callback, at: now + Math.max(0, delay) })
      return id
    },
    clearTimeout(id) {
      pending.delete(id)
    },
    advance(ms) {
      const target = now + ms
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        const [id, timer] = due
        pending.delete(id)
        now = timer.at
        timer.callback()
      }
      now = target
    },
    get pending() {
      return pending.size
    },
  }
}

// Total DOM writes in a subtree, to prove cached setters are no-ops.
export function mutationCount(node) {
  return node.mutations + node.descendants().reduce((sum, child) => sum + child.mutations, 0)
}

// A 16x16 RGBA tile filled by `colorAt(x, y) -> [r, g, b, a]`.
export function makeTile(colorAt) {
  const pixels = new Uint8ClampedArray(16 * 16 * 4)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) pixels.set(colorAt(x, y), (y * 16 + x) * 4)
  }
  return pixels
}
