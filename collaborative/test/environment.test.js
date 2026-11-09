import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AmbientLight,
  BackSide,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  OrthographicCamera,
  Scene,
  Vector3,
} from 'three'
import {
  CLOUDS,
  FOG_RANGE,
  SHADOW,
  SKY,
  SUN_DIRECTION,
  createEnvironment,
  createShoreRingGeometry,
  fitShadowCamera,
  generateCloudLayout,
} from '../src/render/environment.js'
import { CAMERA, measureViewport, pixelRatioFor } from '../src/render/renderer.js'
import { TERRAIN, WORLD_HEIGHT, WORLD_SIZE } from '../src/config.js'

function setup(options) {
  const scene = new Scene()
  const env = createEnvironment(scene, options)
  return { scene, env }
}

function worldCorners(size = WORLD_SIZE, height = WORLD_HEIGHT) {
  const corners = []
  for (const x of [0, size]) for (const y of [0, height]) for (const z of [0, size]) corners.push(new Vector3(x, y, z))
  return corners
}

// Triangles of an indexed, non-transformed geometry as [{x, z}] triples.
function triangles(geometry) {
  const position = geometry.attributes.position
  const index = geometry.index.array
  const result = []
  for (let i = 0; i < index.length; i += 3) {
    const point = (k) => ({ x: position.getX(index[i + k]), y: position.getY(index[i + k]), z: position.getZ(index[i + k]) })
    result.push([point(0), point(1), point(2)])
  }
  return result
}

const average = (points) => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
})
const centroid = (triangle) => average(triangle)
const edgeMidpoints = ([a, b, c]) => [average([a, b]), average([b, c]), average([c, a])]

function pointInTriangle(p, [a, b, c]) {
  const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.z - p3.z) - (p2.x - p3.x) * (p1.z - p3.z)
  const d1 = sign(p, a, b)
  const d2 = sign(p, b, c)
  const d3 = sign(p, c, a)
  const negative = d1 < 0 || d2 < 0 || d3 < 0
  const positive = d1 > 0 || d2 > 0 || d3 > 0
  return !(negative && positive)
}

function instancePositions(mesh) {
  const matrix = new Matrix4()
  const position = new Vector3()
  const result = []
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix)
    result.push(position.setFromMatrixPosition(matrix).clone())
  }
  return result
}

test('sky dome is a camera-following backdrop inside the camera far plane', () => {
  const { env } = setup()
  const { sky } = env
  const { radius } = sky.geometry.parameters
  assert.equal(radius, SKY.radius)
  assert.ok(radius < CAMERA.far, 'dome fits inside the far plane')
  assert.equal(sky.material.side, BackSide)
  assert.equal(sky.material.fog, false)
  assert.equal(sky.material.depthWrite, false)
  assert.equal(sky.frustumCulled, false)
  assert.equal(sky.renderOrder, -1)
  assert.equal(sky.receiveShadow, false)
  assert.equal(sky.castShadow, false)

  env.update(1 / 60, { x: 10, y: 20, z: -5 })
  const centre = sky.getWorldPosition(new Vector3())
  assert.deepEqual(centre.toArray(), [10, 20, -5])
})

test('sun disc shares the backdrop flags and sits in the sun light direction', () => {
  const { env } = setup()
  const { sunDisc, sun } = env
  assert.equal(sunDisc.material.fog, false)
  assert.equal(sunDisc.material.depthWrite, false)
  assert.equal(sunDisc.material.depthTest, true, 'terrain still hides the sun')
  assert.equal(sunDisc.frustumCulled, false)
  assert.equal(sunDisc.renderOrder, -1)

  const toDisc = sunDisc.position.clone().normalize()
  const toSun = sun.position.clone().sub(sun.target.position).normalize()
  assert.ok(toDisc.distanceTo(toSun) < 1e-6, 'disc and light agree on where the sun is')
  assert.ok(sunDisc.position.length() < SKY.radius, 'inside the dome')
  const facing = new Vector3(0, 0, 1).applyQuaternion(sunDisc.quaternion)
  assert.ok(facing.dot(toDisc) < -0.999, 'disc faces the camera at the dome centre')
  assert.ok(Math.abs(Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z) - 1) < 1e-9)
  assert.ok(SUN_DIRECTION.y > 0.5, 'a high, mid-morning sun')
})

test('fog matches the sky horizon colour and fades before the dome', () => {
  const { scene, env } = setup()
  assert.ok(scene.fog instanceof Fog)
  assert.equal(scene.fog, env.fog)
  assert.ok(scene.fog.color.equals(env.sky.material.uniforms.horizonColor.value))
  assert.equal(scene.fog.near, FOG_RANGE.near)
  assert.equal(scene.fog.far, FOG_RANGE.far)
  assert.ok(FOG_RANGE.near > WORLD_SIZE, 'the island itself stays crisp')
  assert.ok(FOG_RANGE.far < SKY.radius)
})

test('lighting: warm shadow-casting sun, cool hemisphere fill, soft ambient', () => {
  const { env } = setup()
  assert.ok(env.sun instanceof DirectionalLight)
  assert.ok(env.hemisphere instanceof HemisphereLight)
  assert.ok(env.ambient instanceof AmbientLight)
  assert.ok(env.ambient.intensity > 0, 'caves are never pitch black')

  const sunColor = env.sun.color
  assert.ok(sunColor.r >= sunColor.b, 'sun is warm')
  const sky = env.hemisphere.color
  assert.ok(sky.b > sky.r, 'sky fill is cool')

  const { shadow } = env.sun
  assert.equal(env.sun.castShadow, true)
  assert.equal(shadow.mapSize.x, 2048)
  assert.equal(shadow.mapSize.y, 2048)
  assert.equal(shadow.bias, SHADOW.bias)
  assert.ok(Math.abs(shadow.bias + 0.0005) < 1e-9)
  assert.ok(Math.abs(shadow.normalBias - 0.03) < 1e-9)
  assert.ok(shadow.camera instanceof OrthographicCamera)
  assert.ok(env.group.children.includes(env.sun.target), 'target is in the scene so its matrix updates')
})

test('shadow camera encloses the whole world box and is tightly fitted', () => {
  const { scene, env } = setup()
  scene.updateMatrixWorld(true)
  const { sun } = env
  // Re-aim the camera exactly the way three.js does before each shadow pass.
  const camera = sun.shadow.camera
  camera.position.setFromMatrixPosition(sun.matrixWorld)
  camera.lookAt(new Vector3().setFromMatrixPosition(sun.target.matrixWorld))
  camera.updateMatrixWorld(true)

  const local = worldCorners().map((corner) => corner.clone().applyMatrix4(camera.matrixWorldInverse))
  for (const corner of worldCorners()) {
    const ndc = corner.clone().project(camera)
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(ndc[axis]) <= 1, `corner ${corner.toArray()} inside on ${axis}`)
  }
  const spanX = Math.max(...local.map((p) => p.x)) - Math.min(...local.map((p) => p.x))
  const spanY = Math.max(...local.map((p) => p.y)) - Math.min(...local.map((p) => p.y))
  assert.ok(camera.right - camera.left <= spanX + 2 * SHADOW.margin + 1e-6, 'no wasted width')
  assert.ok(camera.top - camera.bottom <= spanY + 2 * SHADOW.margin + 1e-6, 'no wasted height')
  assert.ok(camera.near > 0)
})

test('fitShadowCamera handles arbitrary boxes and directions', () => {
  const camera = new OrthographicCamera()
  const points = [new Vector3(-3, 0, 2), new Vector3(5, 8, -1), new Vector3(0, 2, 9)]
  fitShadowCamera(camera, new Vector3(-20, 30, 10), new Vector3(1, 3, 3), points, 0.5)
  for (const point of points) {
    const ndc = point.clone().project(camera)
    assert.ok(Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && Math.abs(ndc.z) < 1)
  }
})

test('sea lies only outside the island footprint, at sea level, without shadows', () => {
  const { env } = setup()
  const { sea, seabed, foam } = env
  assert.ok(Math.abs(sea.position.y - TERRAIN.seaLevel) < 1e-9, 'starts exactly at sea level')
  assert.ok(sea.position.y < TERRAIN.minSurface, 'below the lowest terrain surface')
  for (const mesh of [sea, seabed, foam]) {
    assert.equal(mesh.receiveShadow, false, mesh.name)
    assert.equal(mesh.castShadow, false, mesh.name)
  }
  assert.ok(seabed.position.y < sea.position.y)

  for (const mesh of [sea, seabed, foam]) {
    for (const triangle of triangles(mesh.geometry)) {
      for (const p of triangle) assert.equal(p.y, 0, 'flat geometry')
      for (const p of [...triangle, ...edgeMidpoints(triangle), centroid(triangle)]) {
        const inside = p.x > 1e-6 && p.x < WORLD_SIZE - 1e-6 && p.z > 1e-6 && p.z < WORLD_SIZE - 1e-6
        assert.ok(!inside, `${mesh.name} point ${p.x},${p.z} is outside the footprint`)
      }
    }
  }
})

test('sea surrounds the island right up to the shore and far beyond the fog', () => {
  const { env } = setup()
  const tris = triangles(env.sea.geometry)
  const covered = (x, z) => tris.some((t) => pointInTriangle({ x, z }, t))
  const shoreAndBeyond = [[-0.5, 16], [32.5, 16], [16, -0.5], [16, 32.5], [-0.5, -0.5], [32.5, 32.5], [-100, 40]]
  for (const [x, z] of [...shoreAndBeyond, [16, FOG_RANGE.far + 20]]) {
    assert.ok(covered(x, z), `water at ${x},${z}`)
  }
  assert.ok(!covered(16, 16) && !covered(0.5, 0.5) && !covered(31.5, 16), 'no water over the island')
  for (const t of tris) {
    const n = (t[1].z - t[0].z) * (t[2].x - t[0].x) - (t[1].x - t[0].x) * (t[2].z - t[0].z)
    assert.ok(n > 0, 'faces point up')
  }
})

test('shore ring geometry respects custom sizes and per-vertex tints', () => {
  const geometry = createShoreRingGeometry(10, [0, 2, 5], (d) => [d, d, d, 1])
  assert.equal(geometry.attributes.position.count, 2 * 4 * 4)
  assert.equal(geometry.attributes.color.itemSize, 4)
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const x = geometry.attributes.position.getX(i)
    const z = geometry.attributes.position.getZ(i)
    const distance = Math.max(-x, x - 10, -z, z - 10)
    assert.ok(Math.abs(geometry.attributes.color.getX(i) - distance) < 1e-6, 'tint receives distance beyond the shore')
    assert.equal(geometry.attributes.normal.getY(i), 1)
  }
  const rgb = createShoreRingGeometry(10, [0, 1], () => [1, 0, 0])
  assert.equal(rgb.attributes.color.itemSize, 3)
})

test('sea is translucent near the shore and gently animated', () => {
  const { env } = setup()
  const { sea, foam } = env
  assert.equal(sea.material.transparent, true)
  const colors = sea.geometry.attributes.color
  const position = sea.geometry.attributes.position
  let shoreAlpha = 1
  let openAlpha = 0
  for (let i = 0; i < colors.count; i++) {
    const distance = Math.max(-position.getX(i), position.getX(i) - WORLD_SIZE, -position.getZ(i), position.getZ(i) - WORLD_SIZE)
    if (distance === 0) shoreAlpha = Math.min(shoreAlpha, colors.getW(i))
    if (distance > 100) openAlpha = Math.max(openAlpha, colors.getW(i))
  }
  assert.ok(shoreAlpha < openAlpha, 'shallows are clearer than open water')

  const offset = sea.material.map.offset.clone()
  const foamOpacity = foam.material.opacity
  const heights = []
  for (let i = 0; i < 120; i++) {
    env.update(1 / 30)
    heights.push(sea.position.y)
  }
  assert.ok(!sea.material.map.offset.equals(offset), 'water texture scrolls')
  assert.notEqual(foam.material.opacity, foamOpacity, 'foam pulses')
  assert.ok(Math.max(...heights) - Math.min(...heights) > 0.01, 'surface bobs')
  assert.ok(heights.every((y) => Math.abs(y - TERRAIN.seaLevel) <= 0.05), 'but stays at sea level')
  assert.ok(heights.every((y) => y < TERRAIN.minSurface), 'never floods the shore')
})

test('clouds: one instanced, unshadowed draw high above anything buildable', () => {
  const { env } = setup()
  const { clouds } = env
  assert.ok(clouds instanceof InstancedMesh)
  assert.equal(clouds.castShadow, false)
  assert.equal(clouds.receiveShadow, false)
  assert.equal(clouds.frustumCulled, false)
  assert.ok(clouds.count >= CLOUDS.count)
  for (const p of instancePositions(clouds)) assert.ok(p.y > WORLD_HEIGHT + 10, 'above the build limit and the player')
})

test('clouds drift with time, wrap around, and are deterministic', () => {
  const a = setup().env
  const b = setup().env
  assert.deepEqual(instancePositions(a.clouds), instancePositions(b.clouds))
  const start = instancePositions(a.clouds)
  a.update(1)
  const moved = instancePositions(a.clouds)
  const deltas = moved.map((p, i) => p.x - start[i].x)
  assert.ok(deltas.some((d) => Math.abs(d - CLOUDS.speed) < 1e-4), 'slabs drift along +X at the wind speed')

  for (let i = 0; i < 2000; i++) a.update(0.25)
  const half = CLOUDS.span / 2
  for (const p of instancePositions(a.clouds)) assert.ok(Math.abs(p.x - WORLD_SIZE / 2) <= half + 1e-6, 'wrapped inside the field')
})

test('cloud layout is seeded and blocky', () => {
  const layout = generateCloudLayout()
  assert.deepEqual(generateCloudLayout(), layout)
  assert.notDeepEqual(generateCloudLayout({ seed: 7 }), layout)
  for (const box of layout) {
    for (const key of ['x', 'z', 'width', 'depth']) assert.ok(box[key] % CLOUDS.cell === 0, `${key} on the ${CLOUDS.cell}-unit grid`)
    assert.ok(box.thickness > 0)
  }
})

test('update ignores invalid dt but still follows the camera', () => {
  const { env } = setup()
  const clouds = instancePositions(env.clouds)
  const seaY = env.sea.position.y
  for (const dt of [Number.NaN, -1, Number.POSITIVE_INFINITY, undefined, 0]) env.update(dt, { x: 1, y: 2, z: 3 })
  assert.equal(env.elapsed, 0)
  assert.deepEqual(instancePositions(env.clouds), clouds)
  assert.equal(env.sea.position.y, seaY)
  assert.deepEqual(env.sky.getWorldPosition(new Vector3()).toArray(), [1, 2, 3])
  env.update(0.5)
  assert.equal(env.elapsed, 0.5)
})

test('options resize the sea hole and lift the clouds with the world height', () => {
  const { env } = setup({ size: 16, height: 12, seaLevel: 2 })
  assert.equal(env.sea.position.y, 2)
  const tris = triangles(env.sea.geometry)
  assert.ok(tris.some((t) => pointInTriangle({ x: 16.5, z: 8 }, t)), 'water just past a 16-wide island')
  assert.ok(!tris.some((t) => pointInTriangle({ x: 15.5, z: 8 }, t)))
  for (const p of instancePositions(env.clouds)) assert.ok(p.y > 12 && p.y < WORLD_HEIGHT + CLOUDS.above)
})

test('dispose removes everything it added and restores the previous fog', () => {
  const scene = new Scene()
  const previous = new Fog(0x000000, 1, 2)
  scene.fog = previous
  const before = scene.children.length
  const env = createEnvironment(scene)
  assert.equal(scene.children.length, before + 1)
  let disposed = 0
  for (const object of [env.sky, env.sea, env.clouds, env.sunDisc, env.seabed, env.foam]) {
    object.geometry.addEventListener('dispose', () => disposed++)
    object.material.addEventListener('dispose', () => disposed++)
  }
  env.dispose()
  assert.equal(scene.children.length, before)
  assert.equal(scene.fog, previous)
  assert.equal(disposed, 12)
  env.dispose() // idempotent
  env.update(1, { x: 0, y: 0, z: 0 }) // harmless after dispose
})

test('renderer module imports in Node and its sizing helpers are safe', () => {
  assert.deepEqual(CAMERA, { fov: 75, near: 0.05, far: 400 })
  const tinyWindow = { innerWidth: 1, innerHeight: 1 }
  assert.deepEqual(measureViewport({ clientWidth: 800, clientHeight: 600 }, tinyWindow), { width: 800, height: 600 })
  const unlaidOut = { clientWidth: 0, clientHeight: 0 }
  assert.deepEqual(measureViewport(unlaidOut, { innerWidth: 1280, innerHeight: 720 }), { width: 1280, height: 720 })
  assert.deepEqual(measureViewport(null, undefined), { width: 1, height: 1 })
  assert.equal(pixelRatioFor({ devicePixelRatio: 3 }), 2)
  assert.equal(pixelRatioFor({ devicePixelRatio: 1.5 }), 1.5)
  assert.equal(pixelRatioFor({}), 1)
})
