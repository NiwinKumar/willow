import { toast } from 'sonner'

/**
 * Number formatting for Willow Proof (docs/DESIGN.md "Typography": tabular figures, U+2212 minus, explicit
 * plus on deltas). Rates arrive as fractions (0.48); the UI shows whole percents and "points" for differences.
 */

/** Any group under 10 people is suppressed by the api (retailer.py MIN_GROUP); the UI only says so. */
export const MIN_GROUP = 10
export const SUPPRESSED = `Fewer than ${MIN_GROUP} people`
export const MINUS = '−'

const sign = (v: number) => (v < 0 ? MINUS : '')

/** 0.476 → "48%"; null → "—". */
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const p = Math.round(v * 100)
  return `${sign(p)}${Math.abs(p)}%`
}

/** A difference of two rates in percentage points, signed: +17 pts, −4 pts, ±0 pts. */
export function pts(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const p = Math.round(v * 100)
  return `${p > 0 ? '+' : p < 0 ? MINUS : '±'}${Math.abs(p)} pts`
}

/** A 95% interval as "41–55%". */
export const interval = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo === null || lo === undefined || hi === null || hi === undefined ? null : `${pct(lo).replace('%', '')}–${pct(hi)}`

/** Counts with thin grouping (1,692). */
export const int = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-GB'))

export const weeks = (w: number | null | undefined) => (w === null || w === undefined ? '—' : `${Number.isInteger(w) ? w : w.toFixed(1)} wk`)

/** A URL-safe id for a brand name ("La Roche-Posay" → "la-roche-posay"), used in ?as=brand:<slug>. */
export function slugOf(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export type CsvValue = string | number | null | undefined

/**
 * Download a CSV in the browser. `meta` lines go first as "# " comments (cohort, filter, suppression and the
 * disclaimer: docs/DESIGN.md rule 13 puts a disclaimer on every retail export).
 */
export function downloadCsv(file: string, meta: string[], header: string[], rows: CsvValue[][]) {
  const esc = (v: CsvValue) => {
    const t = v === null || v === undefined ? '' : String(v)
    return /[",\n#]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const body = [...meta.map((m) => `# ${m}`), header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
  try {
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = file
    a.click()
    // Revoking at once can cancel the download in some browsers; give it a moment to start.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`Exported ${file} · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`)
  } catch {
    toast('The export could not be created in this browser.')
  }
}

/** Download a text file built in the browser (an evidence pack as HTML or Markdown). */
export function downloadText(file: string, body: string, type: string) {
  try {
    const url = URL.createObjectURL(new Blob([body], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = file
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`Exported ${file}`)
  } catch {
    toast('The export could not be created in this browser.')
  }
}

/** Copy text to the clipboard with a toast either way (claim statements); true when it was copied. */
export async function copyText(text: string, what = 'Copied'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast(what)
    return true
  } catch {
    toast('Copy is blocked in this browser. Select the text instead.')
    return false
  }
}
