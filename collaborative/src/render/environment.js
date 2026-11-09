// Sky, fog, lighting, decorative sea, and clouds.
// The sky follows the camera; only the sea and clouds animate.

import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { TERRAIN, WORLD_HEIGHT, WORLD_SEED, WORLD_SIZE } from '../config.js'
import { clamp01, lerp, smoothstep } from '../core/math.js'
import { createRng, deriveSeed } from '../core/rng.js'
import { RENDER_ORDER } from './renderOrder.js'
import { TILE_SIZE, createPixelTexture, generateSunPixels, generateWaterPixels } from './textures.js'

export const SKY = Object.freeze({ zenith: 0x5b9be6, horizon: 0xc4e0f4, glow: 0xffe2a6, radius: 250 })
export const FOG_RANGE = Object.freeze({ near: 40, far: 170 })
export const SUN_DIRECTION = Object.freeze(normalize({ x: 0.45, y: 0.8, z: 0.4 })) // toward the sun
export const SHADOW = Object.freeze({ mapSize: 2048, bias: -0.0005, normalBias: 0.03, margin: 1, distance: 64 })
export const CLOUDS = Object.freeze({
  count: 26, // clusters of 1-3 slabs
  span: 360, // side of the square field the clouds wrap around
  cell: 4, // grid that slab positions and sizes snap to
  above: 18, // altitude above the world height
  speed: 0.9, // wind drift along +X, units per second
  thickness: 3,
  emissive: 0x8090a8, // keeps undersides a soft blue-grey instead of murky
})

const LIGHT = Object.freeze({
  sunColor: 0xfff1d8,
  sunIntensity: 2.6,
  skyColor: 0xbcd6ff,
  groundColor: 0x7a6a50,
  skyIntensity: 1.8,
  ambientIntensity: 0.6,
})
const SUN_DISC = Object.freeze({ distance: 235, size: 28 })
const SEA = Object.freeze({
  rings: [0, 1.5, 4, 9, 18, 36, 72, 130, 220], // band edges, in units beyond the shore
  tileWorld: 2, // world units covered by one water tile
  bedY: 0.02,
  bob: 0.03,
  foamWidth: 0.8,
  foamLift: 0.02,
})
const SAND = new Color(0xc9b88a)
const DEEP_BED = new Color(0x2a5563)

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// The horizon (and everything below it) is exactly the fog colour, so fogged
// terrain and the distant sea blend seamlessly into the sky.
const SKY_FRAGMENT = /* glsl */ `
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 glowColor;
uniform vec3 sunDirection;
varying vec3 vDirection;
void main() {
  vec3 direction = normalize(vDirection);
  float height = max(direction.y, 0.0);
  vec3 color = mix(horizonColor, zenithColor, pow(height, 0.6));
  float facing = max(dot(direction, sunDirection), 0.0);
  float glow = pow(facing, 48.0) * 0.45 + pow(facing, 6.0) * 0.12;
  color += glowColor * glow * smoothstep(0.0, 0.25, direction.y);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function createEnvironment(
  scene,
  { size = WORLD_SIZE, height = WORLD_HEIGHT, seaLevel = TERRAIN.seaLevel } = {},
) {
  const resources = []
  const own = (resource) => {
    resources.push(resource)
    return resource
  }

  const root = new Group()
  root.name = 'environment'
  const sky = createSky(own)
  const lights = createLights(size, height)
  const sea = createSea(size, seaLevel, own)
  const clouds = createClouds(size, height, own)
  root.add(sky.group, ...lights.objects, sea.group, clouds.mesh)
  scene.add(root)

  const previousFog = scene.fog ?? null
  const fog = new Fog(SKY.horizon, FOG_RANGE.near, FOG_RANGE.far)
  scene.fog = fog
  let elapsed = 0
  let disposed = false

  // The sky follows the camera every call; animation only advances on a
  // valid (finite, positive) dt.
  function update(dt, cameraPosition) {
    if (disposed) return
    if (cameraPosition) sky.follow(cameraPosition)
    if (!Number.isFinite(dt) || dt <= 0) return
    elapsed += dt
    sea.animate(elapsed)
    clouds.animate(elapsed)
  }

  function dispose() {
    if (disposed) return
    disposed = true
    scene.remove(root)
    if (scene.fog === fog) scene.fog = previousFog
    lights.sun.shadow.dispose()
    for (const resource of resources) resource.dispose()
  }

  return {
    update,
    dispose,
    group: root,
    fog,
    sun: lights.sun,
    hemisphere: lights.hemisphere,
    ambient: lights.ambient,
    sky: sky.dome,
    sunDisc: sky.disc,
    sea: sea.water,
    seabed: sea.seabed,
    foam: sea.foam,
    clouds: clouds.mesh,
    sunDirection: { ...SUN_DIRECTION },
    get elapsed() {
      return elapsed
    },
  }
}


// Sky and sun

function createSky(own) {
  const group = new Group()
  group.name = 'sky'
  const dome = new Mesh(own(new SphereGeometry(SKY.radius, 32, 16)), own(createSkyMaterial()))
  dome.name = 'sky-dome'
  const sunTexture = own(createPixelTexture(generateSunPixels(), TILE_SIZE, TILE_SIZE))
  const disc = new Mesh(own(new PlaneGeometry(SUN_DISC.size, SUN_DISC.size)), own(createSunMaterial(sunTexture)))
  disc.name = 'sun-disc'
  disc.position.set(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).multiplyScalar(SUN_DISC.distance)
  disc.lookAt(0, 0, 0) // face the camera at the group's origin
  for (const mesh of [dome, disc]) asBackdrop(mesh)
  group.add(dome, disc)
  return { group, dome, disc, follow: (p) => group.position.set(p.x, p.y, p.z) }
}

function createSkyMaterial() {
  return new ShaderMaterial({
    uniforms: {
      zenithColor: { value: new Color(SKY.zenith) },
      horizonColor: { value: new Color(SKY.horizon) },
      glowColor: { value: new Color(SKY.glow) },
      sunDirection: { value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z) },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
}

// Additive so the stepped halo brightens the sky; depth-tested so terrain and
// clouds still hide it.
function createSunMaterial(map) {
  return new MeshBasicMaterial({
    map,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
}

function asBackdrop(mesh) {
  mesh.frustumCulled = false
  mesh.renderOrder = RENDER_ORDER.backdrop
  mesh.castShadow = false
  mesh.receiveShadow = false
}


// Lighting

function createLights(size, height) {
  const hemisphere = new HemisphereLight(LIGHT.skyColor, LIGHT.groundColor, LIGHT.skyIntensity)
  const ambient = new AmbientLight(0xffffff, LIGHT.ambientIntensity)
  const sun = new DirectionalLight(LIGHT.sunColor, LIGHT.sunIntensity)
  sun.name = 'sun'
  const centre = new Vector3(size / 2, height / 2, size / 2)
  const towardSun = new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z)
  sun.target.position.copy(centre)
  sun.position.copy(centre).addScaledVector(towardSun, SHADOW.distance)
  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize)
  sun.shadow.bias = SHADOW.bias
  sun.shadow.normalBias = SHADOW.normalBias
  fitShadowCamera(sun.shadow.camera, sun.position, sun.target.position, worldCorners(size, height))
  return { hemisphere, ambient, sun, objects: [hemisphere, ambient, sun, sun.target] }
}

function worldCorners(size, height) {
  const corners = []
  for (const x of [0, size]) {
    for (const y of [0, height]) {
      for (const z of [0, size]) corners.push(new Vector3(x, y, z))
    }
  }
  return corners
}

// Fit an orthographic shadow camera looking from `from` to `to` tightly around
// the given points (plus a small margin), matching how three.js aims it.
export function fitShadowCamera(camera, from, to, points, margin = SHADOW.margin) {
  camera.position.copy(from)
  camera.lookAt(to)
  camera.updateMatrixWorld(true)
  const bounds = new Box3()
  const local = new Vector3()
  for (const point of points) bounds.expandByPoint(local.copy(point).applyMatrix4(camera.matrixWorldInverse))
  camera.left = bounds.min.x - margin
  camera.right = bounds.max.x + margin
  camera.bottom = bounds.min.y - margin
  camera.top = bounds.max.y + margin
  camera.near = Math.max(0.1, -bounds.max.z - margin)
  camera.far = -bounds.min.z + margin
  camera.updateProjectionMatrix()
  return camera
}


// Decorative sea: translucent scrolling water, pulsing shore foam, and a sandy
// bed fading to deep blue. Only outside the island footprint.

function createSea(size, seaLevel, own) {
  const group = new Group()
  group.name = 'sea'
  const texture = own(
    createPixelTexture(generateWaterPixels(), TILE_SIZE, TILE_SIZE, { repeat: true, mipmaps: true }),
  )
  const water = new Mesh(own(createShoreRingGeometry(size, SEA.rings, waterTint)), own(createWaterMaterial(texture)))
  const foam = new Mesh(own(createShoreRingGeometry(size, [0, SEA.foamWidth], foamTint)), own(createFoamMaterial()))
  const seabed = new Mesh(
    own(createShoreRingGeometry(size, SEA.rings, seabedTint)),
    own(new MeshLambertMaterial({ vertexColors: true })),
  )
  water.name = 'sea-water'
  foam.name = 'sea-foam'
  seabed.name = 'seabed'
  water.renderOrder = RENDER_ORDER.seaWater
  foam.renderOrder = RENDER_ORDER.seaFoam
  seabed.position.y = SEA.bedY
  for (const mesh of [water, foam, seabed]) {
    mesh.castShadow = false
    mesh.receiveShadow = false
  }
  group.add(seabed, water, foam)

  function animate(time) {
    texture.offset.set((time * 0.02) % 1, (time * 0.013) % 1)
    water.position.y = seaLevel + Math.sin(time * 0.9) * SEA.bob
    foam.position.y = water.position.y + SEA.foamLift
    foam.material.opacity = 0.6 + Math.sin(time * 1.7) * 0.25
  }

  animate(0)
  return { group, water, foam, seabed, animate }
}

function createWaterMaterial(map) {
  return new MeshPhongMaterial({ map, vertexColors: true, transparent: true, specular: 0x9fb8cc, shininess: 60 })
}

function createFoamMaterial() {
  return new MeshBasicMaterial({
    color: 0xeef8ff,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
}

// Shallow water near the shore is clearer and a little greener.
function waterTint(distance) {
  const t = smoothstep(0, 14, distance)
  return [lerp(0.86, 0.74, t), lerp(1, 0.86, t), 1, lerp(0.5, 0.93, t)]
}

function foamTint(distance) {
  return [1, 1, 1, distance === 0 ? 0.85 : 0]
}

function seabedTint(distance) {
  const color = SAND.clone().lerp(DEEP_BED, smoothstep(0, 20, distance))
  return [color.r, color.g, color.b]
}

// Flat square annulus around the footprint [0, size]^2, built from concentric
// bands at `distances` beyond the shore so per-vertex tints can vary with
// distance. `tint(distance)` returns RGB or RGBA. Faces point up (+Y); UVs are
// world-space so the water texture tiles evenly.
export function createShoreRingGeometry(size, distances, tint) {
  const positions = []
  const uvs = []
  const colors = []
  const indices = []
  for (let band = 0; band < distances.length - 1; band++) {
    const inner = squareCorners(size, distances[band])
    const outer = squareCorners(size, distances[band + 1])
    for (let side = 0; side < 4; side++) {
      const next = (side + 1) % 4
      const base = positions.length / 3
      const near = distances[band]
      const far = distances[band + 1]
      const quad = [[inner[side], near], [inner[next], near], [outer[next], far], [outer[side], far]]
      for (const [corner, distance] of quad) {
        positions.push(corner.x, 0, corner.z)
        uvs.push(corner.x / SEA.tileWorld, corner.z / SEA.tileWorld)
        colors.push(...tint(distance))
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
  const vertexCount = positions.length / 3
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(upNormals(vertexCount), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), colors.length / vertexCount))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function upNormals(count) {
  const normals = new Float32Array(count * 3)
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1
  return normals
}

// Corners of the footprint grown by `d`, in the winding order the bands need.
function squareCorners(size, d) {
  return [
    { x: -d, z: -d },
    { x: size + d, z: -d },
    { x: size + d, z: size + d },
    { x: -d, z: size + d },
  ]
}


// Clouds: flat slabs on a coarse grid, one instanced draw call, drifting on the
// wind and wrapping around a wide square; they shrink away near its edge so
// the wrap never pops into view.

function createClouds(size, height, own) {
  const centre = size / 2
  const boxes = generateCloudLayout({ centre, altitude: height + CLOUDS.above })
  const material = own(new MeshLambertMaterial({ color: 0xffffff, emissive: CLOUDS.emissive }))
  const mesh = own(new InstancedMesh(own(new BoxGeometry(1, 1, 1)), material, boxes.length))
  mesh.name = 'clouds'
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false

  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const rotation = new Quaternion()

  function animate(time) {
    const drift = time * CLOUDS.speed
    boxes.forEach((box, i) => {
      const x = wrapAround(box.x + drift, centre, CLOUDS.span)
      const fade = Math.max(edgeFade(x - centre) * edgeFade(box.z - centre), 1e-3)
      position.set(x, box.y, box.z)
      scale.set(box.width * fade, box.thickness * fade, box.depth * fade)
      mesh.setMatrixAt(i, matrix.compose(position, rotation, scale))
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  animate(0)
  return { mesh, boxes, animate }
}

// Deterministic cloud slabs: { x, y, z, width, thickness, depth } (centres).
export function generateCloudLayout({
  seed = deriveSeed(WORLD_SEED, 'clouds'),
  centre = WORLD_SIZE / 2,
  altitude = WORLD_HEIGHT + CLOUDS.above,
  span = CLOUDS.span,
  count = CLOUDS.count,
} = {}) {
  const rng = createRng(seed)
  const boxes = []
  for (let i = 0; i < count; i++) {
    const x = centre + rng.range(-span / 2, span / 2)
    const z = centre + rng.range(-span / 2, span / 2)
    const puffs = rng.int(1, 3)
    for (let p = 0; p < puffs; p++) boxes.push(cloudPuff(rng, x, z, altitude, p === 0))
  }
  return boxes
}

// One slab of a cloud; secondary slabs are thinner so faces never coincide.
function cloudPuff(rng, x, z, altitude, main) {
  const { cell } = CLOUDS
  return {
    x: snap(x + rng.int(-2, 2) * cell, cell),
    y: altitude,
    z: snap(z + rng.int(-2, 2) * cell, cell),
    width: rng.int(main ? 4 : 2, main ? 8 : 5) * cell,
    thickness: main ? CLOUDS.thickness : CLOUDS.thickness * 0.75,
    depth: rng.int(main ? 3 : 2, main ? 6 : 4) * cell,
  }
}

function wrapAround(value, centre, span) {
  const min = centre - span / 2
  return min + ((((value - min) % span) + span) % span)
}

// 1 across most of the cloud field, falling to 0 over its outer 30 %.
function edgeFade(offset) {
  const t = Math.abs(offset) / (CLOUDS.span / 2)
  return clamp01((1 - t) / 0.3)
}


// Small math helpers

function normalize({ x, y, z }) {
  const length = Math.hypot(x, y, z)
  return { x: x / length, y: y / length, z: z / length }
}

function snap(value, step) {
  return Math.round(value / step) * step
}
