/** `npm test`: Willow Proof formatting and URL-state helpers (true minus, suppression wording, brand slugs). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { article, interval, pct, pts, slugOf, SUPPRESSED, weeks } from '../src/features/retail/ui/format.ts'
import { cohortSizeText, mixedLabel } from '../src/features/retail/ui/cohort.ts'
import { parseWorkspace, sectionPath } from '../src/features/retail/state.ts'

test('rates and lifts use a true minus and signed points', () => {
  assert.equal(pct(0.476), '48%')
  assert.equal(pct(null), '—')
  assert.equal(pts(0.17), '+17 pts')
  assert.equal(pts(-0.04), '−4 pts')
  assert.equal(pts(0.001), '±0 pts')
  assert.equal(interval(0.41, 0.55), '41–55%')
  assert.equal(interval(null, 0.5), null)
  assert.equal(weeks(6.5), '6.5 wk')
})

test('suppression is worded for people, not as a code', () => {
  assert.equal(SUPPRESSED, 'Fewer than 10 people')
})

test('brand slugs are URL-safe and stable', () => {
  assert.equal(slugOf('La Roche-Posay'), 'la-roche-posay')
  assert.equal(slugOf("Paula's Choice"), 'paula-s-choice')
  assert.equal(slugOf('Dot & Key'), 'dot-and-key')
  assert.equal(slugOf('Beauty of Joseon'), 'beauty-of-joseon')
})

test('workspace and section paths round-trip the URL', () => {
  assert.deepEqual(parseWorkspace(null), { kind: 'retailer' })
  assert.deepEqual(parseWorkspace('brand:'), { kind: 'retailer' })
  assert.deepEqual(parseWorkspace('brand:cerave'), { kind: 'brand', slug: 'cerave' })
  assert.equal(sectionPath('overview'), '/retail')
  assert.equal(sectionPath('categories', 'serum'), '/retail/categories/serum')
})

test('the cohort is never called mixed: its size says how many are simulated and how many real', () => {
  const c = { synthetic: 35000, real: 8, weeks: 8, dropout: 0.13, seed: 7 }
  assert.equal(cohortSizeText(c), '35,000 simulated + 8 real people')
  assert.equal(cohortSizeText({ ...c, real: 0 }), '35,000 simulated people')
  assert.equal(cohortSizeText({ ...c, synthetic: 0, real: 1 }), '1 real person')
  assert.equal(mixedLabel(c), 'Simulated + 8 real')
  assert.equal(mixedLabel({ ...c, real: 0 }), 'Simulated')
  assert.equal(mixedLabel(null), 'Simulated + real')
})

test('a or an before a goal name', () => {
  assert.deepEqual(['under-eye', 'redness', 'Oil and glow'].map(article), ['an', 'a', 'an'])
})
