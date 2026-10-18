/** `npm test`: Home's "Routine effect": which way each product moved, and when a product is worth a second look. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RoutineEntry, Session } from '../src/data/types.ts'
import { effectHeadline, routineEffect as effectOf, type EffectDeps } from '../src/lib/effect.ts'
import type { Outcome } from '../src/lib/outcome.ts'

const NOW = Date.parse('2026-10-18T12:00:00Z')
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString()
const entry = (id: string, startedDaysAgo: number, concerns: string[], extra: Partial<RoutineEntry> = {}): RoutineEntry => ({
  id,
  product_id: id,
  custom_name: id,
  brand: '',
  category: 'serum',
  key_actives: [],
  inci: [],
  started_at: day(startedDaysAgo).slice(0, 10),
  ended_at: null,
  slots: ['pm'],
  concerns,
  source: 'catalog',
  ...extra,
}) as unknown as RoutineEntry
const session = (id: string, ago: number, redness: number, verdict: 'within_noise' | 'real_change', delta: number, baseline = false): Session =>
  ({
    id,
    site: 'face_full',
    capture_mode: 'quick',
    created_at: day(ago),
    status: 'done',
    measured: true,
    is_baseline: baseline,
    baseline_ref: baseline ? null : { session_id: 'b', frames: 5, has_noise_band: true },
    result: { quality: { passed: true }, metrics: [{ id: 'redness', value: redness, unit: 'a_star', mdc95: 0.5, delta, verdict, direction: delta < 0 ? 'decrease' : 'increase' }] },
  }) as unknown as Session

const baseline = session('b', 70, 10, 'within_noise', 0, true)

// The outcome rule itself is lib/outcome.ts; here it is read off the sessions the way it would judge them.
const outcome: EffectDeps['outcome'] = (e, sessions): Outcome => {
  if (e.concerns.length === 0 || e.concerns[0] === 'dryness_barrier') return { kind: 'unmeasured', text: 'Not measured', detail: '' }
  const after = sessions.filter((s) => !s.is_baseline && new Date(s.created_at) >= new Date(e.started_at))
  if (after.length < 2) return { kind: 'early', text: 'Not enough data yet', detail: '' }
  const latest = after[after.length - 1]
  const m = latest.result!.metrics[0]
  return m.verdict === 'real_change' ? { kind: 'real', metric: 'redness', site: 'face_full', session: latest, band: 0.5, text: 'Changed', detail: '' } : { kind: 'none', text: 'Within normal range so far', detail: '' }
}
const deps: EffectDeps = {
  outcome,
  targets: (e) => (e.concerns.includes('redness_sensitivity') ? ['redness'] : []),
  words: () => ({ label: 'Redness', decrease: 'calmer', increase: 'more redness', sites: ['face_full'] }),
  sites: ['face_full'],
  day: (iso) => new Date(iso),
}
const routineEffect = (entries: RoutineEntry[], sessions: Session[], check?: Parameters<typeof effectOf>[2]) => effectOf(entries, sessions, check, deps, NOW)

test('a real drop in redness since the start is helping; a real rise is away and flagged', () => {
  const down = [baseline, session('a', 20, 9.5, 'within_noise', -0.5), session('c', 3, 8, 'real_change', -2)]
  const r1 = routineEffect([entry('serum', 40, ['redness_sensitivity'])], down, undefined)
  assert.equal(r1.rows[0].effect, 'helping')
  assert.equal(r1.rows[0].flag, null)
  assert.match(r1.rows[0].line, /Redness: calmer/)
  assert.equal(r1.rows[0].points.length, 3)
  const up = [baseline, session('a', 20, 10.5, 'within_noise', 0.5), session('c', 3, 12, 'real_change', 2)]
  const r2 = routineEffect([entry('serum', 40, ['redness_sensitivity'])], up, undefined)
  assert.equal(r2.rows[0].effect, 'away')
  assert.equal(r2.rows[0].flag?.kind, 'away')
})

test('no change after eight weeks and three check-ins is worth a second look; sooner it is not', () => {
  const flat = [baseline, session('a', 50, 10, 'within_noise', 0.1), session('b2', 30, 10, 'within_noise', 0), session('c', 5, 10.1, 'within_noise', 0.1)]
  const long = routineEffect([entry('serum', 60, ['redness_sensitivity'])], flat, undefined)
  assert.equal(long.rows[0].effect, 'steady')
  assert.equal(long.rows[0].flag?.kind, 'review')
  const short = routineEffect([entry('serum', 40, ['redness_sensitivity'])], flat, undefined)
  assert.equal(short.rows[0].flag, null)
})

test('too early, unmeasured and stopped products are never judged', () => {
  const few = [baseline, session('a', 3, 10, 'within_noise', 0)]
  assert.equal(routineEffect([entry('serum', 5, ['redness_sensitivity'])], few, undefined).rows[0].effect, 'early')
  assert.equal(routineEffect([entry('cleanser', 40, ['dryness_barrier'])], few, undefined).rows.length, 0)
  assert.equal(routineEffect([entry('old', 40, ['redness_sensitivity'], { ended_at: day(2) })], few, undefined).rows.length, 0)
})

test('two products that share an active flag each other', () => {
  const flat = [baseline, session('a', 10, 10, 'within_noise', 0)]
  const check = { conflicts: [], gaps: [], notes: [], duplicates: [{ active: 'niacinamide', products: ['a', 'b'], note: 'x' }] }
  const r = routineEffect([entry('a', 5, ['redness_sensitivity']), entry('b', 5, ['redness_sensitivity'])], flat, check)
  assert.deepEqual(r.rows.map((x) => x.flag?.kind), ['overlap', 'overlap'])
})

test('the headline counts only the products that can be judged', () => {
  assert.equal(effectHeadline({ helping: 0, away: 0, changed: 0, steady: 0, early: 2 }), 'Too early to say what your routine is doing.')
  assert.equal(effectHeadline({ helping: 2, away: 0, changed: 0, steady: 1, early: 1 }), '2 of 3 products show a real change in the direction you want.')
  assert.equal(effectHeadline({ helping: 0, away: 0, changed: 0, steady: 2, early: 0 }), 'Nothing has moved beyond your normal range yet.')
})
