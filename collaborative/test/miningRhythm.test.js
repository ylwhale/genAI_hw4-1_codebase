// The mining rhythm shared by the hand's swings and the crack overlay's chips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MINING_IMPACT, MINING_SWINGS, miningImpactCount } from '../src/render/miningRhythm.js'
import { mineCurve } from '../src/render/handView.js'

test('miningImpactCount: four impacts over one break, with exact boundaries', () => {
  assert.equal(MINING_SWINGS, 4)
  const firstImpact = MINING_IMPACT / MINING_SWINGS // 0.075
  assert.equal(miningImpactCount(0), 0)
  assert.equal(miningImpactCount(firstImpact - 1e-6), 0)
  assert.equal(miningImpactCount(firstImpact), 1)
  assert.equal(miningImpactCount(0.25 + firstImpact - 1e-6), 1)
  assert.equal(miningImpactCount(0.25 + firstImpact), 2)
  assert.equal(miningImpactCount(0.9), 4)
  assert.equal(miningImpactCount(1), 4)
  assert.equal(miningImpactCount(2), 4, 'clamped')
  assert.equal(miningImpactCount(-1), 0)
  assert.equal(miningImpactCount(Number.NaN), 0)
})

test('each counted impact is the moment the hand swing peaks on the block', () => {
  for (let swing = 0; swing < MINING_SWINGS; swing++) {
    const progress = (swing + MINING_IMPACT) / MINING_SWINGS
    assert.ok(Math.abs(mineCurve(progress * MINING_SWINGS) - 1) < 1e-9, `swing ${swing} peaks`)
    assert.equal(miningImpactCount(progress + 1e-9), swing + 1, 'counted as the head lands')
    assert.equal(miningImpactCount(progress - 1e-3), swing, 'not before')
  }
})

test('the rhythm module is neutral: no Three.js, and effects never import the hand rig', () => {
  const read = (file) => readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8')
  assert.doesNotMatch(read('miningRhythm.js'), /from 'three'/)
  for (const file of ['effects.js', 'crackOverlay.js', 'particles.js', 'placementPreview.js', 'blockHighlight.js']) {
    assert.doesNotMatch(read(file), /handView/, `${file} does not depend on handView`)
  }
})
