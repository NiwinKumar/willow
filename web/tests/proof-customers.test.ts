/** `npm test`: Willow Proof Customers helpers (goal trends, a brand's products for a goal, matrix modes). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cellFill, goalTrends, ownForGoal, parseMode } from '../src/features/retail/sections/customers/model.ts'

test('goal trends are shares of each month’s people, compared over the last two months', () => {
  const t = goalTrends({
    months: ['2026-08', '2026-09', '2026-10'],
    people: [690, 1371, 1582],
    goals: [
      { goal: 'Dark spots', goal_id: 'dark_spots', counts: [99, 311, 408], share_of_peak: [0.35, 0.61, 0.75] },
      { goal: 'Shine and glow', goal_id: 'oil_glow', counts: [286, 514, 545], share_of_peak: [1, 1, 1] },
      { goal: 'Lines', goal_id: 'lines', counts: [78, 179, null], share_of_peak: [0.27, 0.35, null] },
    ],
  })
  // Rising in share even though every month has more people.
  assert.deepEqual(t.get('dark_spots'), { goal_id: 'dark_spots', shares: [14, 23, 26], prev: 23, last: 26, delta: 3, prevMonth: '2026-09', lastMonth: '2026-10', dir: 'up' })
  assert.equal(t.get('oil_glow')?.dir, 'down')
  assert.equal(t.get('oil_glow')?.delta, -3)
  // A suppressed month is never read as 0: no comparison.
  assert.equal(t.get('lines')?.delta, null)
  assert.equal(t.get('lines')?.dir, null)
  assert.equal(goalTrends(undefined).size, 0)
})

test('a brand’s products for a goal, measured first', () => {
  const rows = [
    { product_id: 'a', brand: 'X', goal_ids: ['lines'], rate: null, n: null },
    { product_id: 'b', brand: 'X', goal_ids: ['lines', 'dark_spots'], rate: 0.6, n: 40 },
    { product_id: 'c', brand: 'Y', goal_ids: ['lines'], rate: 0.9, n: 40 },
    { product_id: 'd', brand: 'X', goal_ids: ['redness'], rate: 0.8, n: 40 },
  ]
  assert.deepEqual(
    ownForGoal(rows, 'X', 'lines').map((p) => p.product_id),
    ['b', 'a'],
  )
  assert.deepEqual(ownForGoal(rows, 'X', 'under_eye'), [])
})

test('matrix modes and fills keep suppressed groups apart from zero', () => {
  assert.equal(parseMode(null), 'unmet')
  assert.equal(parseMode('best'), 'best')
  assert.equal(parseMode('nonsense'), 'unmet')
  const cell = { skin: 'oily', goal: 'lines', users: 47, unmet: null, best: null, runner_up: null }
  assert.equal(cellFill('unmet', cell, 200), null)
  assert.match(cellFill('people', { ...cell, users: 160 }, 200) ?? '', / 24%,/)
  assert.equal(cellFill('people', { ...cell, users: null }, 200), null)
})
