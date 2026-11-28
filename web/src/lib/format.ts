/** A date-only string ("2026-10-13") is a calendar day, not UTC midnight: parse it as local. */
export function parseDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
}

/** Every date and time in the app reads the design's way ("15 Oct", "21:25") whatever the browser's locale. */
export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return parseDate(iso).toLocaleDateString('en-GB', opts)
}

/** "21:25": a check-in's time of day. */
export function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
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

/** "1 photo", "3 photos" (the plural defaults to one + s). */
/** The calendar day (YYYY-MM-DD) `weeks` whole weeks after `day`: a plan pick's start day (today + its start
 * week), so the routine's "FROM <date>" and "Verdict due" match the plan. */
export function weeksAfter(day: string, weeks: number): string {
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 7 * weeks)
  return d.toISOString().slice(0, 10)
}

/** "a" or "an" before a number said aloud: an 8-week, an 11-product, an 18-week; a 7-week. */
export function aNum(n: number): 'a' | 'an' {
  const s = String(Math.round(Math.abs(n)))
  return s.startsWith('8') || ((s.startsWith('11') || s.startsWith('18')) && s.length % 3 === 2) ? 'an' : 'a'
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** A price in its own currency; '' for no price (an index product nobody has priced yet). */
export function fmtPrice(price: { amount: number; currency: string } | null | undefined): string {
  if (!price) return ''
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency, maximumFractionDigits: price.amount % 1 ? 2 : 0 }).format(price.amount)
  } catch {
    return `${price.amount} ${price.currency}`
  }
}
