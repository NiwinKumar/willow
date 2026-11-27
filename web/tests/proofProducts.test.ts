/** `npm test`: Willow Proof product screens' pure helpers (compare ids, intervals, brand shares, evidence pack). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { packCsv, packHtml, packMarkdown, packName, statementLine } from '../src/features/retail/evidencePack.ts'
import { bestSeg, brandShares, categorySpot, filterRows, hintOf, productsLead, sortRows, leaderOf, money, noDataReason, parseIds, rivalOf, segInterval, toggleId, verdictLine, wilson } from '../src/features/retail/productModel.ts'
import type { ProductDetail, ProductRow } from '../src/features/retail/types.ts'

function row(p: Partial<ProductRow> & { product_id: string }): ProductRow {
  return {
    product: p.product_id,
    brand: 'B',
    category: 'serum',
    category_label: 'Serums',
    goal_ids: ['redness'],
    price_tier: 'mid',
    image_url: null,
    users: 100,
    n: 40,
    rate: 0.5,
    rate_lo: 0.35,
    rate_hi: 0.65,
    base_rate: 0.3,
    lift: 0.2,
    lift_lo: 0.01,
    lift_hi: 0.39,
    weeks: 6,
    cont8: 0.7,
    routine_share: 0.2,
    tier: 'proven',
    ...p,
  }
}

test('compare ids are trimmed, unique and capped at three', () => {
  assert.deepEqual(parseIds('a, b,,a,c,d'), ['a', 'b', 'c'])
  assert.deepEqual(parseIds(null), [])
  assert.deepEqual(toggleId(['a', 'b'], 'c'), ['a', 'b', 'c'])
  assert.deepEqual(toggleId(['a', 'b', 'c'], 'd'), ['a', 'b', 'c'])
  assert.deepEqual(toggleId(['a', 'b', 'c'], 'b'), ['a', 'c'])
})

test('wilson matches the api (retailer._wilson) and segment cells reuse it', () => {
  assert.deepEqual(wilson(40, 63), [0.51, 0.74])
  assert.deepEqual(wilson(0, 0), [0, 0])
  assert.deepEqual(segInterval({ rate: 0.68, n: 22, suppressed: false }), { lo: 0.47, hi: 0.84 })
  assert.equal(segInterval({ rate: null, n: null, suppressed: true }), null)
})

test('the default rival shares a goal and the category, highest rate first', () => {
  const me = row({ product_id: 'me', rate: 0.5 })
  const rows = [me, row({ product_id: 'x', rate: 0.9, category: 'toner' }), row({ product_id: 'y', rate: 0.8, goal_ids: ['lines'] }), row({ product_id: 'z', rate: 0.6 }), row({ product_id: 'w', rate: 0.7, n: null })]
  rows[4].rate = null
  assert.equal(rivalOf(me, rows)?.product_id, 'z')
  assert.equal(rivalOf(me, [me]), null)
})

test('brand shares: footprint vs real changes over measured products of the category', () => {
  const rows = [
    row({ product_id: 'a1', brand: 'A', users: 60, n: 20, rate: 0.5 }), // 10 changes
    row({ product_id: 'a2', brand: 'A', users: 20, n: 10, rate: 0.2 }), // 2
    row({ product_id: 'b1', brand: 'B', users: 20, n: 10, rate: 0.8 }), // 8
    row({ product_id: 'c1', brand: 'C', users: 50, n: null, rate: null, tier: 'too_few' }), // not measured: left out
    row({ product_id: 'd1', brand: 'D', category: 'toner', users: 99, n: 50, rate: 1 }),
  ]
  const s = brandShares(rows, 'serum')
  assert.equal(s.users, 100)
  assert.equal(s.changed, 20)
  assert.deepEqual(
    s.brands.map((b) => [b.brand, b.routine, b.outcome, b.gap]),
    [
      ['A', 0.8, 0.6, -0.2],
      ['B', 0.2, 0.4, 0.2],
    ],
  )
})

test('scoreboard filters combine (search, brand, mine, goal, tier)', () => {
  const rows = [row({ product_id: 'cica balm', brand: 'LRP', tier: 'promising' }), row({ product_id: 'serum', brand: 'CeraVe', goal_ids: ['lines'] })]
  assert.equal(filterRows(rows, { q: 'CICA' }).length, 1)
  assert.equal(filterRows(rows, { mineOf: 'CeraVe' })[0].product_id, 'serum')
  assert.equal(filterRows(rows, { goal: 'lines', tier: 'proven' }).length, 1)
  assert.equal(filterRows(rows, { tier: 'unclear' }).length, 0)
})

test('what-would-it-take hint only for Promising with a target', () => {
  assert.match(hintOf({ tier: 'promising', to_proven: 5 }) ?? '', /about 5 more people/)
  assert.match(hintOf({ tier: 'promising', to_proven: 1 }) ?? '', /1 more person/)
  assert.equal(hintOf({ tier: 'proven', to_proven: null }), undefined)
  assert.equal(money(null), null)
  assert.equal(money({ amount: 17, currency: 'USD' }), 'US$17')
})

test('evidence pack carries every statement with n, window, cohort and the caveat, escaped', () => {
  const d = {
    product: { ...row({ product_id: 'p<1>', product: 'Glow <b>Serum</b>', brand: 'Brand & Co' }), tier_label: 'Proven', key_actives: [], size: null, price: null, image_source: null, stores: 0 },
    evidence: [
      { id: 'efficacy', kind: 'efficacy', text: 'Measured in 63 Willow users: 63% had a visible change.', n: 63, method: 'Photos vs own baseline.', window: '8 weeks', cohort_label: 'Simulated cohort', caveat: 'Not a trial.' },
      { id: 'retention', kind: 'retention', text: 'Measured in 63 Willow users: 76% still used it.', n: 63, window: '8 weeks', cohort_label: 'Simulated cohort' },
    ],
    evidence_caveat: 'Not a trial.',
    cohort: { synthetic: 1692, real: 0, weeks: 8 },
    filters: { cohort: 'mixed', range: 'all', since: null, today: '2026-10-16' },
  } as unknown as ProductDetail
  const md = packMarkdown(d)
  assert.match(md, /Caveat.\*\* Not a trial\./)
  assert.match(md, /n=63 · window 8 weeks · Simulated cohort/)
  assert.match(md, /1692 simulated \+ 0 real users/)
  const html = packHtml(d)
  assert.ok(!html.includes('<b>Serum</b>'))
  assert.match(html, /Glow &lt;b&gt;Serum&lt;\/b&gt;/)
  assert.match(html, /Brand &amp; Co/)
  assert.equal((html.match(/<li>/g) ?? []).length, 2)
  assert.equal(packCsv(d).rows.length, 2)
  assert.equal(packCsv(d).rows[0][4], 63)
  assert.equal(statementLine(d.evidence[1]), 'Measured in 63 Willow users: 76% still used it. (n=63, 8 weeks, Simulated cohort)')
  assert.equal(packName(d, 'md'), 'willow-proof-evidence-p<1>.md')
})

test('rows without a rate say why', () => {
  assert.equal(noDataReason(row({ product_id: 'a' })), null)
  assert.equal(noDataReason(row({ product_id: 'a', rate: null, reason: 'unused' })), 'Not used yet')
  assert.equal(noDataReason(row({ product_id: 'a', rate: null, reason: 'not_measured' })), 'Goal not measured')
  assert.equal(noDataReason(row({ product_id: 'a', rate: null, reason: 'few' })), 'Fewer than 10 people')
  assert.equal(noDataReason(row({ product_id: 'a', rate: null })), 'Fewer than 10 people')
})

test('a compare row has one leader or none', () => {
  assert.equal(leaderOf([0.5, 0.7, 0.6]), 1)
  assert.equal(leaderOf([6, 4, 5], 'low'), 1)
  assert.equal(leaderOf([0.7, 0.7, 0.2]), null)
  assert.equal(leaderOf([0.7, null]), null)
  assert.equal(leaderOf([null, 0.4, 0.3]), 1)
})

test('the product verdict says what the evidence says, in the tier’s words', () => {
  assert.equal(verdictLine(row({ product_id: 'p', lift: 0.42 })), 'Linked to a held visible change: +42 pts over people with the same goals who don’t use it.')
  assert.match(verdictLine(row({ product_id: 'p', tier: 'promising', rate: 0.5, base_rate: 0.4, to_proven: 12 })), /^Ahead of people with the same goals \(50% against 40%\), but the interval still reaches zero\. About 12 more people/)
  assert.equal(verdictLine(row({ product_id: 'p', tier: 'unclear', rate: 0.31, base_rate: 0.3 })), 'Users and non-users with the same goals change at about the same rate (31% against 30%).')
  assert.equal(verdictLine(row({ product_id: 'p', tier: 'too_few', rate: null, reason: 'unused' })), 'No Willow users have it in their routine yet, so there is nothing to measure.')
})

test('works best for: the largest lift over its own non-users, never a suppressed or small group', () => {
  const seg = (id: string, rate: number | null, base: number | null, n: number | null, suppressed = false) => ({ id, label: id, rate, base_rate: base, n, suppressed })
  // b has the highest rate, but a has the larger lift over its own non-users (the api's promote rule)
  assert.equal(bestSeg([seg('a', 0.68, 0.2, 34), seg('b', 0.69, 0.5, 16), seg('c', 0.9, 0.1, 8), seg('d', null, null, null, true)])?.id, 'a')
  assert.equal(bestSeg([seg('a', 0.3, 0.4, 40)]), null)
})

test('category spot: the product against the median of the other measured products', () => {
  const spot = categorySpot([{ rate: 0.65, is_self: true }, { rate: 0.9 }, { rate: 0.4 }, { rate: 0.5 }, { rate: null }])
  assert.deepEqual(spot && { median: spot.median, delta: spot.delta, n: spot.others.length, min: spot.min, max: spot.max }, { median: 0.5, delta: 0.15, n: 3, min: 0.4, max: 0.9 })
  assert.equal(categorySpot([{ rate: 0.6, is_self: true }, { rate: 0.5 }]), null)
  assert.equal(categorySpot([{ rate: null, is_self: true }, { rate: 0.5 }, { rate: 0.4 }]), null)
})

test('products lead: Proven without a running campaign, the nearest Promising, the most-used unclear', () => {
  const rows = [
    row({ product_id: 'a', lift_lo: 0.05 }),
    row({ product_id: 'b', lift_lo: 0.2 }),
    row({ product_id: 'c', lift_lo: 0.3 }),
    row({ product_id: 'p1', tier: 'promising', to_proven: 40 }),
    row({ product_id: 'p2', tier: 'promising', to_proven: 3 }),
    row({ product_id: 'p3', tier: 'promising', to_proven: null }),
    row({ product_id: 'u1', tier: 'unclear', users: 20 }),
    row({ product_id: 'u2', tier: 'unclear', users: 90 }),
  ]
  const lead = productsLead(rows, new Set(['c']))
  assert.deepEqual(lead.toPromote.map((r) => r.product_id), ['b', 'a'])
  assert.equal(lead.proven, 3)
  assert.deepEqual(lead.close.map((r) => r.product_id), ['p2', 'p1', 'p3'])
  assert.deepEqual(lead.unclear.map((r) => r.product_id), ['u2', 'u1'])
})

test('long tables sort the whole list before a page is cut, nulls last both ways', () => {
  const rs = [{ v: 2 }, { v: null }, { v: 9 }, { v: 5 }]
  assert.deepEqual(sortRows(rs, (r) => r.v, 'desc').map((r) => r.v), [9, 5, 2, null])
  assert.deepEqual(sortRows(rs, (r) => r.v, 'asc').map((r) => r.v), [2, 5, 9, null])
  assert.equal(sortRows(rs, undefined, 'asc'), rs)
})
