/**
 * The product test, read for Home: day N since the treated-arm baseline, which days had a treated photo,
 * and a one-line standing of the latest treated photo against its matched control (same rules as the
 * product test page: each arm against its own band, the gap against the band for a difference).
 */
import type { Session } from '../../data/types'
import { baselineFor, matchControl } from '../../data/live'
import { localDay } from '../../lib/api'
import { parseDate } from '../../lib/format'
import { dayOf, daysSince, latest, usable } from './derive'

const DOTS = 28

export type ForearmRead = { day: number; dots: boolean[]; standing: { g: string; t: string } }

export function readForearm(treated: Session[], controls: Session[]): ForearmRead | null {
  const done = treated.filter((s) => s.status === 'done')
  if (!done.length) return null
  const base = latest(treated, (s) => s.is_baseline) ?? done[0]
  const day = Math.max(0, daysSince(base.created_at))
  // One dot per day since the baseline (the last 28 when longer), filled on days with a treated photo.
  const photoDays = new Set(done.map((s) => dayOf(s.created_at)))
  const span = Math.min(DOTS, day + 1)
  const start = parseDate(localDay())
  const dots = Array.from({ length: span }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() - (span - 1 - i))
    return photoDays.has(localDay(d))
  })
  return { day, dots, standing: standingOf(treated, controls) }
}

function standingOf(treated: Session[], controls: Session[]): { g: string; t: string } {
  const t = latest(treated, usable)
  if (!t) return { g: '—', t: 'No measured treated photo yet' }
  if (t.is_baseline) return { g: '·', t: 'Baseline set; the next photo is compared with it' }
  const c = matchControl(t, controls)
  if (!c) return { g: '◌', t: 'No control photo within 3 hours of the latest' }
  const tb = baselineFor(t, treated)
  const cb = baselineFor(c, controls)
  for (const id of ['redness', 'tone_ita'] as const) {
    const tm = t.result?.metrics.find((m) => m.id === id)
    const cm = c.result?.metrics.find((m) => m.id === id)
    const tbm = tb?.result?.metrics.find((m) => m.id === id)
    const cbm = cb?.result?.metrics.find((m) => m.id === id)
    if (!tm || !cm || tm.delta === null || cm.delta === null) continue
    if (tbm?.mdc95 == null || cbm?.mdc95 == null) return { g: '◌', t: 'Not enough data yet: no normal range on both arms' }
    const dd = tm.delta - cm.delta
    const band = Math.hypot(tbm.mdc95, cbm.mdc95)
    const ddReal = Math.abs(dd) > band && Math.sign(dd) === Math.sign(tm.delta)
    const tReal = tm.verdict === 'real_change'
    const cReal = cm.verdict === 'real_change'
    if (tReal && ddReal) return { g: '◆', t: cReal ? 'Both arms changed, the treated arm more' : 'Treated arm changed beyond the control' }
    if (cReal) return { g: '○', t: 'Both arms moved: not attributable to the product' }
    if (tReal) return { g: '◌', t: 'Treated arm changed, not yet clearly more than the control' }
    return { g: '○', t: 'Within normal range on both arms so far' }
  }
  return { g: '—', t: 'Could not compare the latest photos' }
}
