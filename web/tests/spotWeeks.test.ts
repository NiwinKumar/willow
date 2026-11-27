/** `npm test`: the spot diary week by week: which weeks show, areas, crops and counts. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SpotWeek, SpotWeekView } from '../src/lib/api.ts'
import { areaBox, areaCounts, areasOf, countLine, shownWeeks, viewWithArea, viewsOf } from '../src/lib/spotWeeks.ts'

const square = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
]
const view = (v: SpotWeekView['view'], rois: SpotWeekView['rois']): SpotWeekView => ({
  view: v,
  photo: { url: 'u', width: 1000, height: 1200 },
  rois,
  marks: [],
  blemishes: 3,
  dark_spots: 1,
})
const week = (id: string, views: SpotWeekView[], complete = true): SpotWeek => ({
  id,
  created_at: `2026-11-${id.padStart(2, '0')}T10:00:00Z`,
  complete,
  blemishes: 10,
  dark_spots: 4,
  by_zone: { right_cheek: { blemishes: 6, dark_spots: 2 }, forehead: { blemishes: 4 } },
  views,
})

test('the picker shows the last five check-ins, or all of them', () => {
  const weeks = Array.from({ length: 8 }, (_, i) => week(String(i + 1), []))
  assert.deepEqual(shownWeeks(weeks, false).map((w) => w.id), ['4', '5', '6', '7', '8'])
  assert.equal(shownWeeks(weeks, true).length, 8)
})

test('views in toggle order, and areas without the under-eye patches', () => {
  const w = week('1', [view('right', []), view('front', [{ name: 'left_under_eye', polygon: square(0, 0, 10) }, { name: 'forehead', polygon: square(0, 0, 10) }])])
  assert.deepEqual(viewsOf(w), ['front', 'right'])
  assert.deepEqual(areasOf(w.views[1]), ['forehead'])
})

test('an area crop is a square around its outline with a margin, kept inside the photo', () => {
  const v = view('right', [{ name: 'right_cheek', polygon: square(400, 500, 200) }])
  const b = areaBox(v, 'right_cheek')!
  assert.equal(b.w, b.h)
  assert.ok(b.x <= 400 && b.y <= 500 && b.x + b.w >= 600 && b.y + b.h >= 700)
  const edge = areaBox(view('right', [{ name: 'right_cheek', polygon: square(0, 0, 300) }]), 'right_cheek')!
  assert.ok(edge.x >= 0 && edge.y >= 0)
  assert.equal(areaBox(v, 'chin'), null)
})

test('an area comes from the photo that shows it; its counts are the check-in by area', () => {
  const front = view('front', [{ name: 'forehead', polygon: square(100, 100, 300) }])
  const right = view('right', [{ name: 'right_cheek', polygon: square(400, 500, 200) }])
  const w = week('3', [front, right])
  assert.equal(viewWithArea(w, 'right_cheek', 'front'), right)
  assert.deepEqual(areaCounts(w, 'right_cheek'), { blemishes: 6, darkSpots: 2 })
  // dark spots by area need every mark placed: unknown on an older check-in
  assert.deepEqual(areaCounts(week('4', [front, right], false), 'right_cheek'), { blemishes: 6, darkSpots: null })
})

test('count words', () => {
  assert.equal(countLine(1, 0), '1 blemish · 0 dark spots')
  assert.equal(countLine(53, null), '53 blemishes')
})
