// A fixed-capacity particle pool backed by typed arrays and drawn with one InstancedMesh.

import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { isFinitePoint } from '../core/geometry.js'
import { TAU, clamp } from '../core/math.js'
import { createRng } from '../core/rng.js'

export const PARTICLE_CAPACITY = 384

export const BURST_DEFAULTS = Object.freeze({
  speed: 2.6, // m/s of the outward kick
  size: 0.11, // cube edge length
  lifetime: 0.7, // seconds (each particle varies ±25 %)
  gravity: 16, // m/s², negative values float upward
  spread: 0.3, // half-extent of the spawn volume
  upward: 2.2, // extra upward kick
  variation: 0.14, // ± brightness jitter per particle
})
const DRAG = 1.1 // 1/s air drag
const GROW_TIME = 0.06 // particles pop in over this many seconds
const SHRINK_FROM = 0.6 // fraction of life after which they shrink away

const FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 'size', 'rx', 'ry', 'wx', 'wy', 'gravity', 'r', 'g', 'b']

function burstOptions(options) {
  const merged = { ...BURST_DEFAULTS }
  for (const key of Object.keys(BURST_DEFAULTS)) {
    if (Number.isFinite(options?.[key])) merged[key] = options[key]
  }
  merged.size = Math.max(merged.size, 0.005)
  merged.lifetime = Math.max(merged.lifetime, 0.05)
  return merged
}

// Uniformly distributed unit vector.
export function randomDirection(rng) {
  const z = rng.range(-1, 1)
  const angle = rng.range(0, TAU)
  const r = Math.sqrt(1 - z * z)
  return { x: r * Math.cos(angle), y: z, z: r * Math.sin(angle) }
}

// Cube edge length over a particle's life: quick pop-in, hold, shrink away.
export function particleScale(age, life, size) {
  if (!(life > 0) || age >= life) return 0
  const grow = Math.min(1, 0.5 + (0.5 * age) / GROW_TIME)
  const shrink = Math.min(1, (1 - age / life) / (1 - SHRINK_FROM))
  return size * grow * shrink
}

// Simulation (pure)

// Fixed-capacity pool of cube particles in struct-of-arrays form. Free slots
// are reused first; when every slot is live the oldest particle is recycled.
// Motion uses the closed-form solution for gravity + linear drag, so results
// are identical for any frame rate. An optional world makes debris land on
// (and settle onto) solid blocks instead of falling through the terrain.
export function createParticleSystem(capacity = PARTICLE_CAPACITY, { seed = 0x5eed, world = null } = {}) {
  const size = capacity >= 1 && Number.isFinite(capacity) ? Math.floor(capacity) : PARTICLE_CAPACITY
  const data = Object.fromEntries(FIELDS.map((field) => [field, new Float32Array(size)]))
  const born = new Float64Array(size)
  const alive = new Uint8Array(size)
  const rng = createRng(seed)
  const color = new Color()
  let free = []
  let live = 0
  let serial = 0

  function clear() {
    alive.fill(0)
    free = Array.from({ length: size }, (_, i) => size - 1 - i)
    live = 0
  }

  function oldestSlot() {
    let best = 0
    for (let i = 1; i < size; i++) if (born[i] < born[best]) best = i
    return best
  }

  function claimSlot() {
    if (free.length) {
      live++
      return free.pop()
    }
    return oldestSlot()
  }

  // p: { x, y, z, vx, vy, vz, life, size, gravity, color (hex), brightness, spin }.
  // Returns the slot index, or -1 for an invalid particle.
  function spawn(p) {
    if (!isFinitePoint(p) || !(p.life > 0) || !(p.size > 0)) return -1
    const i = claimSlot()
    const d = data
    alive[i] = 1
    born[i] = serial++
    d.px[i] = p.x
    d.py[i] = p.y
    d.pz[i] = p.z
    d.vx[i] = p.vx ?? 0
    d.vy[i] = p.vy ?? 0
    d.vz[i] = p.vz ?? 0
    d.age[i] = 0
    d.life[i] = p.life
    d.size[i] = p.size
    d.gravity[i] = p.gravity ?? BURST_DEFAULTS.gravity
    d.rx[i] = rng.range(0, TAU)
    d.ry[i] = rng.range(0, TAU)
    d.wx[i] = rng.range(-1, 1) * (p.spin ?? 8)
    d.wy[i] = rng.range(-1, 1) * (p.spin ?? 8)
    writeColor(i, p.color ?? 0xffffff, p.brightness ?? 1)
    return i
  }

  // Hex colours are sRGB; Color converts them to the linear working space.
  function writeColor(i, hex, brightness) {
    color.setHex(hex)
    data.r[i] = color.r * brightness
    data.g[i] = color.g * brightness
    data.b[i] = color.b * brightness
  }

  // Explosion of `count` cubes around `position`; returns how many spawned.
  function burst(position, hex, count, options = {}) {
    const total = Number.isFinite(count) ? clamp(Math.floor(count), 0, size) : 0
    if (!isFinitePoint(position) || total === 0) return 0
    const o = burstOptions(options)
    for (let n = 0; n < total; n++) {
      const dir = randomDirection(rng)
      const offset = rng.range(0, o.spread)
      const speed = o.speed * rng.range(0.45, 1)
      spawn({
        x: position.x + dir.x * offset,
        y: position.y + dir.y * offset,
        z: position.z + dir.z * offset,
        vx: dir.x * speed,
        vy: dir.y * speed + o.upward * rng.range(0.4, 1),
        vz: dir.z * speed,
        life: o.lifetime * rng.range(0.75, 1.25),
        size: o.size * rng.range(0.7, 1.3),
        gravity: o.gravity,
        color: hex,
        brightness: 1 + rng.range(-o.variation, o.variation),
      })
    }
    return total
  }

  function kill(i) {
    alive[i] = 0
    free.push(i)
    live--
  }

  // Exact integration of v' = -g·ŷ - DRAG·v over dt.
  function integrate(i, dt) {
    const d = data
    const decay = Math.exp(-DRAG * dt)
    const reach = (1 - decay) / DRAG
    const terminal = -d.gravity[i] / DRAG
    d.px[i] += d.vx[i] * reach
    d.pz[i] += d.vz[i] * reach
    d.py[i] += terminal * dt + (d.vy[i] - terminal) * reach
    d.vx[i] *= decay
    d.vz[i] *= decay
    d.vy[i] = terminal + (d.vy[i] - terminal) * decay
    d.rx[i] += d.wx[i] * dt
    d.ry[i] += d.wy[i] * dt
  }

  // Debris landing on a block top bounces softly and settles; hitting a wall
  // stops the sideways motion.
  function collide(i, prevX, prevY, prevZ) {
    const d = data
    const half = d.size[i] / 2
    const cx = Math.floor(d.px[i])
    const cy = Math.floor(d.py[i] - half)
    const cz = Math.floor(d.pz[i])
    if (!world.isSolid(cx, cy, cz)) return
    if (Math.floor(prevY - half) > cy && d.vy[i] <= 0) {
      d.py[i] = cy + 1 + half
      d.vy[i] *= -0.25
      d.vx[i] *= 0.5
      d.vz[i] *= 0.5
      d.wx[i] *= 0.5
      d.wy[i] *= 0.5
      return
    }
    d.px[i] = prevX
    d.py[i] = prevY
    d.pz[i] = prevZ
    d.vx[i] = 0
    d.vz[i] = 0
  }

  function step(dt) {
    if (!Number.isFinite(dt) || dt < 0) return
    const d = data
    for (let i = 0; i < size; i++) {
      if (!alive[i]) continue
      d.age[i] += dt
      if (d.age[i] >= d.life[i]) {
        kill(i)
        continue
      }
      const prevX = d.px[i]
      const prevY = d.py[i]
      const prevZ = d.pz[i]
      integrate(i, dt)
      if (world) collide(i, prevX, prevY, prevZ)
    }
  }

  // Visits live particles: fn(index, data) — used to fill instance buffers.
  function forEachLive(fn) {
    for (let i = 0; i < size; i++) if (alive[i]) fn(i, data)
  }

  clear()
  return {
    capacity: size,
    spawn,
    burst,
    step,
    clear,
    forEachLive,
    get count() {
      return live
    },
  }
}

// Drawing

// One unculled, dynamic InstancedMesh holding every live particle of `system`.
// sync() copies the pool into the instance buffers (call once per frame).
export function createParticleMesh(system) {
  const capacity = system.capacity
  const material = new MeshLambertMaterial({ color: 0xffffff })
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, capacity)
  mesh.name = 'effects:particles'
  mesh.frustumCulled = false
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  mesh.instanceColor.setUsage(DynamicDrawUsage)
  mesh.count = 0

  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const euler = new Euler()
  const scale = new Vector3()

  function sync() {
    let n = 0
    const colors = mesh.instanceColor.array
    system.forEachLive((i, d) => {
      const s = particleScale(d.age[i], d.life[i], d.size[i])
      position.set(d.px[i], d.py[i], d.pz[i])
      rotation.setFromEuler(euler.set(d.rx[i], d.ry[i], 0))
      matrix.compose(position, rotation, scale.set(s, s, s))
      mesh.setMatrixAt(n, matrix)
      colors[n * 3] = d.r[i]
      colors[n * 3 + 1] = d.g[i]
      colors[n * 3 + 2] = d.b[i]
      n++
    })
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
  }

  function dispose() {
    mesh.geometry.dispose()
    mesh.material.dispose()
    mesh.dispose()
  }

  return { mesh, sync, dispose }
}
