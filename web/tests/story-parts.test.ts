import assert from 'node:assert/strict'
import { test } from 'node:test'

import { areaStatus, productLine, productStatus, spotLine, typicalLine } from '../src/features/progress/storyParts.ts'

test('an area says which way it moved, gently, and only when it really changed', () => {
  assert.deepEqual(areaStatus({ area: 'chin', label: 'chin', value: 9, verdict_vs_baseline: 'real_change', way: 'other_way' }), { glyph: '◇', text: 'Moved the other way', tone: 'away' })
  assert.equal(areaStatus({ area: 'nose', label: 'nose', value: 3, verdict_vs_baseline: 'real_change', way: 'improved' }).text, 'Improved')
  assert.equal(areaStatus({ area: 'nose', label: 'nose', value: 3, verdict_vs_baseline: 'within_noise' }).text, 'Within its normal range')
  assert.equal(areaStatus({ area: 'nose', label: 'nose', value: 3, verdict_vs_baseline: 'no_band' }).text, "Can't judge yet")
  assert.equal(areaStatus({ area: 'nose', label: 'nose', value: 3 }).text, 'Not in your baseline')
})

test('spot lines list only what happened', () => {
  const r = { area: 'forehead', label: 'forehead', new_this_time: 2, still_there: 0, fading: 1, not_seen_this_time: 0, faded_so_far: 4, typical_days_visible: null }
  assert.equal(spotLine(r), '2 new · 1 fading')
  assert.equal(typicalLine(r), null)
  assert.equal(typicalLine({ ...r, typical_days_visible: { at_least: 3.2, at_most: 7.4, from: 3 } }), 'Spots here usually stay 3 to 7 days')
  // weekly check-ins: the shortest a spot can have lasted is under a day, never "0 days"
  assert.equal(typicalLine({ ...r, typical_days_visible: { at_least: 0, at_most: 7, from: 6 } }), 'Spots here usually stay up to 7 days')
})

test('a product is never judged before two weeks and two check-ins', () => {
  const p = { name: 'Retinol 0.3%', brand: 'Minimalist', use: { days_used: 5, of_days: 7 }, since_start: { started: '2026-11-20', weeks: 1, check_ins: 1, status: 'too_early' as const } }
  assert.equal(productStatus(p)?.text, 'Too early to tell')
  assert.equal(productLine(p), 'Week 1 · used 5 of 7 days since last check-in')
  assert.equal(productStatus({ ...p, since_start: { ...p.since_start, weeks: 5, check_ins: 5, status: 'helping' } })?.text, 'Improved since you started it')
  assert.equal(productStatus({ ...p, since_start: null }), null)
})
