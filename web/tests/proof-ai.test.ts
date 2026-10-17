/** `npm test`: Willow Proof · AI on the product page (next steps' links and provenance, claim source labels, channels). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { actionsProvenance, actionTarget, ANCHOR, channelOf, CHANNELS, prefillSkins, sourceLabel } from '../src/features/retail/proofAi.ts'

const ID = 'the-derma-co-1-hyaluronic-sunscreen-aqua-gel-spf-50'

test('source chips read as short labels, and self-reported stays labelled', () => {
  assert.equal(sourceLabel('efficacy'), 'Overall result')
  assert.equal(sourceLabel('efficacy_dark_spots'), 'Dark spots')
  assert.equal(sourceLabel('efficacy_pores_texture'), 'Pores and texture')
  assert.equal(sourceLabel('speed'), 'Timing')
  assert.equal(sourceLabel('segment_sensitive'), 'Sensitive skin')
  assert.equal(sourceLabel('retention'), 'Still using')
  assert.equal(sourceLabel('perception'), 'Self-reported')
  assert.equal(sourceLabel('something_new'), 'something new')
})

test('a campaigns step opens the create sheet prefilled with the product and skin types, keeping the filters', () => {
  const t = actionTarget({ section: 'campaigns', id: ID, skin_types: ['sensitive', 'dry'] }, '/retail/campaigns?cohort=real')
  assert.deepEqual(t, { kind: 'route', to: `/retail/campaigns?cohort=real&new=${ID}&skins=sensitive,dry`, label: 'Set up campaign' })
  const bare = actionTarget({ section: 'campaigns', id: ID }, '/retail/campaigns')
  assert.equal(bare.kind === 'route' && bare.to, `/retail/campaigns?new=${ID}`)
})

test('on-page steps scroll to their panel and pick its tab or channel', () => {
  const at = (section: Parameters<typeof actionTarget>[0]['section'], extra = {}) => actionTarget({ section, id: ID, ...extra }, '/retail/campaigns')
  assert.deepEqual(at('claims', { channel: 'pack' }), { kind: 'scroll', anchor: ANCHOR.claims, params: { claim: 'pack' }, label: 'Draft pack copy' })
  assert.deepEqual(at('claims', { channel: 'pdp' }), { kind: 'scroll', anchor: ANCHOR.claims, params: { claim: null }, label: 'Draft claims' })
  assert.deepEqual(at('switching'), { kind: 'scroll', anchor: ANCHOR.context, params: { ctx: 'switch' }, label: 'See where users go' })
  assert.deepEqual(at('conflicts'), { kind: 'scroll', anchor: ANCHOR.context, params: { ctx: 'conflicts' }, label: 'See conflicts' })
  assert.deepEqual(at('co_used'), { kind: 'scroll', anchor: ANCHOR.context, params: { ctx: null }, label: 'See pairings' })
  assert.deepEqual(at('segments'), { kind: 'scroll', anchor: ANCHOR.segments, params: { seg: null }, label: 'See skin types' })
  assert.equal(at('feel').kind === 'scroll' && at('feel').anchor, ANCHOR.feel)
  assert.equal(at('pipeline').kind === 'scroll' && at('pipeline').anchor, ANCHOR.pipeline)
})

test('a claims step on a product without claims goes to felt vs measured, not an empty claim panel', () => {
  assert.deepEqual(actionTarget({ section: 'claims', id: ID, channel: 'pack' }, '/retail/campaigns', false), { kind: 'scroll', anchor: ANCHOR.feel, params: {}, label: 'See felt vs measured' })
  assert.equal(actionTarget({ section: 'feel', id: ID }, '/retail/campaigns', false).label, 'See what people said')
})

test('provenance names Gemini only when it picked, with how many it chose from', () => {
  assert.equal(actionsProvenance('gemini', 4), 'Picked by Gemini from 4 things the data supports')
  assert.equal(actionsProvenance('gemini', 1), 'Picked by Gemini from 1 thing the data supports')
  assert.equal(actionsProvenance('rules', 4), 'From the data')
})

test('channels: picker order, Product page by default, unknown values fall back', () => {
  assert.deepEqual(
    CHANNELS.map((c) => c.label),
    ['Pack', 'Product page', 'Retailer listing', 'Social'],
  )
  assert.equal(channelOf(null), 'pdp')
  assert.equal(channelOf('social'), 'social')
  assert.equal(channelOf('billboard'), 'pdp')
})

test('the campaign sheet ticks the requested skin types the evidence covers, else every covered one', () => {
  assert.deepEqual(prefillSkins(['dry', 'oily', 'sensitive'], ['sensitive']), ['sensitive'])
  assert.deepEqual(prefillSkins(['dry', 'oily'], ['sensitive']), ['dry', 'oily'])
  assert.deepEqual(prefillSkins(['dry', 'oily'], []), ['dry', 'oily'])
})
