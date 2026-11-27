/** `npm test`: Proof Home dashboard figures (features/retail/home/dashboard.ts) and BrandLogo monograms (ui/brandMark.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { campaignTotals, changeText, demandTrends, monthShort, pooledRate, portfolio, risingGoal, weekBrief } from '../src/features/retail/home/dashboard.ts'
import { hueOf, monogramOf } from '../src/features/retail/ui/brandMark.ts'

type Row = Parameters<typeof portfolio>[0][number] & { n: number | null }
const row = (rate: number | null, n: number | null, tier: Row['tier'], extra: Partial<Row> = {}): Row => ({ rate, n, tier, reason: undefined, users: n ?? 0, ...extra })

test('portfolio counts measured, collecting and unused, and Proven only among the measured', () => {
  const p = portfolio([row(0.6, 40, 'proven'), row(0.5, 20, 'promising'), row(0.4, 12, 'no_clear_effect' as Row['tier']), row(null, null, 'too_few' as Row['tier'], { users: 4, reason: 'few' }), row(null, null, 'too_few' as Row['tier'], { users: 0, reason: 'unused' }), row(null, null, 'too_few' as Row['tier'], { users: 30, reason: 'not_measured' })])
  assert.deepEqual(p, { total: 6, measured: 3, collecting: 1, noUsers: 1, proven: 1, promising: 1 })
})

test('the pooled rate weights each product by its people and skips the unmeasured', () => {
  assert.equal(pooledRate([]), null)
  const r = pooledRate([row(0.8, 100, 'proven'), row(0.2, 100, 'promising'), row(null, null, 'too_few' as Row['tier'])])!
  assert.equal(r.n, 200)
  assert.equal(r.products, 2)
  assert.ok(Math.abs(r.rate - 0.5) < 1e-9)
})

const camp = (o: { status?: 'active' | 'ended'; reach?: number; clicks?: number; adds?: number; inc?: [number, number, number] | null; daily?: { day: string; impressions: number; clicks: number; adds: number }[]; sample?: boolean; product?: string }) =>
  ({
    id: Math.random().toString(36),
    status: o.status ?? 'ended',
    product: o.product ?? 'P',
    product_id: 'p',
    sample: o.sample,
    stats: { reach: o.reach ?? 0, impressions: o.reach ?? 0, clicks: o.clicks ?? 0, adds: o.adds ?? 0, ctr: null, daily: o.daily ?? [], incrementality: o.inc ? { exposed: { n: 50, added: 10, rate: 0.2 }, holdout: { n: 20, added: 2, rate: 0.1 }, lift: o.inc[0], lift_lo: o.inc[1], lift_hi: o.inc[2] } : null, incrementality_note: '' },
  }) as unknown as Parameters<typeof campaignTotals>[0][number]

test('campaign totals sum the funnel, merge days and pick the lift with the highest lower bound', () => {
  const t = campaignTotals([
    camp({ status: 'active', reach: 100, clicks: 40, adds: 10, inc: [0.2, 0.01, 0.39], daily: [{ day: '2026-11-02', impressions: 5, clicks: 1, adds: 0 }], product: 'Wide' }),
    camp({ reach: 50, clicks: 10, adds: 5, inc: [0.12, 0.08, 0.16], daily: [{ day: '2026-11-01', impressions: 3, clicks: 0, adds: 0 }, { day: '2026-11-02', impressions: 2, clicks: 0, adds: 1 }], product: 'Narrow', sample: true }),
    camp({ reach: 10 }),
  ])
  assert.equal(t.count, 3)
  assert.equal(t.live, 1)
  assert.deepEqual([t.reach, t.clicks, t.adds, t.measured], [160, 50, 15, 2])
  assert.equal(t.best?.product, 'Narrow')
  assert.equal(t.best?.sample, true)
  assert.deepEqual(
    t.daily.map((d) => [d.day, d.impressions]),
    [
      ['2026-11-01', 3],
      ['2026-11-02', 7],
    ],
  )
  assert.equal(campaignTotals([]).best, null)
})

const nbm = { months: ['2026-09', '2026-10', '2026-11'], people: [100, 200, 220], goals: [
  { goal: 'Redness', goal_id: 'redness', counts: [10, 40, 50], share_of_peak: [] },
  { goal: 'Blemishes', goal_id: 'blemishes', counts: [60, 120, 110], share_of_peak: [] },
  { goal: 'Lines', goal_id: 'lines', counts: [null, 12, null], share_of_peak: [] },
] }

test('demand trends lead with focus goals, then the latest month; change is against the month before', () => {
  const d = demandTrends(nbm, new Set(['redness']))
  assert.deepEqual(d.rows.map((r) => r.goalId), ['redness', 'blemishes', 'lines'])
  assert.equal(d.rows[0].change, 0.25)
  assert.ok(Math.abs((d.rows[1].change ?? 0) + 1 / 12) < 1e-9)
  assert.equal(d.rows[2].change, null) // the latest month is suppressed: no change claimed
  assert.deepEqual(demandTrends(null), { months: [], rows: [] })
  assert.equal(risingGoal(d.rows)?.goalId, 'redness')
  assert.equal(risingGoal(demandTrends(nbm).rows)?.goalId, 'redness')
  assert.equal(changeText(0.04), '+4%')
  assert.equal(changeText(-0.12), '−12%')
  assert.equal(changeText(0.001), 'no change')
  assert.equal(monthShort('2026-11'), 'Nov')
})

test('the weekly brief states only the figures it is given, in plain sentences', () => {
  const p = { total: 21, measured: 2, collecting: 0, noUsers: 14, proven: 0, promising: 0 }
  const s = weekBrief({ mix: 'brand', name: 'CeraVe', p, rate: { rate: 0.63, n: 213 }, market: { rate: 0.65, n: 9000 }, rising: null, camp: { live: 0, best: null } })
  assert.deepEqual(s, ['2 of 21 CeraVe products are measured; none is Proven yet.', '63% of people using them saw a visible change (n=213), 2 points below the market’s 65%.'])
  const r = weekBrief({ mix: 'retailer', name: 'Northside', p: { ...p, measured: 1, proven: 1 }, rate: null, market: null, rising: demandTrends(nbm).rows[0], camp: { live: 1, best: { lift: 0.13, lo: 0.1, hi: 0.16, product: 'Glow Serum', n: 300, sample: true } } })
  assert.equal(r[0], '1 of 21 products is measured; 1 is Proven.')
  assert.equal(r[1], 'Best campaign lift: +13 pts against its holdout, for Glow Serum (a sample campaign, simulated).')
  assert.equal(weekBrief({ mix: 'brand', name: 'X', p: { ...p, total: 0, measured: 0 }, rate: null, market: null, rising: null, camp: { live: 0, best: null } })[0], 'None of X’s products is in the catalog yet.')
})

test('monograms read the brand and keep one hue per name', () => {
  assert.equal(monogramOf('CeraVe'), 'CE')
  assert.equal(monogramOf('La Roche-Posay'), 'LR')
  assert.equal(monogramOf('The Derma Co'), 'TD')
  assert.equal(monogramOf("A'pieu"), 'AP')
  assert.equal(monogramOf('111SKIN'), '11')
  assert.equal(monogramOf('  '), '?')
  assert.equal(hueOf('CeraVe'), hueOf('CeraVe'))
  assert.ok(hueOf('CeraVe') >= 0 && hueOf('CeraVe') < 360)
  assert.notEqual(hueOf('CeraVe'), hueOf('Cetaphil'))
})
