/** `npm test`: Willow Proof · Promote words, dates, errors and the holdout interval (features/retail/promote.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { answerLine, audienceText, barHeights, blockedReasons, campaignSummary, createTarget, liftWords, reachRange, ctrText, dateRange, durationText, exampleWhy, listText, notEligibleOrder, previewItem, promoError, runningCount, skinText, timeLeft, wilson, workspaceId, DISCLOSURE } from '../src/features/retail/promote.ts'

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
  assert.equal(durationText({ days: 14, status: 'active', starts_at: '2026-10-16T10:00:00+00:00', ends_at: '2026-10-30T10:00:00+00:00' }), '14 days')
  assert.equal(durationText({ days: 14, status: 'ended', starts_at: '2026-10-16T10:00:00+00:00', ends_at: '2026-10-16T16:00:00+00:00' }), 'ended early after 1 day of 14')
  assert.equal(durationText({ days: 7, status: 'ended', starts_at: '2026-10-01T10:00:00+00:00', ends_at: '2026-10-08T10:00:00+00:00' }), '7 days')
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

test('campaigns: audience, create target, blocked reasons', () => {
  assert.equal(audienceText(['oil_glow'], []), 'Shine and glow · all eligible skin types')
  assert.equal(audienceText(['oil_glow', 'lines'], ['oily']), 'Shine and glow, Lines · Oily')
  assert.deepEqual(createTarget('prod-a', null), { open: true, product: 'prod-a' })
  assert.deepEqual(createTarget('1', 'prod-b'), { open: true, product: 'prod-b' })
  assert.deepEqual(createTarget(null, 'prod-c'), { open: true, product: 'prod-c' })
  assert.deepEqual(createTarget('1', null), { open: true, product: null })
  assert.deepEqual(createTarget(null, null), { open: false, product: null })
  const ok = { eligible: true, brand: 'Plum', reasons: [] }
  assert.deepEqual(blockedReasons(ok, null), [])
  assert.deepEqual(blockedReasons(ok, 'Plum'), [])
  assert.match(blockedReasons(ok, 'COSRX')[0], /promotes its own products; this one is Plum’s/)
  assert.deepEqual(blockedReasons({ eligible: false, brand: 'Plum', reasons: ['About 5 more people at week 8 would make it Proven.'] }, null), ['About 5 more people at week 8 would make it Proven.'])
  assert.deepEqual(blockedReasons(undefined, null), ['This product isn’t in the catalog.'])
})

test('reach is a range: the largest goal up to every goal added, capped by the skin types', () => {
  const cells = [
    { skin: 'oily', goal: 'a', users: 100 },
    { skin: 'dry', goal: 'a', users: 50 },
    { skin: 'oily', goal: 'b', users: 80 },
    { skin: 'dry', goal: 'b', users: null },
    { skin: 'normal', goal: 'a', users: 999 },
  ]
  assert.deepEqual(reachRange(cells, ['a'], ['oily', 'dry']), { lo: 150, hi: 150 })
  assert.deepEqual(reachRange(cells, ['a', 'b'], ['oily', 'dry']), { lo: 150, hi: 230 })
  assert.deepEqual(reachRange(cells, ['a', 'b'], ['oily', 'dry'], [{ id: 'oily', users: 120 }, { id: 'dry', users: 60 }]), { lo: 150, hi: 180 })
  assert.equal(reachRange(cells, [], ['oily']), null)
  assert.equal(reachRange(cells, ['b'], ['dry']), null)
})

test('campaign summary and lift words', () => {
  const st = (impressions: number, lift: number | null, reach?: number) => ({ reach, impressions, clicks: 0, adds: 0, ctr: null, daily: [], incrementality_note: '', incrementality: lift === null ? null : { exposed: { n: 10, added: 1, rate: 0.1 }, holdout: { n: 10, added: 0, rate: 0 }, lift, lift_lo: 0, lift_hi: 0.2 } })
  const s = campaignSummary([
    { status: 'active', stats: st(1200, 0.06) },
    { status: 'paused', stats: st(40, null) },
  ])
  // an older api sent no reach: the page falls back to impressions
  assert.deepEqual(s, { active: 1, reach: null, impressions: 1240, lifts: [0.06] })
  const r = campaignSummary([
    { status: 'active', stats: st(1200, 0.06, 300) },
    { status: 'ended', stats: st(40, null, 25) },
  ])
  assert.deepEqual(r, { active: 1, reach: 325, impressions: 1240, lifts: [0.06] })
  assert.deepEqual(liftWords(0.06), { figure: '+6 pts', dir: 'above' })
  assert.deepEqual(liftWords(-0.03), { figure: '3 pts', dir: 'below' })
  assert.deepEqual(liftWords(0.001), { figure: '', dir: 'level with' })
})

test('the campaign page: day of the run, funnel and boosted adds', async () => {
  const { runDay, funnelSteps, boostedAdds, shareText } = await import('../src/features/retail/promote.ts')
  const c = { status: 'active' as const, days: 14 as const, starts_at: '2026-10-16T10:00:00+00:00', ends_at: '2026-10-30T10:00:00+00:00' }
  assert.deepEqual(runDay(c, new Date('2026-10-18T12:00:00Z')), { day: 3, of: 14 })
  assert.equal(runDay(c, new Date('2026-10-31T00:00:00Z')), null)
  assert.equal(runDay({ ...c, status: 'ended' }, new Date('2026-10-18T12:00:00Z')), null)
  const f = funnelSteps({ impressions: 200, clicks: 20, adds: 5 })
  assert.deepEqual(f.map((s) => s.value), [200, 20, 5])
  assert.deepEqual(f.map((s) => s.share), [1, 0.1, 0.025])
  assert.equal(funnelSteps({ impressions: 0, clicks: 0, adds: 0 })[1].share, null)
  assert.equal(shareText(0.033), '3.3%')
  assert.equal(shareText(0.0004), '<0.1%')
  assert.equal(shareText(null), '—')
  assert.equal(boostedAdds(null), null)
  const inc = { exposed: { n: 80, added: 20, rate: 0.25 }, holdout: { n: 20, added: 2, rate: 0.1 }, lift: 0.15, lift_lo: 0.05, lift_hi: 0.25 }
  assert.deepEqual(boostedAdds(inc), { n: 12, lo: 4, hi: 20 })
})

test('campaign insight words the verdict only when it is measured', async () => {
  const { campaignInsight, cumulativeDays, ownRecordInsight } = await import('../src/features/retail/promote.ts')
  const base = { status: 'active' as const, stats: { reach: 34, impressions: 34, clicks: 9, adds: 3, ctr: 0.26, daily: [], incrementality: null, incrementality_note: '' } }
  assert.equal(campaignInsight({ ...base, stats: { ...base.stats, impressions: 0, reach: 0 } }).tone, 'wait')
  const wait = campaignInsight(base)
  assert.equal(wait.tone, 'wait')
  assert.match(wait.detail, /34 people have seen the card; 9 clicked through and 3 added it to their routine/)
  const g = (lift: number, lo: number, hi: number) => ({ ...base, stats: { ...base.stats, incrementality: { exposed: { n: 80, added: 20, rate: 0.25 }, holdout: { n: 20, added: 2, rate: 0.1 }, lift, lift_lo: lo, lift_hi: hi } } })
  assert.equal(campaignInsight(g(0.15, 0.05, 0.25)).tone, 'good')
  assert.match(campaignInsight(g(0.15, 0.05, 0.25)).detail, /25 in 100 .* against 10 in 100/)
  assert.equal(campaignInsight(g(0.05, -0.04, 0.14)).tone, 'wait')
  assert.equal(campaignInsight(g(-0.1, -0.2, -0.01)).tone, 'neutral')
  assert.deepEqual(cumulativeDays([{ day: 'a', impressions: 5, clicks: 1, adds: 0 }, { day: 'b', impressions: 7, clicks: 2, adds: 1 }]).map((d) => d.values), [[5, 1, 0], [12, 3, 1]])
  assert.equal(ownRecordInsight({ rate: null, base_rate: 0.3, n: 40 }), null)
  assert.match(ownRecordInsight({ rate: 0.64, base_rate: 0.29, n: 67 })!, /^64 in 100 of its users .* 29 in 100 non-users/)
})
