/** `npm test`: Willow Proof formatting and URL-state helpers (true minus, suppression wording, brand slugs). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { interval, pct, pts, slugOf, SUPPRESSED, weeks } from '../src/features/retail/ui/format.ts'
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
