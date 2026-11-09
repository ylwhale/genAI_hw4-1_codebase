// Construction preview: atlas UV remapping for the ghost and the rising fill.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry } from 'three'
import { applyAtlasUvs } from '../src/render/placementPreview.js'
import { BLOCK } from '../src/world/blocks.js'
import { fakeAtlas } from './render-helpers.js'

test('applyAtlasUvs maps each box face into its tile and crops side faces for a partial fill', () => {
  const atlas = fakeAtlas()
  const geometry = applyAtlasUvs(new BoxGeometry(1, 1, 1), atlas, BLOCK.GRASS)
  const uv = geometry.attributes.uv
  const within = (i, rect) => uv.getX(i) >= rect.u0 - 1e-9 && uv.getX(i) <= rect.u1 + 1e-9 && uv.getY(i) >= rect.v0 - 1e-9 && uv.getY(i) <= rect.v1 + 1e-9
  for (let i = 0; i < 4; i++) assert.ok(within(i, atlas.rects.side), '+x face uses the side tile')
  for (let i = 8; i < 12; i++) assert.ok(within(i, atlas.rects.top), '+y face uses the top tile')
  for (let i = 12; i < 16; i++) assert.ok(within(i, atlas.rects.bottom), '-y face uses the bottom tile')
  assert.equal(uv.getY(0), atlas.rects.side.v1, 'top edge of a side face samples the top of its tile')

  applyAtlasUvs(geometry, atlas, BLOCK.GRASS, 0.5)
  assert.equal(uv.getY(0), 0.5 + 0.5 * 0.25, 'half-built side shows the lower half of the tile')
  assert.equal(uv.getY(2), atlas.rects.side.v0)
  applyAtlasUvs(geometry, atlas, BLOCK.GRASS, 1)
  assert.equal(uv.getY(0), atlas.rects.side.v1, 'remapping is idempotent (uses the pristine uvs)')
})
