/**
 * Where the person shops (profile.safety.market): the markets, their currency, a default guessed from the
 * browser, and the price to show first. Mirrors api app/regions.py (market → catalog region and currency),
 * which also orders product lists nearest first. No imports, so it runs in node tests.
 */

export type Market = 'SG' | 'MY' | 'TH' | 'ID' | 'PH' | 'VN' | 'IN' | 'KR' | 'JP' | 'CN' | 'HK' | 'TW' | 'AU' | 'NZ' | 'US' | 'UK' | 'EU' | 'GCC'

/** `words`: how a sentence names it ("sold as a cosmetic in the UK"). */
export const MARKETS: { id: Market; label: string; words: string; currency: string; symbol: string }[] = [
  { id: 'SG', label: 'Singapore', words: 'Singapore', currency: 'SGD', symbol: 'S$' },
  { id: 'MY', label: 'Malaysia', words: 'Malaysia', currency: 'MYR', symbol: 'RM' },
  { id: 'TH', label: 'Thailand', words: 'Thailand', currency: 'THB', symbol: '฿' },
  { id: 'ID', label: 'Indonesia', words: 'Indonesia', currency: 'IDR', symbol: 'Rp' },
  { id: 'PH', label: 'Philippines', words: 'the Philippines', currency: 'PHP', symbol: '₱' },
  { id: 'VN', label: 'Vietnam', words: 'Vietnam', currency: 'VND', symbol: '₫' },
  { id: 'IN', label: 'India', words: 'India', currency: 'INR', symbol: '₹' },
  { id: 'KR', label: 'South Korea', words: 'South Korea', currency: 'KRW', symbol: '₩' },
  { id: 'JP', label: 'Japan', words: 'Japan', currency: 'JPY', symbol: '¥' },
  { id: 'CN', label: 'China', words: 'China', currency: 'CNY', symbol: 'CN¥' },
  { id: 'HK', label: 'Hong Kong', words: 'Hong Kong', currency: 'HKD', symbol: 'HK$' },
  { id: 'TW', label: 'Taiwan', words: 'Taiwan', currency: 'TWD', symbol: 'NT$' },
  { id: 'AU', label: 'Australia', words: 'Australia', currency: 'AUD', symbol: 'A$' },
  { id: 'NZ', label: 'New Zealand', words: 'New Zealand', currency: 'NZD', symbol: 'NZ$' },
  { id: 'US', label: 'United States', words: 'the US', currency: 'USD', symbol: '$' },
  { id: 'UK', label: 'United Kingdom', words: 'the UK', currency: 'GBP', symbol: '£' },
  { id: 'EU', label: 'European Union', words: 'the EU', currency: 'EUR', symbol: '€' },
  { id: 'GCC', label: 'Gulf (GCC)', words: 'the Gulf', currency: 'AED', symbol: 'AED ' },
]
const US = MARKETS.find((m) => m.id === 'US')!
export const marketOf = (id: Market | string | null | undefined) => MARKETS.find((m) => m.id === id) ?? US
/** "the UK", "Malaysia"; an unknown code as it is. */
export const marketWords = (id: string) => MARKETS.find((m) => m.id === id)?.words ?? id

const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'])
const GCC = new Set(['AE', 'SA', 'QA', 'KW', 'BH', 'OM'])
const SAME = new Set<string>(['SG', 'MY', 'TH', 'ID', 'PH', 'VN', 'IN', 'KR', 'JP', 'CN', 'HK', 'TW', 'AU', 'NZ', 'US'])

/** A country code (a language tag's region, "en-SG" → "SG") as a market; null when Willow has none for it. */
export function marketOfCountry(code: string | undefined): Market | null {
  if (!code) return null
  const c = code.toUpperCase()
  if (SAME.has(c)) return c as Market
  if (c === 'GB' || c === 'UK') return 'UK'
  if (GCC.has(c)) return 'GCC'
  return EU.has(c) ? 'EU' : null
}

const ZONES: Record<string, Market> = {
  'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Kuching': 'MY',
  'Asia/Bangkok': 'TH',
  'Asia/Jakarta': 'ID',
  'Asia/Pontianak': 'ID',
  'Asia/Makassar': 'ID',
  'Asia/Jayapura': 'ID',
  'Asia/Manila': 'PH',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Saigon': 'VN',
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Seoul': 'KR',
  'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN',
  'Asia/Chongqing': 'CN',
  'Asia/Urumqi': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Taipei': 'TW',
  'Pacific/Auckland': 'NZ',
  'Pacific/Chatham': 'NZ',
  'Asia/Dubai': 'GCC',
  'Asia/Riyadh': 'GCC',
  'Asia/Qatar': 'GCC',
  'Asia/Kuwait': 'GCC',
  'Asia/Bahrain': 'GCC',
  'Asia/Muscat': 'GCC',
  'Europe/London': 'UK',
}

/** A time zone as a market; null when it says nothing (the Americas, Africa, UTC...). */
export function marketOfZone(tz: string): Market | null {
  if (ZONES[tz]) return ZONES[tz]
  if (tz.startsWith('Australia/')) return 'AU'
  if (tz.startsWith('Europe/')) return 'EU'
  return null
}

/**
 * The market this browser most likely shops in: its time zone first (many browsers in Asia say "en-US",
 * but the clock is local), else its language region; the US when neither says.
 */
export function marketFrom(languages: readonly string[], timeZone: string): Market {
  const fromZone = marketOfZone(timeZone)
  if (fromZone) return fromZone
  for (const lang of languages) {
    const m = marketOfCountry(lang.split(/[-_]/)[1])
    if (m) return m
  }
  return 'US'
}

/** marketFrom with this browser's languages and time zone. */
export function marketFromLocale(): Market {
  try {
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
    return marketFrom(languages, Intl.DateTimeFormat().resolvedOptions().timeZone ?? '')
  } catch {
    return 'US'
  }
}

type Priced = { price: { amount: number; currency: string } | null; stores?: { price?: { amount: number; currency: string } | null }[] }

/** The price to show first: the lowest checked price in the person's currency (a store's or the reference
 * one), else the catalog's reference price; never converted. */
export function priceFor(product: Priced, currency: string | null | undefined): { amount: number; currency: string } | null {
  if (currency) {
    const local = [product.price, ...(product.stores ?? []).map((s) => s.price)].filter((p): p is { amount: number; currency: string } => Boolean(p && p.currency === currency))
    if (local.length) return local.reduce((a, b) => (b.amount < a.amount ? b : a))
  }
  return product.price
}

/**
 * The currency each market's routine plan is priced in (api GET /v1/markets): the market's own, or
 * USD where the catalog has too few local prices. The plan's budget is set in this currency, so a
 * budget is always compared with prices in the same currency (nothing is ever converted).
 */
const priced = new Map<string, string>()
let pricedLoad: Promise<void> | null = null

export function setPricedCurrencies(list: { market: string; priced_currency: string }[]): void {
  for (const m of list) priced.set(m.market, m.priced_currency)
}

export function budgetCurrency(market: Market): string {
  return priced.get(market) ?? marketOf(market).currency
}

/** Loads the list once per page (public endpoint); a failure leaves each market's own currency. */
export function loadPricedCurrencies(apiUrl: string): Promise<void> {
  pricedLoad ??= fetch(`${apiUrl}/v1/markets`)
    .then((r) => (r.ok ? r.json() : { markets: [] }))
    .then((d: { markets?: { market: string; priced_currency: string }[] }) => setPricedCurrencies(d.markets ?? []))
    .catch(() => undefined)
  return pricedLoad
}
