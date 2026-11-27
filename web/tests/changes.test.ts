/** `npm test`: "What's been different since your last check-in?" chips, their finer chips and the routine lines. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CHANGE_GROUPS, addTags, changesQuestion, routineLines, toggleTag } from '../src/lib/changes.ts'

test('every chip is a distinct api tag, in the groups the check-in asks', () => {
  const tags = CHANGE_GROUPS.flatMap((g) => g.chips.flatMap((c) => [c.tag, ...(c.more ?? []).map((m) => m.tag)]))
  assert.equal(new Set(tags).size, tags.length)
  assert.equal(tags.length, 25) // api app/changes.py TAGS
  assert.deepEqual(
    CHANGE_GROUPS.map((g) => g.id),
    ['period', 'stress', 'sleep', 'travel', 'sport', 'sun', 'diet', 'routine', 'health'],
  )
})

test('a finer chip picks its parent, and dropping the parent drops the finer chips', () => {
  let tags = toggleTag([], 'travel_humid')
  assert.deepEqual(tags, ['travel', 'travel_humid'])
  tags = toggleTag(tags, 'sun')
  tags = toggleTag(tags, 'travel')
  assert.deepEqual(tags, ['sun'])
  assert.deepEqual(toggleTag(['sun'], 'sun'), [])
})

test('tags read from the person’s words are added, never removing what they picked', () => {
  assert.deepEqual(addTags(['period'], ['diet_sugar', 'period']), ['period', 'diet', 'diet_sugar'])
})

test('the question names the last check-in, or asks about this week on a first one', () => {
  assert.equal(changesQuestion('2026-11-20'), 'What’s been different since 20 Nov?')
  assert.equal(changesQuestion(null), 'Anything going on this week?')
})

test('routine lines say what started or stopped and how often it was used', () => {
  assert.deepEqual(
    routineLines([
      { name: 'Mandelic 8% Serum', brand: 'Mixi', started: '2026-11-22', stopped: null, use: { days_used: 5, of_days: 7 } },
      { name: 'Gel Cleanser', brand: 'Face Reality', started: null, stopped: null, use: { days_used: 12, of_days: 14 } },
      { name: 'Old toner', brand: '', started: null, stopped: '2026-11-21', use: null },
      { name: 'Unused', brand: 'X', started: null, stopped: null, use: null },
    ]),
    ['Started Mixi Mandelic 8% Serum on 22 Nov · used 5 of 7 days', 'Face Reality Gel Cleanser · used 12 of 14 days', 'Stopped Old toner on 21 Nov'],
  )
})
