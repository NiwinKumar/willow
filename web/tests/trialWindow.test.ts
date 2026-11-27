/** `npm test`: the trial-window bar on "Is it working?" (features/routine/trialWindow.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { trialWindow } from '../src/features/routine/trialWindow.ts'

const DAY = 86_400_000
const start = '2026-01-01T00:00:00Z'
const t0 = Date.parse(start)
const due = new Date(t0 + 24 * 7 * DAY)
const look = new Date(t0 + 4 * 7 * DAY)

test('the first day is week 1 of the window, with the first look marked on it', () => {
  const w = trialWindow(start, due, look, t0 + DAY)!
  assert.equal(w.week, 1)
  assert.equal(w.weeks, 24)
  assert.ok(w.done > 0 && w.done < 0.01)
  assert.equal(w.look, 4 / 24)
})

test('past the due date the bar is full and stays at the last week', () => {
  const w = trialWindow(start, due, look, t0 + 30 * 7 * DAY)!
  assert.equal(w.week, 24)
  assert.equal(w.done, 1)
})

test('a start in the future is week 0 with nothing filled', () => {
  const w = trialWindow(start, due, null, t0 - 3 * DAY)!
  assert.equal(w.week, 0)
  assert.equal(w.done, 0)
  assert.equal(w.look, null)
})

test('a window with no length gives no bar', () => {
  assert.equal(trialWindow(start, new Date(t0), look, t0), null)
})
