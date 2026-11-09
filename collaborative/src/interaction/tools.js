// Cosmetic tool belt for the first-person hand. Tools never change gameplay;
// the selection is independent of the block hotbar and cycles with Q.

export const TOOLS = Object.freeze([
  Object.freeze({ key: 'pickaxe', name: 'Pickaxe' }),
  Object.freeze({ key: 'axe', name: 'Axe' }),
  Object.freeze({ key: 'shovel', name: 'Shovel' }),
])

export function getTool(key) {
  return TOOLS.find((tool) => tool.key === key) ?? null
}

function isToolIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < TOOLS.length
}

function wrapIndex(index) {
  return ((index % TOOLS.length) + TOOLS.length) % TOOLS.length
}

export function createToolbelt(startIndex = 0) {
  let index = isToolIndex(startIndex) ? startIndex : 0

  return {
    get current() {
      return TOOLS[index]
    },
    get index() {
      return index
    },
    // Advance to the next tool (or `step` tools, e.g. -1 for the previous
    // one), wrapping around the belt. Returns the newly held tool.
    cycle(step = 1) {
      index = wrapIndex(index + (Number.isInteger(step) ? step : 1))
      return TOOLS[index]
    },
    // Returns the selected tool, or null (selection unchanged) for an invalid index.
    select(next) {
      if (!isToolIndex(next)) return null
      index = next
      return TOOLS[index]
    },
  }
}
