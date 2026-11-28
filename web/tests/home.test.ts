/** `npm test`: Home's read of the person (features/home/derive.ts readHome) for whatever places they track. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RoutineEntry, Session } from '../src/data/types.ts'
import { article, brandedName, checkInsSince, distinctNames, firstRead, readHome, shortName, spanOfUse } from '../src/features/home/derive.ts'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const session = (id: string, site: Session['site'], at: string, extra: Partial<Session> = {}) =>
  ({ id, site, capture_mode: 'uncalibrated', created_at: at, status: 'done', n_frames: 5, is_baseline: false, labels: {}, explanation: null, measured: true, result: { quality: { passed: true, reasons: [] }, frames_used: 4, metrics: [] }, ...extra }) as unknown as Session

const baseline = (id: string, site: Session['site'], at: string) => session(id, site, at, { is_baseline: true, baseline_ref: { session_id: id, frames: 4, has_noise_band: true } })

test('a person who tracks only the cheek close-up is not asked for a baseline again', () => {
  const base = baseline('c1', 'cheek_macro', daysAgo(1))
  const read = readHome([base], [{ site: 'face_full', sessions: [] }, { site: 'cheek_macro', sessions: [base] }])
  assert.equal(read.person, 'active')
  assert.equal(read.site, 'cheek_macro')
  assert.equal(read.baseline?.id, 'c1')
})

test('nothing taken anywhere is a new person; a face baseline leads when there is one', () => {
  assert.equal(readHome([], [{ site: 'face_full', sessions: [] }, { site: 'cheek_macro', sessions: [] }]).person, 'new')
  const face = baseline('f1', 'face_full', daysAgo(3))
  const cheek = baseline('c1', 'cheek_macro', daysAgo(2))
  const read = readHome([face, cheek], [{ site: 'face_full', sessions: [face] }, { site: 'cheek_macro', sessions: [cheek] }])
  assert.equal(read.site, 'face_full')
})

test('back after a gap counts the latest check-in of any tracked place', () => {
  const face = baseline('f1', 'face_full', daysAgo(30))
  const cheek = session('c2', 'cheek_macro', daysAgo(2))
  const places = [{ site: 'face_full' as const, sessions: [face] }, { site: 'cheek_macro' as const, sessions: [cheek] }]
  assert.equal(readHome([face, cheek], places, 14).person, 'active')
  assert.equal(readHome([face], [places[0]], 14).person, 'gap')
})

// --- Nov 28: rows that can be told apart, and use counted the way the rest of Willow counts weeks ---
const entry = (id: string, brand: string, custom_name: string, actives: string[] = []) => ({ id, brand, custom_name, category: 'serum', key_actives: actives.map((name) => ({ name, pct: null })) }) as unknown as RoutineEntry

test('two products with the same short name carry their brand; the others stay short', () => {
  const ordinary = entry('a', 'The Ordinary', 'Niacinamide 10% + Zinc 1%', ['Niacinamide'])
  const anua = entry('b', 'Anua', 'Niacinamide 10 TXA 4 Serum', ['Niacinamide'])
  const cream = entry('c', 'Purito Seoul', 'Wonder Releaf Centella Cream Unscented')
  assert.equal(shortName(ordinary), shortName(anua))
  const names = distinctNames([ordinary, anua, cream])
  assert.equal(names.get('a'), 'The Ordinary Niacinamide')
  assert.equal(names.get('b'), 'Anua Niacinamide')
  // a variant word is not the product: "Centella Cream", never "Cream Unscented"
  assert.equal(names.get('c'), 'Centella Cream')
  assert.equal(brandedName(cream), 'Purito Seoul Centella Cream')
})

test('use is counted in weeks as the rest of Willow counts them, and the article fits the word', () => {
  assert.equal(spanOfUse(0), 'day 1')
  assert.equal(spanOfUse(13), 'day 13')
  assert.equal(spanOfUse(48), 'week 7') // 48 days in: the start's own week is week 1
  assert.equal(spanOfUse(49), 'week 8')
  assert.equal(`${article('azelaic')} azelaic night`, 'an azelaic night')
  assert.equal(`${article('glycolic')} glycolic night`, 'a glycolic night')
})

// --- Nov 28: Is your routine working? shows how far a product too new to judge is toward its first read ---
test('check-ins since a product started count measured, non-baseline photos on its best place, up to an end day', () => {
  const start = daysAgo(10).slice(0, 10)
  const sessions = [
    baseline('b', 'face_full', daysAgo(10)), // the baseline itself is never a check-in "since"
    session('f1', 'face_full', daysAgo(7)),
    session('f2', 'face_full', daysAgo(1)),
    session('old', 'face_full', daysAgo(20)), // before the start
    session('bad', 'face_full', daysAgo(3), { result: { quality: { passed: false, reasons: ['blurry'] }, frames_used: 0, metrics: [] } } as Partial<Session>),
    session('c1', 'cheek_macro', daysAgo(2)),
  ]
  assert.equal(checkInsSince(start, ['face_full', 'cheek_macro'], sessions), 2)
  assert.equal(checkInsSince(start, ['cheek_macro'], sessions), 1)
  assert.equal(checkInsSince(start, ['face_full'], sessions, Date.parse(daysAgo(4))), 1) // the demo journey ends on its last day
})

test('the first read needs two weeks and two check-ins; progress never runs past either', () => {
  assert.deepEqual(firstRead(1, 0), { days: 1, checkIns: 0, share: 0, daysLeft: 13 })
  assert.deepEqual(firstRead(30, 5), { days: 14, checkIns: 2, share: 1, daysLeft: 0 })
  assert.equal(firstRead(14, 1).share, 0.5) // the slower of the two
})
