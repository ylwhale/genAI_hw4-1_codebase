// The two hostile creature types. Stats follow EXTENSION_MOBS_HEALTH.md.

export const MOB_TYPES = {
  mossling: {
    id: 'mossling',
    name: 'Mossling',
    maxHealth: 40,
    damage: 10,
    speed: 1.3, // chase speed, world units / second
    wanderSpeed: 0.6, // "move around slowly"
    width: 0.7,
    height: 0.8,
    stopDistance: 1.05, // horizontal distance at which a chase stops
    jumpSpeed: 8.2, // enough to hop up a one-block step
    knockback: 5, // light: struck Mosslings fly back
    colors: ['#2f6a3a', '#3a7a40', '#8fbf4a', '#1f4426', '#a3c95a'],
  },
  stoneguard: {
    id: 'stoneguard',
    name: 'Stoneguard',
    maxHealth: 60,
    damage: 15,
    speed: 0.8,
    wanderSpeed: 0.4,
    width: 0.9,
    height: 1.8,
    stopDistance: 1.25,
    jumpSpeed: 8.2,
    knockback: 2.2, // heavy: barely budges...
    interruptible: false, // ...and a hit doesn't cancel its slam
    hitStun: 0.15,
    colors: ['#a3a6a9', '#8e9194', '#afb2b4', '#66696d', '#5aa83c'],
  },
};

/** Three Mosslings and one Stoneguard (the Stoneguard is placed first: it needs more room). */
export const SPAWN_LIST = ['stoneguard', 'mossling', 'mossling', 'mossling'];
