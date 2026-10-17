/** `npm test`: measurement cards lead with the verdict in words after the baseline (features/progress/headline). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Metric } from '../src/data/types.ts'
import { LAST_LIKE_THIS, verdictHeadline } from '../src/features/progress/headline.ts'

function metric(p: Partial<Metric>): Metric {
  return { id: 'redness', group: 'redness', label: 'Redness', unit: 'a_star', confidence: 'indicative', value: 12.2, within_session_sd: 0.2, mdc95: 0.8, delta: -0.9, verdict: 'real_change', direction: 'decrease', extras: {}, ...p } as Metric
}
const later = { is_baseline: false }

test('a real change reads in words, numbers before → now', () => {
  assert.deepEqual(verdictHeadline(metric({}), later), { headline: 'Calmer than your start', numbers: '13.1 → 12.2' })
  assert.equal(verdictHeadline(metric({ delta: 0.9, value: 14.0 }), later)?.headline, 'More redness than your start')
})

test('counts compared with an earlier check-in taken the same way say so', () => {
  const spots = metric({ id: 'blemishes', group: 'clarity', value: 3, delta: -2 })
  assert.equal(verdictHeadline(spots, later, LAST_LIKE_THIS)?.headline, 'Fewer blemishes than your last check-in like this')
})

test('within the normal range: no real change', () => {
  assert.equal(verdictHeadline(metric({ verdict: 'within_noise', delta: 0.3 }), later)?.headline, 'No real change')
})

test('skin tone never gets a direction', () => {
  const tone = metric({ id: 'tone_ita', unit: 'deg', delta: -3, value: 30 })
  assert.equal(verdictHeadline(tone, later)?.headline, 'Changed since your start')
})

test('the baseline keeps its number; no reading gives nothing', () => {
  assert.equal(verdictHeadline(metric({}), { is_baseline: true }), null)
  assert.equal(verdictHeadline(metric({ value: null }), later), null)
})

test('no band yet: too early to tell', () => {
  assert.equal(verdictHeadline(metric({ verdict: 'no_baseline', delta: -0.4 }), later)?.headline, 'Too early to tell')
})
