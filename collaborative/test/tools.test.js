import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS, createToolbelt, getTool } from '../src/interaction/tools.js'

test('TOOLS lists pickaxe, axe and shovel in Q order and is frozen', () => {
  assert.deepEqual(TOOLS, [
    { key: 'pickaxe', name: 'Pickaxe' },
    { key: 'axe', name: 'Axe' },
    { key: 'shovel', name: 'Shovel' },
  ])
  assert.ok(Object.isFrozen(TOOLS))
  for (const tool of TOOLS) assert.ok(Object.isFrozen(tool))
  assert.throws(() => TOOLS.push({ key: 'sword' }))
  assert.throws(() => {
    TOOLS[0].key = 'sword'
  })
})

test('getTool finds tools by key and returns null otherwise', () => {
  assert.equal(getTool('axe'), TOOLS[1])
  assert.equal(getTool('sword'), null)
  assert.equal(getTool(undefined), null)
})

test('a new toolbelt holds the pickaxe', () => {
  const belt = createToolbelt()
  assert.equal(belt.index, 0)
  assert.equal(belt.current, TOOLS[0])
  assert.equal(belt.current.key, 'pickaxe')
})

test('a valid start index is honoured; invalid ones fall back to the first tool', () => {
  assert.equal(createToolbelt(2).current.key, 'shovel')
  for (const start of [-1, 3, 1.5, Number.NaN, '1', null]) {
    assert.equal(createToolbelt(start).index, 0, `start ${String(start)}`)
  }
})

test('cycle advances pickaxe -> axe -> shovel and wraps back to the pickaxe', () => {
  const belt = createToolbelt()
  assert.equal(belt.cycle().key, 'axe')
  assert.equal(belt.index, 1)
  assert.equal(belt.cycle().key, 'shovel')
  assert.equal(belt.cycle().key, 'pickaxe')
  assert.equal(belt.index, 0)
  assert.equal(belt.current.key, 'pickaxe')
})

test('cycle accepts a step, including negative steps, and ignores malformed ones', () => {
  const belt = createToolbelt()
  assert.equal(belt.cycle(-1).key, 'shovel')
  assert.equal(belt.cycle(2).key, 'axe')
  assert.equal(belt.cycle(0).key, 'axe')
  assert.equal(belt.cycle(7).key, 'shovel')
  assert.equal(belt.cycle('x').key, 'pickaxe', 'a non-integer step behaves like a single step')
  assert.equal(belt.cycle(1.5).key, 'axe')
})

test('select picks a tool by index; invalid indices return null and keep the current tool', () => {
  const belt = createToolbelt()
  assert.equal(belt.select(2).key, 'shovel')
  assert.equal(belt.index, 2)
  for (const index of [-1, 3, 0.5, Number.NaN, '0', undefined]) {
    assert.equal(belt.select(index), null, `index ${String(index)}`)
    assert.equal(belt.current.key, 'shovel')
  }
  assert.equal(belt.select(0).key, 'pickaxe')
})

test('toolbelts are independent of each other', () => {
  const a = createToolbelt()
  const b = createToolbelt()
  a.cycle()
  assert.equal(a.current.key, 'axe')
  assert.equal(b.current.key, 'pickaxe')
})
