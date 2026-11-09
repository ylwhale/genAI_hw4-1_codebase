// Builds face-culled chunk geometry with vertex ambient occlusion.
// Returns typed arrays, independent of Three.js.

// Brightness for 0..3 occluding neighbours around a vertex (3 = fully tucked in).
export const AO_BRIGHTNESS = Object.freeze([1, 0.8, 0.64, 0.5])

// Gentle fixed face shading so block edges stay readable in flat ambient light.
export const FACE_SHADING = Object.freeze({ top: 1, bottom: 0.74, x: 0.9, z: 0.84 })

const UNIT_UV = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 })

// Tile UV corner for each of a face's four vertices: bottom-left, bottom-right,
// top-right, top-left as seen from outside the block (v = 1 is the tile top).
const CORNER_UVS = [[0, 0], [1, 0], [1, 1], [0, 1]]

// Two triangulations of a quad. The mesher picks the one whose shared diagonal
// joins the brighter pair of corners, so AO gradients stay symmetric.
const SPLIT_02 = [0, 1, 2, 0, 2, 3]
const SPLIT_13 = [0, 1, 3, 1, 2, 3]

// Unit-cube corners per face, counter-clockwise seen from outside.
const FACES = Object.freeze(
  [
    { normal: [1, 0, 0], kind: 'side', shade: FACE_SHADING.x, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
    { normal: [-1, 0, 0], kind: 'side', shade: FACE_SHADING.x, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { normal: [0, 1, 0], kind: 'top', shade: FACE_SHADING.top, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { normal: [0, -1, 0], kind: 'bottom', shade: FACE_SHADING.bottom, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { normal: [0, 0, 1], kind: 'side', shade: FACE_SHADING.z, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { normal: [0, 0, -1], kind: 'side', shade: FACE_SHADING.z, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  ].map(withOccluders),
)

// For every corner, the two edge neighbours and the diagonal neighbour in the
// layer in front of the face; together they decide that vertex's occlusion.
function withOccluders(face) {
  const tangents = [0, 1, 2].filter((axis) => face.normal[axis] === 0)
  const occluders = face.corners.map((corner) => {
    const [side1, side2] = tangents.map((axis) => offsetAlong(face.normal, axis, corner[axis] ? 1 : -1))
    const diagonal = side1.map((value, i) => value + side2[i] - face.normal[i])
    return [side1, side2, diagonal]
  })
  return Object.freeze({ ...face, occluders })
}

function offsetAlong(vector, axis, sign) {
  const result = vector.slice()
  result[axis] += sign
  return result
}

// Mesh columns x0..x0+chunkSize-1, z0..z0+chunkSize-1 (clipped to the world),
// all heights. Positions are in world coordinates. `uvFor(blockId, face)` maps
// a block face to an atlas rectangle {u0, v0, u1, v1}.
export function meshChunk(world, x0, z0, chunkSize, uvFor = () => UNIT_UV) {
  const builder = createMeshBuilder()
  const bounds = chunkBounds(world, x0, z0, chunkSize)
  if (!bounds) return builder.finish()
  const solid = sampleOccupancy(world, bounds)
  for (let y = 0; y < world.height; y++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      for (let x = bounds.xMin; x <= bounds.xMax; x++) {
        if (solid(x, y, z)) emitVisibleFaces(builder, solid, x, y, z, world.getBlock(x, y, z), uvFor)
      }
    }
  }
  return builder.finish()
}

function chunkBounds(world, x0, z0, chunkSize) {
  if (![x0, z0, chunkSize].every(Number.isInteger) || chunkSize <= 0) return null
  const xMin = Math.max(0, x0)
  const zMin = Math.max(0, z0)
  const xMax = Math.min(world.size, x0 + chunkSize) - 1
  const zMax = Math.min(world.size, z0 + chunkSize) - 1
  return xMin <= xMax && zMin <= zMax ? { xMin, xMax, zMin, zMax } : null
}

// Snapshot solidity of the chunk plus a one-cell border (and one layer below
// and above the world), so culling and AO lookups are plain array reads.
function sampleOccupancy(world, { xMin, xMax, zMin, zMax }) {
  const width = xMax - xMin + 3
  const depth = zMax - zMin + 3
  const layers = world.height + 2
  const cells = new Uint8Array(width * depth * layers)
  for (let ly = 0; ly < layers; ly++) {
    for (let lz = 0; lz < depth; lz++) {
      for (let lx = 0; lx < width; lx++) {
        const solid = world.isSolid(xMin + lx - 1, ly - 1, zMin + lz - 1)
        cells[(ly * depth + lz) * width + lx] = solid ? 1 : 0
      }
    }
  }
  return (x, y, z) => cells[((y + 1) * depth + (z - zMin + 1)) * width + (x - xMin + 1)]
}

// A face is visible when the cell in front of it is not solid; faces on the
// world's outer walls are kept, but the floor (y = 0) is never seen from below.
function emitVisibleFaces(builder, solid, x, y, z, blockId, uvFor) {
  for (const face of FACES) {
    const [nx, ny, nz] = face.normal
    if (solid(x + nx, y + ny, z + nz)) continue
    if (ny < 0 && y === 0) continue
    const occlusion = face.occluders.map((offsets) => vertexOcclusion(solid, x, y, z, offsets))
    builder.addFace(face, x, y, z, uvFor(blockId, face.kind) ?? UNIT_UV, occlusion)
  }
}

function vertexOcclusion(solid, x, y, z, [side1, side2, diagonal]) {
  const a = solid(x + side1[0], y + side1[1], z + side1[2])
  const b = solid(x + side2[0], y + side2[1], z + side2[2])
  if (a && b) return 3
  return a + b + solid(x + diagonal[0], y + diagonal[1], z + diagonal[2])
}

function createMeshBuilder() {
  const positions = []
  const normals = []
  const uvs = []
  const colors = []
  const indices = []
  let faceCount = 0

  function addFace(face, x, y, z, uv, occlusion) {
    const base = positions.length / 3
    face.corners.forEach(([cx, cy, cz], i) => {
      const [cu, cv] = CORNER_UVS[i]
      const light = AO_BRIGHTNESS[occlusion[i]] * face.shade
      positions.push(x + cx, y + cy, z + cz)
      normals.push(face.normal[0], face.normal[1], face.normal[2])
      uvs.push(cu ? uv.u1 : uv.u0, cv ? uv.v1 : uv.v0)
      colors.push(light, light, light)
    })
    // More occlusion on the 0-2 pair means it is the darker diagonal: split along 1-3.
    const split = occlusion[0] + occlusion[2] > occlusion[1] + occlusion[3] ? SPLIT_13 : SPLIT_02
    for (const corner of split) indices.push(base + corner)
    faceCount++
  }

  function finish() {
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices),
      faceCount,
    }
  }

  return { addFace, finish }
}
