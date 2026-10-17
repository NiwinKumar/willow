/** `npm test`: "How it feels": words matching the api, which product the routine nudge asks about, and the felt-vs-readings line. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RoutineEntry } from '../src/data/types.ts'
import { MAX_TAGS, TAGS, VERDICTS, feelNudge, feelVsReadings, nudgeQuestion, saidLine, snoozed, toggleTag, weekOf } from '../src/features/routine/feel.ts'

const TODAY = '2026-10-17'
const entry = (id: string, started_at: string, extra: Partial<RoutineEntry> = {}): RoutineEntry => ({
  id,
  product_id: null,
  custom_name: id,
  brand: '',
  category: 'serum',
  key_actives: [],
  inci: [],
  started_at,
  ended_at: null,
  slots: ['pm'],
  concerns: [],
  source: 'manual',
  ...extra,
})
const said = (at: string) => ({ feel: { verdict: 'working' as const, tags: [], week: 2, at: `${at}T09:00:00+00:00` } })

test('verdict and tag ids and words match api/app/feel.py, good tags first', () => {
  assert.deepEqual(
    VERDICTS.map((v) => [v.id, v.label]),
    [
      ['working', "It's working for me"],
      ['unsure', 'Too soon to tell'],
      ['not_for_me', 'Not for me'],
    ],
  )
  assert.deepEqual(
    TAGS.map((t) => [t.id, t.label, t.good]),
    [
      ['feels_nice', 'Nice to use', true],
      ['absorbs', 'Absorbs well', true],
      ['softer', 'Skin feels softer', true],
      ['looks_better', 'Looks better', true],
      ['heavy', 'Heavy or sticky', false],
      ['stings', 'Stings or tingles', false],
      ['drying', 'Dries my skin', false],
      ['breakouts', 'More breakouts', false],
    ],
  )
  assert.equal(MAX_TAGS, 4)
})

test('weeks count like the api: whole weeks from the start, 0 in the first week', () => {
  assert.equal(weekOf('2026-10-17', TODAY), 0)
  assert.equal(weekOf('2026-10-11', TODAY), 0)
  assert.equal(weekOf('2026-10-10', TODAY), 1)
  assert.equal(weekOf('2026-09-19', TODAY), 4)
  assert.equal(weekOf('2026-10-20', TODAY), 0)
})

test('tags toggle and stop at four', () => {
  assert.deepEqual(toggleTag([], 'absorbs'), ['absorbs'])
  assert.deepEqual(toggleTag(['absorbs', 'heavy'], 'absorbs'), ['heavy'])
  const four = ['feels_nice', 'absorbs', 'softer', 'heavy'] as const
  assert.deepEqual(toggleTag([...four], 'stings'), [...four])
  assert.deepEqual(toggleTag([...four], 'heavy'), ['feels_nice', 'absorbs', 'softer'])
})

test('"You said" names the week, and the first week in words', () => {
  assert.equal(saidLine({ verdict: 'unsure', week: 0 }), 'You said “Too soon to tell” in your first week.')
  assert.equal(saidLine({ verdict: 'working', week: 3 }), 'You said “It\'s working for me” in week 3.')
})

test('nudge: in use 14 days or more, no answer in the last 14 days', () => {
  assert.equal(feelNudge([entry('a', '2026-10-04')], TODAY), null, '13 days is too early')
  assert.equal(feelNudge([entry('a', '2026-10-03')], TODAY)?.entry.id, 'a')
  assert.equal(feelNudge([entry('a', '2026-09-01', said('2026-10-04'))], TODAY), null, 'answered 13 days ago')
  assert.equal(feelNudge([entry('a', '2026-09-01', said('2026-10-03'))], TODAY)?.entry.id, 'a', 'answered 14 days ago')
  const n = feelNudge([entry('a', '2026-09-26')], TODAY)!
  assert.deepEqual([n.weeks, n.stopped], [3, false])
  assert.equal(feelNudge([entry('a', '2026-11-01')], TODAY), null, 'a future start')
})

test('nudge: stopped in the last 14 days after 7 or more days of use, never answered', () => {
  assert.equal(feelNudge([entry('s', '2026-09-20', { ended_at: '2026-10-10' })], TODAY)?.entry.id, 's')
  const n = feelNudge([entry('s', '2026-09-20', { ended_at: '2026-10-10' })], TODAY)!
  assert.deepEqual([n.weeks, n.stopped], [2, true], 'weeks of use, up to the stop')
  assert.equal(feelNudge([entry('s', '2026-09-20', { ended_at: '2026-10-02' })], TODAY), null, 'stopped 15 days ago')
  assert.equal(feelNudge([entry('s', '2026-10-05', { ended_at: '2026-10-11' })], TODAY), null, 'only 6 days of use')
  assert.equal(feelNudge([entry('s', '2026-09-20', { ended_at: '2026-10-10', ...said('2026-10-01') })], TODAY), null, 'already answered once')
})

test('nudge: at most one product, oldest start first', () => {
  const list = [entry('new', '2026-09-30'), entry('old', '2026-08-01'), entry('mid', '2026-09-01', { ended_at: '2026-10-12' })]
  assert.equal(feelNudge(list, TODAY)?.entry.id, 'old')
  assert.equal(feelNudge([], TODAY), null)
})

test('nudge question', () => {
  assert.equal(nudgeQuestion({ weeks: 3, stopped: false }, 'Night serum'), 'Quick check: how’s Night serum after 3 weeks?')
  assert.equal(nudgeQuestion({ weeks: 1, stopped: true }, 'Toner'), 'Quick check: how was Toner over 1 week?')
})

test('"Not now" holds until the stored day', () => {
  assert.equal(snoozed(null, TODAY), false)
  assert.equal(snoozed('2026-10-24', TODAY), true)
  assert.equal(snoozed('2026-10-17', TODAY), false)
  assert.equal(snoozed('garbage', TODAY), false)
})

test('felt vs readings: one line, never a cause, nothing to compare when unmeasured', () => {
  assert.equal(feelVsReadings('working', 'none'), 'Readings often trail what you feel. Keep checking in weekly to see if they catch up.')
  assert.equal(feelVsReadings('working', 'unmeasured'), null)
  assert.equal(feelVsReadings('not_for_me', 'unmeasured'), null)
  for (const v of ['working', 'unsure', 'not_for_me'] as const)
    for (const k of ['real', 'none', 'early'] as const) {
      const line = feelVsReadings(v, k)!
      assert.ok(line.length > 0)
      assert.doesNotMatch(line, /\d/, 'no numbers of its own')
      assert.doesNotMatch(line, /\b(caused|because of|thanks to|works)\b/i, `${v}/${k}: never claims cause`)
    }
})
