// UI: pure helpers (hearts, labels, cooldown, sprites, iso icons, logo,
// confirmation) and DOM building of the HUD and screens against a fake DOM.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HEART_PIXELS,
  HIT_MARKER_PIXELS,
  ICON_SHADES,
  TOOL_SPRITES,
  blockIconSize,
  createBlockIcon,
  cubeSpriteRows,
  isoCubeFace,
  isoCubePixels,
  pixelArtShadow,
  shadeColor,
  spriteSize,
} from '../src/ui/icons.js'
import { HEART_COUNT, TOAST_DURATION, TOAST_LIMIT, createHud, healthLabel, healthTone, heartStates, quantizeCooldown } from '../src/ui/hud.js'
import {
  CONFIRM_TIMEOUT,
  CONTROL_ROWS,
  FATAL_COPY,
  LOGO_GLYPHS,
  REARM_DELAY,
  SCREEN_HEADINGS,
  SCREEN_NAMES,
  UNLOCKED_BUTTON_ID,
  createScreens,
  fatalMessage,
  logoColor,
  logoRows,
  nextConfirmState,
  showFatalError,
} from '../src/ui/screens.js'
import { HOTBAR_BLOCKS, getBlockType } from '../src/world/blocks.js'
import { TOOLS } from '../src/interaction/tools.js'
import { createFakeDom, createFakeTimers, fire, makeTile, mutationCount } from './ui-helpers.js'

const ROOT = new URL('../', import.meta.url)
const SLOTS = HOTBAR_BLOCKS.map((blockId, i) => ({ blockId, name: getBlockType(blockId).name, icon: i === 4 ? '' : `data:image/png;base64,ICON${i}` }))

function hudSetup(options = {}) {
  const dom = createFakeDom()
  const timers = createFakeTimers()
  const hud = createHud(dom.ui, { slots: SLOTS, tools: TOOLS, timers, ...options })
  return { ...dom, timers, hud, q: (selector) => dom.ui.querySelector(selector), all: (selector) => dom.ui.querySelectorAll(selector) }
}

function screensSetup() {
  const dom = createFakeDom()
  const timers = createFakeTimers()
  const calls = { play: 0, resume: 0, unlocked: 0, reset: 0, respawn: 0 }
  const screens = createScreens(dom.ui, {
    onPlay: () => calls.play++,
    onResume: () => calls.resume++,
    onPlayUnlocked: () => calls.unlocked++,
    onResetWorld: () => calls.reset++,
    onRespawn: () => calls.respawn++,
    timers,
  })
  const byId = (id) => dom.doc.getElementById(id)
  const screen = (name) => dom.ui.querySelector(`[data-screen="${name}"]`)
  return { ...dom, timers, calls, screens, byId, screen }
}

// Declarations of the CSS rule whose selector list is exactly `selector`.
function cssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null
}

const rgba = (pixels, size, x, y) => Array.from(pixels.slice((y * size + x) * 4, (y * size + x) * 4 + 4))

// ---------- hearts, labels, cooldown ----------

test('heartStates shows ten hearts in half-heart steps', () => {
  assert.equal(HEART_COUNT, 10)
  assert.deepEqual(heartStates(100, 100), Array(10).fill('full'))
  assert.deepEqual(heartStates(95, 100), [...Array(9).fill('full'), 'half'])
  assert.deepEqual(heartStates(90, 100), [...Array(9).fill('full'), 'empty'])
  assert.deepEqual(heartStates(85, 100), [...Array(8).fill('full'), 'half', 'empty'])
  assert.deepEqual(heartStates(10, 100), ['full', ...Array(9).fill('empty')])
  assert.deepEqual(heartStates(5, 100), ['half', ...Array(9).fill('empty')])
})

test('heartStates boundaries: any life shows half a heart, zero shows none', () => {
  assert.deepEqual(heartStates(1, 100), ['half', ...Array(9).fill('empty')])
  assert.deepEqual(heartStates(0.01, 100), ['half', ...Array(9).fill('empty')])
  assert.deepEqual(heartStates(0, 100), Array(10).fill('empty'))
  assert.deepEqual(heartStates(5.01, 100).slice(0, 2), ['full', 'empty'], 'just above half a heart rounds up')
  assert.deepEqual(heartStates(30, 60), [...Array(5).fill('full'), ...Array(5).fill('empty')], 'other maxima scale')
})

test('heartStates clamps and rejects invalid input', () => {
  assert.deepEqual(heartStates(250, 100), Array(10).fill('full'))
  assert.deepEqual(heartStates(-5, 100), Array(10).fill('empty'))
  assert.deepEqual(heartStates(Number.NaN, 100), Array(10).fill('empty'))
  assert.deepEqual(heartStates(50, 0), Array(10).fill('empty'))
  assert.deepEqual(heartStates(50, Infinity), Array(10).fill('empty'))
  assert.equal(heartStates(50, 100, 4).length, 4)
})

test('healthLabel rounds up while alive and clamps', () => {
  assert.equal(healthLabel(100, 100), '100 / 100')
  assert.equal(healthLabel(85, 100), '85 / 100')
  assert.equal(healthLabel(0.3, 100), '1 / 100')
  assert.equal(healthLabel(0, 100), '0 / 100')
  assert.equal(healthLabel(-3, 100), '0 / 100')
  assert.equal(healthLabel(140, 100), '100 / 100')
  assert.equal(healthLabel(Number.NaN, 100), '0 / 100')
})

test('healthTone bands', () => {
  assert.equal(healthTone(100, 100), 'ok')
  assert.equal(healthTone(51, 100), 'ok')
  assert.equal(healthTone(50, 100), 'mid')
  assert.equal(healthTone(26, 100), 'mid')
  assert.equal(healthTone(25, 100), 'low')
  assert.equal(healthTone(1, 100), 'low')
  assert.equal(healthTone(0, 100), 'empty')
  assert.equal(healthTone(10, 0), 'empty')
})

test('quantizeCooldown: 0 only when ready, rounds remaining time up', () => {
  assert.equal(quantizeCooldown(0), 0)
  assert.equal(quantizeCooldown(-0.2), 0)
  assert.equal(quantizeCooldown(Number.NaN), 0)
  assert.equal(quantizeCooldown(0.001), 1, 'still cooling down')
  assert.equal(quantizeCooldown(0.5), 50)
  assert.equal(quantizeCooldown(0.29 / 0.6), 49)
  assert.equal(quantizeCooldown(1), 100)
  assert.equal(quantizeCooldown(3), 100)
})

// ---------- sprites and colours ----------

test('pixelArtShadow maps each pixel to a 1em square offset by one cell', () => {
  assert.equal(pixelArtShadow(['a.', '.b'], { a: 'red', b: 'blue' }), '1em 1em red,2em 2em blue')
  assert.equal(pixelArtShadow(['..'], {}), '')
  const viaFunction = pixelArtShadow(['xx'], (key, x, y) => `c${x}${y}`)
  assert.equal(viaFunction, '1em 1em c00,2em 1em c10')
  assert.throws(() => pixelArtShadow(['z'], { a: 'red' }), TypeError, 'unknown pixel keys are a bug')
})

test('every built-in sprite is rectangular and fully coloured by its palette', () => {
  const sprites = { heart: HEART_PIXELS, hit: HIT_MARKER_PIXELS, ...TOOL_SPRITES }
  for (const [name, rows] of Object.entries(sprites)) {
    const { width } = spriteSize(rows)
    assert.ok(rows.every((row) => row.length === width), `${name} rows have equal length`)
  }
  assert.doesNotThrow(() => pixelArtShadow(HEART_PIXELS, { k: 1, l: 1, h: 1, r: 1, s: 1 }))
  assert.doesNotThrow(() => pixelArtShadow(HIT_MARKER_PIXELS, { x: 1 }))
  for (const rows of Object.values(TOOL_SPRITES)) assert.doesNotThrow(() => pixelArtShadow(rows, { w: 1, m: 1, h: 1 }))
  assert.deepEqual(Object.keys(TOOL_SPRITES).sort(), TOOLS.map((tool) => tool.key).sort(), 'one glyph per tool')
})

test('the heart splits cleanly into halves and is mirror-symmetric', () => {
  const { width } = spriteSize(HEART_PIXELS)
  HEART_PIXELS.forEach((row) => {
    for (let x = 0; x < width; x++) {
      if ('lh'.includes(row[x])) assert.ok(x < width / 2, 'left colours stay in the left half')
      if ('rs'.includes(row[x])) assert.ok(x >= width / 2, 'right colours stay in the right half')
      assert.equal(row[x] === '.', row[width - 1 - x] === '.', 'outline is symmetric')
    }
  })
})

test('shadeColor scales and clamps channels', () => {
  assert.equal(shadeColor(0x6aa84f, 1), '#6aa84f')
  assert.equal(shadeColor(0x808080, 0.5), '#404040')
  assert.equal(shadeColor(0xf0f0f0, 2), '#ffffff')
  assert.equal(shadeColor(0x000000, 0.3), '#000000')
})

// ---------- isometric block icons ----------

test('isoCubeFace maps the three visible faces', () => {
  assert.equal(isoCubeFace(0.5, 0.25).face, 'top')
  assert.equal(isoCubeFace(0.2, 0.6).face, 'left')
  assert.equal(isoCubeFace(0.8, 0.6).face, 'right')
  assert.equal(isoCubeFace(0.02, 0.02), null, 'corners are transparent')
  assert.equal(isoCubeFace(0.98, 0.98), null)
  const nearTop = isoCubeFace(0.1, 0.32)
  assert.equal(nearTop.face, 'left')
  assert.ok(nearTop.v < 0.1, 'the top of a side face samples the top rows of the tile')
})

test('isoCubePixels shades faces and keeps the side tile upright', () => {
  const top = makeTile(() => [200, 100, 50, 255])
  // Side tile: a green fringe on its top two rows, brown below.
  const side = makeTile((x, y) => (y < 2 ? [0, 200, 0, 255] : [100, 50, 0, 255]))
  const size = 48
  const pixels = isoCubePixels(top, side, size)
  assert.equal(pixels.length, size * size * 4)
  assert.deepEqual(rgba(pixels, size, 24, 12), [200, 100, 50, 255], 'top face is unshaded')
  assert.deepEqual(rgba(pixels, size, 0, 0), [0, 0, 0, 0], 'outside the cube is transparent')
  assert.deepEqual(rgba(pixels, size, 10, 46), [0, 0, 0, 0])

  const leftFringe = rgba(pixels, size, 2, 14)
  assert.equal(leftFringe[1], Math.round(200 * ICON_SHADES.left), 'left face top row shows the grass fringe')
  const leftBody = rgba(pixels, size, 6, 34)
  assert.deepEqual(leftBody, [Math.round(100 * ICON_SHADES.left), Math.round(50 * ICON_SHADES.left), 0, 255])
  const rightBody = rgba(pixels, size, 40, 34)
  assert.deepEqual(rightBody, [Math.round(100 * ICON_SHADES.right), Math.round(50 * ICON_SHADES.right), 0, 255])
  assert.ok(rightBody[0] < leftBody[0], 'right face is darker than the left')
})

test('isoCubePixels is deterministic and validates its inputs', () => {
  const tile = makeTile((x, y) => [x * 16, y * 16, 128, 255])
  assert.deepEqual(isoCubePixels(tile, tile, 32), isoCubePixels(tile, tile, 32))
  assert.throws(() => isoCubePixels(new Uint8ClampedArray(10), tile), TypeError)
  assert.throws(() => isoCubePixels(tile, [1, 2, 3]), TypeError)
  assert.throws(() => isoCubePixels(tile, tile, 4), RangeError)
  assert.throws(() => isoCubePixels(tile, tile, 20.5), RangeError)
})

test('createBlockIcon draws through a canvas and never throws', () => {
  const tile = makeTile(() => [90, 160, 70, 255])
  assert.equal(createBlockIcon(tile, tile), '', 'Node has no document: empty string')

  const { doc } = createFakeDom({ canvas: 'ok' })
  const url = createBlockIcon(tile, tile, 48, { doc })
  assert.equal(url, 'data:image/png;base64,FAKE48x48')

  assert.equal(createBlockIcon(tile, tile, 48, { doc: createFakeDom({ canvas: 'no-context' }).doc }), '')
  assert.equal(createBlockIcon(tile, tile, 48, { doc: createFakeDom({ canvas: 'throw' }).doc }), '')
  assert.equal(createBlockIcon(null, tile, 48, { doc }), '', 'invalid tiles')
  assert.equal(createBlockIcon(tile, tile, 0, { doc }), '', 'invalid size')
})

test('createBlockIcon hands the rasterised cube to the canvas', () => {
  const { doc } = createFakeDom({ canvas: 'ok' })
  let canvas = null
  const create = doc.createElement.bind(doc)
  doc.createElement = (tag) => (canvas = create(tag))
  const top = makeTile(() => [10, 20, 30, 255])
  createBlockIcon(top, top, 32, { doc })
  assert.equal(canvas.width, 32)
  assert.deepEqual(Array.from(canvas.drawn.image.data), Array.from(isoCubePixels(top, top, 32)))
})

// Regression: 48-px icons were resampled to 32 or 64 device px and blurred.
test('blockIconSize matches the displayed device pixels of a hotbar icon', () => {
  assert.equal(blockIconSize(2, 1), 32, 'default GUI scale on a 1x display')
  assert.equal(blockIconSize(3, 1), 48)
  assert.equal(blockIconSize(2, 2), 64, 'Retina')
  assert.equal(blockIconSize(2, 1.25), 40, 'fractional scaling')
  assert.equal(blockIconSize(4, 2), 128)
  assert.equal(blockIconSize(2, 3), 64, 'pixel ratio capped at 2 like the renderer')
  assert.equal(blockIconSize(Number.NaN, undefined), 32, 'unreadable --px falls back to the default scale')
  assert.equal(blockIconSize(-1, 0), 32)
  assert.equal(blockIconSize(), 32)
  assert.equal(blockIconSize(100, 2), 512, 'never above the rasteriser limit')
})

test('cubeSpriteRows outlines a full-size cube with three faces', () => {
  const rows = cubeSpriteRows(16)
  assert.equal(rows.length, 16)
  assert.ok(rows.every((row) => row.length === 16))
  const all = rows.join('')
  for (const face of 'tlr') assert.ok(all.includes(face), `face ${face} present`)
  assert.equal(rows[0][0], '.')
  assert.equal(rows[0].slice(7, 9), 'tt', 'apex of the top face is centred')
})

// ---------- logo ----------

test('logo rows spell VOXEL GROVE in 7-row bold glyphs', () => {
  for (const glyph of Object.values(LOGO_GLYPHS)) {
    assert.equal(glyph.length, 7)
    assert.ok(glyph.every((row) => row.length === 6))
  }
  const rows = logoRows()
  assert.equal(rows.length, 7)
  assert.ok(rows.every((row) => row.length === rows[0].length))
  assert.equal(rows[0].length, 10 * 6 + 3 + 10, 'ten letters, one space, single-column gaps')
  assert.ok(/^\.+$/.test(rows.map((row) => row.slice(34, 39)).join('')), 'the word gap is empty')
  assert.throws(() => logoRows('VOXEL ZONE'), RangeError)
})

test('logo colours read as grass-topped earth and are deterministic', () => {
  assert.equal(logoColor('#', 3, 0), '#b6ee7f')
  assert.equal(logoColor('#', 3, 1), '#72c84a')
  assert.equal(logoColor('#', 3, 6), '#5e3a20')
  for (let x = 0; x < 20; x++) assert.equal(logoColor('#', x, 4), logoColor('#', x, 4))
  assert.doesNotThrow(() => pixelArtShadow(logoRows(), logoColor))
})

// ---------- confirmation state ----------

test('two-step confirmation state machine', () => {
  assert.deepEqual(nextConfirmState('idle', 'press'), { state: 'armed', confirmed: false })
  assert.deepEqual(nextConfirmState('armed', 'press'), { state: 'idle', confirmed: true })
  assert.deepEqual(nextConfirmState('armed', 'cancel'), { state: 'idle', confirmed: false })
  assert.deepEqual(nextConfirmState('armed', 'timeout'), { state: 'idle', confirmed: false })
  assert.deepEqual(nextConfirmState('idle', 'reset'), { state: 'idle', confirmed: false })
})

test('control rows cover every required control', () => {
  const text = CONTROL_ROWS.map((row) => `${row.keys.join(' ')} ${row.action}`).join('\n')
  for (const needle of ['W A S D', 'Mouse', 'Space', 'Left click', 'Right click', '1–5', 'Q', 'Esc']) {
    assert.ok(text.includes(needle), `controls mention ${needle}`)
  }
  assert.match(text, /Mine \/ attack/)
  assert.match(text, /Place block/)
  assert.ok(Object.isFrozen(CONTROL_ROWS) && Object.isFrozen(CONTROL_ROWS[0]))
})

// ---------- HUD ----------

test('HUD builds crosshair, five numbered slots with icons, tool chip and hearts', () => {
  const { q, all, ui } = hudSetup()
  assert.ok(q('.vg-hud'))
  assert.ok(q('.vg-crosshair'))
  const slots = all('.vg-slot')
  assert.equal(slots.length, 5)
  assert.deepEqual(
    slots.map((slot) => slot.querySelector('.vg-slot-key').textContent),
    ['1', '2', '3', '4', '5'],
  )
  assert.equal(slots[0].querySelector('img').getAttribute('src'), 'data:image/png;base64,ICON0')
  assert.equal(slots[4].querySelector('img'), null, 'an empty icon falls back to a CSS cube')
  assert.ok(slots[4].querySelector('.vg-slot-cube .vg-sprite-ink').style.boxShadow.includes('em'))
  assert.equal(all('.vg-heart').length, 10)
  assert.match(q('.vg-tool').textContent, /Q.*Pickaxe/)
  assert.equal(ui.children.length, 1, 'the HUD adds one root element')
})

test('HUD starts on slot 1, the first tool and full health', () => {
  const { q, all } = hudSetup()
  assert.ok(all('.vg-slot')[0].classList.contains('is-selected'))
  assert.equal(q('.vg-block-label').textContent, 'Grass')
  assert.equal(q('.vg-tool-name').textContent, 'Pickaxe')
  assert.equal(q('.vg-health-text').textContent, '100 / 100')
  assert.ok(all('.vg-heart').every((heart) => heart.getAttribute('data-state') === 'full'))
})

test('setSelectedSlot highlights exactly one slot and names the block', () => {
  const { hud, q, all } = hudSetup()
  hud.setSelectedSlot(3)
  const selected = all('.vg-slot').filter((slot) => slot.classList.contains('is-selected'))
  assert.equal(selected.length, 1)
  assert.equal(selected[0].getAttribute('data-slot'), '3')
  assert.equal(selected[0].getAttribute('aria-current'), 'true')
  assert.equal(q('.vg-block-label').textContent, 'Wood')
  assert.ok(q('.vg-block-label').classList.contains('is-popping'))
})

test('setSelectedSlot ignores invalid indices', () => {
  const { hud, q } = hudSetup()
  hud.setSelectedSlot(2)
  for (const bad of [5, -1, 1.5, '1', null, undefined, Number.NaN]) hud.setSelectedSlot(bad)
  assert.equal(q('.vg-block-label').textContent, 'Stone')
})

test('setTool shows the tool name, glyph and position on the belt', () => {
  const { hud, q, all } = hudSetup()
  hud.setTool(TOOLS[1])
  assert.equal(q('.vg-tool-name').textContent, 'Axe')
  const pips = all('.vg-tool-pip')
  assert.deepEqual(
    pips.map((pip) => pip.classList.contains('is-active')),
    [false, true, false],
  )
  const visibleGlyphs = all('.vg-tool-icon').filter((sprite) => !sprite.hidden)
  assert.equal(visibleGlyphs.length, 1)
  hud.setTool('shovel')
  assert.equal(q('.vg-tool-name').textContent, 'Shovel', 'accepts a tool key')
  hud.setTool(null)
  hud.setTool({})
  assert.equal(q('.vg-tool-name').textContent, 'Shovel', 'invalid tools are ignored')
  hud.setTool({ key: 'wand', name: 'Wand' })
  assert.equal(q('.vg-tool-name').textContent, 'Wand', 'unknown tools still show their name')
  assert.ok(all('.vg-tool-icon').every((sprite) => sprite.hidden))
})

test('setHealth updates hearts, bar, number and tone', () => {
  const { hud, q, all } = hudSetup()
  hud.setHealth(85, 100)
  assert.deepEqual(
    all('.vg-heart').map((heart) => heart.getAttribute('data-state')),
    heartStates(85, 100),
  )
  assert.equal(q('.vg-health-text').textContent, '85 / 100')
  assert.equal(q('.vg-health-fill').style.transform, 'scaleX(0.85)')
  assert.equal(q('.vg-hud').getAttribute('data-health'), 'ok')
  hud.setHealth(20, 100)
  assert.equal(q('.vg-hud').getAttribute('data-health'), 'low')
  assert.equal(q('.vg-hearts').getAttribute('aria-label'), 'Health 20 / 100')
})

test('setHealth clamps to [0, max] and ignores invalid values', () => {
  const { hud, q } = hudSetup()
  hud.setHealth(-30, 100)
  assert.equal(q('.vg-health-text').textContent, '0 / 100')
  assert.equal(q('.vg-health-fill').style.transform, 'scaleX(0)')
  assert.equal(q('.vg-hud').getAttribute('data-health'), 'empty')
  hud.setHealth(500, 100)
  assert.equal(q('.vg-health-text').textContent, '100 / 100')
  hud.setHealth(Number.NaN, 100)
  hud.setHealth(50, 0)
  hud.setHealth(50, Infinity)
  assert.equal(q('.vg-health-text').textContent, '100 / 100')
})

test('HUD setters are cached: repeating a value writes nothing to the DOM', () => {
  const { hud, ui } = hudSetup()
  const apply = () => {
    hud.setVisible(true)
    hud.setSelectedSlot(2)
    hud.setTool(TOOLS[2])
    hud.setHealth(70, 100)
    hud.setAttackCooldown(0.42)
    hud.setHint('Hold to mine')
    hud.setTarget('mob')
  }
  apply()
  const before = mutationCount(ui)
  for (let frame = 0; frame < 60; frame++) apply()
  assert.equal(mutationCount(ui), before)
  hud.setAttackCooldown(0.4199)
  assert.equal(mutationCount(ui), before, 'sub-percent cooldown changes are not redrawn')
})

test('attack cooldown indicator hides when ready and refills as it recharges', () => {
  const { hud, q } = hudSetup()
  const meter = q('.vg-cooldown')
  assert.equal(meter.hidden, true)
  hud.setAttackCooldown(1)
  assert.equal(meter.hidden, false)
  assert.equal(q('.vg-cooldown-fill').style.transform, 'scaleX(0)')
  hud.setAttackCooldown(0.25)
  assert.equal(q('.vg-cooldown-fill').style.transform, 'scaleX(0.75)')
  hud.setAttackCooldown(0)
  assert.equal(meter.hidden, true)
  hud.setAttackCooldown(Number.NaN)
  assert.equal(meter.hidden, true)
})

test('flashDamage flashes the vignette and shakes the hearts; ignores non-damage', () => {
  const { hud, q } = hudSetup()
  const vignette = q('.vg-vignette')
  hud.flashDamage(0)
  hud.flashDamage(-5)
  hud.flashDamage(Number.NaN)
  assert.equal(vignette.classList.contains('is-flashing'), false)
  hud.flashDamage(10)
  assert.ok(vignette.classList.contains('is-flashing'))
  assert.ok(q('.vg-vitals').classList.contains('is-hurt'))
  const small = Number(vignette.style.getPropertyValue('--vg-hurt'))
  hud.flashDamage(15)
  const big = Number(vignette.style.getPropertyValue('--vg-hurt'))
  assert.ok(big > small && big <= 0.95, 'bigger hits flash harder')
  assert.ok(vignette.reflows >= 2, 'each flash restarts the animation')
})

test('flashHit marks hits and kills differently', () => {
  const { hud, q } = hudSetup()
  const marker = q('.vg-hitmarker')
  hud.flashHit(false)
  assert.ok(marker.classList.contains('is-hit'))
  hud.flashHit(true)
  assert.ok(marker.classList.contains('is-kill'))
  assert.equal(marker.classList.contains('is-hit'), false)
  hud.flashHit()
  assert.ok(marker.classList.contains('is-hit') && !marker.classList.contains('is-kill'))
})

test('flashRespawn plays the fade-in from dark', () => {
  const { hud, q } = hudSetup()
  hud.flashRespawn()
  assert.ok(q('.vg-fade').classList.contains('is-fading'))
})

test('toasts appear, expire, de-duplicate and keep at most three', () => {
  const { hud, timers } = hudSetup()
  assert.equal(TOAST_LIMIT, 3)
  assert.equal(hud.showToast('Mossling defeated'), true)
  assert.deepEqual(hud.toastMessages(), ['Mossling defeated'])
  timers.advance(TOAST_DURATION - 1)
  assert.equal(hud.toastMessages().length, 1)
  timers.advance(1)
  assert.deepEqual(hud.toastMessages(), [], 'expired')

  for (const text of ['a', 'b', 'c', 'd']) hud.showToast(text)
  assert.deepEqual(hud.toastMessages(), ['b', 'c', 'd'], 'oldest dropped')
  hud.showToast('b')
  assert.deepEqual(hud.toastMessages(), ['c', 'd', 'b'], 'a repeat moves to the end instead of stacking')
  timers.advance(TOAST_DURATION)
  assert.deepEqual(hud.toastMessages(), [])
  assert.equal(timers.pending, 0, 'no timers leak')
})

test('toasts reject empty text and sanitise tone and duration', () => {
  const { hud, q, timers } = hudSetup()
  assert.equal(hud.showToast(''), false)
  assert.equal(hud.showToast('   '), false)
  assert.equal(hud.showToast(null), false)
  hud.showToast('Saving failed', { tone: 'danger', duration: 500 })
  assert.equal(q('.vg-toast').getAttribute('data-tone'), 'danger')
  assert.equal(q('.vg-toast').style.animationDuration, '500ms')
  timers.advance(500)
  hud.showToast('Odd tone', { tone: 'sparkly', duration: -1 })
  assert.equal(q('.vg-toast').getAttribute('data-tone'), 'info')
  assert.equal(q('.vg-toast').style.animationDuration, `${TOAST_DURATION}ms`)
})

test('setHint shows and hides the hint line', () => {
  const { hud, q } = hudSetup()
  assert.equal(q('.vg-hint').hidden, true)
  hud.setHint('Click to resume')
  assert.equal(q('.vg-hint').hidden, false)
  assert.equal(q('.vg-hint').textContent, 'Click to resume')
  hud.setHint(null)
  assert.equal(q('.vg-hint').hidden, true)
  hud.setHint('')
  assert.equal(q('.vg-hint').hidden, true)
})

test('setVisible toggles the whole HUD; setTarget tints the crosshair', () => {
  const { hud, q } = hudSetup()
  hud.setVisible(false)
  assert.equal(q('.vg-hud').hidden, true)
  hud.setVisible(true)
  assert.equal(q('.vg-hud').hidden, false)
  hud.setTarget('mob')
  assert.equal(q('.vg-crosshair').getAttribute('data-target'), 'mob')
  hud.setTarget('bogus')
  assert.equal(q('.vg-crosshair').getAttribute('data-target'), 'none')
})

test('setSlotIcons swaps icon images in place and skips CSS-cube slots', () => {
  const { hud, all, ui } = hudSetup()
  const images = () => all('.vg-slot img').map((img) => img.getAttribute('src'))
  hud.setSlotIcons(['data:a', 'data:b', '', null, 'data:e'])
  assert.deepEqual(images(), ['data:a', 'data:b', 'data:image/png;base64,ICON2', 'data:image/png;base64,ICON3'])
  assert.equal(all('.vg-slot')[4].querySelector('img'), null, 'the CSS cube fallback stays')
  const before = mutationCount(ui)
  hud.setSlotIcons(['data:a', 'data:b'])
  hud.setSlotIcons(null)
  assert.equal(mutationCount(ui), before, 'unchanged icons are not rewritten')
})

test('HUD tolerates missing slot data and tools', () => {
  const dom = createFakeDom()
  const hud = createHud(dom.ui, { slots: [{ blockId: 3 }, null], tools: undefined, timers: createFakeTimers() })
  const labels = dom.ui.querySelectorAll('.vg-slot').map((slot) => slot.getAttribute('aria-label'))
  assert.deepEqual(labels, ['1: Stone', '2: Slot 2'])
  assert.equal(dom.ui.querySelectorAll('.vg-tool-pip').length, 0)
  hud.setTool(TOOLS[0])
  assert.equal(dom.ui.querySelector('.vg-tool-name').textContent, 'Pickaxe')
})

test('HUD dispose removes its DOM and pending toast timers', () => {
  const { hud, ui, timers } = hudSetup()
  hud.showToast('bye')
  hud.dispose()
  assert.equal(ui.children.length, 0)
  assert.equal(timers.pending, 0)
})

// ---------- screens ----------

test('screens expose stable button ids as real buttons', () => {
  const { byId } = screensSetup()
  for (const id of ['play-button', 'resume-button', 'reset-button', 'pause-reset-button', 'respawn-button']) {
    const button = byId(id)
    assert.ok(button, `#${id} exists`)
    assert.equal(button.tagName, 'BUTTON')
    assert.equal(button.getAttribute('type'), 'button')
  }
})

test('show() reveals one overlay and hides the rest with the hidden attribute', () => {
  const { screens, screen, ui } = screensSetup()
  const container = ui.querySelector('.vg-screens')
  assert.equal(container.hidden, true, 'nothing shown before the first show()')
  for (const name of SCREEN_NAMES) {
    assert.equal(screens.show(name), true)
    assert.equal(screens.current, name)
    for (const other of SCREEN_NAMES) assert.equal(screen(other).hidden, other !== name)
    assert.equal(container.hidden, false)
  }
  screens.show(null)
  assert.equal(container.hidden, true, 'no overlay blocks the game')
  assert.ok(SCREEN_NAMES.every((name) => screen(name).hidden))
  assert.equal(screens.current, null)
})

test('show() ignores unknown names and blurs the focused element', () => {
  const { screens, byId, doc } = screensSetup()
  screens.show('title')
  assert.equal(screens.show('credits'), false)
  assert.equal(screens.current, 'title')
  byId('play-button').focus()
  assert.equal(doc.activeElement, byId('play-button'))
  screens.show(null)
  assert.equal(doc.activeElement, doc.body, 'focus never lingers on a hidden button')
})

test('title screen: logo, tagline, Play, controls and reset', () => {
  const { screen } = screensSetup()
  const title = screen('title')
  assert.ok(title.querySelector('h1').textContent.includes('Voxel Grove'))
  assert.ok(title.querySelector('.vg-logo-art .vg-sprite-ink').style.boxShadow.length > 1000, 'pixel logo is drawn')
  assert.ok(title.querySelector('.vg-tagline').textContent.length > 10)
  assert.equal(title.querySelectorAll('.vg-control').length, CONTROL_ROWS.length)
  assert.ok(title.querySelector('#play-button').textContent.includes('Play'))
  assert.ok(title.querySelector('#reset-button'))
})

test('a button fires once per show, even when double-clicked', () => {
  const { screens, byId, calls } = screensSetup()
  screens.show('title')
  byId('play-button').click()
  byId('play-button').click()
  assert.equal(calls.play, 1)
  screens.show('title') // e.g. the pointer-lock request failed and the title is shown again
  byId('play-button').click()
  assert.equal(calls.play, 2)
})

test('a fired button re-arms after a delay so a silently failed request can be retried', () => {
  const { screens, byId, calls, timers } = screensSetup()
  screens.show('pause')
  byId('resume-button').click()
  timers.advance(REARM_DELAY - 1)
  byId('resume-button').click()
  assert.equal(calls.resume, 1)
  timers.advance(1)
  byId('resume-button').click()
  assert.equal(calls.resume, 2)
})

test('resume and respawn call their handlers', () => {
  const { screens, byId, calls, screen } = screensSetup()
  screens.show('pause')
  byId('resume-button').click()
  assert.equal(calls.resume, 1)
  screens.show('death')
  assert.match(screen('death').textContent, /You were defeated/)
  assert.match(screen('death').textContent, /Respawn/)
  byId('respawn-button').click()
  byId('respawn-button').click()
  assert.equal(calls.respawn, 1)
})

test('Reset World needs two clicks; Cancel and timeout disarm it', () => {
  const { screens, byId, calls, timers } = screensSetup()
  screens.show('title')
  const reset = byId('reset-button')
  reset.click()
  assert.equal(calls.reset, 0, 'first click only arms')
  assert.ok(reset.classList.contains('is-armed'))
  assert.match(reset.textContent, /Yes, reset/)
  const cancel = reset.parentNode.querySelector('.vg-button-ghost')
  assert.equal(cancel.hidden, false)
  cancel.click()
  assert.equal(reset.classList.contains('is-armed'), false)
  assert.equal(cancel.hidden, true)

  reset.click()
  timers.advance(CONFIRM_TIMEOUT)
  assert.equal(reset.classList.contains('is-armed'), false, 'disarms by itself')
  reset.click()
  reset.click()
  assert.equal(calls.reset, 1, 'confirmed on the second click')
  assert.match(reset.textContent, /^Reset world$/)
})

test('pause has its own reset and showing a screen disarms any armed reset', () => {
  const { screens, byId, calls, screen } = screensSetup()
  screens.show('pause')
  assert.ok(screen('pause').querySelector('#pause-reset-button'))
  byId('pause-reset-button').click()
  screens.show('pause')
  assert.equal(byId('pause-reset-button').classList.contains('is-armed'), false)
  byId('pause-reset-button').click()
  byId('pause-reset-button').click()
  assert.equal(calls.reset, 1)
  byId('pause-reset-button').click()
  byId('pause-reset-button').click()
  assert.equal(calls.reset, 1, 'reset fires only once per show')
})

test('setNotice fills the title and pause notice slots', () => {
  const { screens, screen } = screensSetup()
  const notices = () => ['title', 'pause'].map((name) => screen(name).querySelector('.vg-notice'))
  assert.ok(notices().every((node) => node.hidden))
  screens.setNotice("Couldn't capture the mouse — wait a moment and click Resume")
  for (const node of notices()) {
    assert.equal(node.hidden, false)
    assert.match(node.textContent, /capture the mouse/)
  }
  screens.setNotice(null)
  assert.ok(notices().every((node) => node.hidden))
})

// Regression: dialogs were announced as an unnamed 'dialog'.
test('every screen is a dialog named by its heading; reset buttons describe their warning', () => {
  const { screen, byId } = screensSetup()
  for (const name of SCREEN_NAMES) {
    const node = screen(name)
    assert.equal(node.getAttribute('role'), 'dialog')
    const labelId = node.getAttribute('aria-labelledby')
    assert.equal(labelId, SCREEN_HEADINGS[name])
    const heading = node.querySelector(`#${labelId}`)
    assert.ok(heading, `${name} heading exists inside its dialog`)
    assert.match(heading.tagName, /^H[12]$/)
  }
  assert.equal(screen('title').querySelector(`#${SCREEN_HEADINGS.title}`).textContent, 'Voxel Grove')
  assert.equal(byId(SCREEN_HEADINGS.pause).textContent, 'Paused')
  assert.equal(byId(SCREEN_HEADINGS.death).textContent, 'You were defeated')
  for (const id of ['reset-button', 'pause-reset-button']) {
    const describedBy = byId(id).getAttribute('aria-describedby')
    assert.ok(describedBy, `#${id} is described`)
    assert.match(byId(describedBy).textContent, /erases every block/)
  }
})

test('showing a dialog still blurs instead of focusing a button', () => {
  const { screens, byId, doc } = screensSetup()
  byId('respawn-button').focus()
  screens.show('death')
  assert.equal(doc.activeElement, doc.body, 'a held Space or Enter cannot trigger Respawn')
})

test('a lock-failure notice can offer to play without mouse capture', () => {
  const { screens, byId, screen, calls } = screensSetup()
  const offer = () => byId(UNLOCKED_BUTTON_ID)
  screens.show('title')
  assert.equal(offer().tagName, 'BUTTON')
  assert.equal(offer().hidden, true, 'hidden until offered')
  screens.setNotice("Couldn't capture the mouse.", { offerUnlocked: true })
  assert.equal(offer().hidden, false)
  assert.ok(screen('title').contains(offer()), 'shown under the title notice')
  assert.match(offer().textContent, /without mouse capture/i)
  offer().click()
  offer().click()
  assert.equal(calls.unlocked, 1, 'fires once per show')

  screens.show('pause')
  assert.ok(screen('pause').contains(offer()), 'moves to the visible screen (ids stay unique)')
  assert.equal(screens.notice, "Couldn't capture the mouse.")
  offer().click()
  assert.equal(calls.unlocked, 2)

  screens.setNotice('World reset to its original terrain.')
  assert.equal(offer().hidden, true, 'another notice withdraws the offer')
  screens.setNotice(null, { offerUnlocked: true })
  assert.equal(offer().hidden, true, 'never offered without a notice')
  assert.ok(screen('pause').querySelector('.vg-notice-slot').hidden)
})

test('menu clicks never reach the game; the context menu is suppressed', () => {
  const { screens, byId, win } = screensSetup()
  const reached = []
  for (const type of ['mousedown', 'click', 'contextmenu']) win.addEventListener(type, () => reached.push(type))
  screens.show('title')
  fire(byId('play-button'), 'mousedown', { button: 0 })
  byId('play-button').click()
  const menu = fire(byId('play-button'), 'contextmenu', { button: 2 })
  assert.deepEqual(reached, [])
  assert.equal(menu.defaultPrevented, true)
})

test('missing callbacks are harmless', () => {
  const dom = createFakeDom()
  const screens = createScreens(dom.ui, { timers: createFakeTimers() })
  screens.show('title')
  assert.doesNotThrow(() => dom.doc.getElementById('play-button').click())
  const reset = dom.doc.getElementById('reset-button')
  assert.doesNotThrow(() => {
    reset.click()
    reset.click()
  })
})

test('screens dispose removes their DOM and timers', () => {
  const { screens, byId, ui, timers } = screensSetup()
  screens.show('title')
  byId('reset-button').click()
  byId('play-button').click()
  screens.dispose()
  assert.equal(ui.children.length, 0)
  assert.equal(timers.pending, 0)
})

// ---------- start-up failure ----------

test('fatalMessage names WebGL when the renderer could not start', () => {
  assert.equal(fatalMessage(new Error('THREE.WebGLRenderer: Error creating WebGL context.')), FATAL_COPY.webgl)
  assert.match(FATAL_COPY.webgl, /needs WebGL 2/)
  assert.equal(fatalMessage(new Error('boom')), FATAL_COPY.generic)
  assert.equal(fatalMessage(null), FATAL_COPY.generic)
  assert.equal(fatalMessage('webgl2 unavailable'), FATAL_COPY.webgl)
})

// Regression: a WebGL failure left a blank page.
test('showFatalError replaces the interface with a styled, named message', () => {
  const { ui, doc } = createFakeDom()
  ui.appendChild(doc.createElement('div')) // a partly built HUD
  const node = showFatalError(ui, new Error('Error creating WebGL context.'))
  assert.equal(ui.children.length, 1)
  assert.equal(ui.children[0], node)
  assert.ok(node.classList.contains('vg-screen-fatal'))
  assert.equal(node.getAttribute('role'), 'alertdialog')
  assert.equal(doc.getElementById(node.getAttribute('aria-labelledby')).textContent, FATAL_COPY.title)
  assert.match(doc.getElementById(node.getAttribute('aria-describedby')).textContent, /needs WebGL 2/)
  assert.equal(showFatalError(null, new Error('x')), null, 'no root: nothing to do')
})

test('main.js catches start-up failures and only exposes a game that exists', () => {
  const main = readFileSync(new URL('src/main.js', ROOT), 'utf8')
  assert.match(main, /try\s*\{[^}]*createGame\(/, 'createGame runs inside try')
  assert.match(main, /catch \(error\)\s*\{[^}]*console\.error\([^)]*error\)[^}]*showFatalError\(/)
  assert.match(main, /if \(import\.meta\.env\.DEV && game\)/)
})

// ---------- static files ----------

test('index.html has #app, #ui, the title and exactly one module script', () => {
  const html = readFileSync(new URL('index.html', ROOT), 'utf8')
  assert.match(html, /<div id="app"><\/div>/)
  assert.match(html, /<div id="ui"><\/div>/)
  assert.match(html, /<title>Voxel Grove<\/title>/)
  const scripts = html.match(/<script\b[^>]*>/g) ?? []
  assert.deepEqual(scripts, ['<script type="module" src="/src/main.js">'])
  assert.doesNotMatch(html, /https?:\/\//, 'no external resources')
  assert.doesNotMatch(html, /<link[^>]+stylesheet/)
})

// Regression: translating the whole button moved its hit box, so a click on
// its top edge ended outside it and never fired.
test('a pressed button keeps its hit box still and only sinks its contents', () => {
  const css = readFileSync(new URL('src/style.css', ROOT), 'utf8')
  const pressed = cssRule(css, '.vg-button:active')
  assert.ok(pressed, '.vg-button:active rule exists')
  assert.doesNotMatch(pressed, /transform/)
  const contents = cssRule(css, '.vg-button:active > .vg-button-label,\n.vg-button:active > .vg-button-icon')
  assert.match(contents ?? '', /transform: translateY\(var\(--px\)\)/)
})

test('hotbar icon images render pixelated', () => {
  const css = readFileSync(new URL('src/style.css', ROOT), 'utf8')
  assert.match(cssRule(css, 'img.vg-slot-icon') ?? '', /image-rendering: pixelated/)
})

test('style.css is self-contained: no imports, external URLs or web fonts', () => {
  const css = readFileSync(new URL('src/style.css', ROOT), 'utf8')
  assert.doesNotMatch(css, /@import/)
  assert.doesNotMatch(css, /url\(/)
  assert.doesNotMatch(css, /@font-face/)
  assert.doesNotMatch(css, /https?:\/\//)
  const hiddenRule = css.match(/([^{}]*)\{\s*display: none !important;\s*\}/)
  assert.ok(hiddenRule, 'hidden overlays are display:none')
  for (const selector of ['#ui [hidden]', '.vg-screens [hidden]', '.vg-hud [hidden]']) assert.ok(hiddenRule[1].includes(selector), selector)
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^@\s{}][^{}]*(?=\{)/gm) ?? []
  for (const selector of selectors.flatMap((s) => s.split(',')).map((s) => s.trim())) {
    if (/^(from|to|\d+%)/.test(selector)) continue
    assert.match(selector, /^(html|body|#app|#ui|\.vg-|img\.vg-)/, `scoped selector: ${selector}`)
  }
})
