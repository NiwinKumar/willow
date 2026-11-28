/*
 * Proof crawl: open Proof as the retailer and as one brand, visit every section and N product pages, and fail on
 * an error boundary, an uncaught page error or a console TypeError. Not part of `npm test` (it needs a running web
 * + api and a browser). puppeteer-core is not a dependency of this repo: point PUPPETEER at any install of it.
 *
 *   PUPPETEER=/path/to/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js \
 *   BASE=http://localhost:5173 API=http://localhost:8080 N=12 node scripts/proof-crawl.mjs
 *
 * BASE: the web (dev auth, or a deployed demo where the gate signs a guest in). API: the api it talks to, read
 * only to pick product ids (half without a price, the rest by status). BRAND: the brand seat to try (default
 * CeraVe). CHROME: the browser binary. Exit code 1 when any page failed.
 * SELFTEST=1 proves the crawl can fail: every product-page answer loses its `product`, so those pages must hit the
 * error boundary and the run must exit 1.
 */
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const API = process.env.API ?? 'http://localhost:8080'
const N = Number(process.env.N ?? 12)
const BRAND = process.env.BRAND ?? 'CeraVe'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!process.env.PUPPETEER) {
  console.error('Set PUPPETEER to puppeteer-core’s entry file (see the header of this script).')
  process.exit(2)
}
const { default: puppeteer } = await import(process.env.PUPPETEER)

const SECTIONS = ['', 'products', 'customers', 'market', 'campaigns', 'research', 'range', 'digest', 'settings', 'explore', 'compare', 'board']
const BOUNDARY = /Something went wrong/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Product ids to visit: no price first (the crash this crawl was written for), then one of each status. */
async function productIds() {
  const res = await fetch(`${API}/v1/retailer/products`, { headers: { 'X-Dev-Uid': 'proof-crawl' } })
  if (!res.ok) throw new Error(`GET ${API}/v1/retailer/products: ${res.status}`)
  const rows = (await res.json()).products
  const take = (xs, k) => xs.slice(0, k).map((r) => r.product_id)
  const noPrice = rows.filter((r) => r.price_tier === null)
  const ids = [
    ...take(noPrice.filter((r) => r.tier === 'proven'), Math.ceil(N / 4)),
    ...take(noPrice.filter((r) => r.tier === 'too_few'), Math.ceil(N / 4)),
    ...['proven', 'promising', 'unclear', 'too_few'].flatMap((t) => take(rows.filter((r) => r.tier === t && r.price_tier !== null), Math.ceil(N / 8))),
    ...take(rows.filter((r) => r.brand === BRAND), 2),
  ]
  return [...new Set(ids)].slice(0, N)
}

const failures = []
let visited = 0

async function visit(page, seat, url) {
  const errors = []
  const onError = (e) => errors.push(`pageerror: ${e.message}`)
  const onConsole = (m) => {
    if (m.type() === 'error' && /TypeError|ReferenceError|Cannot read prop/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`)
  }
  page.on('pageerror', onError)
  page.on('console', onConsole)
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 }).catch((e) => errors.push(`navigation: ${e.message}`))
    await sleep(1200)
    const text = await page.evaluate(() => document.body.innerText).catch(() => '')
    if (BOUNDARY.test(text)) errors.push('error boundary: “Something went wrong”')
    if (text.trim().length < 40) errors.push('blank page')
  } finally {
    page.off('pageerror', onError)
    page.off('console', onConsole)
  }
  visited += 1
  const short = url.replace(BASE, '')
  if (errors.length) failures.push({ seat, url: short, errors: [...new Set(errors)] })
  console.log(`${errors.length ? 'FAIL' : 'ok  '} [${seat}] ${short}${errors.length ? `\n     ${[...new Set(errors)].join('\n     ')}` : ''}`)
}

/** Join a seat through the demo gate ("Choose how to explore"): the retailer is the first row (Enter); a brand is searched for. */
async function join(page, name) {
  await page.goto(`${BASE}/retail?choose=1`, { waitUntil: 'networkidle2', timeout: 90_000 })
  const input = await page.waitForSelector('input[role="combobox"]', { timeout: 60_000 })
  if (name) await input.type(name, { delay: 15 })
  await sleep(300)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('input[role="combobox"][aria-controls]') || !/Choose how to explore/.test(document.body.innerText), { timeout: 90_000 })
  await sleep(1500)
}

const ids = await productIds()
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-crawl-'))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: dir, args: ['--no-first-run'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1350, height: 940 })
  if (process.env.SELFTEST) {
    await page.setRequestInterception(true)
    page.on('request', async (req) => {
      if (req.method() !== 'GET' || !/\/v1\/retailer\/products\/[^/?]+(\?|$)/.test(req.url())) return req.continue()
      const body = await (await fetch(req.url(), { headers: req.headers() })).json()
      await req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ...body, product: null }) })
    })
  }
  for (const [seat, name] of [['retailer', null], ['brand', BRAND]]) {
    await join(page, name)
    for (const s of SECTIONS) await visit(page, seat, `${BASE}/retail${s ? `/${s}` : ''}`)
    for (const id of ids) await visit(page, seat, `${BASE}/retail/products/${encodeURIComponent(id)}`)
    // the campaign pages the list links to
    await page.goto(`${BASE}/retail/campaigns`, { waitUntil: 'networkidle2', timeout: 90_000 }).catch(() => undefined)
    const campaigns = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/retail/campaigns/"]')].map((a) => a.getAttribute('href')))].slice(0, 3))
    for (const href of campaigns) await visit(page, seat, `${BASE}${href}`)
  }
} finally {
  await browser.close()
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${visited} pages, ${failures.length} failed`)
if (failures.length) {
  console.log(JSON.stringify(failures, null, 2))
  process.exit(1)
}
