/** `npm test`: Willow Proof · Buying list text (features/retail/buying.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { BuyingList } from '../src/lib/api.ts'
import { itemText, listText } from '../src/features/retail/buying.ts'

const list: BuyingList = {
  filters: { cohort: 'mixed', range: 'all' },
  cohort: { synthetic: 2000, real: 0 },
  source: 'rules',
  caveat: 'An ingredient match is a reason to look, not evidence that a product works.',
  items: [
    {
      id: 'redness:budget:missing',
      goal_id: 'redness',
      goal: 'Redness',
      tier: 'budget',
      tier_label: 'budget',
      price: 'under ₹700',
      kind: 'missing',
      demand: 412,
      title: 'Add a budget redness product',
      brief: '412 people want help with redness; no option under ₹700.',
      candidates: [{ product_id: 'p', product: 'Cica Gel', brand: 'Dot & Key', image_url: null, category: 'moisturizer', tier: 'budget', price: { amount: 545, currency: 'INR' }, kind: 'fit', ingredient: 'Centella Asiatica Extract', label: 'Not measured for redness yet', why: 'Contains centella, often used in redness products.' }],
    },
  ],
} as unknown as BuyingList

test('a copied brief keeps every candidate’s label and the caveat', () => {
  const text = listText(list, 'Simulated cohort')
  assert.match(text, /^Willow Proof buying list \(Simulated cohort\)/)
  assert.match(text, /1\. Add a budget redness product \(budget, under ₹700\)/)
  assert.match(text, /Dot & Key Cica Gel — Not measured for redness yet\./)
  assert.ok(text.endsWith(list.caveat))
  assert.ok(!/proven/i.test(itemText(list.items[0])))
})
