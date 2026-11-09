// End-to-end gameplay checks against the headless simulation (no WebGL/DOM).
// These mirror the functional checks in SPEC.md and EXTENSION_MOBS_HEALTH.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSimulation } from '../src/game/simulation.js'
import { BLOCK } from '../src/world/blocks.js'
import { bodyCollides } from '../src/world/physics.js'
import { horizontalDistance } from '../src/core/geometry.js'
import { COMBAT, MAX_FRAME_DT, MOB_RULES, PLAYER_KNOCKBACK, STORAGE_KEY } from '../src/config.js'
import { mobBox } from '../src/mobs/mob.js'
import { memoryStorage } from './helpers.js'

const STILL = { forward: false, backward: false, left: false, right: false, jump: false }

function controls(overrides = {}) {
  return { move: STILL, look: { dx: 0, dy: 0 }, primaryPressed: false, primaryHeld: false, secondaryPressed: false, ...overrides }
}

function run(sim, seconds, each = () => controls(), dt = 1 / 60) {
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) sim.update(dt, each(i))
}

// Move every mob to a far corner so it cannot interfere with sandbox checks.
function parkMobs(sim) {
  const corners = [[2.5, 2.5], [29.5, 2.5], [2.5, 29.5], [29.5, 29.5]]
  sim.mobs.mobs.forEach((mob, i) => {
    const [x, z] = corners[i % corners.length]
    mob.position.x = x
    mob.position.z = z
    mob.position.y = sim.world.surfaceHeight(Math.floor(x), Math.floor(z)) + 1
  })
  const far = sim.mobs.mobs.every((mob) => horizontalDistance(mob.position, sim.player.position) > MOB_RULES.detectRange)
  assert.ok(far, 'test setup: mobs parked out of detection range')
}

// Flatten a small arena around the player: stone floor at the spawn surface,
// open air above, so aim-dependent checks don't depend on hill shapes.
function flattenArena(sim, radius = 4) {
  const { world, player } = sim
  const cx = Math.floor(player.position.x)
  const cz = Math.floor(player.position.z)
  const floor = Math.floor(player.position.y) - 1
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let z = cz - radius; z <= cz + radius; z++) {
      if (!world.inBounds(x, floor, z)) continue
      world.setBlock(x, floor, z, BLOCK.STONE)
      for (let y = floor + 1; y < world.height; y++) world.setBlock(x, y, z, BLOCK.AIR)
    }
  }
  return { cx, cz, floor }
}

function settle(sim) {
  run(sim, 1)
  assert.ok(sim.player.onGround, 'player settles on the ground')
}

test('boots a deterministic seed-42 world with a safe spawn and four valid mobs', () => {
  const a = createSimulation({ storage: memoryStorage() })
  const b = createSimulation({ storage: memoryStorage() })
  assert.deepEqual(a.baseData, b.baseData)
  assert.equal(a.world.size, 32)
  assert.equal(bodyCollides(a.world, a.player), false)
  assert.equal(a.player.health.current, 100)

  const types = a.mobs.mobs.map((mob) => mob.type).sort()
  assert.deepEqual(types, ['mossling', 'mossling', 'mossling', 'stoneguard'])
  for (const mob of a.mobs.mobs) {
    assert.ok(horizontalDistance(mob.position, a.player.position) > MOB_RULES.spawnExclusionRadius)
    assert.equal(bodyCollides(a.world, mob), false)
    assert.ok(a.world.inBounds(Math.floor(mob.position.x), Math.floor(mob.position.y), Math.floor(mob.position.z)))
  }
})

test('player stands on terrain, walks, jumps and lands', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  parkMobs(sim)
  flattenArena(sim)
  settle(sim)
  const start = { ...sim.player.position }
  sim.player.yaw = 0
  run(sim, 0.5, () => controls({ move: { ...STILL, forward: true } }))
  assert.ok(start.z - sim.player.position.z > 1, 'moved forward (toward -Z)')
  assert.ok(Math.abs(sim.player.position.y - start.y) < 1e-3, 'stayed on flat ground')

  run(sim, 0.05, () => controls({ move: { ...STILL, jump: true } }))
  assert.ok(sim.player.position.y > start.y + 0.1, 'jumped')
  run(sim, 1.5)
  assert.ok(Math.abs(sim.player.position.y - start.y) < 1e-3, 'landed again')
  assert.ok(sim.player.onGround)
})

test('player cannot walk through a solid wall', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  parkMobs(sim)
  const { cx, cz, floor } = flattenArena(sim)
  settle(sim)
  for (let y = floor + 1; y <= floor + 3; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) sim.world.setBlock(x, y, cz - 2, BLOCK.STONE)
  }
  sim.player.yaw = 0
  run(sim, 2, () => controls({ move: { ...STILL, forward: true } }))
  assert.ok(sim.player.position.z >= cz - 1 + sim.player.width / 2 - 1e-3, 'stopped by the wall')
  assert.equal(bodyCollides(sim.world, sim.player), false)
})

test('mining takes about one second, updates the world, and persists across reloads', () => {
  const storage = memoryStorage()
  const sim = createSimulation({ storage })
  parkMobs(sim)
  const { cx, cz, floor } = flattenArena(sim)
  settle(sim)
  sim.player.pitch = -Math.PI / 2 + 0.02
  const broken = []
  sim.events.on('block:broken', (event) => broken.push(event))

  sim.update(1 / 60, controls({ primaryPressed: true, primaryHeld: true }))
  assert.equal(sim.actions.active?.kind, 'break')
  run(sim, 0.5)
  assert.equal(sim.world.getBlock(cx, floor, cz), BLOCK.STONE, 'not removed before the animation completes')
  run(sim, 0.6)
  assert.equal(sim.world.getBlock(cx, floor, cz), BLOCK.AIR, 'removed after ~1 s')
  assert.equal(broken.length, 1)

  const reloaded = createSimulation({ storage })
  assert.equal(reloaded.restoreResult.status, 'loaded')
  assert.equal(reloaded.world.getBlock(cx, floor, cz), BLOCK.AIR, 'edit survives a reload')
})

test('looking away cancels mining and leaves the block intact', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  parkMobs(sim)
  const { cx, cz, floor } = flattenArena(sim)
  settle(sim)
  sim.player.pitch = -Math.PI / 2 + 0.02
  const cancels = []
  sim.events.on('action:cancel', (event) => cancels.push(event.reason))
  sim.update(1 / 60, controls({ primaryPressed: true }))
  run(sim, 0.3)
  sim.player.pitch = 0.6 // look up at the open sky
  run(sim, 1)
  assert.equal(sim.world.getBlock(cx, floor, cz), BLOCK.STONE)
  assert.equal(sim.actions.active, null)
  assert.ok(cancels.length >= 1)
})

test('placement takes about one second and never goes inside the player', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  parkMobs(sim)
  const { cx, cz, floor } = flattenArena(sim)
  settle(sim)

  // Looking straight down, the placement cell is the player's own feet.
  sim.player.pitch = -Math.PI / 2 + 0.02
  sim.update(1 / 60, controls({ secondaryPressed: true }))
  assert.equal(sim.actions.active, null, 'placement inside the player is rejected')

  // A target block two cells east at eye level; place against its west face.
  sim.world.setBlock(cx + 2, floor + 2, cz, BLOCK.STONE)
  sim.player.pitch = 0
  sim.player.yaw = -Math.PI / 2
  sim.player.position.z = cz + 0.5
  sim.player.position.x = cx + 0.5
  sim.selectSlot(3) // wood
  sim.update(1 / 60, controls({ secondaryPressed: true }))
  assert.equal(sim.actions.active?.kind, 'place')
  run(sim, 0.5)
  assert.equal(sim.world.getBlock(cx + 1, floor + 2, cz), BLOCK.AIR)
  run(sim, 0.6)
  assert.equal(sim.world.getBlock(cx + 1, floor + 2, cz), BLOCK.WOOD)
})

test('blocks beyond 6 units cannot be edited', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  parkMobs(sim)
  const { cx, cz, floor } = flattenArena(sim, 9)
  settle(sim)
  sim.world.setBlock(cx + 7, floor + 2, cz, BLOCK.STONE) // ~6.5 units from the eye
  sim.player.yaw = -Math.PI / 2
  sim.player.pitch = 0
  sim.update(1 / 60, controls({ primaryPressed: true, secondaryPressed: true }))
  assert.equal(sim.actions.active, null)
  run(sim, 1.2)
  assert.equal(sim.world.getBlock(cx + 7, floor + 2, cz), BLOCK.STONE)
  assert.equal(sim.world.getBlock(cx + 6, floor + 2, cz), BLOCK.AIR)
})

test('hotbar and tools are independent selections', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  assert.equal(sim.selectedBlockId, BLOCK.GRASS)
  assert.ok(sim.selectSlot(4))
  assert.equal(sim.selectedBlockId, BLOCK.LEAVES)
  assert.equal(sim.selectSlot(5), false)
  assert.equal(sim.toolbelt.current.key, 'pickaxe')
  assert.equal(sim.cycleTool().key, 'axe')
  assert.equal(sim.selectedBlockId, BLOCK.LEAVES, 'tool switching leaves the hotbar alone')
  assert.equal(sim.cycleTool().key, 'shovel')
  assert.equal(sim.cycleTool().key, 'pickaxe')
})

test('reset world restores the generated terrain and clears the save', () => {
  const storage = memoryStorage()
  const sim = createSimulation({ storage })
  flattenArena(sim)
  assert.ok(storage.getItem(STORAGE_KEY))
  sim.resetWorld()
  assert.deepEqual(sim.world.snapshot(), sim.baseData)
  assert.equal(storage.getItem(STORAGE_KEY), null)
  assert.equal(bodyCollides(sim.world, sim.player), false)
  const reloaded = createSimulation({ storage })
  assert.deepEqual(reloaded.world.snapshot(), reloaded.baseData)
})

test('corrupt saves do not crash and fall back to the generated world', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{not json' })
  const sim = createSimulation({ storage })
  assert.equal(sim.restoreResult.status, 'corrupt')
  assert.deepEqual(sim.world.snapshot(), sim.baseData)
})

// Put one mob right in front of the player, inside melee range.
function stageDuel(sim, typeKey = 'mossling', distance = 1.5) {
  parkMobs(sim)
  const { cx, cz, floor } = flattenArena(sim, 5)
  settle(sim)
  const mob = sim.mobs.mobs.find((m) => m.type === typeKey)
  mob.position.x = sim.player.position.x
  mob.position.z = sim.player.position.z - distance
  mob.position.y = floor + 1
  sim.player.yaw = 0
  // Aim at the mob's body centre.
  const eye = sim.player.position.y + sim.player.eyeHeight
  sim.player.pitch = Math.atan2(mob.position.y + mob.height / 2 - eye, distance)
  return { mob, cx, cz, floor }
}

test('mobs attack within range on a 1.5 s cooldown and health never goes negative', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  const { mob } = stageDuel(sim, 'mossling', 1.2)
  const damage = []
  sim.events.on('player:damaged', (event) => damage.push(event.amount))
  let died = 0
  sim.events.on('player:died', () => died++)

  run(sim, 0.2)
  assert.equal(damage.length, 0, 'the strike waits for its visible wind-up')
  run(sim, 0.3)
  assert.equal(damage.length, 1, 'first attack lands after the wind-up')
  assert.equal(sim.player.health.current, 90)
  run(sim, 1.2)
  assert.equal(damage.length, 1, 'no second attack before the 1.5 s cooldown')
  run(sim, 0.5)
  assert.equal(damage.length, 2)
  assert.ok(damage.every((amount) => amount === 10))

  for (let i = 0; i < 20 && !sim.player.health.isDead; i++) {
    mob.position.x = sim.player.position.x
    mob.position.z = sim.player.position.z - 1.2
    run(sim, 1.5)
  }
  assert.equal(sim.player.health.current, 0)
  assert.equal(died, 1)
  const healthAtDeath = sim.player.health.current
  run(sim, 3)
  assert.equal(sim.player.health.current, healthAtDeath, 'no damage after death')
  assert.ok(sim.player.health.current >= 0)
})

test('the player defeats mobs with 25-damage hits on a 0.6 s cooldown', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  const { mob } = stageDuel(sim, 'stoneguard', 2.2)
  const killed = []
  sim.events.on('mob:killed', (event) => killed.push(event.mob))

  sim.update(1 / 60, controls({ primaryPressed: true }))
  assert.equal(mob.health, 60 - COMBAT.playerDamage)
  sim.update(1 / 60, controls({ primaryPressed: true }))
  assert.equal(mob.health, 35, 'second click during cooldown is ignored')
  assert.equal(sim.actions.active, null, 'the swallowed click does not start mining')

  for (let i = 0; i < 6 && killed.length === 0; i++) {
    mob.position.x = sim.player.position.x
    mob.position.z = sim.player.position.z - 2.2
    run(sim, COMBAT.playerCooldown + 0.05)
    sim.update(1 / 60, controls({ primaryPressed: true }))
  }
  assert.equal(killed.length, 1)
  assert.equal(mob.health, 0)
  run(sim, 2)
  assert.ok(!sim.mobs.mobs.includes(mob), 'dead mob disappears after its death animation')
})

test('melee cannot pass through blocks; the click mines the wall instead', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  const { mob, cz, floor } = stageDuel(sim, 'mossling', 2.5)
  const cx = Math.floor(sim.player.position.x)
  for (let y = floor + 1; y <= floor + 3; y++) sim.world.setBlock(cx, y, cz - 1, BLOCK.STONE)
  sim.update(1 / 60, controls({ primaryPressed: true }))
  assert.equal(mob.health, 40)
  assert.equal(sim.actions.active?.kind, 'break')
})

test('respawn restores health, resets mobs, and keeps world edits', () => {
  const storage = memoryStorage()
  const sim = createSimulation({ storage })
  const { mob } = stageDuel(sim, 'mossling', 1.2)
  sim.world.setBlock(1, 20, 1, BLOCK.WOOD)
  mob.health = 15
  while (!sim.player.health.isDead) {
    mob.position.x = sim.player.position.x
    mob.position.z = sim.player.position.z - 1.2
    run(sim, 1.5)
  }
  sim.respawn()
  assert.equal(sim.player.health.current, 100)
  assert.equal(sim.mobs.mobs.length, 4)
  for (const m of sim.mobs.mobs) {
    assert.equal(m.health, m.maxHealth)
    assert.ok(horizontalDistance(m.position, sim.player.position) > MOB_RULES.spawnExclusionRadius)
  }
  assert.equal(sim.world.getBlock(1, 20, 1), BLOCK.WOOD, 'world edit preserved')
  assert.equal(createSimulation({ storage }).world.getBlock(1, 20, 1), BLOCK.WOOD, 'and still saved')
  assert.equal(bodyCollides(sim.world, sim.player), false)
})

test('a killing click never starts mining the block behind the mob while held', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  const { mob } = stageDuel(sim, 'mossling', 2.2)
  mob.health = 10
  sim.update(1 / 60, controls({ primaryPressed: true, primaryHeld: true }))
  assert.equal(mob.state, 'dying')
  run(sim, 1.5, () => controls({ primaryHeld: true }))
  assert.equal(sim.actions.active, null, 'holding after a kill does not mine')
  const broken = []
  sim.events.on('block:broken', (event) => broken.push(event))
  // A fresh press on terrain mines as usual, and holding then continues.
  sim.player.pitch = -Math.PI / 2 + 0.02
  sim.update(1 / 60, controls({ primaryPressed: true, primaryHeld: true }))
  assert.equal(sim.actions.active?.kind, 'break')
  run(sim, 2.2, () => controls({ primaryHeld: true }))
  assert.equal(broken.length, 2, 'held mining continues block after block')
})

// --- frame guard (review quality-perf:L4) ---

test('regression: update ignores non-finite or non-positive dt and returns at once', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  const before = JSON.stringify({ player: sim.player.position, mobs: sim.mobs.mobs.map((mob) => mob.position) })
  for (const dt of [Infinity, -Infinity, NaN, 0, -1, undefined]) {
    const started = Date.now()
    assert.equal(sim.update(dt, controls()), sim.lastFrame)
    assert.ok(Date.now() - started < 50, `dt ${dt} returns immediately`)
  }
  assert.equal(JSON.stringify({ player: sim.player.position, mobs: sim.mobs.mobs.map((mob) => mob.position) }), before)
  assert.equal(sim.player.health.current, 100)
})

test('long frames are clamped to MAX_FRAME_DT', () => {
  const long = createSimulation({ storage: memoryStorage() })
  const clamped = createSimulation({ storage: memoryStorage() })
  const walk = controls({ move: { ...STILL, forward: true } })
  long.update(5, walk)
  clamped.update(MAX_FRAME_DT, walk)
  assert.deepEqual(long.player.position, clamped.player.position)
  assert.deepEqual(long.mobs.mobs.map((mob) => mob.position), clamped.mobs.mobs.map((mob) => mob.position))
})

// --- strikes, knockback, and bodies (review logic-bugs:L2) ---

test('a mob strike shoves the player away by PLAYER_KNOCKBACK', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  stageDuel(sim, 'mossling', 1.2) // the mob stands 1.2 toward -Z
  const shoves = []
  sim.events.on('player:damaged', () => shoves.push({ ...sim.player.velocity }))
  run(sim, 0.6)
  assert.equal(shoves.length, 1)
  const [shove] = shoves
  assert.ok(Math.abs(shove.z - PLAYER_KNOCKBACK.speed) < 1e-6, `pushed toward +Z (${shove.z})`)
  assert.ok(Math.abs(shove.x) < 1e-6)
  assert.equal(shove.y, PLAYER_KNOCKBACK.hop, 'a small hop')
})

test('walking into a Stoneguard never puts the eye inside it, so aiming away still works', () => {
  const sim = createSimulation({ storage: memoryStorage() })
  const { mob } = stageDuel(sim, 'stoneguard', 2.5)
  sim.player.pitch = 0
  const startZ = mob.position.z
  let inside = 0
  run(sim, 1.2, () => {
    const box = mobBox(mob)
    const eye = { x: sim.player.position.x, y: sim.player.position.y + sim.player.eyeHeight, z: sim.player.position.z }
    const within = eye.x > box.minX && eye.x < box.maxX && eye.y > box.minY && eye.y < box.maxY && eye.z > box.minZ && eye.z < box.maxZ
    if (within) inside++
    return controls({ move: { ...STILL, forward: true } })
  })
  assert.equal(inside, 0, 'the mob is shoved along instead of overlapping')
  assert.ok(startZ - mob.position.z > 1, 'the player really walked into it')
  sim.player.pitch = Math.PI / 2 - 0.02 // straight up at the sky
  const frame = sim.update(1 / 60, controls({ primaryPressed: true }))
  assert.equal(frame.mobTarget, null, 'no melee target in the sky')
})

// --- other tabs (review logic-bugs:L5) ---

test('regression: after B saves and A reloads, A has B\'s edits and keeps them on its next save', () => {
  const storage = memoryStorage()
  const a = createSimulation({ storage })
  const b = createSimulation({ storage })
  b.world.setBlock(9, 20, 9, BLOCK.DIRT)
  const saved = storage.getItem(STORAGE_KEY)

  const result = a.reloadSavedEdits()
  assert.deepEqual(result, { status: 'loaded', applied: 1, skipped: 0 })
  assert.equal(a.world.getBlock(9, 20, 9), BLOCK.DIRT, "A now shows B's edit")
  assert.equal(storage.getItem(STORAGE_KEY), saved, 'reloading does not save back')

  a.world.setBlock(12, 20, 12, BLOCK.WOOD)
  const reopened = createSimulation({ storage })
  assert.equal(reopened.world.getBlock(9, 20, 9), BLOCK.DIRT, "B's edit survives A's save")
  assert.equal(reopened.world.getBlock(12, 20, 12), BLOCK.WOOD)
})

test('two tabs that reload on every foreign save converge on all edits', () => {
  const storage = memoryStorage()
  const a = createSimulation({ storage })
  const b = createSimulation({ storage })
  a.world.setBlock(5, 20, 5, BLOCK.STONE)
  b.reloadSavedEdits()
  b.world.setBlock(9, 20, 9, BLOCK.DIRT)
  a.reloadSavedEdits()
  assert.deepEqual(a.world.snapshot(), b.world.snapshot())
  const reopened = createSimulation({ storage })
  assert.equal(reopened.world.getBlock(5, 20, 5), BLOCK.STONE)
  assert.equal(reopened.world.getBlock(9, 20, 9), BLOCK.DIRT)
})

test('reloadSavedEdits cancels the active action and frees a player buried by the other tab', () => {
  const storage = memoryStorage()
  const a = createSimulation({ storage })
  parkMobs(a)
  const { floor } = flattenArena(a)
  settle(a)
  const b = createSimulation({ storage })
  const cancels = []
  a.events.on('action:cancel', (event) => cancels.push(event.reason))
  a.player.pitch = -Math.PI / 2 + 0.02
  a.update(1 / 60, controls({ primaryPressed: true }))
  assert.equal(a.actions.active?.kind, 'break')

  const cx = Math.floor(a.player.position.x)
  const cz = Math.floor(a.player.position.z)
  for (let y = floor + 1; y <= floor + 2; y++) b.world.setBlock(cx, y, cz, BLOCK.STONE) // B builds where A stands
  a.reloadSavedEdits()
  assert.deepEqual(cancels, ['reset'])
  assert.equal(a.actions.active, null)
  assert.equal(a.world.getBlock(cx, floor + 2, cz), BLOCK.STONE)
  assert.equal(bodyCollides(a.world, a.player), false, 'lifted out of the new blocks')
})
