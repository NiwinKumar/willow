/** `npm test`: Willow Proof · Shelf vs results template and ordering (features/retail/shelf.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ShelfCategory, ShelfFlag } from '../src/lib/api.ts'
import { flagsFor, templateCsv } from '../src/features/retail/shelf.ts'

const cat = { category: 'serum', label: 'Serums', products: [{ product_id: 'a', brand: 'The Ordinary', product: 'Alpha Arbutin 2% + HA' }, { product_id: 'b', brand: 'X', product: 'Say "hi", ok' }] } as unknown as ShelfCategory

test('the template lists every measured product with a blank facings column', () => {
  assert.equal(templateCsv([cat]), 'product_id,product,category,facings\na,The Ordinary Alpha Arbutin 2% + HA,Serums,\nb,"X Say ""hi"", ok",Serums,\n')
})

test('the picked category’s flags come first', () => {
  const f = (category: string, product_id: string) => ({ category, product_id }) as ShelfFlag
  assert.deepEqual(flagsFor([f('mask', 'm'), f('serum', 's'), f('toner', 't')], 'serum').map((x) => x.product_id), ['s', 'm', 't'])
})
