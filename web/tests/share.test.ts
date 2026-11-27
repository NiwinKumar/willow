/** `npm test`: the share card says verdicts in words only (lib/share.ts): no numbers, no skin tone, nothing for a baseline. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Metric, Session } from '../src/data/types.ts'
import { resultShare, weekOf } from '../src/lib/share.ts'

const metric = (id: string, verdict: Metric['verdict'], delta: number, value = 12.34) => ({ id, verdict, delta, value, unit: 'count', mdc95: 1 }) as unknown as Metric
const session = (metrics: Metric[], at: string, is_baseline = false) => ({ id: 's', site: 'face_full', created_at: at, is_baseline, result: { metrics } }) as unknown as Session
const base = session([], '2026-08-23T18:00:00Z', true)

test('week 1 is the baseline week; 35 days later is week 6', () => {
  assert.equal(weekOf({ created_at: '2026-08-23T19:00:00Z' }, base), 1)
  assert.equal(weekOf({ created_at: '2026-09-27T18:00:00Z' }, base), 6)
  assert.equal(weekOf({ created_at: '2026-09-27T18:00:00Z' }, null), null)
})

test('changes first, in words; skin tone and measured numbers never appear', () => {
  const s = session([metric('tone_ita', 'real_change', 3.1), metric('redness', 'within_noise', 0.2), metric('blemishes', 'real_change', -4)], '2026-09-27T18:00:00Z')
  const card = resultShare(s, base)!
  assert.deepEqual(card.lines.map((l) => [l.label, l.verdict]), [
    ['Blemishes', 'Improved, beyond my normal range'],
    ['Redness', 'Within my normal range'],
  ])
  assert.match(card.kicker, /^WEEK 6 /)
  const words = JSON.stringify(card).replace(/WEEK 6|Week 6|2026-09-27/g, '')
  assert.doesNotMatch(words, /\d/)
  assert.doesNotMatch(words, /tone/i)
  assert.match(card.text, /#DoesItWork/)
})

test('a baseline, or a check-in with nothing compared, has no card', () => {
  assert.equal(resultShare(session([metric('redness', 'no_baseline', 0)], '2026-08-23T18:00:00Z', true), null), null)
  assert.equal(resultShare(session([metric('redness', 'low_quality', 0)], '2026-09-27T18:00:00Z'), base), null)
})
