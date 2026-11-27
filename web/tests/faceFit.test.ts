/** `npm test`: placing the canonical face on a photo from the photo's own marks. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, fitAffine, scaleOf, type Pt } from '../src/features/progress/faceFit.ts'

// a selfie: 12 px/mm, mirrored (the subject's right on the left is x < 0 -> small px), y down, face centre at (900, 1100)
const truth = (p: Pt): Pt => [900 + 12 * p[0], 1100 - 12 * p[1]]

test('the fit recovers the photo placement from a few marks', () => {
  const mm: Pt[] = [[-40, 10], [35, -5], [0, 60], [-10, -70], [50, 30]]
  const t = fitAffine(mm.map((m) => ({ mm: m, px: truth(m) })))
  assert.ok(t)
  const [x, y] = apply(t, [20, -40])
  assert.ok(Math.abs(x - truth([20, -40])[0]) < 1e-6 && Math.abs(y - truth([20, -40])[1]) < 1e-6)
  assert.ok(Math.abs(scaleOf(t) - 12) < 1e-6)
})

test('too few marks, or marks in a line, give no fit', () => {
  assert.equal(fitAffine([[0, 0], [10, 0], [0, 10]].map((m) => ({ mm: m as Pt, px: truth(m as Pt) }))), null)
  assert.equal(fitAffine([[0, 0], [10, 10], [20, 20], [30, 30]].map((m) => ({ mm: m as Pt, px: truth(m as Pt) }))), null)
})
