/** One metric over the sessions of a site and mode, ready for TimelineChart. */
import type { TimelinePoint } from '../../components/charts'
import type { CaptureMode, MetricId, Session } from '../../data/types'
import { fmtValue } from '../../lib/metrics'
import { bandOf, chartable, currentBaseline, metricOf, shortWhen } from './model'

export type MetricSeries = { sessions: Session[]; points: TimelinePoint[]; baseIndex: number | null; band: number | null; format: (v: number) => string }

export function metricSeries(all: Session[], mode: CaptureMode, id: MetricId, baseline?: Session | null): MetricSeries {
  const sessions = chartable(all, mode).filter((s) => !s.result?.quality.passed || s.result.metrics.some((m) => m.id === id))
  const base = baseline ?? currentBaseline(all, mode)
  const baseIndex = base ? sessions.findIndex((s) => s.id === base.id) : -1
  const band = bandOf(base, id)
  const points = sessions.map((s) => {
    const m = metricOf(s, id)
    const why = !s.result?.quality.passed ? 'not usable' : m?.verdict === 'low_quality' ? 'quality too low' : m?.value === null ? 'not measured' : null
    return {
      value: m?.value ?? null,
      label: shortWhen(s, sessions).toUpperCase(),
      why,
      name: new Date(s.created_at).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    }
  })
  const sample = metricOf(base, id) ?? sessions.map((s) => metricOf(s, id)).find(Boolean) ?? null
  const format = (v: number) => (sample ? fmtValue(v, { unit: sample.unit, mdc95: band ?? sample.mdc95 }) : v.toFixed(1))
  return { sessions, points, baseIndex: baseIndex >= 0 ? baseIndex : null, band, format }
}
