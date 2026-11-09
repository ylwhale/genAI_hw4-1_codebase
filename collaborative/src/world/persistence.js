// Save edits as a diff against generated terrain. Storage failures do not interrupt play.
// Saved JSON: {"version":1,"seed":42,"size":32,"height":32,"edits":[[x,y,z,id],...]}
// Edits are sorted by voxel index; unchanged blocks are omitted.

import { STORAGE_KEY, WORLD_HEIGHT, WORLD_SEED, WORLD_SIZE } from '../config.js'
import { BLOCK, isValidBlockId } from './blocks.js'
import { voxelIndex } from './world.js'

export const SAVE_VERSION = 1
const HEADER_FIELDS = Object.freeze(['version', 'seed', 'size', 'height'])

// Storage access: every call is guarded and reports success.

function readItem(storage, key) {
  try {
    return { ok: true, value: storage.getItem(key) }
  } catch {
    return { ok: false, value: null }
  }
}

function writeItem(storage, key, value) {
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function removeItem(storage, key) {
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

// Save document parsing and validation (pure).

function hasSaveShape(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return false
  return Array.isArray(doc.edits) && HEADER_FIELDS.every((field) => Number.isFinite(doc[field]))
}

function matchesWorld(doc, dims) {
  const expected = { version: SAVE_VERSION, ...dims }
  return HEADER_FIELDS.every((field) => doc[field] === expected[field])
}

// Returns { status: 'corrupt' | 'incompatible' } or { status: 'loaded', entries }.
function parseSave(raw, dims) {
  if (typeof raw !== 'string') return { status: 'corrupt' }
  let doc
  try {
    doc = JSON.parse(raw)
  } catch {
    return { status: 'corrupt' }
  }
  if (!hasSaveShape(doc)) return { status: 'corrupt' }
  if (!matchesWorld(doc, dims)) return { status: 'incompatible' }
  return { status: 'loaded', entries: doc.edits }
}

function inWorld(x, y, z, { size, height }) {
  return x >= 0 && x < size && z >= 0 && z < size && y >= 0 && y < height
}

// Voxel index of a saved [x, y, z, id] entry, or -1 when the entry is invalid.
// The y = 0 floor is unbreakable, so a floor edit can only ever be stone.
function entryIndex(entry, dims) {
  if (!Array.isArray(entry) || entry.length !== 4) return -1
  const [x, y, z, id] = entry
  if (![x, y, z].every(Number.isInteger) || !inWorld(x, y, z, dims)) return -1
  if (!isValidBlockId(id) || (y === 0 && id !== BLOCK.STONE)) return -1
  return voxelIndex(dims.size, x, y, z)
}

// Valid entries as Map<index, id>. Later duplicates win; superseded
// duplicates, invalid entries, and no-op edits (equal to the base) are skipped.
function collectEdits(entries, baseData, dims) {
  const edits = new Map()
  let skipped = 0
  for (const entry of entries) {
    const index = entryIndex(entry, dims)
    if (index < 0) {
      skipped++
      continue
    }
    if (edits.has(index)) skipped++
    edits.set(index, entry[3])
  }
  for (const [index, id] of edits) {
    if (baseData[index] !== id) continue
    edits.delete(index)
    skipped++
  }
  return { edits, skipped }
}

function serialize(edits, { seed, size, height }) {
  const layer = size * size
  const list = [...edits]
    .sort((a, b) => a[0] - b[0])
    .map(([index, id]) => [index % size, Math.floor(index / layer), Math.floor(index / size) % size, id])
  return JSON.stringify({ version: SAVE_VERSION, seed, size, height, edits: list })
}

function outcome(status, applied = 0, skipped = 0) {
  return { status, applied, skipped }
}

function mergeEdits(baseData, edits) {
  const merged = new Uint8Array(baseData) // copy: baseData stays read-only
  for (const [index, id] of edits) merged[index] = id
  return merged
}

// Persistence for one world layout. `restore` must be given the same base
// terrain the world was generated from; `attach` keeps the save in sync.
export function createWorldPersistence({
  storage = null,
  key = STORAGE_KEY,
  seed = WORLD_SEED,
  size = WORLD_SIZE,
  height = WORLD_HEIGHT,
} = {}) {
  const dims = { seed, size, height }
  const backupKey = `${key}:corrupt-backup`
  const saveErrorListeners = new Set()
  let edits = new Map() // voxel index -> block id that differs from the base terrain
  let failing = false

  // Programmer errors (wrong-sized world or base) are reported loudly; data
  // problems never throw.
  function checkLayout(world, baseData) {
    const volume = size * size * height
    if (world.size !== size || world.height !== height || baseData?.length !== volume) {
      throw new RangeError(`persistence expects a ${size} x ${height} x ${size} world and base terrain`)
    }
  }

  function notifySaveResult(ok) {
    if (!ok && !failing) for (const listener of [...saveErrorListeners]) listener()
    failing = !ok
  }

  // Bad saves never block the game. Corrupt text is kept under a backup key
  // for debugging; either way the main key is dropped so the next save starts
  // clean (even if the backup itself could not be written).
  function discard(status, raw) {
    if (status === 'corrupt') writeItem(storage, backupKey, String(raw))
    removeItem(storage, key)
  }

  // Reads storage into `edits`; returns { status, applied, skipped }.
  function load(baseData) {
    const read = storage ? readItem(storage, key) : { ok: false }
    if (!read.ok) return outcome('unavailable')
    if (read.value === null || read.value === undefined) return outcome('empty')
    const parsed = parseSave(read.value, dims)
    if (parsed.status !== 'loaded') {
      discard(parsed.status, read.value)
      return outcome(parsed.status)
    }
    const collected = collectEdits(parsed.entries, baseData, dims)
    edits = collected.edits
    // Rewrite without the rejected entries. A raw write: nobody listens for
    // save errors yet, so a failure here must not latch the failing state
    // (the first failed save in play then reports it as usual).
    if (collected.skipped > 0) writeSave()
    return outcome('loaded', edits.size, collected.skipped)
  }

  function restore(world, baseData) {
    checkLayout(world, baseData)
    edits = new Map()
    const result = load(baseData)
    world.replaceAll(mergeEdits(baseData, edits))
    return result
  }

  // Adopt what another tab saved: re-read the stored diff into the edit map
  // and rebuild the world from it. replaceAll emits a 'reset' event, which is
  // not an edit, so this never saves back. When storage cannot be read the
  // current edits and world are kept.
  function resync(world, baseData) {
    checkLayout(world, baseData)
    const previous = edits
    edits = new Map()
    const result = load(baseData)
    if (result.status === 'unavailable') {
      edits = previous
      return result
    }
    world.replaceAll(mergeEdits(baseData, edits))
    return result
  }

  // Track block edits as a diff against baseData and save after each one.
  // 'reset' events (generation, restore, world reset) are not edits.
  function attach(world, baseData) {
    checkLayout(world, baseData)
    return world.subscribe((event) => {
      if (event.type !== 'block') return
      const index = voxelIndex(size, event.x, event.y, event.z)
      if (event.next === baseData[index]) edits.delete(index)
      else edits.set(index, event.next)
      save()
    })
  }

  // An empty diff removes the key entirely: an unedited world needs no save.
  function writeSave() {
    if (!storage) return false
    return edits.size === 0 ? removeItem(storage, key) : writeItem(storage, key, serialize(edits, dims))
  }

  function save() {
    const ok = writeSave()
    notifySaveResult(ok)
    return ok
  }

  function clear() {
    edits = new Map()
    return storage ? removeItem(storage, key) : false
  }

  // Called once when saving starts failing (not on every failed save), so the
  // game can show a single "not saving" notice. A listener added while saving
  // is already failing is told straight away.
  function onSaveError(listener) {
    saveErrorListeners.add(listener)
    if (failing) listener()
    return () => saveErrorListeners.delete(listener)
  }

  return {
    restore,
    resync,
    attach,
    save,
    clear,
    onSaveError,
    get editCount() {
      return edits.size
    },
  }
}
