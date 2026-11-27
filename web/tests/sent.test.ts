/** `npm test`: the end of a whole check-in says where each place stands, honestly, while close-ups take minutes. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { placeState, sentTitle } from '../src/features/checkin/sent.ts'

const session = (status: 'uploading' | 'processing' | 'done' | 'failed', passed = true, minutesAgo = 1) => ({
  status,
  created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  result: status === 'done' ? ({ quality: { passed } } as never) : null,
})

test('a place still measuring says so, and a close-up says it takes minutes', () => {
  assert.deepEqual(placeState('face_full', session('processing')), { kind: 'measuring', line: 'Measuring', view: false })
  assert.equal(placeState('cheek_macro', session('processing')).line, 'Measuring · close-ups take a few minutes')
  // sent but not read back yet: still measuring
  assert.equal(placeState('cheek_macro', undefined).kind, 'measuring')
})

test('a finished place is ready, back for a retake, or did not finish; a stuck one is called out', () => {
  assert.equal(placeState('face_full', session('done')).kind, 'ready')
  assert.equal(placeState('face_full', session('done', false)).kind, 'retake')
  assert.equal(placeState('face_full', session('failed')).kind, 'failed')
  assert.equal(placeState('cheek_macro', session('processing', true, 11)).kind, 'slow')
  assert.ok(placeState('face_full', session('done')).view)
})

test('the title tells what is still on its way', () => {
  const face = placeState('face_full', session('done'))
  const cheek = placeState('cheek_macro', session('processing'))
  assert.equal(sentTitle([face, cheek]), 'Some places are ready')
  assert.equal(sentTitle([cheek]), 'All photos are in')
  assert.equal(sentTitle([face]), 'Your check-in is ready')
  assert.equal(sentTitle([face, placeState('face_full', session('failed'))]), 'Your check-in is back')
  assert.equal(sentTitle([]), 'Nothing was sent')
})
