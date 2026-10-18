/** `npm test`: places to track: the default from goals, cleaning a saved list, the choices, and the check-in's ?places=. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { choicesOf, cleanTrack, defaultTrack, minutesFor, parsePlaces, trackOf, withArms } from '../src/lib/track.ts'

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

test('the forearms are never a tracked place; an old save with them is cleaned', () => {
  assert.deepEqual(cleanTrack(['cheek_macro', 'forearm_treated', 'forearm_control']), ['cheek_macro'])
  assert.deepEqual(cleanTrack(['forearm_treated', 'forearm_control'], ['lines']), ['cheek_macro', 'face_full'])
  assert.deepEqual(trackOf(['cheek', 'face']), ['cheek_macro', 'face_full'])
  assert.deepEqual(choicesOf(['cheek_macro', 'nose_macro']), ['cheek', 'nose'])
})

test('a check-in includes both forearms only while a product test is running', () => {
  assert.deepEqual(withArms(['cheek_macro', 'face_full'], false), ['cheek_macro', 'face_full'])
  assert.deepEqual(withArms(['cheek_macro', 'face_full'], true), ['cheek_macro', 'face_full', 'forearm_treated', 'forearm_control'])
  assert.deepEqual(withArms(['cheek_macro'], true), ['cheek_macro', 'forearm_treated', 'forearm_control'])
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
