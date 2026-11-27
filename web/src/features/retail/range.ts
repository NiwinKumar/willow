import type { ProductRow } from './types'

/*
 * "Connect your range" (research/finals/06 §6.3), the pure parts: read a retailer's item file (CSV), match each
 * row to the measured catalog, and say where each product stands. Matching is by Willow product_id, else by
 * brand + product name as the catalog writes them (the catalog carries no barcodes yet, so a GTIN column is kept
 * for the retailer's records and shown, never used to match). Nothing is invented: a row that matches nothing
 * is "Not recognised" and can be sent to the product-request queue.
 */

export type RangeStatus = 'measured' | 'collecting' | 'no_users' | 'not_measured' | 'unrecognised'

export const STATUS_LABEL: Record<RangeStatus, string> = {
  measured: 'Measured',
  collecting: 'Collecting',
  no_users: 'In range, no users yet',
  not_measured: 'Not measured by Willow',
  unrecognised: 'Not recognised',
}

export const STATUS_HINT: Record<RangeStatus, string> = {
  measured: '10 or more people reached week 8 with it, so it has an outcome and a Proof tier.',
  collecting: 'People use it, but fewer than 10 have reached week 8 yet.',
  no_users: 'In your range and in the catalog; no Willow user has it in a routine yet.',
  not_measured: 'Its goals have no Willow photo measure, so no outcome can be measured.',
  unrecognised: 'Not in the catalog. Send it to the product-request queue to have it added.',
}

export const STATUS_ORDER: RangeStatus[] = ['measured', 'collecting', 'no_users', 'not_measured', 'unrecognised']

export type ItemRow = { line: number; gtin: string; productId: string; brand: string; name: string; category: string; price: string; facings: string }
export type MatchedRow = ItemRow & { match: string | null; status: RangeStatus }

/** The columns an item file may carry, by every header name accepted for each. */
const COLS: Record<keyof Omit<ItemRow, 'line'>, string[]> = {
  gtin: ['gtin', 'ean', 'upc', 'barcode'],
  productId: ['product_id', 'willow_id', 'id'],
  brand: ['brand'],
  name: ['product', 'name', 'product_name', 'title'],
  category: ['category'],
  price: ['price', 'rrp'],
  facings: ['facings', 'stock_units', 'stock', 'units'],
}

export const MAX_ROWS = 500

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim() !== '')) out.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) out.push(row)
  return out
}

export class ItemFileError extends Error {}

/** Rows of an item file; throws ItemFileError with a plain sentence when the file can't be used. */
export function readItemFile(text: string): ItemRow[] {
  const rows = parseCsv(text)
  if (!rows.length) throw new ItemFileError('The file is empty.')
  const head = rows[0].map((h) => h.trim().toLowerCase())
  const at = (k: keyof typeof COLS) => head.findIndex((h) => COLS[k].includes(h))
  const idx = { gtin: at('gtin'), productId: at('productId'), brand: at('brand'), name: at('name'), category: at('category'), price: at('price'), facings: at('facings') }
  if (idx.productId < 0 && idx.name < 0) throw new ItemFileError('The header needs product_id, or brand and product (as in the template).')
  if (rows.length - 1 > MAX_ROWS) throw new ItemFileError(`Keep it to ${MAX_ROWS} rows; this file has ${rows.length - 1}.`)
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  return rows.slice(1).map((r, i) => ({
    line: i + 2,
    gtin: get(r, idx.gtin),
    productId: get(r, idx.productId),
    brand: get(r, idx.brand),
    name: get(r, idx.name),
    category: get(r, idx.category),
    price: get(r, idx.price),
    facings: get(r, idx.facings),
  }))
}

export const nameKey = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()

/** Where a catalog product stands, from its scoreboard row. */
export function statusOf(r: Pick<ProductRow, 'rate' | 'reason' | 'users'>): RangeStatus {
  if (r.rate !== null) return 'measured'
  if (r.reason === 'not_measured') return 'not_measured'
  if (r.reason === 'unused' || !r.users) return 'no_users'
  return 'collecting'
}

/** Match item rows to the catalog (product_id, then brand + name, then a name that already includes the brand). */
export function matchRows(items: ItemRow[], catalog: ProductRow[]): MatchedRow[] {
  const byId = new Map(catalog.map((p) => [p.product_id, p]))
  const byName = new Map<string, ProductRow>()
  for (const p of catalog) {
    byName.set(nameKey(`${p.brand} ${p.product}`), p)
    if (!byName.has(nameKey(p.product))) byName.set(nameKey(p.product), p)
  }
  return items.map((it) => {
    const p = byId.get(it.productId) ?? byName.get(nameKey(`${it.brand} ${it.name}`)) ?? (it.name ? byName.get(nameKey(it.name)) : undefined)
    return { ...it, match: p?.product_id ?? null, status: p ? statusOf(p) : 'unrecognised' }
  })
}

export type Coverage = Record<RangeStatus, number> & { total: number; matched: number }

export function coverage(rows: Pick<MatchedRow, 'status' | 'match'>[]): Coverage {
  const c = { measured: 0, collecting: 0, no_users: 0, not_measured: 0, unrecognised: 0, total: 0, matched: 0 }
  const seen = new Set<string>()
  for (const r of rows) {
    // the same product listed twice (two sizes, two stores) counts once
    if (r.match) {
      if (seen.has(r.match)) continue
      seen.add(r.match)
      c.matched++
    }
    c[r.status]++
    c.total++
  }
  return c
}

/** "152 products in range: 43 measured, 21 collecting, 88 with no users yet." */
export function coverageSentence(c: Coverage): string {
  const parts = [`${c.measured} measured`, c.collecting ? `${c.collecting} collecting` : null, c.no_users ? `${c.no_users} with no users yet` : null, c.not_measured ? `${c.not_measured} not measurable by photo` : null, c.unrecognised ? `${c.unrecognised} not recognised` : null].filter(Boolean)
  return `${c.total} ${c.total === 1 ? 'product' : 'products'} in range: ${parts.join(', ')}.`
}

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** A template item file: every catalog product, the retailer fills in GTIN, price and facings. */
export function itemTemplate(catalog: Pick<ProductRow, 'product_id' | 'brand' | 'product' | 'category_label'>[]): string {
  const rows = [...catalog].sort((a, b) => a.brand.localeCompare(b.brand) || a.product.localeCompare(b.product)).map((p) => ['', p.product_id, p.brand, p.product, p.category_label, '', ''].map(esc).join(','))
  return ['gtin,product_id,brand,product,category,price,facings', ...rows].join('\n') + '\n'
}

/** The item file reduced to what the shelf check reads (product_id + facings), when it has facings. */
export function stockCsv(rows: MatchedRow[]): string | null {
  const withQty = rows.filter((r) => r.match && r.facings && !Number.isNaN(Number(r.facings.replace(/,/g, ''))))
  if (!withQty.length) return null
  return ['product_id,facings', ...withQty.map((r) => `${r.match},${r.facings.replace(/,/g, '')}`)].join('\n') + '\n'
}
