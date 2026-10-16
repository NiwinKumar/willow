/** `npm test`: the advisor's one purchase link (lib/partnerStore). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { purchaseLink } from '../src/lib/partnerStore.ts'

const s = (store: string) => ({ store, url: `https://${store.toLowerCase().replace(/ /g, '')}.example/p`, region: 'IN' })

test('the partner store is the only link when it sells the product', () => {
  assert.equal(purchaseLink([s('Brand site'), s('Ulta'), s('Nykaa'), s('Boots')], 'Nykaa')?.store, 'Nykaa')
})

test('not sold by the partner: the brand site, never another retailer', () => {
  assert.equal(purchaseLink([s('Ulta'), s('Brand site'), s('Boots')], 'Nykaa')?.store, 'Brand site')
  assert.equal(purchaseLink([s('Ulta'), s('Boots')], 'Nykaa'), null)
})

test('the partner name matches the catalog in any case', () => {
  assert.equal(purchaseLink([s('Ulta'), s('nykaa ')], 'Nykaa')?.store, 'nykaa ')
})
