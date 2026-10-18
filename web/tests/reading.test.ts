import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fmtReading } from '../src/lib/metrics.ts'

test('a signed scale (under-eye) shows + above zero; other readings never do', () => {
  const eye = { unit: 'delta_l_star' as const, mdc95: 1.2 }
  assert.equal(fmtReading(3.5, eye), '+3.5')
  assert.equal(fmtReading(-3.5, eye), '−3.5')
  assert.equal(fmtReading(0.01, eye), '0.0')
  assert.equal(fmtReading(14.2, { unit: 'index' as const, mdc95: 1.2 }), '14.2')
})
