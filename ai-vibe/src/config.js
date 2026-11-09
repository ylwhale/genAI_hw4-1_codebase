// Central tuning constants for Voxel Grove.

export const WORLD = {
  SIZE: 32, // blocks along X and Z (valid coords 0..31)
  HEIGHT: 48, // blocks along Y (valid coords 0..47)
  SEED: 42,
  CHUNK_SIZE: 16, // horizontal chunk size used for meshing
};

export const PLAYER = {
  WIDTH: 0.6, // collision box width/depth
  HEIGHT: 1.8, // collision box height
  EYE_HEIGHT: 1.62, // camera height above the feet
  WALK_SPEED: 4.6, // blocks per second
  GROUND_ACCEL: 14, // velocity smoothing rate on the ground (1/s)
  AIR_ACCEL: 3.5, // velocity smoothing rate in the air (1/s)
  GRAVITY: 28, // blocks per second^2
  JUMP_SPEED: 8.6, // initial upward velocity (~1.3 block jump)
  TERMINAL_VELOCITY: 48,
  MOUSE_SENSITIVITY: 0.0022, // radians per pixel
};

export const PHYSICS = {
  STEP: 1 / 120, // fixed simulation step (seconds)
  MAX_FRAME_TIME: 0.1, // clamp long frames (tab switches etc.)
};

export const INTERACTION = {
  REACH: 6, // max distance from the camera, in world units
  BREAK_DURATION: 1.0, // seconds of mining before a block is removed
  PLACE_DURATION: 1.0, // seconds of construction before a block appears
  BREAK_STRIKES: 3, // tool strikes per mining action (the last one breaks it)
  PLACE_TAPS: 2, // hand taps per construction action
};

export const COMBAT = {
  PLAYER_MAX_HEALTH: 100,
  PLAYER_DAMAGE: 25, // per melee hit
  PLAYER_ATTACK_COOLDOWN: 0.6, // seconds
  PLAYER_ATTACK_RANGE: 3, // from the camera, world units
  CHASE_RANGE: 10, // mobs start chasing within this distance
  CHASE_GIVE_UP: 12.5, // ...and stop once the player is this far away
  ATTACK_RANGE: 1.75, // centre-to-centre distance for a mob attack
  ATTACK_COOLDOWN: 1.5, // seconds between a mob's attacks
  ATTACK_WINDUP: 0.35, // seconds from starting an attack to the hit
  ATTACK_RECOVER: 0.3, // seconds a mob stays rooted after its hit
  SPAWN_MIN_DISTANCE: 8, // from the player's spawn (horizontal)
  HIT_STUN: 0.35, // seconds a struck mob cannot attack
};

export const STORAGE_KEY = 'voxel-grove:world:v1';
