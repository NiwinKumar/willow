/** `npm test`: the check-in's place in the engine line (features/checkin/queue.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextPlace, queueLine, queuedPlace } from '../src/features/checkin/queue.ts'

test('the line says to keep the page open, never that the person can leave', () => {
  assert.equal(queueLine({ position: 3, eta_s: 90 }), 'In line · about 90 s (place 3). Keep this open; your place is kept.')
  assert.equal(queueLine(null), 'In line. Keep this open; your place is kept.')
  assert.doesNotMatch(queueLine({ position: 1, eta_s: 45 }), /leave/)
})

test('a 409 still in line carries the place; other conflicts do not', () => {
  assert.deepEqual(queuedPlace({ code: 'conflict', queued: true, position: 2, eta_s: 45 }), { position: 2, eta_s: 45 })
  assert.equal(queuedPlace({ code: 'conflict', message: 'analysis already running' }), null)
  assert.equal(queuedPlace(null), null)
})

test('the place is kept between asks and dropped once the engine has the check-in', () => {
  const p = { position: 2, eta_s: 45 }
  assert.deepEqual(nextPlace(null, 'queued', p), p)
  assert.deepEqual(nextPlace(p, 'queued', { position: 1, eta_s: 45 }), { position: 1, eta_s: 45 })
  assert.deepEqual(nextPlace(p, 'received', null), p) // asked again: not yet back in line
  assert.deepEqual(nextPlace(p, null, null), p)
  assert.equal(nextPlace(p, 'engine', null), null)
  assert.equal(nextPlace(p, 'explaining', null), null)
})
