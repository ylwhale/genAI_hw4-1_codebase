// Central gameplay constants. Values marked (SPEC) or (EXT) come directly from
// SPEC.md or EXTENSION_MOBS_HEALTH.md; the rest are tuning choices.

export const WORLD_SIZE = 32 // (SPEC) blocks along X and Z, valid coords 0..31
export const WORLD_HEIGHT = 32 // blocks along Y, valid coords 0..31
export const WORLD_SEED = 42 // (SPEC)
export const CHUNK_SIZE = 8 // render chunk footprint (8 x 8 columns)

export const REACH = 6 // (SPEC) block interaction distance from the camera
export const BREAK_DURATION = 1.0 // seconds for the mining animation
export const PLACE_DURATION = 1.0 // seconds for the construction animation

export const PLAYER = Object.freeze({
  width: 0.6,
  height: 1.8,
  eyeHeight: 1.62,
  walkSpeed: 4.3,
  groundAccel: 40,
  airAccel: 12,
  jumpSpeed: 8.2,
  maxHealth: 100, // (EXT)
  lookSensitivity: 0.0022,
})

export const GRAVITY = 25
export const TERMINAL_VELOCITY = 40
export const MAX_FRAME_DT = 0.1 // clamp long frames (tab switches, hitches)
export const PHYSICS_STEP = 1 / 120 // largest simulation sub-step
export const FALL_RESCUE_Y = -8 // below this the player is returned to spawn

export const COMBAT = Object.freeze({
  playerDamage: 25, // (EXT)
  playerCooldown: 0.6, // (EXT)
  playerReach: 3, // (EXT)
})

// Shove a mob strike gives the player, so hits read clearly.
export const PLAYER_KNOCKBACK = Object.freeze({
  speed: 4, // horizontal push away from the attacker, units per second
  hop: 4, // minimum upward speed when struck on the ground
})

export const MOB_RULES = Object.freeze({
  detectRange: 10, // (EXT) chase when within this distance
  attackRange: 1.75, // (EXT) attack when within this distance and unobstructed
  attackCooldown: 1.5, // (EXT) minimum time between strikes
  attackWindup: 0.35, // visible wind-up before each strike (inside the cooldown)
  spawnExclusionRadius: 8, // (EXT) no spawns within this horizontal distance of the player spawn
  spawnMinDistance: 9, // enforced floor: exclusion radius plus body half-widths
  spawnPreferredDistance: 12, // prefer spawning beyond the chase range
  spawnPlan: ['mossling', 'mossling', 'mossling', 'stoneguard'], // (EXT)
})

export const STORAGE_KEY = 'voxel-grove:world:v1'

// Terrain envelope promised by the generator (surface = top solid block y).
// The decorative sea outside the island sits just below the lowest surface.
export const TERRAIN = Object.freeze({
  minSurface: 4,
  maxSurface: 14,
  seaLevel: 3.55,
})
