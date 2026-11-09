// Resolves melee, mining, and placement from mouse input and advances timed actions.

import { REACH, COMBAT } from '../config.js'
import { BLOCK } from '../world/blocks.js'
import { raycastBlocks } from '../world/raycast.js'
import { evaluateBreak, evaluatePlace, placementCell } from '../interaction/blockRules.js'
import { findMobTarget } from '../combat/playerCombat.js'

// Left-click decision table (one press):
//   1. a live mob within melee reach, not behind a block -> 'melee' (swallowed
//      while the attack cools down; never mines the block behind it)
//   2. a mob further along the ray, in front of the block  -> 'miss' swing; the
//      block is hidden behind the mob, so it is not the visible target
//   3. otherwise                                           -> 'mine'
// targets = { meleeTarget, occluder } as found along the crosshair ray.
export function classifyPress({ meleeTarget = null, occluder = null } = {}) {
  if (meleeTarget) return 'melee'
  if (occluder) return 'miss'
  return 'mine'
}

export function createPlayerActions({ world, events, actions, combat }) {
  // What the current left-button press is for. Holding the button only keeps
  // mining when the press itself began as mining, so the frames after a melee
  // kill never start breaking the block behind the fallen mob.
  let pressIntent = null

  function emitCancel(action, reason) {
    if (action) events.emit('action:cancel', { ...action, reason })
  }

  function cancel(reason) {
    emitCancel(actions.cancel(reason), reason)
  }

  function breakOptions(ctx) {
    return { eye: ctx.eye, reach: REACH }
  }

  function placeOptions(ctx, blockId) {
    return { eye: ctx.eye, reach: REACH, blockId, obstacles: ctx.obstacles }
  }

  // A melee press on a mob interrupts any timed action (break or place), even
  // when the swing itself is swallowed by the cooldown.
  function melee(ctx, hit, targets) {
    if (actions.isBusy()) cancel('attack')
    const result = combat.attack(targets.meleeTarget.mob, ctx.applyMobDamage)
    if (result.attacked) events.emit('player:swing', { hit: result.applied > 0 })
  }

  // The block behind the mob is hidden, so the press only swings at the air
  // (not while a timed action keeps the hand busy).
  function miss() {
    if (!actions.isBusy()) events.emit('player:swing', { hit: false })
  }

  function mine(ctx, hit) {
    tryStartBreak(hit, ctx)
  }

  const PRESS_HANDLERS = Object.freeze({ melee, miss, mine })

  // A new press is classified and dispatched; holding the button afterwards
  // only keeps mining (block after block) when the press began as mining and
  // nothing stands in the way.
  function handlePrimary(ctx, hit, targets) {
    if (ctx.primaryPressed) {
      pressIntent = classifyPress(targets)
      PRESS_HANDLERS[pressIntent](ctx, hit, targets)
    } else if (!ctx.primaryHeld) {
      pressIntent = null
    } else if (pressIntent === 'mine' && !targets.occluder) {
      tryStartBreak(hit, ctx)
    }
  }

  function tryStartBreak(hit, ctx) {
    if (actions.isBusy()) return false
    if (!evaluateBreak(world, hit, breakOptions(ctx)).ok) return false
    const target = { x: hit.x, y: hit.y, z: hit.z }
    if (!actions.start('break', target, hit.id)) return false
    events.emit('action:start', { kind: 'break', target, blockId: hit.id })
    return true
  }

  function tryStartPlace(hit, ctx) {
    if (actions.isBusy()) return false
    const cell = placementCell(hit)
    const verdict = evaluatePlace(world, cell, placeOptions(ctx, ctx.selectedBlockId))
    if (!verdict.ok) return false
    if (!actions.start('place', cell, ctx.selectedBlockId)) return false
    events.emit('action:start', { kind: 'place', target: cell, blockId: ctx.selectedBlockId })
    return true
  }

  // An in-progress action stays valid only while its target does: mining
  // needs the crosshair to stay on the same, visible block (a mob stepping
  // into the ray in front of it hides it); construction needs the cell to
  // stay free, reachable, and clear of the player and mobs.
  function activeActionStillValid(action, hit, ctx, occluder) {
    if (action.kind === 'break') {
      const { x, y, z } = action.target
      const sameBlock = hit && hit.x === x && hit.y === y && hit.z === z
      return !occluder && sameBlock && evaluateBreak(world, hit, breakOptions(ctx)).ok
    }
    return evaluatePlace(world, action.target, placeOptions(ctx, action.blockId)).ok
  }

  function complete(action, ctx) {
    const { x, y, z } = action.target
    if (action.kind === 'break') {
      const blockId = world.getBlock(x, y, z)
      const verdict = evaluateBreak(world, { x, y, z, id: blockId }, breakOptions(ctx))
      if (!verdict.ok || !world.setBlock(x, y, z, BLOCK.AIR)) return emitCancel(action, verdict.reason ?? 'unchanged')
      events.emit('block:broken', { x, y, z, blockId })
      return
    }
    const verdict = evaluatePlace(world, action.target, placeOptions(ctx, action.blockId))
    if (!verdict.ok || !world.setBlock(x, y, z, action.blockId)) return emitCancel(action, verdict.reason ?? 'unchanged')
    events.emit('block:placed', { x, y, z, blockId: action.blockId })
  }

  // Mobs on the crosshair ray, in front of the first block: the nearest one in
  // melee reach, and the nearest one within block reach (which hides the block).
  function findTargets(ctx, hit) {
    const blockDistance = hit ? hit.distance : Infinity
    const meleeTarget = findMobTarget(ctx.mobs, ctx.eye, ctx.direction, { reach: COMBAT.playerReach, blockDistance })
    const occluder = meleeTarget ?? findMobTarget(ctx.mobs, ctx.eye, ctx.direction, { reach: REACH, blockDistance })
    return { meleeTarget, occluder }
  }

  // ctx: { eye, direction, dt, primaryPressed, primaryHeld, secondaryPressed,
  //        selectedBlockId, mobs, applyMobDamage, obstacles }
  // Returns the visible targets so views can highlight them.
  function update(ctx) {
    combat.update(ctx.dt)
    const hit = raycastBlocks(world, ctx.eye, ctx.direction, REACH)
    const targets = findTargets(ctx, hit)

    handlePrimary(ctx, hit, targets)
    if (ctx.secondaryPressed && !targets.occluder) tryStartPlace(hit, ctx)

    const active = actions.active
    if (active && !activeActionStillValid(active, hit, ctx, targets.occluder)) cancel('target-lost')
    const finished = actions.update(ctx.dt)
    if (finished) complete(finished, ctx)

    return { hit: targets.occluder ? null : hit, mobTarget: targets.meleeTarget }
  }

  return { update, cancel }
}
