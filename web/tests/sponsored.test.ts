/** `npm test`: the sponsored card's "Why am I seeing this?" words and when the card shows. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SPONSORED_EYEBROW, showSponsored, whyLines } from '../src/features/routine/sponsored.ts'

const label = (id: string) => ({ dark_spots: 'Dark spots', even_tone: 'Tone evenness' })[id] ?? id
const disclosure = 'Brands pay to show a product here; payment never changes your recommendations.'

test('the disclosure leads with the word Sponsored', () => {
  assert.ok(SPONSORED_EYEBROW.startsWith('Sponsored'))
})

test('why: matched goals and skin type from the profile, then the disclosure', () => {
  const one = whyLines({ matched: { goals: ['dark_spots'], skin_type: null }, disclosure }, label)
  assert.deepEqual(one.matched, ['Your goal: Dark spots'])
  assert.equal(one.disclosure, disclosure)
  const two = whyLines({ matched: { goals: ['dark_spots', 'even_tone'], skin_type: 'oily' }, disclosure }, label)
  assert.deepEqual(two.matched, ['Your goals: Dark spots, Tone evenness', 'Your skin type: Oily'])
})

test('never in the demo journey, never for a product already in the routine', () => {
  const item = { product_id: 'p1' }
  assert.equal(showSponsored(item, { demo: false, inRoutine: new Set() }), true)
  assert.equal(showSponsored(item, { demo: true, inRoutine: new Set() }), false)
  assert.equal(showSponsored(item, { demo: false, inRoutine: new Set(['p1']) }), false)
  assert.equal(showSponsored(null, { demo: false, inRoutine: new Set() }), false)
})
