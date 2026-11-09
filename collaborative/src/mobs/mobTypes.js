// Hostile mob definitions. Health, damage, and speed values are fixed by
// EXTENSION_MOBS_HEALTH.md; sizes are tuned so both types fit inside one block
// column (width < 1) and can hop one-block steps (jumpSpeed 8.4 clears ~1.4).

export const MOB_TYPES = Object.freeze({
  mossling: Object.freeze({
    key: 'mossling',
    name: 'Mossling',
    maxHealth: 40, // (EXT)
    damage: 10, // (EXT)
    speed: 1.3, // (EXT) chase speed, world units per second
    wanderSpeed: 0.55,
    width: 0.7,
    height: 0.9,
    eyeHeight: 0.6,
    jumpSpeed: 8.4,
    color: 0x5fae3e,
  }),
  stoneguard: Object.freeze({
    key: 'stoneguard',
    name: 'Stoneguard',
    maxHealth: 60, // (EXT)
    damage: 15, // (EXT)
    speed: 0.8, // (EXT)
    wanderSpeed: 0.4,
    width: 0.9,
    height: 1.9,
    eyeHeight: 1.55,
    jumpSpeed: 8.4,
    color: 0x8c8f94,
  }),
})

export const MOB_TYPE_KEYS = Object.freeze(Object.keys(MOB_TYPES))

// Definition for a type key, or null for anything unknown (including
// inherited object keys such as 'toString').
export function getMobType(key) {
  return Object.hasOwn(MOB_TYPES, key) ? MOB_TYPES[key] : null
}
