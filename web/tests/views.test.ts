/** `npm test`: a face check-in with cheek photos shows each photo with its own marks and areas. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AnalysisResult, Candidate, ResultView, Session } from '../src/data/types.ts'
import { candidateView, shownViews, viewSession } from '../src/features/progress/views.ts'

const cand = (id: string, view: number, frame: number): Candidate => ({ id, kind: 'spot', bbox: [10, 10, 4, 4], features: { view, frame_index: frame } })
const rv = (view: 'front' | 'right' | 'left', frame: number): ResultView => ({
  view,
  frame_index: frame,
  image_size: { width: 1000 + frame, height: 1200 },
  preview_uri: `gs://b/${view}.jpg`,
  rois: [{ name: view === 'front' ? 'forehead' : `${view}_cheek`, polygon: [[0, 0], [9, 0], [9, 9]] }],
})
const result = {
  candidates: [cand('c_001', 0, 0), cand('c_002', 1, 2), cand('c_003', 2, 3), { id: 'c_004', kind: 'blemish', bbox: [1, 1, 2, 2] }],
  views: [rv('front', 0), rv('right', 2), rv('left', 3)],
  rois: [],
  image_size: { width: 1, height: 1 },
} as unknown as AnalysisResult
const session = { id: 's', result } as unknown as Session

test('each mark belongs to the view it was found on; older marks to the front', () => {
  assert.deepEqual(result.candidates.map(candidateView), ['front', 'right', 'left', 'front'])
})

test('views are shown front, left, right, and only when their photo is signed', () => {
  assert.deepEqual(
    shownViews(result, [{ view: 'right' }, { view: 'front' }, { view: 'left' }]).map((v) => v.view),
    ['front', 'left', 'right'],
  )
  assert.deepEqual(
    shownViews(result, [{ view: 'front' }]).map((v) => v.view),
    ['front'],
  )
  assert.deepEqual(shownViews(null, []), [])
})

test('a view draws its own photo, areas and marks', () => {
  const left = viewSession(session, result.views![2], { url: 'https://left', width: null, height: null })
  assert.equal(left.preview?.url, 'https://left')
  assert.deepEqual(left.result?.image_size, { width: 1003, height: 1200 })
  assert.deepEqual(
    left.result?.rois?.map((r) => r.name),
    ['left_cheek'],
  )
  assert.deepEqual(
    left.result?.candidates.map((c) => c.id),
    ['c_003'],
  )
  const front = viewSession(session, result.views![0], { url: 'https://front', width: 800, height: 900 })
  assert.deepEqual(
    front.result?.candidates.map((c) => c.id),
    ['c_001', 'c_004'],
  )
})
