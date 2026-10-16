/** `npm test`: Willow Proof insight helpers (brief links, skin-profile picks, competitor ranking, Wilson). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { brandLeaders, brandRank, briefHref, cardFigure, niceDomain, rateInterval, strongestWinner, switchRows, topUnmet, wilson } from '../src/features/retail/ui/insight.ts'

test('wilson matches the api (retailer._wilson) to 2 dp', () => {
  assert.deepEqual(wilson(52, 74), { lo: 0.59, hi: 0.79 })
  assert.deepEqual(wilson(0, 10), { lo: 0, hi: 0.28 })
  assert.equal(wilson(3, 0), null)
  assert.deepEqual(rateInterval(0.7, 74), { lo: 0.59, hi: 0.79 })
  assert.equal(rateInterval(null, 20), null)
})

test('brief cards link to their exact view and keep the workspace', () => {
  const carry = '?as=brand:cerave&cohort=simulated'
  assert.equal(briefHref({ id: 'top_proven', link: { section: 'products', id: 'cerave-x' } }, carry), '/retail/products/cerave-x?as=brand%3Acerave&cohort=simulated')
  assert.equal(briefHref({ id: 'segment_lift', link: { section: 'segments', id: 'combination' } }), '/retail/customers?skin=combination')
  assert.equal(briefHref({ id: 'brand_best_goal', link: { section: 'competitors', id: 'lines' } }), '/retail/market?goal=lines')
  assert.equal(briefHref({ id: 'switching_net', link: { section: 'competitors' } }), '/retail/market#switching')
  assert.equal(briefHref({ id: 'top_conflict', link: { section: 'demand' } }), '/retail/customers?view=demand#conflicts')
  assert.equal(briefHref({ id: 'unmet_need', link: { section: 'demand', id: 'even_tone' } }), '/retail/customers?view=demand&goal=even_tone#unmet')
  assert.equal(briefHref({ id: 'rising_goal', link: { section: 'demand', id: 'dark_spots' } }), '/retail/customers?view=demand&goal=dark_spots#demand')
  assert.equal(briefHref({ id: 'promotable', link: { section: 'promote' } }), '/retail/campaigns')
})

test('card figures carry their unit and a true minus', () => {
  assert.deepEqual(cardFigure({ id: 'top_proven', value: 48, unit: 'points' }), { value: '+48', unit: 'pts' })
  assert.deepEqual(cardFigure({ id: 'low_continuation', value: 64, unit: 'percent' }), { value: '64', unit: '%' })
  assert.deepEqual(cardFigure({ id: 'switching_net', value: -38, unit: 'people' }), { value: '−38', unit: 'people' })
  assert.deepEqual(cardFigure({ id: 'promotable', value: 1, unit: 'products' }), { value: '1', unit: 'product' })
  assert.equal(cardFigure({ id: 'x', value: null, unit: null }), null)
})

const seg = {
  skin_types: [
    { id: 'oily', label: 'Oily', users: 300 },
    { id: 'dry', label: 'Dry', users: 200 },
  ],
  goals: [
    { id: 'lines', label: 'Lines' },
    { id: 'redness', label: 'Redness' },
  ],
  cells: [
    { skin: 'oily', goal: 'lines', users: 40, unmet: 0.5, best: { product_id: 'a', product: 'A', brand: 'X', rate: 1, n: 11 }, runner_up: null },
    { skin: 'oily', goal: 'redness', users: 90, unmet: 0.8, best: { product_id: 'b', product: 'B', brand: 'Y', rate: 0.9, n: 60 }, runner_up: null },
    { skin: 'dry', goal: 'lines', users: 120, unmet: 0.8, best: null, runner_up: null },
    { skin: 'dry', goal: 'redness', users: null, unmet: null, best: null, runner_up: null },
  ],
}

test('skin profiles: most under-served first, suppressed cells left out', () => {
  const top = topUnmet(seg, 5)
  assert.deepEqual(
    top.map((c) => `${c.skin}.${c.goal}`),
    ['dry.lines', 'oily.redness', 'oily.lines'],
  )
  assert.equal(top[0].skinLabel, 'Dry')
  assert.equal(top[0].goalLabel, 'Lines')
})

test('skin profiles: the strongest winner is ranked by its interval, not a lucky small group', () => {
  assert.equal(strongestWinner(seg)?.best.product_id, 'b')
})

const brands = [
  { brand: 'A', products: 2, users: 300, n: 200, rate: 0.8, lo: 0.74, hi: 0.85, cont8: 0.8, routine_share: 0.3 },
  { brand: 'B', products: 2, users: 200, n: 30, rate: 0.78, lo: 0.6, hi: 0.89, cont8: 0.7, routine_share: 0.2 },
  { brand: 'C', products: 1, users: 100, n: 80, rate: 0.4, lo: 0.3, hi: 0.51, cont8: 0.7, routine_share: 0.1 },
  { brand: 'D', products: 1, users: null, n: null, rate: null, lo: null, hi: null, cont8: null, routine_share: null },
]

test('competitors: leader, brands inside its interval, and rank', () => {
  const { leader, tied, measured } = brandLeaders(brands)
  assert.equal(leader?.brand, 'A')
  assert.deepEqual(
    tied.map((b) => b.brand),
    ['B'],
  )
  assert.equal(measured.length, 3)
  assert.deepEqual(brandRank(brands, 'C'), { rank: 3, of: 3 })
  assert.equal(brandRank(brands, 'D'), null)
})

test('competitors: switching merges won and lost per brand, largest first', () => {
  assert.deepEqual(
    switchRows(
      [
        { brand: 'X', n: 17 },
        { brand: 'Y', n: 10 },
      ],
      [{ brand: 'Y', n: 12 }],
    ),
    [
      { brand: 'Y', won: 10, lost: 12 },
      { brand: 'X', won: 17, lost: null },
    ],
  )
})

test('scatter domains snap outward to 5 points', () => {
  assert.deepEqual(niceDomain([0.31, 0.81]), [0.25, 0.85])
  assert.deepEqual(niceDomain([0.7, 0.84]), [0.65, 0.9])
  assert.deepEqual(niceDomain([]), [0, 1])
})
