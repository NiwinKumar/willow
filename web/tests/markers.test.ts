/** `npm test`: routine markers on the timeline (features/progress/markers.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { routineMarkers } from '../src/features/progress/markers.ts'

const e = (started_at: string, custom_name: string) => ({ started_at, custom_name, brand: '' })
const day = (d: string) => d.slice(5)
const at = (d: string) => (d === '2026-10-18' ? 3.5 : d === '2026-09-26' ? 1.2 : null)

test('products started the same day share one marker', () => {
  const m = routineMarkers([e('2026-10-18T08:00:00Z', 'Gel Cleanser'), e('2026-10-18T09:00:00Z', 'Niacinamide'), e('2026-10-18', 'Retinol')], at, day)
  assert.deepEqual(m, [{ at: 3.5, label: '3 PRODUCTS STARTED · 10-18' }])
})

test('a single product keeps its own name, markers are ordered along the axis, days off the axis are dropped', () => {
  const m = routineMarkers([e('2026-10-18', 'Gel Cleanser'), e('2026-09-26', 'Retinol 0.3% face serum extra'), e('2026-01-01', 'Old')], at, day)
  assert.deepEqual(m, [
    { at: 1.2, label: 'RETINOL 0.3% FACE · 09-26' },
    { at: 3.5, label: 'GEL CLEANSER · 10-18' },
  ])
})
