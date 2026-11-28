/** `npm test`: the spot diary week by week: which weeks show, areas, crops and counts. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SpotCheckIn, SpotCheckInView } from '../src/lib/api.ts'
import { areaBox, areaCounts, areasOf, countLine, shownWeeks, viewWithArea, viewsOf } from '../src/lib/spotDiary.ts'

const square = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
]
const view = (v: SpotCheckInView['view'], rois: SpotCheckInView['rois']): SpotCheckInView => ({
  view: v,
  photo: { url: 'u', width: 1000, height: 1200 },
  rois,
  marks: [],
  blemishes: 3,
  dark_spots: 1,
})
const week = (id: string, views: SpotCheckInView[], complete = true): SpotCheckIn => ({
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

test('a place is found again from the area\'s steadiest edge, and the mark there with it', async () => {
  const { areaFrame, toAreaPoint, fromAreaPoint, markAt, spotBox, startPoint } = await import('../src/lib/spotDiary.ts')
  // the forehead's top (hairline) moves between weeks; its bottom (the brows) and width stay
  const wk1 = view('front', [{ name: 'forehead', polygon: [[100, 300], [500, 300], [500, 500], [100, 500]] }])
  const wk2 = view('front', [{ name: 'forehead', polygon: [[120, 150], [520, 150], [520, 520], [120, 520]] }])
  const f1 = areaFrame(wk1, 'forehead')!
  const f2 = areaFrame(wk2, 'forehead')!
  assert.deepEqual(f1, { x: 300, y: 500, s: 400 })
  const p = toAreaPoint(f1, 260, 440) // 60 px above the brows
  assert.deepEqual(fromAreaPoint(f2, p), { x: 280, y: 460 }) // still 60 px above them
  wk2.marks = [
    { kind: 'blemish', x: 284, y: 455, r: 6, zone: 'forehead' },
    { kind: 'spot', x: 450, y: 300, r: 10, zone: 'forehead' },
  ]
  assert.equal(markAt(wk2, f2, p)?.kind, 'blemish')
  assert.equal(markAt(wk2, f2, { u: -0.4, v: -0.1 }), null)
  const s = spotBox(wk2, f2, p)
  assert.ok(s.x <= 280 && s.x + s.w >= 280 && s.y <= 460 && s.y + s.h >= 460)
  assert.deepEqual(startPoint(wk2, 'forehead', f2), toAreaPoint(f2, 450, 300)) // the biggest mark
  // the chin is found from the lip (its top), the nose from its middle
  const chin = view('front', [{ name: 'chin', polygon: [[0, 700], [200, 700], [200, 900], [0, 900]] }])
  assert.deepEqual(areaFrame(chin, 'chin'), { x: 100, y: 700, s: 200 })
})

test('a place is carried to another photo through the face landmarks around it', async () => {
  const { carry, markNear, boxAround } = await import('../src/lib/spotDiary.ts')
  // the same face, next week: 1.25x closer, shifted, and turned a little (a rotation)
  const from: [number, number][] = []
  for (let gx = 0; gx < 6; gx++) for (let gy = 0; gy < 6; gy++) from.push([200 + gx * 60, 200 + gy * 60])
  const a = 0.1
  const move = ([x, y]: [number, number]): [number, number] => [1.25 * (Math.cos(a) * x - Math.sin(a) * y) + 40, 1.25 * (Math.sin(a) * x + Math.cos(a) * y) - 30]
  const to = from.map(move)
  const got = carry(from, to, 333, 287)!
  const want = move([333, 287])
  assert.ok(Math.hypot(got.x - want[0], got.y - want[1]) < 0.01)
  assert.equal(carry(from, null, 1, 1), null)
  const v = view('front', [])
  v.marks = [{ kind: 'blemish', x: want[0] + 3, y: want[1], r: 4, zone: 'forehead' }]
  assert.equal(markNear(v, got.x, got.y, 10)?.kind, 'blemish')
  assert.equal(markNear(v, got.x + 40, got.y, 10), null)
  const b = boxAround(v, 5, 5, 100)
  assert.deepEqual([b.x, b.y], [0, 0]) // kept inside the photo
})

test('a front area is followed on the front photo, whole, with the cheek photos\' marks in it carried over', async () => {
  const { areaPhoto } = await import('../src/lib/spotDiary.ts')
  const grid: [number, number][] = []
  for (let gx = 0; gx < 6; gx++) for (let gy = 0; gy < 6; gy++) grid.push([gx * 100, gy * 100])
  const front = view('front', [{ name: 'chin', polygon: [[200, 400], [300, 400], [300, 500]] }])
  front.full_rois = [{ name: 'chin', polygon: [[100, 400], [400, 400], [400, 500]] }]
  front.landmarks = grid
  front.marks = [{ kind: 'blemish', x: 250, y: 450, r: 4, zone: 'chin' }]
  const right = view('right', [])
  right.landmarks = grid.map(([x, y]) => [x + 1000, y] as [number, number]) // the same face, elsewhere in its photo
  right.marks = [
    { kind: 'blemish', x: 1150, y: 450, r: 4, zone: 'chin' },
    { kind: 'blemish', x: 1300, y: 200, r: 4, zone: 'right_cheek' },
  ]
  const w = week('9', [front, right])
  const got = areaPhoto(w, 'chin', 'front')!
  assert.equal(got.view, 'front')
  assert.deepEqual(got.rois, front.full_rois) // the whole chin
  assert.equal(got.marks.length, 2) // its own, and the right photo's chin mark (not its cheek mark)
  assert.ok(Math.abs(got.marks[1].x - 150) < 0.01 && Math.abs(got.marks[1].y - 450) < 0.01)
  assert.equal(areaPhoto(w, 'right_cheek', 'front'), undefined) // cheeks: on their own photos only
})
