/** `npm test`: RAW is for close-ups of one place and the forearms; the whole face is quick photos. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { siteForMode, sitesFor } from '../src/features/checkin/places.ts'

test('RAW offers the one-place close-ups and the forearms, never the whole face', () => {
  const raw = sitesFor('calibrated_raw')
  assert.deepEqual(raw, ['left_cheek_macro', 'right_cheek_macro', 'forehead_macro', 'chin_macro', 'nose_macro', 'forearm_treated', 'forearm_control'])
  assert.ok(!raw.includes('face_full'))
  assert.ok(sitesFor('uncalibrated').includes('face_full'))
})

test('switching mode keeps the place when it can, else the nearest one', () => {
  assert.equal(siteForMode('face_full', 'calibrated_raw'), 'left_cheek_macro')
  assert.equal(siteForMode('nose_macro', 'calibrated_raw'), 'nose_macro')
  assert.equal(siteForMode('forearm_control', 'calibrated_raw'), 'forearm_control')
  assert.equal(siteForMode('right_cheek_macro', 'uncalibrated'), 'cheek_macro')
  assert.equal(siteForMode('forehead_macro', 'uncalibrated'), 'face_full')
  assert.equal(siteForMode('face_full', 'uncalibrated'), 'face_full')
})
