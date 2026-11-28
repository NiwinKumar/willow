/** `npm test`: the judge tour's "Same face, two photos" (features/website/noiseReadings.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compare, NOISE_READINGS, outsideTheBand } from '../src/features/website/noiseReadings.ts'

test('the page says every pair stays inside the band: it must be true of the stored readings', () => {
  assert.deepEqual(outsideTheBand(), [])
})

test('a score app reports the raw difference as a change; Willow reports it against the band', () => {
  const c = compare('blemishes', 1, 2)
  assert.equal(c.a, '61')
  assert.equal(c.b, '52')
  assert.equal(c.scoreApp, '9 fewer blemishes, −15%')
  assert.equal(c.willow, 'Within your normal range')
  assert.equal(c.band, '±12')
  assert.ok(c.position < 0 && Math.abs(c.position) < c.bandShare)
  assert.equal(compare('pigment_spots', 1, 2).scoreApp, 'Dark spots up 389%')
})

test('the band is the sample’s own: the five photos’ SD gives it (t-based for five photos, as the engine does)', () => {
  for (const r of Object.values(NOISE_READINGS)) {
    const mean = r.values.reduce((s, v) => s + v, 0) / r.values.length
    const sd = Math.sqrt(r.values.reduce((s, v) => s + (v - mean) ** 2, 0) / (r.values.length - 1))
    assert.ok(Math.abs(sd - r.sd) < 0.002 || r.sd > sd, `sd ${sd} vs ${r.sd}`) // a metric's MIN_SD floor can only raise it
    assert.ok(r.spread >= 1.96 * Math.SQRT2 * r.sd - 0.002)
    assert.ok(r.band >= r.spread) // the normal range: the spread, or the between-room floor when wider
  }
})

test('colour readings whose room floor is wider than the sitting’s spread say so', () => {
  const c = compare('redness', 1, 2)
  assert.equal(c.band, '±3.6')
  assert.equal(c.spread, '±1.1')
  assert.ok(c.fromRoom)
  assert.equal(compare('blemishes', 1, 2).fromRoom, false)
})
