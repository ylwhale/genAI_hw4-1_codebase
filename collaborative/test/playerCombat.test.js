import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMBAT, REACH } from '../src/config.js'
import { BLOCK } from '../src/world/blocks.js'
import { raycastBlocks } from '../src/world/raycast.js'
import { createPlayerCombat, findMobTarget } from '../src/combat/playerCombat.js'
import { createFlatWorld } from './helpers.js'

const near = (actual, expected, eps = 1e-9, label = '') =>
  assert.ok(Math.abs(actual - expected) <= eps, `${label} expected ${expected} ± ${eps}, got ${actual}`)

// The shooter stands at the origin with its eye at y = 0.45, looking down -Z.
const EYE = Object.freeze({ x: 0, y: 0.45, z: 0 })
const AHEAD = Object.freeze({ x: 0, y: 0, z: -1 })

// Mob-shaped fixture (a Mossling by default). `face` places the mob so that
// its near face is exactly that far down the -Z ray from EYE.
function mob({ face, x = 0, y = 0, z, width = 0.7, height = 0.9, state = 'chase', health = 40, ...rest } = {}) {
  const centreZ = face === undefined ? z : -(face + width / 2)
  return { position: { x, y, z: centreZ }, width, height, state, health, maxHealth: health, ...rest }
}

// A damage callback that behaves like the mob manager (clamps at 0, reports kills).
function recordingDamage() {
  const calls = []
  const apply = (target, amount) => {
    calls.push({ target, amount })
    const applied = Math.min(amount, target.health)
    target.health -= applied
    return { applied, killed: target.health <= 0 }
  }
  return { calls, apply }
}

test('targets a mob straight ahead and reports the distance to its near face', () => {
  const target = mob({ face: 1.65 })
  const hit = findMobTarget([target], EYE, AHEAD)
  assert.equal(hit.mob, target)
  near(hit.distance, 1.65)
})

test('picks the nearest of several mobs regardless of list order', () => {
  const far = mob({ face: 2.5 })
  const close = mob({ face: 1.2 })
  const middle = mob({ face: 1.8, width: 0.9, height: 1.9 })
  for (const list of [[far, close, middle], [middle, far, close], [close, middle, far]]) {
    assert.equal(findMobTarget(list, EYE, AHEAD).mob, close)
  }
})

test('ignores mobs that are not under the crosshair', () => {
  const beside = mob({ face: 1.5, x: 1 })
  const above = mob({ face: 1.5, y: 1 })
  const behind = mob({ z: 2 })
  assert.equal(findMobTarget([beside, above, behind], EYE, AHEAD), null)
})

test('the mob box is not inflated: a ray grazing over the head misses', () => {
  const target = mob({ face: 1.5 })
  assert.equal(findMobTarget([target], { x: 0, y: 0.91, z: 0 }, AHEAD), null, 'just above the 0.9 head')
  assert.ok(findMobTarget([target], { x: 0, y: 0.89, z: 0 }, AHEAD), 'just below the top')
  assert.equal(findMobTarget([target], { x: 0.36, y: 0.45, z: 0 }, AHEAD), null, 'just past the 0.35 half width')
  assert.ok(findMobTarget([target], { x: 0.34, y: 0.45, z: 0 }, AHEAD), 'just inside the side')
})

test('melee reach boundary: 2.99 hits, exactly 3 hits, 3.01 misses', () => {
  assert.equal(COMBAT.playerReach, 3)
  const inside = findMobTarget([mob({ face: 2.99 })], EYE, AHEAD)
  assert.ok(inside, '2.99 is within reach')
  near(inside.distance, 2.99, 1e-9, 'distance')
  const edge = mob({ face: 3, width: 1 }) // box face lands exactly on z = -3
  near(findMobTarget([edge], EYE, AHEAD).distance, 3, 0, 'reach is inclusive')
  assert.equal(findMobTarget([mob({ face: 3.01 })], EYE, AHEAD), null, '3.01 is out of reach')
})

test('reach is measured along the ray, also for diagonal aim', () => {
  const direction = { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 }
  const target = mob({ x: 2, z: -2, width: 0.6 }) // near corner at (1.7, -1.7)
  const expected = 1.7 * Math.SQRT2
  near(findMobTarget([target], EYE, direction).distance, expected, 1e-9, 'diagonal entry')
  assert.equal(findMobTarget([target], EYE, direction, { reach: expected - 0.01 }), null)
  assert.ok(findMobTarget([target], EYE, direction, { reach: expected + 0.01 }))
})

test('a custom reach (e.g. the 6-unit block reach) extends targeting', () => {
  const target = mob({ face: 5 })
  assert.equal(findMobTarget([target], EYE, AHEAD), null, 'beyond the default melee reach')
  near(findMobTarget([target], EYE, AHEAD, { reach: REACH }).distance, 5, 1e-9, 'within 6')
})

test('dying or dead mobs are never targeted, even when nearer', () => {
  const dying = mob({ face: 1, state: 'dying', health: 0 })
  const zeroHealth = mob({ face: 1.2, state: 'chase', health: 0 })
  const alive = mob({ face: 2 })
  const hit = findMobTarget([dying, zeroHealth, alive], EYE, AHEAD)
  assert.equal(hit.mob, alive)
  assert.equal(findMobTarget([dying, zeroHealth], EYE, AHEAD), null)
  assert.equal(findMobTarget([mob({ face: 1, state: 'dying', health: 10 })], EYE, AHEAD), null, "'dying' wins over health")
})

test('every live state is targetable', () => {
  for (const state of ['wander', 'chase', 'attack']) {
    assert.ok(findMobTarget([mob({ face: 1.5, state })], EYE, AHEAD), state)
  }
})

test('a block at 1.5 hides a mob at 2; a block behind the mob does not', () => {
  const target = mob({ face: 2 })
  assert.equal(findMobTarget([target], EYE, AHEAD, { blockDistance: 1.5 }), null)
  assert.ok(findMobTarget([target], EYE, AHEAD, { blockDistance: 2.5 }))
  assert.ok(findMobTarget([target], EYE, AHEAD, { blockDistance: Infinity }))
})

test('the mob must be strictly in front of the block', () => {
  const target = mob({ face: 2 })
  assert.equal(findMobTarget([target], EYE, AHEAD, { blockDistance: 2 }), null, 'tie goes to the block')
  assert.ok(findMobTarget([target], EYE, AHEAD, { blockDistance: 2 + 1e-9 }))
})

test('a hidden nearer mob does not shadow a visible one, and vice versa', () => {
  const near1 = mob({ face: 1 })
  const far1 = mob({ face: 2.5 })
  // The block sits between them: only the nearer one is visible.
  assert.equal(findMobTarget([far1, near1], EYE, AHEAD, { blockDistance: 1.8 }).mob, near1)
})

test('blockDistance defaults to Infinity and tolerates null / NaN', () => {
  const target = mob({ face: 2 })
  for (const blockDistance of [undefined, null, NaN]) {
    assert.ok(findMobTarget([target], EYE, AHEAD, { blockDistance }), `blockDistance ${blockDistance}`)
  }
  assert.ok(findMobTarget([target], EYE, AHEAD, {}))
})

test('attacks never pass through a real wall (raycastBlocks distance)', () => {
  const world = createFlatWorld({ size: 16, height: 16, groundTop: 3 })
  const eye = { x: 8.5, y: 4 + 1.62, z: 10.5 }
  const target = mob({ x: 8.5, y: 4, z: 8.05, width: 0.9, height: 1.9 }) // Stoneguard, near face at z = 8.5 -> distance 2
  const blockDistance = () => raycastBlocks(world, eye, AHEAD, REACH)?.distance ?? Infinity

  assert.equal(blockDistance(), Infinity, 'open air ahead')
  const clear = findMobTarget([target], eye, AHEAD, { blockDistance: blockDistance() })
  near(clear.distance, 2, 1e-9, 'visible mob')

  world.setBlock(8, 5, 9, BLOCK.LEAVES) // block face at z = 10 -> distance 0.5
  near(blockDistance(), 0.5, 1e-9, 'wall distance')
  assert.equal(findMobTarget([target], eye, AHEAD, { blockDistance: blockDistance() }), null, 'leaves block melee')

  world.setBlock(8, 5, 9, BLOCK.AIR)
  world.setBlock(8, 5, 7, BLOCK.STONE) // block behind the mob
  assert.ok(findMobTarget([target], eye, AHEAD, { blockDistance: blockDistance() }), 'a block behind the mob is irrelevant')
})

// Updated deliberately (review logic-bugs:L2): an eye inside a box used to
// target that mob in every direction, so the eye now sits 0.2 behind the
// centre and only aiming toward the centre counts.
test('an eye inside the mob box targets it at distance 0 when facing its centre', () => {
  const target = mob({ z: -0.2 })
  const hit = findMobTarget([target], EYE, AHEAD)
  assert.equal(hit.mob, target)
  assert.equal(hit.distance, 0)
  const diagonal = findMobTarget([target], EYE, { x: 0.5, y: 0.3, z: -1 })
  assert.equal(diagonal?.mob, target, 'any direction with a forward component still hits')
})

test('regression: an eye inside the mob box does not target it when aiming away', () => {
  const target = mob({ z: -0.2 })
  assert.equal(findMobTarget([target], EYE, { x: 0, y: 0, z: 1 }), null, 'aiming backwards')
  assert.equal(findMobTarget([target], EYE, { x: 0, y: 1, z: 0 }), null, 'aiming at the sky (perpendicular)')
  assert.equal(findMobTarget([target], EYE, { x: 1, y: 0, z: 0.01 }), null, 'aiming sideways, slightly back')
})

test('an eye inside one mob still targets another mob it aims at', () => {
  const engulfing = mob({ z: -0.2, width: 0.9, height: 1.9 })
  const behind = mob({ z: 1.5 })
  const hit = findMobTarget([engulfing, behind], EYE, { x: 0, y: 0, z: 1 })
  assert.equal(hit?.mob, behind)
})

test('direction need not be normalised', () => {
  const target = mob({ face: 1.65 })
  near(findMobTarget([target], EYE, { x: 0, y: 0, z: -7 }).distance, 1.65)
})

test('invalid queries return null instead of throwing', () => {
  const target = mob({ face: 1.5 })
  for (const mobs of [null, undefined, [], {}, 42]) {
    assert.equal(findMobTarget(mobs, EYE, AHEAD), null, `mobs ${JSON.stringify(mobs)}`)
  }
  for (const direction of [null, undefined, { x: 0, y: 0, z: 0 }, { x: NaN, y: 0, z: -1 }, { x: 0, y: 0, z: -Infinity }]) {
    assert.equal(findMobTarget([target], EYE, direction), null, `direction ${JSON.stringify(direction)}`)
  }
  for (const origin of [null, undefined, { x: NaN, y: 0, z: 0 }, { x: 0, y: 0 }]) {
    assert.equal(findMobTarget([target], origin, AHEAD), null, `origin ${JSON.stringify(origin)}`)
  }
  for (const reach of [0, -1, NaN, null, '3']) {
    assert.equal(findMobTarget([target], EYE, AHEAD, { reach }), null, `reach ${String(reach)}`)
  }
})

test('malformed mob entries are skipped', () => {
  const valid = mob({ face: 2 })
  const broken = [null, undefined, {}, { position: null }, mob({ face: 1, x: NaN }), mob({ face: 1, width: NaN })]
  assert.equal(findMobTarget([...broken, valid], EYE, AHEAD).mob, valid)
})

test('accepts any iterable of mobs', () => {
  const target = mob({ face: 1.5 })
  assert.equal(findMobTarget(new Set([target]), EYE, AHEAD).mob, target)
})

test('combat starts ready with the extension damage and cooldown', () => {
  const combat = createPlayerCombat()
  assert.equal(combat.isReady(), true)
  assert.equal(combat.cooldownRemaining, 0)
  assert.equal(combat.cooldownFraction, 0)
  assert.equal(combat.damage, 25)
  assert.equal(combat.cooldown, 0.6)
})

test('an attack applies 25 damage once and starts the 0.6 s cooldown', () => {
  const combat = createPlayerCombat()
  const target = mob({ face: 1.5 })
  const damage = recordingDamage()
  const result = combat.attack(target, damage.apply)
  assert.deepEqual(result, { attacked: true, applied: 25, killed: false })
  assert.deepEqual(damage.calls, [{ target, amount: 25 }])
  assert.equal(target.health, 15)
  assert.equal(combat.isReady(), false)
  assert.equal(combat.cooldownRemaining, 0.6)
  assert.equal(combat.cooldownFraction, 1)
})

test('attacks during the cooldown do nothing and never call applyDamage', () => {
  const combat = createPlayerCombat()
  const target = mob({ face: 1.5, health: 60 })
  const damage = recordingDamage()
  combat.attack(target, damage.apply)
  for (let i = 0; i < 5; i++) {
    combat.update(0.1)
    assert.deepEqual(combat.attack(target, damage.apply), { attacked: false, applied: 0, killed: false })
  }
  assert.equal(damage.calls.length, 1)
  assert.equal(target.health, 35)
})

test('cooldown boundary: 0.59 s is not ready, 0.6 s is', () => {
  const combat = createPlayerCombat()
  combat.attack(mob(), () => ({ applied: 25, killed: false }))
  combat.update(0.59)
  assert.equal(combat.isReady(), false)
  near(combat.cooldownRemaining, 0.01, 1e-12, 'remaining')
  combat.update(0.01)
  assert.equal(combat.isReady(), true, 'float drift does not leave a sliver of cooldown')
  assert.equal(combat.cooldownRemaining, 0)
})

test('cooldown boundary with 60 fps frames: 35 frames cooling, 36 ready', () => {
  const combat = createPlayerCombat()
  combat.attack(mob(), () => ({ applied: 25, killed: false }))
  for (let i = 0; i < 35; i++) combat.update(1 / 60)
  assert.equal(combat.isReady(), false, '0.583 s')
  combat.update(1 / 60)
  assert.equal(combat.isReady(), true, '0.6 s')
})

test('cooldown is frame-rate independent', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 144, 1 / 240]) {
    const combat = createPlayerCombat()
    combat.attack(mob(), () => ({ applied: 25, killed: false }))
    let elapsed = 0
    while (!combat.isReady()) {
      combat.update(dt)
      elapsed += dt
    }
    assert.ok(elapsed >= 0.6 - 1e-9 && elapsed < 0.6 + dt + 1e-9, `dt ${dt}: ready after ${elapsed}`)
  }
})

test('cooldownFraction falls from 1 to 0 and the remaining time never goes negative', () => {
  const combat = createPlayerCombat()
  combat.attack(mob(), () => ({ applied: 25, killed: false }))
  combat.update(0.3)
  near(combat.cooldownFraction, 0.5, 1e-12, 'halfway')
  combat.update(10)
  assert.equal(combat.cooldownRemaining, 0)
  assert.equal(combat.cooldownFraction, 0)
})

test('update ignores invalid dt', () => {
  const combat = createPlayerCombat()
  combat.attack(mob(), () => ({ applied: 25, killed: false }))
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, null, '0.6']) combat.update(dt)
  assert.equal(combat.cooldownRemaining, 0.6)
})

test('reset clears the cooldown (respawn)', () => {
  const combat = createPlayerCombat()
  combat.attack(mob(), () => ({ applied: 25, killed: false }))
  combat.reset()
  assert.equal(combat.isReady(), true)
  assert.equal(combat.cooldownRemaining, 0)
  assert.equal(combat.attack(mob(), () => ({ applied: 25, killed: false })).attacked, true)
})

test('two hits kill a 40 HP Mossling; three kill a 60 HP Stoneguard', () => {
  for (const [health, hits] of [[40, 2], [60, 3]]) {
    const combat = createPlayerCombat()
    const target = mob({ health })
    const damage = recordingDamage()
    const results = []
    while (results.length < 10 && !results.at(-1)?.killed) {
      results.push(combat.attack(target, damage.apply))
      combat.update(COMBAT.playerCooldown)
    }
    assert.equal(results.length, hits, `${health} HP`)
    assert.deepEqual(results.map((r) => r.killed), [...Array(hits - 1).fill(false), true])
    assert.equal(results.at(-1).applied, health - COMBAT.playerDamage * (hits - 1), 'final hit clamps')
    assert.equal(target.health, 0)
  }
})

test('custom damage and cooldown are honoured', () => {
  const combat = createPlayerCombat({ damage: 7, cooldown: 0.2 })
  const damage = recordingDamage()
  const target = mob()
  combat.attack(target, damage.apply)
  assert.equal(damage.calls[0].amount, 7)
  combat.update(0.19)
  assert.equal(combat.isReady(), false)
  combat.update(0.01)
  assert.equal(combat.isReady(), true)

  const instant = createPlayerCombat({ cooldown: 0 })
  assert.equal(instant.attack(mob(), damage.apply).attacked, true)
  assert.equal(instant.isReady(), true, 'a zero cooldown never blocks')
})

test('invalid combat configuration is rejected', () => {
  for (const damage of [0, -5, NaN, Infinity, '25']) {
    assert.throws(() => createPlayerCombat({ damage }), RangeError, `damage ${String(damage)}`)
  }
  for (const cooldown of [-0.1, NaN, Infinity, '0.6']) {
    assert.throws(() => createPlayerCombat({ cooldown }), RangeError, `cooldown ${String(cooldown)}`)
  }
})

test('a missing mob or damage callback is not an attack and keeps the player ready', () => {
  const combat = createPlayerCombat()
  for (const [target, apply] of [[null, () => ({ applied: 25 })], [undefined, () => ({})], [mob(), null], [mob(), 'nope']]) {
    assert.deepEqual(combat.attack(target, apply), { attacked: false, applied: 0, killed: false })
  }
  assert.equal(combat.isReady(), true)
})

test('a swing that deals no damage still uses the cooldown', () => {
  const combat = createPlayerCombat()
  assert.deepEqual(combat.attack(mob(), () => ({ applied: 0, killed: false })), { attacked: true, applied: 0, killed: false })
  assert.equal(combat.isReady(), false)
})

test('odd applyDamage results are normalised', () => {
  const cases = [
    [undefined, { applied: 0, killed: false }],
    [null, { applied: 0, killed: false }],
    [{}, { applied: 0, killed: false }],
    [{ applied: NaN, killed: 'yes' }, { applied: 0, killed: true }],
    [{ applied: -3 }, { applied: 0, killed: false }],
    // Updated deliberately: applyDamage returns { applied: number, killed },
    // so the old boolean 'applied' tolerance was dropped (true now counts as 0).
    [{ applied: true, killed: false }, { applied: 0, killed: false }],
    [{ applied: false }, { applied: 0, killed: false }],
    [{ applied: 12.5, killed: true }, { applied: 12.5, killed: true }],
  ]
  for (const [returned, expected] of cases) {
    const combat = createPlayerCombat()
    assert.deepEqual(combat.attack(mob(), () => returned), { attacked: true, ...expected }, JSON.stringify(returned))
  }
})

test('the cooldown starts before applyDamage runs, so re-entrant attacks are refused', () => {
  const combat = createPlayerCombat()
  let inner = null
  combat.attack(mob(), (target) => {
    inner = combat.attack(target, () => ({ applied: 25 }))
    return { applied: 25, killed: false }
  })
  assert.equal(inner.attacked, false)
})

test('targeting plus combat: clicking through the cooldown only damages once', () => {
  const combat = createPlayerCombat()
  const target = mob({ face: 2.2, width: 0.9, height: 1.9, health: 60 })
  const damage = recordingDamage()
  const dt = 1 / 60
  let swings = 0
  for (let frame = 0; frame < 30; frame++) {
    combat.update(dt)
    const hit = findMobTarget([target], { x: 0, y: 1, z: 0 }, AHEAD, { blockDistance: Infinity })
    if (hit && combat.attack(hit.mob, damage.apply).attacked) swings++
  }
  assert.equal(swings, 1, 'half a second of clicking is a single swing')
  assert.equal(target.health, 35)
})
