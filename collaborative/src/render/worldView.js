// Keeps one merged mesh per chunk in sync with the voxel world. World edits
// only mark chunks dirty; update() (once per frame) rebuilds them, so many
// edits in one frame cost one rebuild per affected chunk.

import { BufferAttribute, BufferGeometry, Group, Mesh, MeshLambertMaterial } from 'three'
import { CHUNK_SIZE } from '../config.js'
import { meshChunk } from './chunkMesher.js'

export function createWorldView({ world, scene, atlas = null, chunkSize = CHUNK_SIZE }) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new RangeError('chunkSize must be a positive integer')
  const group = new Group()
  group.name = 'world-view'
  scene.add(group)

  const material = new MeshLambertMaterial({ map: atlas?.texture ?? null, vertexColors: true })
  const uvFor = atlas?.uvFor
  const columns = Math.ceil(world.size / chunkSize)
  const chunks = createChunkGrid(columns)
  const dirty = new Set()
  const liveGeometries = new Set()
  let disposed = false

  const chunkKey = (cx, cz) => cz * columns + cx

  function markColumn(x, z) {
    if (x < 0 || z < 0 || x >= world.size || z >= world.size) return
    dirty.add(chunkKey(Math.floor(x / chunkSize), Math.floor(z / chunkSize)))
  }

  // Culling and AO read the eight surrounding columns, so an edit can change
  // the mesh of every chunk touching the 3x3 columns around it.
  function markAround(x, z) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) markColumn(x + dx, z + dz)
    }
  }

  function markAll() {
    for (const key of chunks.keys()) dirty.add(key)
  }

  const unsubscribe = world.subscribe((event) => {
    if (event.type === 'block') markAround(event.x, event.z)
    else if (event.type === 'reset') markAll()
  })

  function trackGeometry(geometry) {
    liveGeometries.add(geometry)
    geometry.addEventListener('dispose', () => liveGeometries.delete(geometry))
    return geometry
  }

  function addMesh(chunk, geometry) {
    const mesh = new Mesh(geometry, material)
    mesh.name = `chunk:${chunk.cx},${chunk.cz}`
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    group.add(mesh)
    return mesh
  }

  function removeMesh(chunk) {
    if (!chunk.mesh) return
    group.remove(chunk.mesh)
    chunk.mesh.geometry.dispose()
    chunk.mesh = null
  }

  function rebuildChunk(chunk) {
    const data = meshChunk(world, chunk.cx * chunkSize, chunk.cz * chunkSize, chunkSize, uvFor)
    if (data.faceCount === 0) return removeMesh(chunk)
    const geometry = trackGeometry(createChunkGeometry(data))
    if (!chunk.mesh) {
      chunk.mesh = addMesh(chunk, geometry)
      return
    }
    const previous = chunk.mesh.geometry
    chunk.mesh.geometry = geometry
    previous.dispose()
  }

  // Rebuild every dirty chunk; returns how many were rebuilt.
  function update() {
    if (disposed || dirty.size === 0) return 0
    const keys = [...dirty]
    dirty.clear()
    for (const key of keys) rebuildChunk(chunks.get(key))
    return keys.length
  }

  function rebuildAll() {
    markAll()
    return update()
  }

  function dispose() {
    if (disposed) return
    disposed = true
    unsubscribe()
    for (const chunk of chunks.values()) removeMesh(chunk)
    dirty.clear()
    material.dispose()
    scene.remove(group)
  }

  rebuildAll()

  return {
    group,
    material,
    update,
    rebuildAll,
    dispose,
    // Chunk-grid coordinates of every chunk waiting for a rebuild.
    dirtyChunks() {
      return [...dirty].sort((a, b) => a - b).map((key) => ({ cx: key % columns, cz: Math.floor(key / columns) }))
    },
    meshAt(cx, cz) {
      return chunks.get(chunkKey(cx, cz))?.mesh ?? null
    },
    get chunkCount() {
      return chunks.size
    },
    get meshCount() {
      return group.children.length
    },
    get geometryCount() {
      return liveGeometries.size
    },
  }
}

function createChunkGrid(columns) {
  const chunks = new Map()
  for (let cz = 0; cz < columns; cz++) {
    for (let cx = 0; cx < columns; cx++) chunks.set(cz * columns + cx, { cx, cz, mesh: null })
  }
  return chunks
}

function createChunkGeometry({ positions, normals, uvs, colors, indices }) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  return geometry
}
