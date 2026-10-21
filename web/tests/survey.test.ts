/** `npm test`: the survey's flow (docs/SURVEY.md): which screens show, early endings, choice limits, option order, link sources. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { QUESTIONS, endingFor, ordered, prune, screens, sourceOf, toggle } from '../src/survey/flow.ts'

const q = (id: string) => QUESTIONS.find((x) => x.id === id)!
const ids = (answers: Record<string, string | string[]>) => screens(answers).map((x) => x.id)

test('the idea comes after every question about how people judge skincare today', () => {
  const order = ids({ bought_3m: '2_3', last_sure: 'very', pilot: 'yes' })
  const idea = order.indexOf('idea')
  for (const before of ['last_sure', 'how_judged', 'weeks_to_tell', 'shelf', 'story']) assert.ok(order.indexOf(before) < idea, before)
  for (const after of ['useful', 'first_try', 'hesitate', 'pilot']) assert.ok(order.indexOf(after) > idea, after)
})

test('screens show only when they make sense', () => {
  assert.ok(!ids({ bought_3m: '0' }).includes('where_buy'), 'no purchases, no "where did you buy them"')
  assert.ok(ids({ bought_3m: '1' }).includes('where_buy'))
  assert.ok(!ids({ last_sure: 'none_recent' }).includes('how_judged'))
  assert.ok(!ids({ pilot: 'no', chat: 'no' }).includes('email'), 'no email asked of someone who said no to both')
  assert.ok(ids({ pilot: 'maybe' }).includes('email'))
  assert.ok(ids({ pilot: 'no', chat: 'yes' }).includes('email'))
})

test('under 18 and no routine end the survey early', () => {
  assert.equal(endingFor(q('age'), 'under_18'), 'minor')
  assert.equal(endingFor(q('age'), '25_34'), null)
  assert.equal(endingFor(q('products_yesterday'), '0'), 'no_routine')
  assert.equal(endingFor(q('products_yesterday'), '1_2'), null)
})

test('changing an earlier answer drops answers to screens that no longer show', () => {
  const kept = prune({ bought_3m: '0', where_buy: ['quick'], goals: ['redness'] })
  assert.deepEqual(kept, { bought_3m: '0', goals: ['redness'] })
})

test('any number of goals, and "nothing in particular" goes alone', () => {
  const goals = q('goals')
  let r = toggle(goals, ['redness', 'lines', 'oil'], 'texture')
  assert.equal(r.full, false)
  assert.deepEqual(r.next, ['redness', 'lines', 'oil', 'texture'])
  r = toggle(goals, ['redness', 'lines'], 'none')
  assert.deepEqual(r.next, ['none'])
  r = toggle(goals, ['none'], 'redness')
  assert.deepEqual(r.next, ['redness'])
  r = toggle(goals, ['redness'], 'redness')
  assert.deepEqual(r.next, [])
})

test('options are shuffled per person but stay put for that person, with fixed ones last', () => {
  const goals = q('goals')
  const a = ordered(goals, 12345).map((o) => o.id)
  assert.deepEqual(ordered(goals, 12345).map((o) => o.id), a)
  assert.equal(a.at(-1), 'none')
  assert.deepEqual([...a].sort(), goals.options!.map((o) => o.id).sort())
  const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ordered(goals, seed).map((o) => o.id).join()))
  assert.ok(orders.size > 1, 'different people see different orders')
  // ordered scales never move
  assert.deepEqual(ordered(q('useful'), 99).map((o) => o.id), q('useful').options!.map((o) => o.id))
})

test('each shared link names its channel', () => {
  assert.equal(sourceOf('?src=WA'), 'wa')
  assert.equal(sourceOf('?src=li<script>'), 'liscript')
  assert.equal(sourceOf(''), 'direct')
})
