// Syncs Three.js views from simulation state and events without changing gameplay.
// `gfx` can be supplied by the caller to use a stub renderer in tests.

import { PLAYER, WORLD_SIZE } from '../config.js'
import { eyePosition } from '../player/player.js'
import { movementAmount } from '../player/playerController.js'
import { createRenderer } from '../render/renderer.js'
import { createEnvironment } from '../render/environment.js'
import { createBlockAtlas } from '../render/textures.js'
import { createWorldView } from '../render/worldView.js'
import { createEffects } from '../render/effects.js'
import { createHandView } from '../render/handView.js'
import { createMobView } from '../render/mobView.js'

const HURT_SHAKE_TIME = 0.35
const HURT_ROLL = 0.09
const DEATH_FALL_TIME = 0.8
const DEATH_ROLL = 0.6
const TITLE_ORBIT_SPEED = 0.06
const TITLE_ORBIT = Object.freeze({ radius: 30, height: 24, lookHeight: 8 })

function sameCell(a, b) {
  return Boolean(a && b) && a.x === b.x && a.y === b.y && a.z === b.z
}

// The crack follows an active break; `hit` (the raycast hit on that block)
// tells the effects where to emit mining dust.
function crackVisual(action, hit) {
  if (action?.kind !== 'break') return null
  const { target, progress, blockId } = action
  return { target, progress, blockId, hit: sameCell(hit, target) ? hit : null }
}

function previewVisual(action) {
  if (action?.kind !== 'place') return null
  const { target, progress, blockId } = action
  return { target, progress, blockId }
}

// What the interaction overlays show this frame. Crack and construction
// preview follow the active timed action and stay (frozen) while paused; the
// outline marks the targeted block only while playing, with nothing in
// progress and no mob under the crosshair.
export function interactionVisuals(mode, active, frame) {
  const live = mode === 'playing'
  const action = live || mode === 'paused' ? (active ?? null) : null
  const hit = frame?.hit ?? null
  return {
    crack: crackVisual(action, hit),
    preview: previewVisual(action),
    outline: live && !action && hit && !frame.mobTarget ? hit : null,
  }
}

export function createGameView({ container, sim, gfx = createRenderer(container) }) {
  const { events, world, player } = sim
  const atlas = createBlockAtlas()
  const environment = createEnvironment(gfx.scene)
  const worldView = createWorldView({ world, scene: gfx.scene, atlas })
  const effects = createEffects(gfx.scene, { atlas, world })
  const hand = createHandView()
  const mobView = createMobView({ scene: gfx.scene, events, effects })
  gfx.setOverlay(hand.scene, hand.camera)
  gfx.onResize((width, height) => hand.resize(width, height))

  const camera = gfx.camera
  const feedback = { hurt: 0, hurtSide: 0, death: -1, orbit: 0.8 }

  // Which side the hit came from tilts the camera away from the attacker.
  function onPlayerDamaged({ source }) {
    feedback.hurt = HURT_SHAKE_TIME
    if (!source) return
    const toSourceX = source.x - player.position.x
    const toSourceZ = source.z - player.position.z
    const rightX = Math.cos(player.yaw)
    const rightZ = -Math.sin(player.yaw)
    feedback.hurtSide = Math.sign(toSourceX * rightX + toSourceZ * rightZ) || 1
  }

  function onDied() {
    feedback.death = 0
    effects.clear()
  }

  function onRespawned({ position }) {
    effects.clear()
    feedback.death = -1
    feedback.hurt = 0
    effects.burst({ x: position.x, y: position.y + 0.2, z: position.z }, 0xfff1a8, 30, { speed: 2.4, upward: 3, lifetime: 0.9 })
  }

  // mobView clears its own models on 'world:reset' and 'player:respawned'.
  const subscriptions = [
    events.on('block:broken', ({ x, y, z, blockId }) => effects.burstBlock({ x, y, z }, blockId)),
    events.on('block:placed', ({ x, y, z, blockId }) => effects.burstPlaced({ x, y, z }, blockId)),
    events.on('action:start', ({ kind }) => kind === 'place' && hand.trigger('place')),
    events.on('player:swing', () => hand.trigger('swing')),
    events.on('tool:change', ({ tool }) => hand.setTool(tool.key)),
    events.on('player:damaged', onPlayerDamaged),
    events.on('player:died', onDied),
    events.on('player:respawned', onRespawned),
    events.on('world:reset', () => effects.clear()),
  ]
  hand.setTool(sim.toolbelt.current.key)

  // Build every shader program now (behind the title screen) instead of
  // stalling on the first play frame, first mine or first placement. The
  // chunks are meshed first so their material is included; compile() also
  // visits hidden overlays, but it only counts the lights of a visible
  // scene, so the hand scene is shown for its pass.
  function precompileShaders() {
    if (typeof gfx.renderer.compile !== 'function') return
    const handVisible = hand.scene.visible
    try {
      worldView.update()
      gfx.renderer.compile(gfx.scene, camera)
      hand.scene.visible = true
      gfx.renderer.compile(hand.scene, hand.camera)
    } catch (error) {
      console.warn('Voxel Grove: shader warm-up skipped', error)
    } finally {
      hand.scene.visible = handVisible
    }
  }

  // Slow orbit around the island behind the title screen.
  function placeTitleCamera(dt) {
    feedback.orbit += dt * TITLE_ORBIT_SPEED
    const center = WORLD_SIZE / 2
    const { radius, height, lookHeight } = TITLE_ORBIT
    camera.position.set(center + Math.cos(feedback.orbit) * radius, height, center + Math.sin(feedback.orbit) * radius)
    camera.lookAt(center, lookHeight, center)
  }

  // Hurt roll and death drop are camera-only effects; the eye stays where
  // the raycast starts, so the crosshair always matches the target.
  function cameraShake(dt) {
    let roll = 0
    let drop = 0
    if (feedback.hurt > 0) {
      feedback.hurt = Math.max(0, feedback.hurt - dt)
      roll = feedback.hurtSide * HURT_ROLL * (feedback.hurt / HURT_SHAKE_TIME)
    }
    if (feedback.death >= 0) {
      feedback.death = Math.min(DEATH_FALL_TIME, feedback.death + dt)
      const t = feedback.death / DEATH_FALL_TIME
      drop = (PLAYER.eyeHeight - 0.35) * t * t
      roll = DEATH_ROLL * t
    }
    return { roll, drop }
  }

  function placePlayerCamera(dt) {
    const eye = eyePosition(player)
    const { roll, drop } = cameraShake(dt)
    camera.position.set(eye.x, eye.y - drop, eye.z)
    camera.rotation.set(player.pitch, player.yaw, roll, 'YXZ')
  }

  function syncInteractionEffects(mode) {
    const { crack, preview, outline } = interactionVisuals(mode, sim.actions.active, sim.lastFrame)
    effects.setCrack(crack?.target ?? null, crack?.progress ?? 0, crack?.blockId, crack?.hit ?? null)
    effects.setPlacementPreview(preview?.target ?? null, preview?.blockId ?? 0, preview?.progress ?? 0)
    effects.setHighlight(outline)
  }

  function handState(mode) {
    const live = mode === 'playing'
    const active = sim.actions.active
    return {
      action: live && active ? { kind: active.kind, progress: active.progress } : null,
      moving: live && player.onGround ? movementAmount(player) : 0,
      onGround: player.onGround,
    }
  }

  // Advance visuals by one rendered frame. `mode` is the game mode; gameplay
  // visuals (mobs, hand) freeze while paused so the scene reads as stopped.
  function update(dt, mode) {
    const live = mode === 'playing'
    const visualDt = live || mode === 'title' ? dt : 0
    if (mode === 'title') placeTitleCamera(dt)
    else placePlayerCamera(dt)

    worldView.update()
    environment.update(dt, camera.position)
    mobView.update(sim.mobs.mobs, visualDt)
    syncInteractionEffects(mode)
    effects.update(live || mode === 'dead' ? dt : 0)
    hand.scene.visible = mode !== 'title' && mode !== 'dead'
    hand.update(live ? dt : 0, handState(mode))
    gfx.render()
  }

  function dispose() {
    for (const unsubscribe of subscriptions) unsubscribe()
    mobView.dispose()
    effects.dispose()
    hand.dispose()
    worldView.dispose()
    atlas.dispose()
    environment.dispose()
    gfx.dispose()
  }

  precompileShaders()

  return {
    update,
    dispose,
    atlas,
    domElement: gfx.renderer.domElement,
    renderer: gfx.renderer,
  }
}
