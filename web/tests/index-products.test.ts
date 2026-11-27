/** `npm test`: index products (known by name only) are never shown as checked, and a missing price never breaks a line. */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hasFullFacts, needsFactsRequest } from '../src/lib/catalog.ts'
import { CHECK_WORDS, noFlagsText } from '../src/lib/checkWords.ts'
import { fmtPrice } from '../src/lib/format.ts'

const index = { product_id: 'p-index', detail: 'index' as const }

test('only an index product lacks full facts; older records without detail are full', () => {
  assert.equal(hasFullFacts({ detail: 'full' }), true)
  assert.equal(hasFullFacts({}), true)
  assert.equal(hasFullFacts({ detail: 'index' }), false)
})

test('an unchecked product reads Not checked yet and asks for the label, and no status says safe', () => {
  assert.equal(CHECK_WORDS.unknown.label, 'Not checked yet')
  assert.match(noFlagsText({ status: 'unknown', explanation: null }), /scan the label/)
  assert.equal(noFlagsText({ status: 'unknown', explanation: 'From the api' }), 'From the api')
  assert.notEqual(noFlagsText({ status: 'unknown' }), noFlagsText({ status: 'clear' }))
  for (const w of Object.values(CHECK_WORDS)) assert.doesNotMatch(`${w.label} ${w.short}`, /\bsafe\b/i)
})

test('a facts request is queued once per index product, never for a full one', () => {
  assert.equal(needsFactsRequest(index, []), true)
  assert.equal(needsFactsRequest(index, undefined), false) // requests not loaded yet: wait
  assert.equal(needsFactsRequest(index, [{ for_product_id: 'p-index', status: 'pending' }]), false)
  assert.equal(needsFactsRequest(index, [{ product_id: 'p-index', status: 'added' }]), false)
  assert.equal(needsFactsRequest(index, [{ for_product_id: 'other', status: 'pending' }]), true)
  assert.equal(needsFactsRequest({ product_id: 'p-full' }, []), false)
})

test('no price formats as nothing instead of crashing', () => {
  assert.equal(fmtPrice(null), '')
  assert.equal(fmtPrice(undefined), '')
  assert.ok(fmtPrice({ amount: 590, currency: 'INR' }).includes('590'))
})
