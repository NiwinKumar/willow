/** `npm test`: Home's read of the person (features/home/derive.ts readHome) for whatever places they track. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Session } from '../src/data/types.ts'
import { readHome } from '../src/features/home/derive.ts'

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
