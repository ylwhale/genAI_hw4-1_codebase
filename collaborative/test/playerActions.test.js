// Mouse-action arbitration in src/game/playerActions.js: the left-click
// decision table, held mining, mobs hiding blocks, melee interrupting timed
// actions, and cancellation reasons. Real world, raycast, action controller
// and combat; mobs are plain fakes with just the fields targeting reads.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMBAT, PLAYER } from '../src/config.js'
import { GAME_EVENTS, createEventBus } from '../src/core/events.js'
import { bodyBox } from '../src/core/geometry.js'
import { BLOCK } from '../src/world/blocks.js'
import { createActionController } from '../src/interaction/actionController.js'
import { createPlayerCombat } from '../src/combat/playerCombat.js'
import { classifyPress, createPlayerActions } from '../src/game/playerActions.js'
import { createFlatWorld } from './helpers.js'
import { recordEvents } from './mobs-helpers.js'

const DT = 1 / 60
const FEET_Y = 4 // standing on createFlatWorld({ groundTop: 3 })
const FEET = Object.freeze({ x: 8.5, y: FEET_Y, z: 8.5 })
const EYE = Object.freeze({ x: 8.5, y: FEET_Y + PLAYER.eyeHeight, z: 8.5 })
const AHEAD = Object.freeze({ x: 0, y: 0, z: -1 }) // toward -Z, at eye height
const FAR_BLOCK = Object.freeze({ x: 8, y: 5, z: 2 }) // its +Z face is 5.5 ahead of the eye
const EVENTS = ['action:start', 'action:cancel', 'block:broken', 'block:placed', 'player:swing']

// Stoneguard-sized fake mob centred `ahead` units in front of the player, so
// the eye-height ray hits its body. Its near face is ahead - 0.45 from the eye.
function fakeMob(ahead, { width = 0.9, height = 1.9, health = 60 } = {}) {
  return { position: { x: FEET.x, y: FEET_Y, z: FEET.z - ahead }, width, height, state: 'chase', health }
}

const IN_MELEE = 2 // near face 1.55 from the eye, inside the 3-unit melee reach
const BEYOND_MELEE = 4 // near face 3.55: outside melee reach, still in front of FAR_BLOCK

// Behaves like the mob manager: clamps at 0 and marks kills as dying.
function applyMobDamage(mob, amount) {
  const applied = Math.min(amount, mob.health)
  mob.health -= applied
  if (mob.health <= 0) mob.state = 'dying'
  return { applied, killed: mob.health <= 0 }
}

function setup({ blocks = [FAR_BLOCK] } = {}) {
  const world = createFlatWorld({ size: 16, height: 12, groundTop: 3 })
  for (const { x, y, z } of blocks) world.setBlock(x, y, z, BLOCK.STONE)
  const events = createEventBus({ known: GAME_EVENTS })
  const log = recordEvents(events, EVENTS)
  const actions = createActionController()
  const combat = createPlayerCombat()
  const playerActions = createPlayerActions({ world, events, actions, combat })
  const state = { mobs: [] }
  const frame = (input = {}) =>
    playerActions.update({
      dt: DT,
      eye: EYE,
      direction: AHEAD,
      primaryPressed: false,
      primaryHeld: false,
      secondaryPressed: false,
      selectedBlockId: BLOCK.DIRT,
      mobs: state.mobs,
      applyMobDamage,
      obstacles: [bodyBox(FEET, PLAYER.width, PLAYER.height)],
      ...input,
    })
  const run = (seconds, input = {}) => {
    let last = null
    for (let i = 0; i < Math.round(seconds / DT); i++) last = frame(input)
    return last
  }
  return { world, log, actions, combat, playerActions, state, frame, run }
}

const reasons = (log) => log['action:cancel'].map((event) => event.reason)
const PRESS = Object.freeze({ primaryPressed: true, primaryHeld: true })
const HOLD = Object.freeze({ primaryHeld: true })

// --- the decision table ---

test('classifyPress: melee beats everything, a hiding mob is a miss, otherwise mine', () => {
  const mob = { mob: {}, distance: 1 }
  const far = { mob: {}, distance: 4 }
  assert.equal(classifyPress({ meleeTarget: mob, occluder: mob }), 'melee')
  assert.equal(classifyPress({ meleeTarget: mob, occluder: null }), 'melee')
  assert.equal(classifyPress({ meleeTarget: null, occluder: far }), 'miss')
  assert.equal(classifyPress({ meleeTarget: null, occluder: null }), 'mine')
  assert.equal(classifyPress({}), 'mine')
  assert.equal(classifyPress(), 'mine')
})

test('the decision table through update(): mine, miss, and melee presses', () => {
  const mine = setup()
  mine.frame(PRESS)
  assert.equal(mine.actions.active?.kind, 'break', 'a visible block is mined')
  assert.deepEqual(mine.actions.active.target, FAR_BLOCK)

  const miss = setup()
  miss.state.mobs = [fakeMob(BEYOND_MELEE)]
  const missed = miss.frame(PRESS)
  assert.equal(miss.actions.active, null, 'the block behind the mob is hidden')
  assert.deepEqual(miss.log['player:swing'], [{ hit: false }], 'a swing at the air')
  assert.equal(missed.hit, null, 'no outline on the hidden block')
  assert.equal(missed.mobTarget, null, 'out of melee reach')

  const melee = setup()
  const mob = fakeMob(IN_MELEE)
  melee.state.mobs = [mob]
  const struck = melee.frame(PRESS)
  assert.equal(mob.health, 60 - COMBAT.playerDamage)
  assert.deepEqual(melee.log['player:swing'], [{ hit: true }])
  assert.equal(struck.mobTarget.mob, mob)
  assert.equal(melee.actions.active, null, 'melee never mines')
})

// --- held mining ---

test('held mining continues block after block', () => {
  const near = { x: 8, y: 5, z: 6 } // face 1.5 ahead
  const behind = { x: 8, y: 5, z: 5 } // revealed once `near` breaks
  const { world, log, frame, run } = setup({ blocks: [near, behind] })
  frame(PRESS)
  run(1.2, HOLD)
  assert.equal(world.getBlock(near.x, near.y, near.z), BLOCK.AIR)
  run(1.2, HOLD)
  assert.equal(world.getBlock(behind.x, behind.y, behind.z), BLOCK.AIR)
  assert.equal(log['block:broken'].length, 2)
  assert.deepEqual(reasons(log), [])
})

test('releasing the button lets the current break finish but starts no new one', () => {
  const near = { x: 8, y: 5, z: 6 }
  const behind = { x: 8, y: 5, z: 5 }
  const { world, log, frame, run } = setup({ blocks: [near, behind] })
  frame(PRESS)
  run(2.5)
  assert.equal(log['block:broken'].length, 1)
  assert.equal(world.getBlock(behind.x, behind.y, behind.z), BLOCK.STONE)
})

// --- mobs hiding the block being mined (review spec-extension:L2 / logic-bugs:L1) ---

test('regression: a mob stepping in front of the block being mined cancels it (target-lost)', () => {
  for (const ahead of [BEYOND_MELEE, IN_MELEE]) {
    const { world, log, actions, state, frame, run } = setup()
    frame(PRESS)
    run(0.3, HOLD)
    assert.equal(actions.active?.kind, 'break', `${ahead}: mining`)
    const mob = fakeMob(ahead)
    state.mobs = [mob]
    const hidden = run(1.2, HOLD)
    assert.deepEqual(reasons(log), ['target-lost'], `${ahead}: cancelled once`)
    assert.equal(actions.active, null)
    assert.deepEqual(log['block:broken'], [], `${ahead}: nothing breaks behind the mob`)
    assert.equal(world.getBlock(FAR_BLOCK.x, FAR_BLOCK.y, FAR_BLOCK.z), BLOCK.STONE)
    assert.equal(hidden.hit, null)
    assert.equal(mob.health, 60, `${ahead}: holding the button is not an attack`)
  }
})

test('regression: a released break is also cancelled when a mob hides its block', () => {
  const { world, log, state, frame, run } = setup()
  frame(PRESS)
  run(0.2)
  state.mobs = [fakeMob(BEYOND_MELEE)]
  run(1.2)
  assert.deepEqual(reasons(log), ['target-lost'])
  assert.equal(world.getBlock(FAR_BLOCK.x, FAR_BLOCK.y, FAR_BLOCK.z), BLOCK.STONE)
})

test('a mob behind the block being mined does not interrupt it', () => {
  const wall = { x: 8, y: 5, z: 5 } // face 2.5 ahead
  const { world, log, state, frame, run } = setup({ blocks: [wall] })
  state.mobs = [fakeMob(4.5)] // near face 4.05 ahead: within reach, but behind the wall
  frame(PRESS)
  run(1.2, HOLD)
  assert.equal(world.getBlock(wall.x, wall.y, wall.z), BLOCK.AIR)
  assert.deepEqual(reasons(log), [])
})

test('held mining starts again once the mob has moved out of the way', () => {
  const { world, log, actions, state, frame, run } = setup()
  frame(PRESS)
  run(0.3, HOLD)
  state.mobs = [fakeMob(BEYOND_MELEE)]
  run(0.3, HOLD)
  assert.equal(actions.active, null)
  state.mobs = []
  frame(HOLD)
  assert.equal(actions.active?.kind, 'break', 'the held press resumes mining')
  assert.equal(log['action:start'].length, 2)
  run(1.2, HOLD)
  assert.equal(world.getBlock(FAR_BLOCK.x, FAR_BLOCK.y, FAR_BLOCK.z), BLOCK.AIR)
})

test('holding after a miss or a melee press never mines, even once the mob is gone', () => {
  for (const ahead of [BEYOND_MELEE, IN_MELEE]) {
    const { actions, state, frame, run } = setup()
    state.mobs = [fakeMob(ahead)]
    frame(PRESS)
    state.mobs = []
    run(1.5, HOLD)
    assert.equal(actions.active, null, `${ahead}: the press was not a mining press`)
    frame(PRESS)
    assert.equal(actions.active?.kind, 'break', `${ahead}: a fresh press mines`)
  }
})

// --- melee interrupts timed actions (review spec-extension:L5) ---

test('regression: a melee press on a mob cancels an active placement (attack)', () => {
  const { world, log, actions, state, frame, run } = setup()
  frame({ secondaryPressed: true })
  assert.equal(actions.active?.kind, 'place')
  run(0.3)
  const mob = fakeMob(IN_MELEE)
  state.mobs = [mob]
  frame(PRESS)
  assert.deepEqual(reasons(log), ['attack'])
  assert.equal(actions.active, null)
  assert.equal(mob.health, 60 - COMBAT.playerDamage, 'the swing still lands')
  run(1.2)
  assert.deepEqual(log['block:placed'], [])
  assert.equal(world.getBlock(FAR_BLOCK.x, FAR_BLOCK.y, FAR_BLOCK.z + 1), BLOCK.AIR)
})

test('a melee press cancels an active break with reason attack', () => {
  const { world, log, state, frame, run } = setup()
  frame(PRESS)
  run(0.3, HOLD)
  const mob = fakeMob(IN_MELEE)
  state.mobs = [mob]
  frame(PRESS) // the mob steps in on the very frame of the click
  assert.deepEqual(reasons(log), ['attack'])
  assert.equal(mob.health, 60 - COMBAT.playerDamage)
  run(1.2, HOLD)
  assert.equal(world.getBlock(FAR_BLOCK.x, FAR_BLOCK.y, FAR_BLOCK.z), BLOCK.STONE)
})

test('the swallowed cooldown click: no damage, no swing, no mining', () => {
  const { log, actions, combat, state, frame, run } = setup()
  const mob = fakeMob(IN_MELEE)
  state.mobs = [mob]
  frame(PRESS)
  assert.equal(combat.isReady(), false)
  frame({}) // release
  frame(PRESS) // clicked again while cooling down
  assert.equal(mob.health, 60 - COMBAT.playerDamage, 'only the first click hurt')
  assert.equal(log['player:swing'].length, 1, 'no second swing')
  run(COMBAT.playerCooldown, HOLD)
  assert.equal(actions.active, null, 'the block behind the mob is never mined')
  frame({})
  frame(PRESS)
  assert.equal(mob.health, 60 - 2 * COMBAT.playerDamage, 'ready again after the cooldown')
})

test('a swallowed melee click still interrupts a placement', () => {
  const { log, actions, state, frame } = setup()
  const mob = fakeMob(IN_MELEE)
  state.mobs = [mob]
  frame(PRESS) // starts the cooldown
  state.mobs = []
  frame({ secondaryPressed: true })
  assert.equal(actions.active?.kind, 'place')
  state.mobs = [mob]
  frame(PRESS)
  assert.deepEqual(reasons(log), ['attack'])
  assert.equal(mob.health, 60 - COMBAT.playerDamage)
})

test('a miss press while a placement runs keeps building and does not swing', () => {
  const { log, actions, state, frame } = setup()
  frame({ secondaryPressed: true })
  state.mobs = [fakeMob(BEYOND_MELEE)]
  frame(PRESS)
  assert.equal(actions.active?.kind, 'place', 'construction continues regardless of crosshair')
  assert.deepEqual(log['player:swing'], [])
  assert.deepEqual(reasons(log), [])
})

// --- right click ---

test('right-click is blocked by a mob hiding the block, and works once it moves', () => {
  const { actions, state, frame } = setup()
  state.mobs = [fakeMob(BEYOND_MELEE)]
  frame({ secondaryPressed: true })
  assert.equal(actions.active, null, 'no building through a mob')
  state.mobs = [fakeMob(IN_MELEE)]
  frame({ secondaryPressed: true })
  assert.equal(actions.active, null, 'nor past a mob in melee reach')
  state.mobs = []
  frame({ secondaryPressed: true })
  assert.equal(actions.active?.kind, 'place')
  assert.deepEqual(actions.active.target, { x: FAR_BLOCK.x, y: FAR_BLOCK.y, z: FAR_BLOCK.z + 1 })
})

// --- cancellation reasons ---

test('cancellation reasons: looking away, an entity in the cell, and external cancels', () => {
  const lookAway = setup()
  lookAway.frame(PRESS)
  lookAway.frame({ ...HOLD, direction: { x: 0, y: 1, z: 0 } })
  assert.deepEqual(reasons(lookAway.log), ['target-lost'])

  const blocked = setup()
  blocked.frame({ secondaryPressed: true })
  const cell = { x: FAR_BLOCK.x, y: FAR_BLOCK.y, z: FAR_BLOCK.z + 1 }
  const intruder = { minX: cell.x + 0.2, minY: cell.y - 1, minZ: cell.z + 0.2, maxX: cell.x + 0.8, maxY: cell.y + 0.5, maxZ: cell.z + 0.8 }
  blocked.frame({ obstacles: [intruder] })
  assert.deepEqual(reasons(blocked.log), ['target-lost'], 'a mob walking into the cell stops the build')
  assert.equal(blocked.world.getBlock(cell.x, cell.y, cell.z), BLOCK.AIR)

  for (const reason of ['pause', 'death', 'respawn', 'reset']) {
    const { log, playerActions, frame } = setup()
    frame(PRESS)
    playerActions.cancel(reason)
    assert.equal(log['action:cancel'].length, 1)
    const [event] = log['action:cancel']
    assert.equal(event.reason, reason)
    assert.equal(event.kind, 'break')
    assert.deepEqual(event.target, FAR_BLOCK)
    playerActions.cancel(reason)
    assert.equal(log['action:cancel'].length, 1, `${reason}: cancelling while idle emits nothing`)
  }
})
