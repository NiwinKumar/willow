/** `npm test`: the Decisions home's card composition (features/retail/decisions.ts) and the weekly digest (digest.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Campaign } from '../src/lib/api.ts'
import { composeCards, demandShift, laneOf, type ComposeInput } from '../src/features/retail/decisions.ts'
import { composeDigest, coverageChange, mondayOf } from '../src/features/retail/digest.ts'
import type { ProductRow } from '../src/features/retail/types.ts'

const row = (id: string, brand: string, over: Partial<ProductRow> = {}): ProductRow => ({
  product_id: id,
  product: `${id} serum`,
  brand,
  category: 'serum',
  category_label: 'Serum',
  goal_ids: ['dark_spots'],
  price_tier: 'mid',
  image_url: null,
  users: 120,
  n: 80,
  rate: 0.6,
  rate_lo: 0.5,
  rate_hi: 0.7,
  base_rate: 0.3,
  lift: 0.3,
  lift_lo: 0.2,
  lift_hi: 0.4,
  weeks: 6,
  cont8: 0.8,
  routine_share: 0.1,
  tier: 'proven',
  ...over,
})

const base = (over: Partial<ComposeInput> = {}): ComposeInput => ({
  mix: 'brand',
  brand: 'Acme',
  rows: [],
  campaigns: [],
  shelf: null,
  segments: null,
  demand: null,
  claimed: new Set(),
  proposals: [],
  brandOrgs: new Set(),
  weeks: 8,
  carry: '',
  ...over,
})

const kinds = (x: ComposeInput) => composeCards(x).map((c) => c.key)
const campaign = (id: string, productId: string, status: string) => ({ id, product_id: productId, status, stats: { reach: 50, impressions: 60, adds: 3, incrementality: null } }) as unknown as Campaign

test('a brand sees its own products only, and each card has one primary action', () => {
  const cards = composeCards(base({ rows: [row('mine', 'Acme'), row('theirs', 'Other')] }))
  assert.deepEqual(cards.map((c) => c.key).sort(), ['claim_ready--mine', 'proven_not_promoted--mine'])
  assert.ok(cards.every((c) => c.primary && c.n === 80 && c.waiting))
})

test('a running campaign takes "Proven, not promoted" away; a saved claim takes "Claim ready" away', () => {
  const keys = kinds(base({ rows: [row('mine', 'Acme')], campaigns: [campaign('c1', 'mine', 'active')], claimed: new Set(['mine']) }))
  assert.deepEqual(keys, [])
})

test('a sample campaign (simulated) only ever shows as a result, labelled; it never promotes or slips', () => {
  const inc = { exposed: { n: 260, added: 44, rate: 0.17 }, holdout: { n: 66, added: 9, rate: 0.14 }, lift: 0.03, lift_lo: -0.07, lift_hi: 0.13 }
  const done = { ...campaign('s1', 'mine', 'ended'), sample: true, stats: { reach: 260, impressions: 900, adds: 44, incrementality: inc } } as unknown as Campaign
  const running = { ...campaign('s2', 'mine', 'active'), sample: true } as unknown as Campaign
  const cards = composeCards(base({ rows: [row('mine', 'Acme', { tier: 'unclear' })], campaigns: [done, running] }))
  assert.deepEqual(cards.map((c) => c.key).filter((k) => /campaign|promoted/.test(k)), ['campaign_result--s1'])
  assert.match(cards.find((c) => c.kind === 'campaign_result')!.trigger, /^Sample campaign, simulated\. Adoption/)
  // a running sample leaves "Proven, not promoted" in place
  assert.ok(kinds(base({ rows: [row('mine', 'Acme')], campaigns: [running] })).includes('proven_not_promoted--mine'))
})

test('4 · evidence slipped: a live campaign or a saved claim on a product below its tier', () => {
  const slipped = row('mine', 'Acme', { tier: 'unclear', tier_label: 'No clear effect yet', lift: 0.02 })
  const keys = kinds(base({ rows: [slipped], campaigns: [campaign('c1', 'mine', 'active')], claimed: new Set(['mine']) }))
  assert.deepEqual(keys.sort(), ['evidence_slipped--campaign-c1', 'evidence_slipped--claim-mine'])
  // a Promising product still carries its claim (no card), but not a campaign
  const promising = row('mine', 'Acme', { tier: 'promising', to_proven: 200 })
  assert.deepEqual(kinds(base({ rows: [promising], campaigns: [campaign('c1', 'mine', 'active')], claimed: new Set(['mine']) })), ['evidence_slipped--campaign-c1'])
})

test('5 · expectation gap needs 10 people and a quarter who changed without saying it works', () => {
  const rows = [row('mine', 'Acme')]
  const sig = (measured_only: number, n = 35) => [{ product_id: 'mine', agree: { n, measured_only }, conflicts: [] }]
  assert.ok(kinds(base({ rows, claimed: new Set(['mine']), campaigns: [campaign('c', 'mine', 'active')], signals: sig(0.37) })).includes('expectation_gap--mine'))
  assert.ok(!kinds(base({ rows, signals: sig(0.2) })).includes('expectation_gap--mine'))
  assert.ok(!kinds(base({ rows, signals: sig(0.5, 9) })).includes('expectation_gap--mine'))
})

test('10 · losing switchers only when net switching is negative, with the destination named by policy', () => {
  const x = base({ rows: [row('mine', 'Acme')], switching: { lost: [{ brand: 'Rival', n: 13 }], net: -5 }, nameOf: (b) => (b === 'Rival' ? 'Brand C' : b) })
  const card = composeCards(x).find((c) => c.kind === 'losing_switchers')
  assert.ok(card)
  assert.match(card.trigger, /Brand C/)
  assert.doesNotMatch(card.trigger + card.title, /Rival/)
  assert.equal(card.figure, '−5')
  assert.equal(composeCards({ ...x, switching: { lost: [{ brand: 'Rival', n: 13 }], net: 19 } }).find((c) => c.kind === 'losing_switchers'), undefined)
})

test('11 · routine clash: a brand from its products, the retailer from all routines checked', () => {
  const sig = [{ product_id: 'mine', agree: null, conflicts: [{ kind: 'no_spf', label: 'No morning sunscreen', fix: 'Add daily SPF', n: 51, share: 0.29 }, { kind: 'dup', label: 'Duplicate', fix: 'Keep one', n: 5, share: 0.6 }] }]
  assert.ok(kinds(base({ rows: [row('mine', 'Acme')], signals: sig })).includes('routine_clash--mine--no_spf'))
  const retailer = base({ mix: 'retailer', brand: null, rows: [row('a', 'Acme')], conflicts: { routines: 1704, rows: [{ kind: 'no_spf', pair: 'No SPF', n: 473, share: 0.28, fix: 'Add daily SPF', resolves: ['X'] }] } })
  const card = composeCards(retailer).find((c) => c.kind === 'routine_clash')
  assert.ok(card)
  assert.match(card.trigger, /473 of 1,704 routines/)
})

test('demand shift needs a rise of at least 3 points and 10 people', () => {
  const d = { months: ['2026-09', '2026-10'], people: [100, 100], goals: [{ goal: 'Redness', goal_id: 'redness', counts: [10, 14], share_of_peak: [1, 1] }] }
  assert.equal(demandShift(d)?.goalId, 'redness')
  assert.equal(demandShift({ ...d, goals: [{ ...d.goals[0], counts: [10, 12] }] }), null)
})

test('laneOf: snoozed cards come back after seven days; dismissed ones stay hidden', () => {
  const now = Date.parse('2026-11-27T00:00:00Z')
  const at = (days: number) => new Date(now - days * 86_400_000).toISOString()
  assert.equal(laneOf(undefined, now), 'decide')
  assert.equal(laneOf({ status: 'snoozed', updated_at: at(2) }, now), null)
  assert.equal(laneOf({ status: 'snoozed', updated_at: at(8) }, now), 'decide')
  assert.equal(laneOf({ status: 'dismissed', updated_at: at(30) }, now), null)
  assert.equal(laneOf({ status: 'accepted', updated_at: at(1) }, now), 'progress')
})

test('the digest counts waiting decisions, results and requests, and says what moved in the range', () => {
  const now = Date.parse('2026-11-27T10:00:00Z')
  const cards = composeCards(base({ rows: [row('a', 'Acme'), row('b', 'Acme')] }))
  const cov = (measured: number, collecting: number) => ({ measured, collecting, no_users: 0, not_measured: 0, unrecognised: 0, total: measured + collecting, matched: measured + collecting })
  const g = composeDigest({
    orgName: 'Acme',
    kind: 'brand',
    cards,
    items: { [cards[0].key]: { status: 'dismissed', updated_at: null } },
    inbox: [{ id: 'r1', from_org: 'n', from_name: 'Northside', to_org: 'acme', product_id: 'a', product: 'a serum', message: 'Evidence?', status: 'open', created_at: '2026-11-26T00:00:00Z' }],
    outbox: [],
    range: { then: cov(40, 21), now: cov(43, 18), since: null },
    now,
  })
  assert.equal(g.waitingN, cards.length - 1)
  assert.equal(g.requests.length, 1)
  assert.equal(g.subject, `Proof · Acme: ${cards.length - 1} decisions waiting, 1 evidence request`)
  assert.equal(coverageChange(g.range!.then, g.range!.now), 'Measured 40 → 43 · Collecting 21 → 18')
  assert.equal(mondayOf(now).toISOString().slice(0, 10), '2026-11-30')
  assert.equal(mondayOf(Date.parse('2026-11-30T09:00:00Z')).toISOString().slice(0, 10), '2026-11-30')
})
