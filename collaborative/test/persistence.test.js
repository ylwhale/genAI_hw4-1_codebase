import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SAVE_VERSION, createWorldPersistence } from '../src/world/persistence.js'
import { generateWorldData } from '../src/world/generator.js'
import { createWorld, voxelIndex } from '../src/world/world.js'
import { BLOCK } from '../src/world/blocks.js'
import { createRng } from '../src/core/rng.js'
import { STORAGE_KEY } from '../src/config.js'
import { memoryStorage } from './helpers.js'

const BASE = generateWorldData()
const BACKUP_KEY = `${STORAGE_KEY}:corrupt-backup`

// A free cell high above the island and a terrain cell on the clearing.
const SKY = { x: 3, y: 25, z: 5 }
const GROUND = { x: 16, y: 7, z: 16 }

function baseAt({ x, y, z }) {
  return BASE[voxelIndex(32, x, y, z)]
}

function saveDoc(edits, overrides = {}) {
  return JSON.stringify({ version: 1, seed: 42, size: 32, height: 32, edits, ...overrides })
}

function storedDoc(storage, key = STORAGE_KEY) {
  const raw = storage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

// A world wired exactly like the game: restore, then attach.
function boot(storage, options = {}) {
  const world = createWorld()
  const resets = []
  world.subscribe((event) => event.type === 'reset' && resets.push(event))
  const persistence = createWorldPersistence({ storage, ...options })
  const result = persistence.restore(world, BASE)
  const detach = persistence.attach(world, BASE)
  return { world, persistence, result, detach, resets }
}

function expectedWorld(edits) {
  const data = BASE.slice()
  for (const [x, y, z, id] of edits) data[voxelIndex(32, x, y, z)] = id
  return data
}

// Memory storage that counts writes and removals.
function countingStorage(initial = {}) {
  const inner = memoryStorage(initial)
  const storage = {
    writes: 0,
    getItem: inner.getItem,
    setItem: (key, value) => {
      storage.writes++
      inner.setItem(key, value)
    },
    removeItem: (key) => {
      storage.writes++
      inner.removeItem(key)
    },
  }
  return storage
}

// Storage whose methods throw on demand.
function flakyStorage({ get = false, set = false, remove = false, initial = {} } = {}) {
  const inner = memoryStorage(initial)
  const fail = (enabled, method) => (...args) => {
    if (enabled()) throw new Error(`storage ${method} failed`)
    return inner[method](...args)
  }
  const state = { get, set, remove }
  return {
    state,
    dump: inner.dump,
    getItem: fail(() => state.get, 'getItem'),
    setItem: fail(() => state.set, 'setItem'),
    removeItem: fail(() => state.remove, 'removeItem'),
  }
}

test('empty storage restores the base terrain with a single replaceAll', () => {
  const storage = memoryStorage()
  const { world, persistence, result, resets } = boot(storage)
  assert.deepEqual(result, { status: 'empty', applied: 0, skipped: 0 })
  assert.deepEqual(world.snapshot(), BASE)
  assert.equal(resets.length, 1)
  assert.equal(persistence.editCount, 0)
  assert.equal(storage.getItem(STORAGE_KEY), null, 'restoring alone writes nothing')
})

test('edits are saved as a compact, minimal diff in the documented format', () => {
  const storage = memoryStorage()
  const { world, persistence } = boot(storage)
  world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD)
  assert.equal(storage.getItem(STORAGE_KEY), '{"version":1,"seed":42,"size":32,"height":32,"edits":[[3,25,5,4]]}')
  world.setBlock(GROUND.x, GROUND.y, GROUND.z, BLOCK.AIR)
  world.setBlock(1, 20, 1, BLOCK.LEAVES)
  assert.equal(persistence.editCount, 3)
  assert.deepEqual(storedDoc(storage).edits, [[16, 7, 16, 0], [1, 20, 1, 5], [3, 25, 5, 4]], 'sorted by voxel index')
  assert.equal(SAVE_VERSION, 1)
})

test('(a) edits survive a reload, and new edits are added to the old ones', () => {
  const storage = memoryStorage()
  const first = boot(storage)
  first.world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.STONE)
  first.world.setBlock(GROUND.x, GROUND.y, GROUND.z, BLOCK.AIR)

  const second = boot(storage)
  assert.deepEqual(second.result, { status: 'loaded', applied: 2, skipped: 0 })
  assert.equal(second.persistence.editCount, 2)
  assert.equal(second.world.getBlock(SKY.x, SKY.y, SKY.z), BLOCK.STONE)
  assert.equal(second.world.getBlock(GROUND.x, GROUND.y, GROUND.z), BLOCK.AIR)

  second.world.setBlock(10, 22, 10, BLOCK.DIRT)
  const edits = storedDoc(storage).edits
  assert.deepEqual(edits.sort(), [[3, 25, 5, 3], [10, 22, 10, 2], [16, 7, 16, 0]].sort())

  const third = boot(storage)
  assert.equal(third.result.applied, 3)
  assert.deepEqual(third.world.snapshot(), second.world.snapshot())
})

test('(b) an edit reverted to the base block is dropped from the save', () => {
  const storage = memoryStorage()
  const { world, persistence } = boot(storage)
  world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD)
  world.setBlock(GROUND.x, GROUND.y, GROUND.z, BLOCK.AIR)
  world.setBlock(GROUND.x, GROUND.y, GROUND.z, baseAt(GROUND)) // put the grass back
  assert.equal(persistence.editCount, 1)
  assert.deepEqual(storedDoc(storage).edits, [[3, 25, 5, 4]])

  world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.AIR)
  assert.equal(persistence.editCount, 0)
  assert.equal(storage.getItem(STORAGE_KEY), null, 'an unedited world needs no save')
  assert.equal(boot(storage).result.status, 'empty')
})

test('(c) restore, then clear() + replaceAll(base) gives back the freshly generated world', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: saveDoc([[3, 25, 5, 4], [16, 7, 16, 0], [8, 9, 8, 3]]) })
  const { world, persistence, result } = boot(storage)
  assert.equal(result.status, 'loaded')
  assert.notDeepEqual(world.snapshot(), BASE)

  assert.equal(persistence.clear(), true)
  world.replaceAll(BASE)
  assert.deepEqual(world.snapshot(), generateWorldData(), 'byte-identical to a fresh seed-42 world')
  assert.equal(persistence.editCount, 0)
  assert.equal(storage.getItem(STORAGE_KEY), null)
  assert.equal(boot(storage).result.status, 'empty', 'a reload after reset is pristine')
})

test('restore replaces the edit map with exactly the applied edits', () => {
  const storage = memoryStorage()
  const persistence = createWorldPersistence({ storage })
  const world = createWorld()
  persistence.attach(world, BASE)
  persistence.restore(world, BASE)
  world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD)
  world.setBlock(1, 20, 1, BLOCK.WOOD)

  storage.setItem(STORAGE_KEY, saveDoc([[5, 21, 5, 3]]))
  const result = persistence.restore(world, BASE)
  assert.deepEqual(result, { status: 'loaded', applied: 1, skipped: 0 })
  assert.equal(persistence.editCount, result.applied)
  assert.deepEqual(world.snapshot(), expectedWorld([[5, 21, 5, 3]]))

  storage.setItem(STORAGE_KEY, '{oops')
  persistence.restore(world, BASE)
  assert.equal(persistence.editCount, 0, 'a corrupt restore leaves the map empty')
})

test('reset events are not edits, and unsubscribing stops tracking', () => {
  const storage = countingStorage()
  const { world, persistence, detach } = boot(storage)
  world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD)
  const saved = storage.getItem(STORAGE_KEY)
  assert.equal(storage.writes, 1, 'one synchronous save per edit')
  world.replaceAll(BASE)
  assert.equal(persistence.editCount, 1)
  assert.equal(storage.writes, 1, 'a reset is not saved')

  detach()
  world.setBlock(1, 20, 1, BLOCK.WOOD)
  assert.equal(persistence.editCount, 1)
  assert.equal(storage.writes, 1)
  assert.equal(storage.getItem(STORAGE_KEY), saved)
})

test('baseData is never modified', () => {
  const base = BASE.slice()
  const storage = memoryStorage({ [STORAGE_KEY]: saveDoc([[3, 25, 5, 4], [16, 7, 16, 0]]) })
  const world = createWorld()
  const persistence = createWorldPersistence({ storage })
  persistence.restore(world, base)
  persistence.attach(world, base)
  world.setBlock(1, 20, 1, BLOCK.WOOD)
  assert.deepEqual(base, BASE)
})

test('a large random edit session round-trips exactly', () => {
  const storage = memoryStorage()
  const first = boot(storage)
  const rng = createRng(9)
  for (let i = 0; i < 400; i++) {
    first.world.setBlock(rng.int(0, 31), rng.int(1, 31), rng.int(0, 31), rng.int(0, 5))
  }
  const second = boot(storage)
  assert.equal(second.result.status, 'loaded')
  assert.equal(second.result.skipped, 0)
  assert.deepEqual(second.world.snapshot(), first.world.snapshot())
  assert.equal(second.persistence.editCount, first.persistence.editCount)
})

// --- (d) bad data ---

test('(d) corrupt JSON is backed up, removed, and ignored', () => {
  const raw = '{"version":1,"seed":42,"edits":[[1,2'
  const storage = memoryStorage({ [STORAGE_KEY]: raw })
  const { world, persistence, result } = boot(storage)
  assert.deepEqual(result, { status: 'corrupt', applied: 0, skipped: 0 })
  assert.deepEqual(world.snapshot(), BASE)
  assert.equal(persistence.editCount, 0)
  assert.equal(storage.getItem(BACKUP_KEY), raw)
  assert.equal(storage.getItem(STORAGE_KEY), null)

  world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD)
  assert.deepEqual(storedDoc(storage).edits, [[3, 25, 5, 4]], 'saving works normally afterwards')
  assert.equal(storage.getItem(BACKUP_KEY), raw, 'the backup is kept')
})

test('(d) a save with the wrong top-level shape is treated as corrupt', () => {
  const shapes = [
    '[]',
    'null',
    '42',
    '"edits"',
    '{}',
    saveDoc('not a list'),
    saveDoc({ 0: [1, 2, 3, 4] }),
    saveDoc([], { seed: '42' }),
    saveDoc([], { version: null }),
    JSON.stringify({ version: 1, seed: 42, size: 32, edits: [] }),
  ]
  for (const raw of shapes) {
    const storage = memoryStorage({ [STORAGE_KEY]: raw })
    const { world, result } = boot(storage)
    assert.equal(result.status, 'corrupt', raw)
    assert.deepEqual(world.snapshot(), BASE, raw)
    assert.equal(storage.getItem(BACKUP_KEY), raw)
    assert.equal(storage.getItem(STORAGE_KEY), null)
  }
})

test('(d) saves for another version, seed, or world size are discarded as incompatible', () => {
  const edits = [[3, 25, 5, 4]]
  for (const overrides of [{ version: 2 }, { version: 0 }, { seed: 43 }, { size: 16 }, { height: 64 }]) {
    const raw = saveDoc(edits, overrides)
    const storage = memoryStorage({ [STORAGE_KEY]: raw })
    const { world, persistence, result } = boot(storage)
    assert.deepEqual(result, { status: 'incompatible', applied: 0, skipped: 0 }, JSON.stringify(overrides))
    assert.deepEqual(world.snapshot(), BASE)
    assert.equal(persistence.editCount, 0)
    assert.equal(storage.getItem(STORAGE_KEY), null)
    assert.equal(storage.getItem(BACKUP_KEY), null, 'incompatible saves are not corrupt')
  }
})

test('(d) invalid entries are skipped and counted; valid ones still load', () => {
  const valid = [[3, 25, 5, 4], [16, 7, 16, 0], [0, 1, 0, 0], [31, 31, 31, 5]]
  const invalid = [
    [1.5, 20, 1, 4], // non-integer coordinate
    ['1', 20, 1, 4], // string coordinate
    [1, 20, 1, 4.5], // non-integer id
    [32, 20, 1, 4], // x out of bounds
    [1, -1, 1, 4], // y below the floor
    [1, 32, 1, 4], // y above the world
    [1, 20, -1, 4], // z out of bounds
    [1, 20, 1, 6], // unknown block id
    [1, 20, 1, -1], // negative id
    [4, 0, 4, 0], // digging the unbreakable floor
    [4, 0, 4, 1], // non-stone floor
    [1, 20, 1], // too short
    [1, 20, 1, 4, 9], // too long
    { x: 1, y: 20, z: 1, id: 4 }, // not a tuple
    null,
  ]
  const storage = memoryStorage({ [STORAGE_KEY]: saveDoc([...invalid.slice(0, 7), ...valid, ...invalid.slice(7)]) })
  const { world, persistence, result } = boot(storage)
  assert.deepEqual(result, { status: 'loaded', applied: valid.length, skipped: invalid.length })
  assert.equal(persistence.editCount, valid.length)
  assert.deepEqual(world.snapshot(), expectedWorld(valid))
  assert.equal(storedDoc(storage).edits.length, valid.length, 'the save is rewritten without the rejected entries')
})

test('(d) duplicate entries: the last one wins; no-op entries are skipped', () => {
  const entries = [
    [3, 25, 5, 4],
    [3, 25, 5, 2], // supersedes the first
    [16, 7, 16, 0],
    [16, 7, 16, BLOCK.GRASS], // ...back to the base block: nothing to apply
    [8, 0, 8, BLOCK.STONE], // the floor is already stone
    [9, 24, 9, 0], // already air
  ]
  const storage = memoryStorage({ [STORAGE_KEY]: saveDoc(entries) })
  const { world, result } = boot(storage)
  assert.equal(baseAt(GROUND), BLOCK.GRASS)
  assert.deepEqual(result, { status: 'loaded', applied: 1, skipped: 5 })
  assert.equal(world.getBlock(3, 25, 5), BLOCK.DIRT)
  assert.equal(world.getBlock(16, 7, 16), BLOCK.GRASS)
  assert.deepEqual(storedDoc(storage).edits, [[3, 25, 5, 2]])
})

test('a loaded save with nothing to skip is left untouched', () => {
  const raw = saveDoc([[16, 7, 16, 0], [3, 25, 5, 4]]) // unsorted, but valid
  const storage = memoryStorage({ [STORAGE_KEY]: raw })
  assert.equal(boot(storage).result.status, 'loaded')
  assert.equal(storage.getItem(STORAGE_KEY), raw)
})

test('a custom storage key is honoured', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: saveDoc([[3, 25, 5, 4]]) })
  const { world, result } = boot(storage, { key: 'custom' })
  assert.equal(result.status, 'empty')
  world.setBlock(1, 20, 1, BLOCK.WOOD)
  assert.deepEqual(storedDoc(storage, 'custom').edits, [[1, 20, 1, 4]])
  assert.equal(storage.getItem(STORAGE_KEY), saveDoc([[3, 25, 5, 4]]), 'other keys are left alone')
})

// --- (d) failing or missing storage ---

test('(d) storage that throws on read is unavailable; the game keeps running', () => {
  const storage = flakyStorage({ get: true, initial: { [STORAGE_KEY]: saveDoc([[3, 25, 5, 4]]) } })
  const { world, persistence, result, resets } = boot(storage)
  assert.deepEqual(result, { status: 'unavailable', applied: 0, skipped: 0 })
  assert.deepEqual(world.snapshot(), BASE)
  assert.equal(resets.length, 1)
  assert.equal(persistence.editCount, 0)
})

test('(d) storage that throws on write: save() returns false and edits never throw', () => {
  const storage = flakyStorage({ set: true })
  const { world, persistence } = boot(storage)
  const failures = []
  persistence.onSaveError(() => failures.push(1))
  assert.doesNotThrow(() => world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD))
  assert.doesNotThrow(() => world.setBlock(1, 20, 1, BLOCK.WOOD))
  assert.equal(persistence.editCount, 2, 'edits are still tracked in memory')
  assert.equal(persistence.save(), false)
  assert.equal(failures.length, 1, 'one notification per failure streak')

  storage.state.set = false
  assert.equal(persistence.save(), true)
  assert.equal(storedDoc(storage).edits.length, 2, 'recovers once storage works again')
  storage.state.set = true
  world.setBlock(2, 20, 2, BLOCK.WOOD)
  assert.equal(failures.length, 2, 'a new failure after a recovery is reported again')
})

test('(d) storage that throws on remove: clear() reports false without throwing', () => {
  const storage = flakyStorage({ remove: true })
  const { world, persistence } = boot(storage)
  world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD)
  assert.equal(persistence.clear(), false)
  assert.equal(persistence.editCount, 0)
})

test('(d) a corrupt save is still removed when writing the backup fails', () => {
  const storage = flakyStorage({ set: true, initial: { [STORAGE_KEY]: 'garbage' } })
  const { world, result } = boot(storage)
  assert.equal(result.status, 'corrupt')
  assert.deepEqual(world.snapshot(), BASE)
  assert.deepEqual(storage.dump(), {}, 'main key removed, no backup written')
})

test('(d) without any storage, nothing is saved and nothing throws', () => {
  for (const storage of [null, undefined, {}]) {
    const { world, persistence, result } = boot(storage)
    assert.equal(result.status, 'unavailable')
    assert.deepEqual(world.snapshot(), BASE)
    assert.doesNotThrow(() => world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD))
    assert.equal(persistence.editCount, 1)
    assert.equal(persistence.save(), false)
    assert.equal(persistence.clear(), false)
  }
})

test('mismatched world or base dimensions are programmer errors', () => {
  const persistence = createWorldPersistence({ storage: memoryStorage() })
  assert.throws(() => persistence.restore(createWorld({ size: 16 }), BASE), RangeError)
  assert.throws(() => persistence.restore(createWorld(), new Uint8Array(10)), RangeError)
  assert.throws(() => persistence.attach(createWorld({ height: 16 }), BASE), RangeError)
})

test('persistence works for non-default world layouts', () => {
  const dims = { seed: 5, size: 8, height: 12 }
  const base = generateWorldData(dims)
  const storage = memoryStorage()
  const world = createWorld(dims)
  const persistence = createWorldPersistence({ storage, ...dims })
  persistence.restore(world, base)
  persistence.attach(world, base)
  world.setBlock(7, 11, 7, BLOCK.STONE)
  assert.equal(storage.getItem(STORAGE_KEY), '{"version":1,"seed":5,"size":8,"height":12,"edits":[[7,11,7,3]]}')

  const reloaded = createWorld(dims)
  const result = createWorldPersistence({ storage, ...dims }).restore(reloaded, base)
  assert.deepEqual(result, { status: 'loaded', applied: 1, skipped: 0 })
  assert.equal(reloaded.getBlock(7, 11, 7), BLOCK.STONE)
  assert.equal(createWorldPersistence({ storage }).restore(createWorld(), BASE).status, 'incompatible')
})

// --- save-error reporting (review logic-bugs:L4) ---

test('regression: a failed cleanup rewrite at load does not hide the first in-game save error', () => {
  // A duplicate entry makes load() rewrite the save; that write fails before
  // the game has registered its listener.
  const initial = { [STORAGE_KEY]: saveDoc([[3, 25, 5, 4], [3, 25, 5, 2]]) }
  const storage = flakyStorage({ set: true, initial })
  const { world, persistence, result } = boot(storage)
  assert.deepEqual(result, { status: 'loaded', applied: 1, skipped: 1 })
  const failures = []
  persistence.onSaveError(() => failures.push(1))
  assert.equal(failures.length, 0, 'the start-up rewrite is not reported as an in-game failure')
  world.setBlock(1, 20, 1, BLOCK.WOOD)
  assert.equal(failures.length, 1, 'the first failed save in play is reported')
  world.setBlock(2, 20, 2, BLOCK.WOOD)
  assert.equal(failures.length, 1, 'once per failure streak')
})

test('onSaveError tells a listener added while saving is already failing straight away', () => {
  const storage = flakyStorage({ set: true })
  const { world, persistence } = boot(storage)
  world.setBlock(1, 20, 1, BLOCK.WOOD) // fails with nobody listening
  const failures = []
  persistence.onSaveError(() => failures.push(1))
  assert.equal(failures.length, 1, 'called immediately')
  world.setBlock(2, 20, 2, BLOCK.WOOD)
  assert.equal(failures.length, 1, 'same streak: no repeat')
  storage.state.set = false
  assert.equal(persistence.save(), true)
  persistence.onSaveError(() => failures.push(2))
  assert.deepEqual(failures, [1], 'a healthy save does not notify new listeners')
  storage.state.set = true
  world.setBlock(3, 20, 3, BLOCK.WOOD)
  assert.deepEqual(failures, [1, 1, 2], 'a new streak notifies every listener once')
})

// --- resync: adopting another tab's save (review logic-bugs:L5) ---

test('resync adopts the edits another instance saved, without saving them back', () => {
  const storage = countingStorage()
  const a = boot(storage)
  const b = boot(storage)
  b.world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD)
  const writes = storage.writes
  const blockEvents = []
  a.world.subscribe((event) => event.type === 'block' && blockEvents.push(event))

  const result = a.persistence.resync(a.world, BASE)
  assert.deepEqual(result, { status: 'loaded', applied: 1, skipped: 0 })
  assert.equal(a.world.getBlock(SKY.x, SKY.y, SKY.z), BLOCK.WOOD)
  assert.equal(a.persistence.editCount, 1)
  assert.equal(a.resets.length, 2, 'one replaceAll for the restore, one for the resync')
  assert.deepEqual(blockEvents, [], 'no per-block events')
  assert.equal(storage.writes, writes, 'nothing is written back')

  a.world.setBlock(GROUND.x, GROUND.y, GROUND.z, BLOCK.AIR)
  assert.deepEqual(storedDoc(storage).edits, [[16, 7, 16, 0], [3, 25, 5, 4]], "A's next save keeps B's edit")
})

test('resync follows a reset in another tab back to the base terrain', () => {
  const storage = memoryStorage()
  const a = boot(storage)
  a.world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD)
  const b = boot(storage)
  b.persistence.clear()
  assert.deepEqual(a.persistence.resync(a.world, BASE), { status: 'empty', applied: 0, skipped: 0 })
  assert.deepEqual(a.world.snapshot(), BASE)
  assert.equal(a.persistence.editCount, 0)
})

test('resync keeps the current edits and world when storage cannot be read', () => {
  const storage = flakyStorage()
  const { world, persistence, resets } = boot(storage)
  world.setBlock(SKY.x, SKY.y, SKY.z, BLOCK.WOOD)
  const before = world.snapshot()
  storage.state.get = true
  assert.equal(persistence.resync(world, BASE).status, 'unavailable')
  assert.deepEqual(world.snapshot(), before)
  assert.equal(persistence.editCount, 1)
  assert.equal(resets.length, 1, 'the world was not rebuilt')
  storage.state.get = false
  world.setBlock(1, 20, 1, BLOCK.LEAVES)
  assert.equal(storedDoc(storage).edits.length, 2, 'the kept edits are still saved')
})

test('resync checks the world layout like restore does', () => {
  const persistence = createWorldPersistence({ storage: memoryStorage() })
  assert.throws(() => persistence.resync(createWorld({ size: 16 }), BASE), RangeError)
})
