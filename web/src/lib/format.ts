export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Date(iso).toLocaleDateString(undefined, opts)
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function fmtHours(h: number): string {
  if (h === 0) return 'Baseline'
  if (h < 24) return `+${h} h`
  const d = h / 24
  return Number.isInteger(d) ? `+${d} d` : `+${h} h`
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function fmtPrice(price: { amount: number; currency: string }): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency, maximumFractionDigits: price.amount % 1 ? 2 : 0 }).format(price.amount)
  } catch {
    return `${price.amount} ${price.currency}`
  }
}

/** "theordinary.com" for the credit line under a product image. */
export function imageCredit(p: { image_url?: string | null; image_source?: string | null }): string | null {
  if (!p.image_url || !p.image_source) return null
  try {
    return new URL(p.image_source).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
