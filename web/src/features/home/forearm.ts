/**
 * The product test, read for Home and Routine. With a product test (GET /v1/product-tests): "{product} on
 * your forearm · day N of M", one dot per day of the plan (filled on days with a treated photo), and the
 * standing of the latest treated photo against its matched control, given only after day 14 (before that it
 * is "too early"). Without one (forearm photos from before product tests existed): day N since the treated
 * baseline and one dot per day since then. Same rules as the product test page: each arm against its own
 * band, the gap against the band for a difference.
 */
import type { ProductTest, Session } from '../../data/types'
import { baselineFor, matchControl } from '../../data/live'
import { localDay } from '../../lib/api'
import { parseDate } from '../../lib/format'
import { planDots, testDay, VERDICT_AFTER_DAYS, type PlanDot } from '../routine/productTests'
import { dayOf, daysSince, latest, usable } from './derive'

const DOTS = 28

export type ForearmRead = {
  day: number
  /** The plan's length when a product test is running, else null ("day N since the baseline"). */
  of: number | null
  /** What is on the treated square (product tests only). */
  name: string | null
  dots: PlanDot[]
  standing: { g: string; t: string }
}

export function readForearm(treated: Session[], controls: Session[], test: ProductTest | null = null): ForearmRead | null {
  if (test) {
    const d = testDay(test)
    const since = treated.filter((s) => dayOf(s.created_at) >= test.started_at.slice(0, 10))
    const standing = !since.some((s) => s.status === 'done')
      ? { g: '·', t: 'Photograph both arms to set the starting point' }
      : d.ready
        ? standingOf(treated, controls)
        : { g: '◌', t: `Too early: verdict after day ${VERDICT_AFTER_DAYS}` }
    return { day: d.day, of: d.of, name: test.name, dots: planDots(test, treated), standing }
  }
  const done = treated.filter((s) => s.status === 'done')
  if (!done.length) return null
  // The baseline of the latest measured treated photo (its own capture mode), as the product test page counts it.
  const lt = latest(treated, usable)
  const base = (lt ? baselineFor(lt, treated) : null) ?? latest(treated, (s) => s.is_baseline) ?? done[0]
  const day = Math.max(0, daysSince(base.created_at))
  // One dot per day since the baseline (the last 28 when longer), filled on days with a treated photo.
  const photoDays = new Set(done.map((s) => dayOf(s.created_at)))
  const span = Math.min(DOTS, day + 1)
  const start = parseDate(localDay())
  const dots = Array.from({ length: span }, (_, i): PlanDot => {
    const d = new Date(start)
    d.setDate(d.getDate() - (span - 1 - i))
    return photoDays.has(localDay(d)) ? 'photo' : 'past'
  })
  return { day, of: null, name: null, dots, standing: standingOf(treated, controls) }
}

export function standingOf(treated: Session[], controls: Session[]): { g: string; t: string } {
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
    if (tReal && ddReal) return { g: '◆', t: cReal ? 'Both arms moved, the treated arm more' : 'Treated arm moved beyond the control' }
    if (cReal) return { g: '○', t: 'Both arms moved: not attributable to the product' }
    if (tReal) return { g: '◌', t: 'Treated arm moved, not yet clearly more than the control' }
    return { g: '○', t: 'Within normal range on both arms so far' }
  }
  return { g: '—', t: 'Could not compare the latest photos' }
}
