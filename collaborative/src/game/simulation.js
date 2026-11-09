// Gameplay simulation, independent of the DOM and Three.js.
// Views read its state and subscribe to events.

import { FALL_RESCUE_Y, MAX_FRAME_DT, PHYSICS_STEP, PLAYER_KNOCKBACK, WORLD_SEED } from '../config.js'
import { GAME_EVENTS, createEventBus } from '../core/events.js'
import { horizontalDirection } from '../core/geometry.js'
import { createWorld } from '../world/world.js'
import { HOTBAR_BLOCKS } from '../world/blocks.js'
import { generateWorldData } from '../world/generator.js'
import { createWorldPersistence } from '../world/persistence.js'
import { findPlayerSpawn } from '../world/spawn.js'
import { bodyCollides, liftOutOfBlocks } from '../world/physics.js'
import { applyLook, createPlayer, eyePosition, playerBox, resetPlayer, viewDirection } from '../player/player.js'
import { EMBED_MAX_LIFT, updatePlayer } from '../player/playerController.js'
import { createToolbelt } from '../interaction/tools.js'
import { createActionController } from '../interaction/actionController.js'
import { createPlayerCombat } from '../combat/playerCombat.js'
import { createMobManager } from '../mobs/mobManager.js'
import { createPlayerActions } from './playerActions.js'

const IDLE_CONTROLS = Object.freeze({
  move: { forward: false, backward: false, left: false, right: false, jump: false },
  look: { dx: 0, dy: 0 },
  primaryPressed: false,
  primaryHeld: false,
  secondaryPressed: false,
})

export function createSimulation({ storage = null, seed = WORLD_SEED, events = createEventBus({ known: GAME_EVENTS }) } = {}) {
  const baseData = generateWorldData({ seed })
  const world = createWorld()
  const persistence = createWorldPersistence({ storage, seed })
  const restoreResult = persistence.restore(world, baseData)
  persistence.attach(world, baseData)

  const player = createPlayer(findPlayerSpawn(world))
  const mobs = createMobManager({ world, events, seed })
  mobs.spawnAll(player.position)

  const toolbelt = createToolbelt()
  const actions = createActionController()
  const combat = createPlayerCombat()
  const playerActions = createPlayerActions({ world, events, actions, combat })
  let selectedSlot = 0
  let lastFrame = { hit: null, mobTarget: null }

  function playerTarget(active) {
    return { position: player.position, width: player.width, height: player.height, active }
  }

  function applyMobAttacks(attacks) {
    for (const { mob, damage } of attacks) {
      if (player.health.isDead) return
      const applied = player.health.damage(damage)
      if (applied <= 0) continue
      knockPlayerBack(mob)
      events.emit('player:damaged', {
        amount: applied,
        health: player.health.current,
        maxHealth: player.health.max,
        source: { ...mob.position },
      })
      if (player.health.isDead) die()
    }
  }

  // A small shove away from the attacker makes hits readable. An attacker
  // exactly on the player's column gives no horizontal push, only the hop.
  function knockPlayerBack(mob) {
    const away = horizontalDirection(mob.position, player.position)
    player.velocity.x += away.x * PLAYER_KNOCKBACK.speed
    player.velocity.z += away.z * PLAYER_KNOCKBACK.speed
    if (player.onGround) player.velocity.y = Math.max(player.velocity.y, PLAYER_KNOCKBACK.hop)
  }

  function die() {
    playerActions.cancel('death')
    player.velocity.x = 0
    player.velocity.z = 0
    events.emit('player:died', {})
  }

  function stepPhysics(dt, move) {
    let remaining = dt
    while (remaining > 1e-9 && !player.health.isDead) {
      const h = Math.min(remaining, PHYSICS_STEP)
      updatePlayer(player, world, move, h)
      applyMobAttacks(mobs.update(h, playerTarget(true)))
      remaining -= h
    }
  }

  // Safety net: a body buried deeper than the controller's small lift, or one
  // that somehow fell out of the world, goes back to a safe spawn.
  function rescuePlayer() {
    const buried = bodyCollides(world, player) && !liftOutOfBlocks(world, player, EMBED_MAX_LIFT)
    if (!buried && player.position.y >= FALL_RESCUE_Y) return
    Object.assign(player.position, findPlayerSpawn(world))
    player.velocity.x = player.velocity.y = player.velocity.z = 0
  }

  // Advance one rendered frame of gameplay. Call only while the game mode is
  // 'playing'; paused/dead/title frames simply do not call update().
  // Non-finite or non-positive dt is ignored; long frames are clamped to
  // MAX_FRAME_DT (a hitch slows the game instead of teleporting it).
  function update(dt, controls = IDLE_CONTROLS) {
    if (!Number.isFinite(dt) || dt <= 0 || player.health.isDead) return lastFrame
    const frameDt = Math.min(dt, MAX_FRAME_DT)
    applyLook(player, controls.look.dx, controls.look.dy)
    rescuePlayer()
    stepPhysics(frameDt, controls.move)
    if (player.health.isDead) return (lastFrame = { hit: null, mobTarget: null })
    lastFrame = playerActions.update({
      dt: frameDt,
      eye: eyePosition(player),
      direction: viewDirection(player),
      primaryPressed: controls.primaryPressed,
      primaryHeld: controls.primaryHeld,
      secondaryPressed: controls.secondaryPressed,
      selectedBlockId: HOTBAR_BLOCKS[selectedSlot],
      mobs: mobs.aliveMobs(),
      applyMobDamage: (mob, amount) => mobs.damage(mob, amount, { from: player.position }),
      obstacles: [playerBox(player), ...mobs.obstacleBoxes()],
    })
    return lastFrame
  }

  function respawn() {
    const spawn = findPlayerSpawn(world)
    playerActions.cancel('respawn')
    resetPlayer(player, spawn)
    combat.reset()
    mobs.reset(spawn)
    lastFrame = { hit: null, mobTarget: null }
    events.emit('player:respawned', { position: { ...spawn } })
  }

  // Adopt the edits another tab saved (window 'storage' event). Any timed
  // action is cancelled first, since its target may have changed; the world is
  // rebuilt without re-saving, and a player now inside blocks is freed.
  // Returns the restore result { status, applied, skipped }.
  function reloadSavedEdits() {
    playerActions.cancel('reset')
    const result = persistence.resync(world, baseData)
    rescuePlayer()
    lastFrame = { hit: null, mobTarget: null }
    return result
  }

  // Clear saved edits and regenerate the identical seed-42 terrain.
  function resetWorld() {
    playerActions.cancel('reset')
    persistence.clear()
    world.replaceAll(baseData)
    events.emit('world:reset', {})
    respawn()
  }

  function selectSlot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= HOTBAR_BLOCKS.length) return false
    selectedSlot = index
    events.emit('hotbar:select', { index, blockId: HOTBAR_BLOCKS[index] })
    return true
  }

  function cycleSlot(delta) {
    const count = HOTBAR_BLOCKS.length
    return selectSlot((((selectedSlot + Math.sign(delta)) % count) + count) % count)
  }

  function cycleTool() {
    const tool = toolbelt.cycle()
    events.emit('tool:change', { tool })
    return tool
  }

  return {
    events,
    world,
    baseData,
    persistence,
    restoreResult,
    player,
    mobs,
    toolbelt,
    actions,
    combat,
    update,
    respawn,
    resetWorld,
    reloadSavedEdits,
    cancelAction: (reason) => playerActions.cancel(reason),
    selectSlot,
    cycleSlot,
    cycleTool,
    get selectedSlot() {
      return selectedSlot
    },
    get selectedBlockId() {
      return HOTBAR_BLOCKS[selectedSlot]
    },
    get lastFrame() {
      return lastFrame
    },
  }
}
