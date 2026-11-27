import assert from 'node:assert/strict'
import { test } from 'node:test'

import { weeksAfter } from '../src/lib/format.ts'

test('a plan pick starts its start week after today, so the routine and the plan agree', () => {
  assert.equal(weeksAfter('2026-11-27', 0), '2026-11-27')
  assert.equal(weeksAfter('2026-11-27', 2), '2026-12-11')
  assert.equal(weeksAfter('2026-12-25', 2), '2027-01-08') // over a year end
  assert.equal(weeksAfter('2027-03-20', 2), '2027-04-03') // over a DST change
  assert.equal(weeksAfter('2026-11-27T09:00:00Z', 1), '2026-12-04')
})
