import { useEffect, useState } from 'react'

import { proofApi, type ResearchView } from './proofApi'
import type { Insights } from './types'

/*
 * How fresh the data is, said once (the data-scope control, exports, the brief): "Data to 31 Oct 2026". The
 * date comes from GET /v1/proof/research (`data_to`) when this api build has it, otherwise from the newest
 * month in the insights (`needs_by_month`), shown as a month. Never from today's date: exports used to stamp
 * "to <today>", which read as fresher than the data is.
 */

let researchP: Promise<ResearchView | null> | null = null
/** GET /v1/proof/research once per visit; null when this api build doesn't have it. */
export function fetchResearch(): Promise<ResearchView | null> {
  researchP ??= proofApi.research().catch(() => {
    researchP = null
    return null
  })
  return researchP
}

export function useResearch(): { status: 'loading' | 'ready' | 'missing'; d: ResearchView | null } {
  const [s, setS] = useState<{ status: 'loading' | 'ready' | 'missing'; d: ResearchView | null }>({ status: 'loading', d: null })
  useEffect(() => {
    let alive = true
    fetchResearch().then((d) => alive && setS({ status: d ? 'ready' : 'missing', d }))
    return () => {
      alive = false
    }
  }, [])
  return s
}

export type DataTo = { iso: string; label: string; short: string }

const MONTH = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "2026-10-31" → Data to 31 Oct 2026; "2026-10" → Data to October 2026. Pure (tested through the UI). */
export function dataToOf(dataTo: string | null | undefined, months: string[] | undefined): DataTo | null {
  if (dataTo && /^\d{4}-\d{2}-\d{2}/.test(dataTo)) {
    const d = new Date(`${dataTo.slice(0, 10)}T00:00:00Z`)
    const short = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    return { iso: dataTo.slice(0, 10), label: `Data to ${short}`, short }
  }
  const last = months?.at(-1)
  if (last && /^\d{4}-\d{2}$/.test(last)) {
    const [y, m] = last.split('-').map(Number)
    const short = MONTH(y, m)
    // the month's last day, for "is the last 30 days empty?"
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    return { iso: end, label: `Data to ${short}`, short }
  }
  return null
}

export function useDataTo(d: Pick<Insights, 'needs_by_month'> | null): DataTo | null {
  const r = useResearch()
  return dataToOf(r.d?.data_to ?? null, d?.needs_by_month?.months)
}

/** Days between the data's last day and today (UTC). */
export function staleDays(to: DataTo | null, today: string | undefined): number | null {
  if (!to || !today) return null
  return Math.round((Date.parse(`${today.slice(0, 10)}T00:00:00Z`) - Date.parse(`${to.iso}T00:00:00Z`)) / 86_400_000)
}
