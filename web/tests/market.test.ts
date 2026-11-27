/** `npm test`: the default market from the browser, the market table, and the price shown first (src/lib/market.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MARKETS, marketFrom, marketOf, priceFor } from '../src/lib/market.ts'

test('the time zone decides first, since many browsers in Asia say en-US', () => {
  assert.equal(marketFrom(['en-US'], 'Asia/Singapore'), 'SG')
  assert.equal(marketFrom(['en-US'], 'Asia/Kuala_Lumpur'), 'MY')
  assert.equal(marketFrom(['en-US'], 'Asia/Ho_Chi_Minh'), 'VN')
  assert.equal(marketFrom(['en-GB'], 'Australia/Sydney'), 'AU')
  assert.equal(marketFrom(['en-US'], 'Pacific/Auckland'), 'NZ')
  assert.equal(marketFrom(['en-US'], 'Asia/Dubai'), 'GCC')
  assert.equal(marketFrom(['en-US'], 'Europe/London'), 'UK')
  assert.equal(marketFrom(['en-US'], 'Europe/Paris'), 'EU')
})

test('a zone that says nothing falls back to the language region, then the US', () => {
  assert.equal(marketFrom(['zh-TW', 'en'], 'UTC'), 'TW')
  assert.equal(marketFrom(['en', 'ko-KR'], 'America/Los_Angeles'), 'KR')
  assert.equal(marketFrom(['ar-SA'], 'UTC'), 'GCC')
  assert.equal(marketFrom(['de-DE'], 'UTC'), 'EU')
  assert.equal(marketFrom(['en'], 'UTC'), 'US')
})

test('every market has its own currency; an unknown one reads as the US', () => {
  assert.equal(new Set(MARKETS.map((m) => m.id)).size, 18)
  assert.equal(marketOf('MY').currency, 'MYR')
  assert.equal(marketOf('NZ').currency, 'NZD')
  assert.equal(marketOf('XX').id, 'US')
})

test('the price shown first is the lowest in the person currency, else the reference price', () => {
  const p = {
    price: { amount: 12, currency: 'USD' },
    stores: [{ price: { amount: 49, currency: 'MYR' } }, { price: { amount: 45, currency: 'MYR' } }, { price: null }],
  }
  assert.deepEqual(priceFor(p, 'MYR'), { amount: 45, currency: 'MYR' })
  assert.deepEqual(priceFor(p, 'SGD'), { amount: 12, currency: 'USD' }) // never converted
  assert.deepEqual(priceFor(p, null), { amount: 12, currency: 'USD' })
  assert.equal(priceFor({ price: null, stores: [] }, 'MYR'), null)
})
