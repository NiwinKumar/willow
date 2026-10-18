/** `npm test`: a real change is said by its direction (lib/verdict): improved, moved the other way, or (skin tone) shifted. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Metric, Session } from '../src/data/types.ts'
import { changeLines, changeTitle, changeWay, wordsFor } from '../src/lib/verdict.ts'

const m = (p: Partial<Metric>): Metric => ({ id: 'redness', group: 'redness', label: 'Redness', unit: 'a_star', confidence: 'indicative', value: 12, within_session_sd: 0.2, mdc95: 0.8, delta: -0.9, verdict: 'real_change', direction: 'decrease', extras: {}, ...p }) as Metric
const later = { is_baseline: false }

test('a change toward what people want improved; the other way is said gently; skin tone only shifts', () => {
  assert.equal(changeWay(m({})), 'improved')
  assert.equal(changeWay(m({ delta: 0.9 })), 'otherWay')
  assert.equal(changeWay(m({ id: 'dark_circles', delta: 1.2 })), 'improved')
  assert.equal(changeWay(m({ id: 'tone_ita', delta: -3 })), 'shifted')
  assert.equal(wordsFor(m({}), later).label, 'Improved')
  assert.equal(wordsFor(m({ delta: 0.9 }), later).label, 'Moved the other way')
  assert.equal(wordsFor(m({ verdict: 'within_noise' }), later).label, 'Within normal range')
})

test('no word says just "changed"', () => {
  for (const p of [{}, { delta: 0.9 }, { id: 'tone_ita' as const, delta: 2 }]) assert.doesNotMatch(wordsFor(m(p), later).label, /changed/i)
})

test('counts and titles split by direction, the good news first', () => {
  const s = { is_baseline: false, result: { metrics: [m({ delta: 0.9 }), m({ id: 'pores', delta: -1 }), m({ id: 'glow', delta: 0.2 })] } } as unknown as Session
  assert.deepEqual(changeLines(s).map((l) => l.text), ['2 improved', '1 moved the other way'])
  const label = (x: Pick<Metric, 'id'>) => (x.id === 'redness' ? 'Redness' : 'Pores')
  assert.equal(changeTitle([m({})], label), 'Redness improved')
  assert.equal(changeTitle([m({}), m({ id: 'pores', delta: -1 })], label), '2 measures improved')
  assert.equal(changeTitle([m({}), m({ id: 'pores', delta: 1 })], label), '1 improved, 1 moved the other way')
})
