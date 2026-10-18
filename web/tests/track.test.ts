/** `npm test`: places to track: the default from goals, cleaning a saved list, the choices, and the check-in's ?places=. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { choicesOf, cleanTrack, defaultTrack, minutesFor, parsePlaces, trackOf } from '../src/lib/track.ts'

test('the cheek close-up is always tracked by default; the face joins when a goal is only seen there', () => {
  assert.deepEqual(defaultTrack([]), ['cheek_macro'])
  assert.deepEqual(defaultTrack(['dark_spots', 'redness']), ['cheek_macro'])
  assert.deepEqual(defaultTrack(['dark_spots', 'lines']), ['cheek_macro', 'face_full'])
})

test('a saved list keeps known places in capture order and is never empty', () => {
  assert.deepEqual(cleanTrack(['face_full', 'moon', 'cheek_macro', 'face_full']), ['cheek_macro', 'face_full'])
  assert.deepEqual(cleanTrack([], ['under_eye']), ['cheek_macro', 'face_full'])
  assert.deepEqual(cleanTrack(null), ['cheek_macro'])
  assert.deepEqual(cleanTrack('cheek_macro'), ['cheek_macro'])
})

test('the forearms are one choice and two places', () => {
  assert.deepEqual(trackOf(['arms', 'cheek']), ['cheek_macro', 'forearm_treated', 'forearm_control'])
  assert.deepEqual(choicesOf(['cheek_macro', 'forearm_treated', 'forearm_control']), ['cheek', 'arms'])
  // one arm alone is not the arms choice
  assert.deepEqual(choicesOf(['forearm_treated']), [])
})

test('a check-in takes about a minute per place or two, rounded up', () => {
  assert.equal(minutesFor(['cheek_macro']), 1)
  assert.equal(minutesFor(['cheek_macro', 'face_full']), 2)
  assert.equal(minutesFor(['cheek_macro', 'nose_macro', 'face_full', 'forearm_treated', 'forearm_control']), 4)
})

test('?places= gives the known places in capture order', () => {
  assert.deepEqual(parsePlaces('face_full,cheek_macro'), ['cheek_macro', 'face_full'])
  assert.deepEqual(parsePlaces('moon,,face_full'), ['face_full'])
  assert.deepEqual(parsePlaces(null), [])
  assert.deepEqual(parsePlaces(''), [])
})
