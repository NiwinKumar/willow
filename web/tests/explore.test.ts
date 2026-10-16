/** `npm test`: Willow Proof Explore's query model (URL round trip, filters, people-weighted grouping, axis). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { aggregate, DEFAULT_QUERY, filterRows, niceAxis, parseQuery, PRESETS, queryParams, sameQuery, type Query } from '../src/features/retail/sections/explore/query.ts'
import type { ProductRow } from '../src/features/retail/types.ts'

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

const q = (patch: Partial<Query> = {}): Query => ({ ...DEFAULT_QUERY, ...patch, filters: { ...DEFAULT_QUERY.filters, ...patch.filters } })
const fromParams = (p: Record<string, string | null>) => parseQuery((k) => p[k] ?? null)

test('the query round-trips through the URL, defaults left out', () => {
  const all = queryParams(DEFAULT_QUERY)
  assert.ok(Object.values(all).every((v) => v === null))
  const custom = q({ measure: 'lift', group: 'brand', min: 30, dir: 'asc', limit: 'all', filters: { brand: ['cerave', 'dot-and-key'], category: [], goal: ['redness'], status: ['proven'] } })
  const p = queryParams(custom)
  assert.equal(p.m, 'lift')
  assert.equal(p.f_brand, 'cerave,dot-and-key')
  assert.equal(p.f_category, null)
  assert.deepEqual(fromParams(p), custom)
  // Unknown values fall back to the defaults.
  assert.deepEqual(fromParams({ m: 'skin', g: 'tone', min: '5', limit: '7', sort: 'up' }), DEFAULT_QUERY)
  assert.ok(sameQuery(fromParams(queryParams(PRESETS[0].query)), PRESETS[0].query))
})

test('filters combine with AND, values within a filter with OR, and drop rows under the minimum', () => {
  const rows = [
    row({ product_id: 'a', brand: 'CeraVe', n: 40 }),
    row({ product_id: 'b', brand: 'Dot & Key', n: 12, goal_ids: ['blemishes'] }),
    row({ product_id: 'c', brand: 'Other', n: 200, tier: 'unclear' }),
    row({ product_id: 'd', brand: 'CeraVe', n: null, rate: null, tier: 'too_few' }),
  ]
  const ids = (x: ProductRow[]) => x.map((r) => r.product_id)
  assert.deepEqual(ids(filterRows(rows, q())), ['a', 'b', 'c'])
  assert.deepEqual(ids(filterRows(rows, q({ min: 30 }))), ['a', 'c'])
  assert.deepEqual(ids(filterRows(rows, q({ filters: { ...DEFAULT_QUERY.filters, brand: ['cerave', 'dot-and-key'] } }))), ['a', 'b'])
  assert.deepEqual(ids(filterRows(rows, q({ filters: { ...DEFAULT_QUERY.filters, brand: ['cerave', 'dot-and-key'], goal: ['redness'] } }))), ['a'])
  assert.deepEqual(ids(filterRows(rows, q({ filters: { ...DEFAULT_QUERY.filters, status: ['unclear'] } }))), ['c'])
})

test('groups are people-weighted; lift is weighted rate minus weighted non-user rate', () => {
  const rows = [
    row({ product_id: 'a', brand: 'X', n: 30, rate: 0.8, base_rate: 0.3, lift: 0.5, cont8: 0.9 }),
    row({ product_id: 'b', brand: 'X', n: 10, rate: 0.4, base_rate: 0.5, lift: -0.1, cont8: 0.5 }),
    row({ product_id: 'c', brand: 'Y', n: 20, rate: 0.6, base_rate: 0.4, lift: 0.2, cont8: null }),
  ]
  const rate = aggregate(rows, q({ group: 'brand' })).groups
  assert.deepEqual(
    rate.map((g) => [g.label, g.value, g.base, g.n, g.products]),
    [
      ['X', 0.7, 0.35, 40, 2], // (0.8·30 + 0.4·10) / 40; non-users (0.3·30 + 0.5·10) / 40
      ['Y', 0.6, 0.4, 20, 1],
    ],
  )
  const lift = aggregate(rows, q({ group: 'brand', measure: 'lift' })).groups
  assert.deepEqual(
    lift.map((g) => [g.label, g.value]),
    [
      ['X', 0.35],
      ['Y', 0.2],
    ],
  )
  // A suppressed value is left out of its group, never counted as 0; a group with nothing left is not shown.
  const cont = aggregate(rows, q({ group: 'brand', measure: 'cont8' }))
  assert.deepEqual(
    cont.groups.map((g) => [g.label, g.value, g.n]),
    [['X', 0.8, 40]],
  )
  // People measured is summed, not averaged.
  assert.deepEqual(
    aggregate(rows, q({ group: 'brand', measure: 'n' })).groups.map((g) => g.value),
    [40, 20],
  )
})

test('grouped by product: the row itself, with its interval and link; own brand marked', () => {
  const rows = [row({ product_id: 'a', brand: 'CeraVe', rate: 0.77, rate_lo: 0.67, rate_hi: 0.84, base_rate: 0.29, lift: 0.48, lift_lo: 0.35, lift_hi: 0.6 }), row({ product_id: 'b', brand: 'Other', rate: 0.5 })]
  const [a, b] = aggregate(rows, q(), { ownBrand: 'CeraVe' }).groups
  assert.deepEqual([a.productId, a.value, a.lo, a.hi, a.base, a.own], ['a', 0.77, 0.67, 0.84, 0.29, true])
  assert.equal(b.own, false)
  const [l] = aggregate(rows, q({ measure: 'lift' })).groups
  assert.deepEqual([l.value, l.lo, l.hi, l.base], [0.48, 0.35, 0.6, null])
  // Grouped, no interval and no product link.
  const [g] = aggregate(rows, q({ group: 'category' })).groups
  assert.deepEqual([g.lo, g.hi, g.productId, g.own], [null, null, null, false])
})

test('a product counts in each of its goals; a goal filter keeps only the chosen goals', () => {
  const rows = [row({ product_id: 'a', goal_ids: ['redness', 'blemishes'], n: 30 }), row({ product_id: 'b', goal_ids: ['blemishes'], n: 10 })]
  const all = aggregate(rows, q({ group: 'goal', measure: 'n' }), { labels: { goal: { redness: 'Redness', blemishes: 'Blemishes' } } }).groups
  assert.deepEqual(
    all.map((g) => [g.label, g.value]),
    [
      ['Blemishes', 40],
      ['Redness', 30],
    ],
  )
  const one = aggregate(rows, q({ group: 'goal', measure: 'n', filters: { ...DEFAULT_QUERY.filters, goal: ['redness'] } })).groups
  assert.deepEqual(
    one.map((g) => [g.key, g.value]),
    [['redness', 30]],
  )
})

test('sort direction, ties and limit', () => {
  const rows = Array.from({ length: 25 }, (_, i) => row({ product_id: `p${i}`, rate: i / 100, n: 20 }))
  const top = aggregate(rows, q())
  assert.equal(top.total, 25)
  assert.equal(top.groups.length, 10)
  assert.equal(top.groups[0].key, 'p24')
  const low = aggregate(rows, q({ dir: 'asc', limit: 20 }))
  assert.equal(low.groups.length, 20)
  assert.equal(low.groups[0].key, 'p0')
  assert.equal(aggregate(rows, q({ limit: 'all' })).groups.length, 25)
  // Equal values: more people first.
  const tie = aggregate([row({ product_id: 'x', n: 10 }), row({ product_id: 'y', n: 90 })], q()).groups
  assert.deepEqual(
    tie.map((g) => g.key),
    ['y', 'x'],
  )
})

test('the axis is scale-true: it always includes zero and reaches past every value', () => {
  assert.deepEqual(niceAxis([0.77, 0.84]), { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] })
  const lift = niceAxis([0.48, -0.05, 0.6])
  assert.equal(lift.ticks.includes(0), true)
  assert.ok(lift.min <= -0.05 && lift.max >= 0.6)
  assert.deepEqual(niceAxis([255, 90]).ticks, [0, 100, 200, 300])
  // Nothing to draw still gives a usable axis from zero.
  const empty = niceAxis([])
  assert.equal(empty.min, 0)
  assert.ok(empty.ticks.length >= 2 && empty.max > 0)
})
