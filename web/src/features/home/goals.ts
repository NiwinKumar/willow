/**
 * Home's "Your goals": for each measure the person chose to work on, how it has moved across their face
 * check-ins since the baseline. Every number is one the engine measured (value, baseline value, normal-range
 * half-width, verdict); the words come from METRIC_META and lib/verdict, never from a model.
 */
import type { MetricId, Session } from '../../data/types'
import { goalMetrics, METRIC_META, unitOf, fmtReading } from '../../lib/metrics'
import { changeWay, movedWords, verdictKind, type ChangeWay, type VerdictKind } from '../../lib/verdict'
import { byGoals, countWord, runOf, usable } from './derive'

export type GoalTrend = {
  id: MetricId
  label: string
  kind: VerdictKind
  /** The way a real change went (improved, the other way); null when nothing moved beyond the range. */
  way: ChangeWay | null
  /** What the latest check-in says, in words ("Fewer / fainter spots · 3 check-ins in a row"). */
  line: string
  /** "Now 1.9% · baseline 2.7%". */
  reading: string | null
  points: { t: number; v: number }[]
  baseline: number | null
  band: number | null
}

const NONE: Record<VerdictKind, string> = {
  changed: 'Beyond your normal range',
  normal: 'Holding steady, within your normal range',
  baseline: 'Your baseline',
  notEnough: 'Normal range not ready yet',
  notCompared: 'Could not compare this time',
}

/** Up to `max` goal measures read from the latest measured check-in (the goal measures first, in goal order). */
export function goalTrends(lead: Session, baseline: Session | null, face: Session[], goals: string[], max = 4): GoalTrend[] {
  const metrics = lead.result?.metrics ?? []
  const chosen = goalMetrics(goals)
  const pool = byGoals(metrics, goals).filter((m) => m.value !== null && m.id !== 'tone_ita')
  const picked = (chosen.length ? pool.filter((m) => chosen.includes(m.id)) : pool).slice(0, max)
  const since = baseline ? Date.parse(baseline.created_at) : 0
  const same = face
    .filter((s) => usable(s) && s.capture_mode === lead.capture_mode && Date.parse(s.created_at) >= since && s.created_at <= lead.created_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  return picked.map((m) => {
    const kind = verdictKind(m, lead)
    const bm = baseline?.result?.metrics.find((x) => x.id === m.id)
    const unit = unitOf(m).trim()
    const run = kind === 'changed' ? runOf(m.id, face, lead) : 0
    const words = METRIC_META[m.id]
    // A change in the wanted direction says how ("Calmer"); the other way is said gently ("Moved the other way").
    const head = kind === 'changed' ? movedWords(m, words) : NONE[kind]
    return {
      id: m.id,
      label: words.label,
      kind,
      way: kind === 'changed' ? changeWay(m) : null,
      line: run >= 2 ? `${head} · ${countWord(run).toLowerCase()} check-ins in a row` : head,
      reading: bm?.value != null && !lead.is_baseline ? `Now ${fmtReading(m.value, m)}${unit} · baseline ${fmtReading(bm.value, bm)}${unit}` : null,
      points: same.flatMap((s) => {
        const v = s.result?.metrics.find((x) => x.id === m.id)?.value
        return v == null ? [] : [{ t: Date.parse(s.created_at), v }]
      }),
      baseline: bm?.value ?? null,
      band: bm?.mdc95 ?? null,
    }
  })
}
