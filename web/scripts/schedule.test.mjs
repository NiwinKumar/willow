// Check-in schedule rules (src/lib/schedule.ts): due, late, done, next day, chips, gap length, calendar.
// Run: npm test (node's own test runner; Node 22.18+ reads the TypeScript directly).
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkinOf, dueChips, dueOf, gapDaysFor, icsFor, longestInterval, scheduleText, weeklyDayOf } from '../src/lib/schedule.ts'

const MWF = { days: [0, 2, 4], time: '08:30', tz: 'Europe/London' }
// Local dates (the device's own calendar): Thu 15 Oct 2026 is a Thursday.
const d = (day, h = 9) => new Date(2026, 9, day, h)

test('reads the schedule from GET /v1/me and ignores bad values', () => {
  assert.equal(checkinOf(undefined), null)
  assert.equal(checkinOf({ profile: null }), null)
  assert.equal(checkinOf({ profile: { checkin: { days: [], time: '08:00', tz: 'UTC' } } }), null)
  assert.equal(checkinOf({ profile: { checkin: { days: [9], time: '08:00', tz: 'UTC' } } }), null)
  assert.deepEqual(checkinOf({ profile: { checkin: { days: [4, 0, 4, 2], time: '08:30', tz: 'Europe/London' } } }), MWF)
})

test('due on a scheduled day until a check-in that day', () => {
  const wed = d(14)
  assert.equal(dueOf(MWF, [d(12)], wed).kind, 'due')
  assert.equal(dueOf(MWF, [d(12)], wed).label, 'Check-in due today')
  const done = dueOf(MWF, [d(12), d(14, 8)], wed)
  assert.equal(done.kind, 'done')
  assert.equal(done.label, 'Next check-in Fri 16 Oct')
})

test('late counts days since the missed scheduled day', () => {
  // Last check-in Mon 12, Wed 14 missed, today Thu 15.
  const late = dueOf(MWF, [d(12)], d(15))
  assert.equal(late.kind, 'late')
  assert.equal(late.lateDays, 1)
  assert.equal(late.label, 'Check-in 1 day late')
  // Weekly on Saturday, last check-in Sat 3 Oct, today Mon 12 Oct: Sat 10 missed, 2 days late.
  const sat = { days: [5], time: '10:00', tz: 'UTC' }
  assert.equal(dueOf(sat, [d(3)], d(12)).short, '2 days late')
})

test('upcoming when nothing was missed', () => {
  const up = dueOf(MWF, [d(14)], d(15))
  assert.equal(up.kind, 'upcoming')
  assert.equal(up.label, 'Next check-in Fri 16 Oct')
  assert.equal(up.short, null)
})

test('after a long gap it is simply due today, not counted as late', () => {
  const back = dueOf(MWF, [d(1)], d(15)) // 14 days >= 2 x 3-day interval
  assert.equal(back.kind, 'due')
})

test('gap length is twice the longest stretch between scheduled days', () => {
  assert.equal(longestInterval(MWF), 3) // Fri -> Mon
  assert.equal(gapDaysFor(MWF), 6)
  assert.equal(gapDaysFor({ days: [5], time: '10:00', tz: 'UTC' }), 14)
  assert.equal(gapDaysFor({ days: [0, 1, 2, 3, 4, 5, 6], time: '10:00', tz: 'UTC' }), 2)
  assert.equal(gapDaysFor(null), 14)
})

test('weekly day is the first scheduled day; chips name the place and day', () => {
  assert.equal(weeklyDayOf(MWF), 0)
  assert.equal(weeklyDayOf(null), null)
  const thu = d(15)
  const up = dueOf(MWF, [d(14)], thu)
  assert.deepEqual(dueChips(MWF, up, { wanted: true, doneToday: false }, thu), ['Face · Fri', 'Cheek close-up · Fri'])
  const fri = d(16)
  assert.deepEqual(dueChips(MWF, dueOf(MWF, [d(14)], fri), { wanted: true, doneToday: false }, fri), ['Face · due', 'Cheek close-up · due'])
  assert.deepEqual(dueChips(MWF, dueOf(MWF, [d(14)], fri), { wanted: false, doneToday: false }, fri), ['Face · due'])
})

test('schedule text', () => {
  assert.equal(scheduleText(MWF), 'Mon, Wed and Fri at 08:30')
  assert.equal(scheduleText({ days: [5], time: '10:00', tz: 'UTC' }), 'Saturday at 10:00')
  assert.equal(scheduleText({ days: [0, 1, 2, 3, 4, 5, 6], time: '07:00', tz: 'UTC' }), 'Every day at 07:00')
})

test('calendar fallback is a weekly event with an alert', () => {
  const ics = icsFor(MWF, 'https://willow-511508.web.app', d(15))
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR\r\n/)
  assert.match(ics, /DTSTART:20261016T083000\r\n/)
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY/)
  assert.match(ics, /URL:https:\/\/willow-511508\.web\.app\/home/)
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75))
})
