/** `npm test`: Willow Proof "How it feels" helpers (self-reported shares, tags, felt vs measured, table cell). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AGREE_CELLS, agreeMissing, feltText, splitTags, verdictParts, verdictSummary } from '../src/features/retail/feel.ts'
import { briefHref } from '../src/features/retail/ui/insight.ts'

const tag = (t: string, good: boolean, n: number) => ({ tag: t, label: t, good, n, share: n / 100 })

test('verdict parts keep the order, show whole percents and fill the bar', () => {
  const parts = verdictParts({ working: 0.51, unsure: 0.25, not_for_me: 0.23 })
  assert.deepEqual(
    parts.map((p) => [p.id, p.text]),
    [
      ['working', '51%'],
      ['unsure', '25%'],
      ['not_for_me', '23%'],
    ],
  )
  // 2 dp shares that sum to 0.99 still fill exactly 100% of the bar.
  assert.ok(Math.abs(parts.reduce((s, p) => s + p.width, 0) - 100) < 1e-9)
  assert.equal(verdictParts({ working: 0, unsure: 0, not_for_me: 0 })[0].width, 0)
})

test('the bar has a text alternative with every share and the n', () => {
  assert.equal(verdictSummary({ n: 142, working: 0.51, unsure: 0.25, not_for_me: 0.23 }), 'Of 142 people who said how it feels: 51% It’s working for me, 25% Too soon to tell, 23% Not for me.')
})

test('tags split into liked and not liked, in the api order, capped', () => {
  const tags = [tag('absorbs', true, 44), tag('drying', false, 25), tag('feels_nice', true, 32), tag('heavy', false, 22), tag('softer', true, 12)]
  const { liked, notLiked } = splitTags(tags, 2)
  assert.deepEqual(
    liked.map((t) => t.tag),
    ['absorbs', 'feels_nice'],
  )
  assert.deepEqual(
    notLiked.map((t) => t.tag),
    ['drying', 'heavy'],
  )
})

test('felt vs measured reads as a 2×2 with the agreed sentences', () => {
  assert.deepEqual(
    AGREE_CELLS.map((c) => [c.key, c.felt, c.measured]),
    [
      ['both', true, true],
      ['measured_only', false, true],
      ['felt_only', true, false],
      ['neither', false, false],
    ],
  )
  assert.match(AGREE_CELLS[1].sentence, /^Changed but didn’t feel it yet: the people most likely to stop early\. Set expectations on timing\.$/)
  assert.match(agreeMissing({ tier: 'too_few', reason: 'not_measured' }), /no Willow measure/)
  assert.match(agreeMissing({ tier: 'proven' }), /10 or more people at week 8/)
})

test('the table cell is suppressed under 10 and carries its n otherwise', () => {
  assert.equal(feltText({ felt: null, felt_n: null }), null)
  assert.equal(feltText({ felt: undefined, felt_n: undefined }), null)
  assert.deepEqual(feltText({ felt: 0.51, felt_n: 142 }), { value: '51%', n: 'n=142', tip: '51% of 142 people said “It’s working for me” (self-reported)' })
})

test('the feel-gap brief card lands on the product’s How it feels panel', () => {
  assert.equal(briefHref({ id: 'feel_gap', link: { section: 'products', id: 'plum-x' } }, '?cohort=simulated'), '/retail/products/plum-x?cohort=simulated#feel')
  assert.equal(briefHref({ id: 'top_proven', link: { section: 'products', id: 'plum-x' } }), '/retail/products/plum-x')
})
