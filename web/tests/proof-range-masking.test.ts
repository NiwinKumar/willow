/** `npm test`: connecting a range (features/retail/range.ts) and the competitor-naming policy (masking.ts). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { brandAlias, brandOrder, buildMask, letters, maskText, namedOthers } from '../src/features/retail/masking.ts'
import { coverage, coverageSentence, homeScope, ItemFileError, matchRows, parseCsv, readItemFile, statusOf, stockCsv } from '../src/features/retail/range.ts'
import type { ProductRow } from '../src/features/retail/types.ts'

const p = (product_id: string, brand: string, product: string, over: Partial<ProductRow> = {}) => ({ product_id, brand, product, rate: 0.5, reason: undefined, users: 40, ...over }) as ProductRow

const CATALOG = [
  p('mini-arbutin', 'Minimalist', 'Alpha Arbutin 2% Face Serum'),
  p('ord-arbutin', 'The Ordinary', 'Alpha Arbutin 2% + HA', { rate: null, users: 4 }),
  p('ord-new', 'The Ordinary', 'Squalane Cleanser', { rate: null, users: 0, reason: 'unused' }),
]

test('the item file: quoted fields, CRLF, and a header that needs an id or a name', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']])
  assert.throws(() => readItemFile('gtin,price\n1,2\n'), ItemFileError)
  const rows = readItemFile('GTIN,brand,product,facings\n890,Minimalist,Alpha Arbutin 2% Face Serum,4\n')
  assert.deepEqual([rows[0].line, rows[0].gtin, rows[0].facings], [2, '890', '4'])
})

test('rows match by id, then brand + name (accents, case and punctuation aside); the rest is not recognised', () => {
  const items = readItemFile(['product_id,brand,product', 'ord-arbutin,,', ',minimalist,ALPHA ARBUTIN 2% face-serum', ',Acme,Mystery Gel', ',,Squalane Cleanser'].join('\n'))
  const m = matchRows(items, CATALOG)
  assert.deepEqual(
    m.map((r) => [r.match, r.status]),
    [
      ['ord-arbutin', 'collecting'],
      ['mini-arbutin', 'measured'],
      [null, 'unrecognised'],
      ['ord-new', 'no_users'],
    ],
  )
  const c = coverage([...m, m[1]]) // the same product twice counts once
  assert.equal(c.total, 4)
  assert.equal(coverageSentence(c), '4 products in range: 1 measured, 1 collecting, 1 with no users yet, 1 not recognised.')
  assert.equal(stockCsv(m), null)
  assert.equal(statusOf({ rate: null, reason: 'not_measured', users: 30 }), 'not_measured')
})

test('brand letters follow code-point order, like the api (Python sorted)', () => {
  assert.deepEqual(brandOrder(['innisfree', 'COSRX', 'Avène', 'COSRX']), ['Avène', 'COSRX', 'innisfree'])
  assert.equal(letters(0), 'A')
  assert.equal(letters(26), 'AA')
  const order = brandOrder(['Minimalist', 'The Ordinary', 'Acme'])
  assert.equal(brandAlias('The Ordinary', order, 'Minimalist'), 'Brand C')
  assert.equal(brandAlias('Minimalist', order, 'Minimalist'), 'Minimalist')
  assert.equal(brandAlias('Unknown', order, 'Minimalist'), 'Another brand')
})

test('exports mask other brands and their products, never the viewer’s own names', () => {
  const m = buildMask(CATALOG, 'Minimalist')
  const csv = 'Alpha Arbutin 2% Face Serum (Minimalist),Alpha Arbutin 2% + HA (The Ordinary),The Ordinary Squalane Cleanser'
  const out = maskText(csv, m)
  assert.equal(out, 'Alpha Arbutin 2% Face Serum (Minimalist),A Brand B product (Brand B),A Brand B product')
  assert.deepEqual(namedOthers(csv, m).sort(), ['Alpha Arbutin 2% + HA', 'The Ordinary', 'The Ordinary Squalane Cleanser'])
  assert.deepEqual(namedOthers(out, m), [])
  // a whole name only: a brand called "Plum" leaves "plump" and "Plumper" alone
  const plum = buildMask([...CATALOG, p('plum-1', 'Plum', 'Green Tea Toner')], 'Minimalist')
  assert.equal(maskText('Plum toner keeps skin Plumper', plum), 'Brand B toner keeps skin Plumper')
  // the retailer (names on): no mask
  assert.equal(maskText(csv, null), csv)
})

test('Home counts a brand’s own products: in the range when it lists them, else in the catalog (as its cards)', () => {
  const rows = [p('a1', 'Derma Co', 'Sunscreen'), p('a2', 'Derma Co', 'Serum'), p('b1', 'Plum', 'Gel')]
  const noDerma = new Set(['b1'])
  assert.deepEqual(homeScope(rows, noDerma, 'Derma Co'), { rows: rows.slice(0, 2), scope: 'brand_catalog' })
  assert.deepEqual(homeScope(rows, null, 'Derma Co').scope, 'brand_catalog')
  assert.deepEqual(homeScope(rows, new Set(['a1', 'b1']), 'Derma Co'), { rows: [rows[0]], scope: 'brand_range' })
  assert.deepEqual(homeScope(rows, noDerma, null), { rows: [rows[2]], scope: 'range' })
  assert.deepEqual(homeScope(rows, null, null), { rows, scope: 'catalog' })
})

test('the coverage sentence separates thousands at catalog scale', () => {
  const c = { measured: 1495, collecting: 0, no_users: 1732, not_measured: 0, unrecognised: 0, total: 3227, matched: 3227 }
  assert.equal(coverageSentence(c), '3,227 products in range: 1,495 measured, 1,732 with no users yet.')
})
