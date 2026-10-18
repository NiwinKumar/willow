/** `npm test`: the one-line product names Routine rows use (features/routine/names.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compactName } from '../src/features/routine/names.ts'

const n = (custom_name: string, category: string, brand = '') => compactName({ custom_name, brand, category })

test('long catalog names are cut at their first qualifier and end on the product type', () => {
  assert.equal(n('Green Tea Alcohol-Free Pore Tightening Face Toner For Oily & Acne-Prone Skin', 'toner', 'Plum'), 'Green Tea Toner')
  assert.equal(n('Tran-Zelaic Pigmentation Corrector Serum with Tranexamic Acid & Azelaic Acid - 30ml', 'serum', 'The Derma Co'), 'Tran-Zelaic Pigmentation Serum')
  assert.equal(n('Glow Deep Serum : Rice + Alpha-Arbutin', 'serum', 'Beauty of Joseon'), 'Glow Deep Serum')
})

test('short names, strengths and brands', () => {
  assert.equal(n('Acne Pimple Master Patch', 'treatment', 'COSRX'), 'Acne Pimple Master Patch')
  assert.equal(n('15% Vitamin C & Mandarin Glow Boost Serum', 'serum', 'Plum'), 'Vitamin C')
  assert.equal(n('Plum 15% Vitamin C Serum', 'serum', 'Plum'), 'Vitamin C Serum')
  assert.equal(n('', 'serum', 'CeraVe'), 'CeraVe')
})
