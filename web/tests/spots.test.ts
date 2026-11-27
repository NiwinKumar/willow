/** `npm test`: "seen in X of N photos" counts the photos of the mark's own view. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AnalysisResult, Candidate, Session } from '../src/data/types.ts'
import { spotItems, spotShort } from '../src/features/progress/spots.ts'

const cand = (id: string, features: Record<string, number>): Candidate => ({ id, kind: 'spot', bbox: [10, 10, 4, 4], features })
const session = (candidates: Candidate[], frames_used: number) =>
  ({ id: 's', result: { candidates, frames_used } as unknown as AnalysisResult }) as unknown as Session
const agree = (s: Session) => Object.fromEntries(spotItems(s).map((it) => [it.c.id, it.agree]))

test('a cheek mark is a share of its own photos, a front mark of the front photos', () => {
  const s = session(
    [
      cand('c_001', { view: 0, frames_in_view: 3, seen_in_fraction: 0.67 }),
      cand('c_002', { view: 1, frames_in_view: 2, seen_in_fraction: 0.5 }),
      cand('c_003', { view: 2, frames_in_view: 1 }), // one left-cheek photo: no count
    ],
    3,
  )
  assert.deepEqual(agree(s), { c_001: { seen: 2, of: 3 }, c_002: { seen: 1, of: 2 }, c_003: null })
})

test('older engines: front marks of frames_used, cheek marks without a count', () => {
  const s = session([cand('c_001', { seen_in_fraction: 1 }), cand('c_002', { view: 1, seen_in_fraction: 1 })], 2)
  assert.deepEqual(agree(s), { c_001: { seen: 2, of: 2 }, c_002: null })
})

test('a mark labelled a mole is never listed, numbered or counted; clinical ids show as cosmetic words', () => {
  const s = {
    ...session([cand('c_001', {}), cand('c_002', {}), cand('c_003', {})], 1),
    label_details: {
      c_001: { label: 'open_comedone', confidence: 'high', visible_features: [] },
      c_002: { label: 'mole', confidence: 'high', visible_features: [] },
      c_003: { label: 'closed_comedone', confidence: 'medium', visible_features: [] },
    },
  } as unknown as Session
  const items = spotItems(s)
  assert.deepEqual(items.map((it) => [it.n, it.c.id]), [[1, 'c_001'], [2, 'c_003']])
  assert.deepEqual(items.map((it) => spotShort(it, false)), ['Open pore / blackhead', 'Small bump'])
})
