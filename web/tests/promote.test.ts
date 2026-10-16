/** `npm test`: Willow Proof · Promote words, dates, errors and the holdout interval (features/retail/promote.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { answerLine, barHeights, ctrText, dateRange, exampleWhy, listText, notEligibleOrder, previewItem, promoError, runningCount, skinText, timeLeft, wilson, workspaceId, DISCLOSURE } from '../src/features/retail/promote.ts'

const p = (brand: string, eligible: boolean) => ({ brand, eligible })

test('the answer line counts eligible products and, in brand view, yours', () => {
  const all = [p('COSRX', true), p('COSRX', true), p('Plum', true), p('Plum', false)]
  assert.equal(answerLine(all, null), '3 of 4 products clear the evidence bar and can be promoted.')
  assert.equal(answerLine(all, 'COSRX'), '3 products clear the evidence bar; 2 of them are yours.')
  assert.equal(answerLine(all, 'Plum'), '3 products clear the evidence bar; 1 of them is yours.')
  assert.equal(answerLine(all, 'Minimalist'), '3 products clear the evidence bar; none of them are Minimalist’s yet.')
  assert.equal(answerLine([p('Plum', true)], 'Plum'), '1 product clears the evidence bar; it is yours.')
  assert.equal(answerLine([p('Plum', false)], null), 'None of the 1 product clears the evidence bar yet, so nothing can be promoted.')
})

test('lists and skin types read as words', () => {
  assert.equal(listText(['A']), 'A')
  assert.equal(listText(['A', 'B', 'C']), 'A, B and C')
  assert.equal(skinText(['oily', 'dry']), 'Oily and Dry')
  assert.equal(skinText([], ['oily', 'combination']), 'All eligible skin types (oily, combination)')
  assert.equal(skinText([]), 'All eligible skin types')
})

test('dates and time left use UTC days', () => {
  assert.equal(dateRange('2026-10-16T10:00:00+00:00', '2026-10-30T10:00:00+00:00'), '16 Oct – 30 Oct')
  const now = new Date('2026-10-16T12:00:00Z')
  assert.equal(timeLeft({ status: 'active', ends_at: '2026-10-30T10:00:00+00:00' }, now), '14 days left')
  assert.equal(timeLeft({ status: 'active', ends_at: '2026-10-17T10:00:00+00:00' }, now), 'Last day')
  assert.equal(timeLeft({ status: 'ended', ends_at: '2026-10-15T10:00:00+00:00' }, now), 'Ended 15 Oct')
})

test('CTR keeps one decimal and no impressions is a dash', () => {
  assert.equal(ctrText(0.033), '3.3%')
  assert.equal(ctrText(0), '0.0%')
  assert.equal(ctrText(null), '—')
})

test('Wilson interval matches the api method', () => {
  assert.deepEqual(wilson(12, 40), [0.18, 0.45])
  assert.deepEqual(wilson(0, 10), [0, 0.28])
  assert.equal(wilson(1, 0), null)
})

test('api errors become words, with the reasons the api sent', () => {
  const ne = promoError({ status: 422, code: 'not_eligible', message: 'no', detail: { reasons: ['Only products rated Proven can be promoted.'] } })
  assert.equal(ne.kind, 'not_eligible')
  assert.deepEqual(ne.reasons, ['Only products rated Proven can be promoted.'])
  assert.equal(promoError({ status: 429, code: 'too_many_active', message: '' }).kind, 'too_many')
  assert.equal(promoError({ status: 429, code: 'rate_limited', message: '' }).kind, 'rate')
  assert.equal(promoError({ status: 409, code: 'ended', message: '' }).kind, 'ended')
  assert.equal(promoError(new TypeError('fetch failed')).title, 'Couldn’t reach Willow')
})

test('the preview carries the consumer disclosure and an example match', () => {
  const item = previewItem({ product_id: 'x', product: 'Gel', brand: 'Plum', evidence: 'Measured in 30 Willow users' }, { image_url: null, category: 'serum' })
  assert.equal(item.label, 'Sponsored')
  assert.equal(item.disclosure, DISCLOSURE)
  const why = exampleWhy(['oil_glow', 'pores_texture'], [], ['combination'])
  assert.deepEqual(why.matched, ['Your goal: Shine and glow', 'Your skin type: Combination'])
})

test('helpers: running count, workspace, order, bars', () => {
  assert.equal(runningCount([{ status: 'active' }, { status: 'paused' }, { status: 'ended' }, { status: 'active' }]), 2)
  assert.equal(workspaceId({ kind: 'retailer' }), 'retailer')
  assert.equal(workspaceId({ kind: 'brand', brand: 'COSRX' }), 'COSRX')
  const e = (tier: 'promising' | 'too_few' | 'unclear', product: string) => ({ product_id: product, product, brand: 'B', tier, eligible: false, reasons: [], goals: [], skin_types: [], evidence: '' })
  assert.deepEqual([e('too_few', 'a'), e('promising', 'b'), e('unclear', 'c')].sort(notEligibleOrder).map((x) => x.product), ['b', 'c', 'a'])
  assert.deepEqual(barHeights([0, 2, 4]), [0, 0.5, 1])
  assert.deepEqual(barHeights([0, 0]), [0, 0])
})
