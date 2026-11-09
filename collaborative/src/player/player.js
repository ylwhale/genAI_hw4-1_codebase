// Player state and camera orientation. Movement lives in playerController.js.

import { PLAYER, WORLD_SIZE } from '../config.js'
import { bodyBox, horizontalDirection, isFinitePoint, lookDirection } from '../core/geometry.js'
import { clamp, wrapAngle, yawFromDirection } from '../core/math.js'
import { createHealth } from './health.js'

export const MAX_PITCH = Math.PI / 2 - 0.01 // just short of straight up/down
const WORLD_CENTRE = Object.freeze({ x: WORLD_SIZE / 2, y: 0, z: WORLD_SIZE / 2 })

export function createPlayer(spawn) {
  const player = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    width: PLAYER.width,
    height: PLAYER.height,
    eyeHeight: PLAYER.eyeHeight,
    yaw: 0,
    pitch: 0,
    onGround: false,
    health: createHealth(),
  }
  resetPlayer(player, spawn)
  return player
}

// Put the player at `spawn`, at rest, level and at full health. The position
// object is updated in place, so `spawn` may be player.position itself and
// references held elsewhere stay valid. Yaw defaults to facing `lookAt`.
export function resetPlayer(player, spawn, { yaw, lookAt = WORLD_CENTRE } = {}) {
  assertPoint(spawn)
  player.position.x = spawn.x
  player.position.y = spawn.y
  player.position.z = spawn.z
  player.velocity.x = 0
  player.velocity.y = 0
  player.velocity.z = 0
  player.onGround = false
  player.pitch = 0
  player.yaw = wrapAngle(Number.isFinite(yaw) ? yaw : yawToward(spawn, lookAt))
  player.health.reset()
}

// Yaw that faces horizontally from `from` toward `to` (0 when they coincide).
export function yawToward(from, to) {
  if (!from || !to) return 0
  const direction = horizontalDirection(from, to)
  return direction.length > 0 ? yawFromDirection(direction.x, direction.z) : 0
}

export function eyePosition(player) {
  const { x, y, z } = player.position
  return { x, y: y + player.eyeHeight, z }
}

export function viewDirection(player) {
  return lookDirection(player.yaw, player.pitch)
}

export function playerBox(player) {
  return bodyBox(player.position, player.width, player.height)
}

// Mouse right turns right (yaw decreases, toward +X from the default -Z view)
// and mouse down looks down. Each axis ignores a non-finite delta on its own.
// Yaw stays wrapped in [-PI, PI) so long sessions never lose float precision.
export function applyLook(player, dx, dy, sensitivity = PLAYER.lookSensitivity) {
  if (!Number.isFinite(sensitivity)) return
  if (Number.isFinite(dx)) player.yaw = wrapAngle(player.yaw - dx * sensitivity)
  if (Number.isFinite(dy)) player.pitch = clamp(player.pitch - dy * sensitivity, -MAX_PITCH, MAX_PITCH)
}

function assertPoint(point) {
  if (!isFinitePoint(point)) throw new TypeError('Player spawn must be a finite {x, y, z} point')
}
