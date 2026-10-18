/** `npm test`: Willow Proof · AutoCampaign sentences, templates and feed order (features/retail/autopilot.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AutopilotActivity } from '../src/lib/api.ts'
import { agoText, emptyRule, feedOrder, openProposals, ruleSentence, TEMPLATES } from '../src/features/retail/autopilot.ts'

test('the template rule reads exactly as the api says it (autopilot.describe)', () => {
  assert.equal(
    ruleSentence(emptyRule('The Ordinary')),
    'When any of my serums becomes Proven for dark spots, promote it to the skin types it works for, for 14 days, with a 20% holdout, max 2 at a time. Suggest it and ask me first.',
  )
  assert.equal(
    ruleSentence({ ...emptyRule('retailer'), level: 'autopilot', scope: { category: null, product_ids: [] }, trigger: { kind: 'unmet_need', goals: ['blemishes', 'redness'], unmet_min: 0.6 }, conditions: { in_store: true, start_on: null, stop_after: '2026-12-31', monthly_cap: 2 } }),
    'When 60% or more of a skin type for blemishes and redness see no change yet and any of the products works for them, promote it to that skin type, for 14 days, with a 20% holdout, max 2 at a time (only products sold in a store; until 2026-12-31; at most 2 new a month). Run it on autopilot.',
  )
})

test('every template has its own trigger and a holdout', () => {
  const rules = TEMPLATES.map((t) => t.rule('retailer'))
  assert.deepEqual(rules.map((r) => r.trigger.kind), ['proven', 'new_segment', 'rising_demand', 'unmet_need'])
  assert.ok(rules.every((r) => r.action.holdout_pct >= 0.1 && r.action.max_running <= 3))
})

const item = (over: Partial<AutopilotActivity>): AutopilotActivity => ({ id: 'a', at: '2026-10-18T10:00:00Z', kind: 'started', status: 'done', text: '', rule_id: 'r', rule_name: 'R', level: 'auto', product_id: null, product: null, brand: null, image_url: null, campaign_id: null, proposal: null, numbers: {}, can_undo: false, ...over })

test('open proposals come first, then newest first', () => {
  const old = item({ id: 'p', kind: 'proposed', status: 'open', at: '2026-10-17T10:00:00Z' })
  const done = item({ id: 'd', kind: 'proposed', status: 'dismissed', at: '2026-10-18T11:00:00Z' })
  const latest = item({ id: 's', at: '2026-10-18T12:00:00Z' })
  assert.deepEqual(feedOrder([latest, done, old]).map((a) => a.id), ['p', 's', 'd'])
  assert.deepEqual(openProposals([latest, done, old]).map((a) => a.id), ['p'])
})

test('feed times read as people say them', () => {
  const now = Date.parse('2026-10-18T12:00:00Z')
  assert.equal(agoText('2026-10-18T11:59:30Z', now), 'just now')
  assert.equal(agoText('2026-10-18T11:45:00Z', now), '15 min ago')
  assert.equal(agoText('2026-10-18T09:00:00Z', now), '3 h ago')
  assert.equal(agoText('2026-10-15T09:00:00Z', now), '15 Oct')
})
