/**
 * What a session is, in the words and shapes the Result, Progress and Product test screens draw. Every value
 * is derived from the api's sessions; verdict words only come from lib/verdict.ts.
 */
import { baselineFor } from '../../data/live'
import type { CaptureMode, Metric, MetricId, Session, Site } from '../../data/types'
import { localDay } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { METRIC_META, VERDICT_RANK, fmtSigned, fmtValue, orderedGroups, unitOf } from '../../lib/metrics'
import { VERDICT_WORDS, verdictKind, type VerdictKind } from '../../lib/verdict'

export const MODE_LABEL: Record<CaptureMode, string> = { calibrated_raw: 'RAW', uncalibrated: 'Quick' }
export const MODE_LONG: Record<CaptureMode, string> = { calibrated_raw: 'RAW', uncalibrated: 'Quick photo' }

/**
 *   pending    uploading or still measuring
 *   failed     the analysis did not finish (photos kept)
 *   unmeasured saved, the engine did not measure this site
 *   rejected   no photo passed the quality check
 *   baseline   the current baseline of its site and mode
 *   former     passed, not the baseline and compared with nothing: it was the baseline before another was chosen
 *   compared   compared with its baseline
 */
export type SessionState = 'pending' | 'failed' | 'unmeasured' | 'rejected' | 'baseline' | 'former' | 'compared'

export function sessionState(s: Session): SessionState {
  if (s.status === 'uploading' || s.status === 'processing') return 'pending'
  if (s.status === 'failed' || !s.result) return 'failed'
  if (s.measured === false) return 'unmeasured'
  if (!s.result.quality.passed) return 'rejected'
  if (s.is_baseline) return 'baseline'
  if (s.live && s.baseline_ref === null) return 'former'
  return 'compared'
}

/** A failure a second try can fix (a busy or unreachable engine), never an unreadable file. */
export function retryable(s: Session): boolean {
  return s.status === 'failed' && (!s.error?.code || ['engine_timeout', 'engine_unreachable', 'internal'].includes(s.error.code))
}

/** Sessions with numbers worth charting: analysed and measured (quality-failed ones stay as gaps). */
export function chartable(sessions: Session[], mode: CaptureMode): Session[] {
  return sessions.filter((s) => s.capture_mode === mode && s.status === 'done' && s.measured !== false && s.result)
}

/** The person's own calendar day of a session (local time). */
export const dayOf = (s: Pick<Session, 'created_at'>) => localDay(new Date(s.created_at))

/** "3 of 3 usable", "0 of 3 usable". */
export function usableLine(s: Session): string {
  const used = s.result ? (s.result.quality.passed ? s.result.frames_used : 0) : null
  return used === null ? `${s.n_frames} ${s.n_frames === 1 ? 'photo' : 'photos'}` : `${used} of ${s.n_frames} usable`
}

export const usedFrames = (s: Session | null | undefined) => (s?.result?.quality.passed ? s.result.frames_used : 0)

/** The baseline's normal range for a metric: the BASELINE session's mdc95 (a later session's own spread is not it). */
export function bandOf(baseline: Session | null, id: MetricId): number | null {
  return baseline?.result?.metrics.find((m) => m.id === id)?.mdc95 ?? null
}

export const metricOf = (s: Session | null | undefined, id: MetricId): Metric | null => s?.result?.metrics.find((m) => m.id === id) ?? null

/** True when this session is compared with a baseline that has no normal range (fewer than 3 usable photos). */
export function noBand(s: Session): boolean {
  return Boolean(!s.is_baseline && s.baseline_ref && !s.baseline_ref.has_noise_band)
}

/** Metrics in the order of the person's goals, then changed first within a group. */
export function orderMetrics(metrics: Metric[], goals: string[]): Metric[] {
  const groups = orderedGroups(goals)
  return [...metrics].sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])
}

/** Value with its unit, as written on cards ("3.1 %", "21.4°"). */
export function valueText(m: Metric, v: number | null = m.value): string {
  if (v === null) return '–'
  const u = unitOf(m)
  return `${fmtValue(v, m)}${u === '°' ? '°' : u ? ` ${u.trim()}` : ''}`
}

export function deltaText(m: Metric, d: number | null = m.delta): string {
  if (d === null) return '–'
  const u = unitOf(m)
  return `${fmtSigned(d, m)}${u === '°' ? '°' : u === '%' ? ' pts' : u ? ` ${u.trim()}` : ''}`
}

export function bandText(m: Metric, band: number): string {
  const u = unitOf(m)
  return `±${fmtValue(band, { ...m, mdc95: band })}${u === '°' ? '°' : u === '%' ? ' pts' : u ? ` ${u.trim()}` : ''}`
}

/** The metric to put on the hero ruler: the first changed one in goal order, else the first with a change. */
export function leadMetric(ordered: Metric[], session: Session): Metric | null {
  return ordered.find((m) => verdictKind(m, session) === 'changed') ?? ordered.find((m) => m.value !== null && m.delta !== null) ?? ordered.find((m) => m.value !== null) ?? null
}

export type DayStatus = 'baseline' | 'changed' | 'normal' | 'notEnough' | 'rejected' | 'other'

/** One calendar colour per session (design CELLBG; "quick" became "no normal range yet"). */
export function dayStatus(s: Session): DayStatus {
  const st = sessionState(s)
  if (st === 'rejected') return 'rejected'
  if (st === 'baseline') return 'baseline'
  if (st !== 'compared') return 'other'
  const kinds = (s.result?.metrics ?? []).map((m) => verdictKind(m, s))
  if (kinds.includes('changed')) return 'changed'
  if (kinds.includes('normal')) return 'normal'
  if (kinds.includes('notEnough')) return 'notEnough'
  return 'other'
}

export const DAY_BG: Record<DayStatus, string> = {
  baseline: 'radial-gradient(circle at 30% 20%, #F4FFB0, var(--signal-baseline) 70%)',
  changed: 'radial-gradient(120% 100% at 80% 100%, #FF8A5C 0%, #FFB27A 45%, #FFE3CC 100%)',
  normal: 'radial-gradient(120% 100% at 80% 100%, #B9A4FF 0%, #D8B8FF 45%, #EFE6FF 100%)',
  notEnough: 'radial-gradient(120% 100% at 80% 100%, #7FB6FF 0%, #9CD3FF 45%, #E3F1FF 100%)',
  rejected: 'repeating-linear-gradient(135deg, #F3D6CE 0 6px, #FBE9E4 6px 12px)',
  other: 'linear-gradient(180deg, #F4F3F0, #E3E2DD)',
}

/** Calendar key words: the verdict words of lib/verdict.ts, plus the one day state that is not a verdict. */
export const DAY_WORDS: Record<DayStatus, string> = {
  baseline: VERDICT_WORDS.baseline.label,
  changed: VERDICT_WORDS.changed.label,
  normal: VERDICT_WORDS.normal.label,
  notEnough: VERDICT_WORDS.notEnough.label,
  rejected: 'No usable photos',
  other: VERDICT_WORDS.notCompared.short,
}

/** Day-detail hero gradient and glow per status (design HB). */
export const DAY_HERO: Record<DayStatus, [string, string]> = {
  baseline: ['radial-gradient(60% 70% at 78% 62%, #C8E62E 0%, #DCF24B 30%, #EEF7B8 62%, #E9E8E2 100%)', 'rgba(170,200,20,.55)'],
  changed: ['radial-gradient(55% 65% at 78% 60%, #FF6A00 0%, #FF8A2A 22%, #F7A866 42%, #E4BFA9 62%, #D6D3D8 100%)', 'rgba(255,106,0,.55)'],
  normal: ['radial-gradient(55% 65% at 78% 60%, #9C84FF 0%, #B9A4FF 25%, #D8C6FF 50%, #E7E1F2 100%)', 'rgba(107,76,255,.45)'],
  notEnough: ['radial-gradient(55% 65% at 78% 60%, #5E9BFF 0%, #7FB6FF 25%, #B8D8FF 52%, #E3EBF5 100%)', 'rgba(31,92,255,.45)'],
  rejected: ['radial-gradient(55% 65% at 78% 60%, #FF8A70 0%, #FFB3A1 35%, #F6DCD4 70%, #ECE6E2 100%)', 'rgba(224,69,42,.45)'],
  other: ['radial-gradient(60% 70% at 50% 50%, #F7F6F3 0%, #E7E5E0 60%, #D9D7D1 100%)', 'rgba(0,0,0,.2)'],
}

/** Short reasons for chips ("Soft photo"); qualityCopy has the full sentence and the fix. */
export const REASON_SHORT: Record<string, string> = {
  card_not_found: 'No colour card found',
  card_delta_e_high: 'Card colours off',
  blurry: 'Photo too soft',
  overexposed: 'Too bright',
  underexposed: 'Too dark',
  pose_out_of_range: 'Face turned',
  face_not_found: 'No face found',
  occlusion_suspected: 'Skin covered',
  too_few_frames: 'No photo passed',
}

/** Photos (previews included) are deleted 30 days after upload (infra lifecycle on uploads/ and results/). */
export function photoExpired(s: Session): boolean {
  return Date.now() - new Date(s.created_at).getTime() > 30 * 86_400_000
}

/** Counts of each verdict in a session, plus how many metrics carry a value. */
export function counts(s: Session): Record<VerdictKind, number> & { values: number } {
  const out = { changed: 0, normal: 0, baseline: 0, notEnough: 0, notCompared: 0, values: 0 }
  for (const m of s.result?.metrics ?? []) {
    out[verdictKind(m, s)]++
    if (m.value !== null) out.values++
  }
  return out
}

/** The current baseline of a site and mode. */
export function currentBaseline(sessions: Session[], mode: CaptureMode): Session | null {
  return sessions.find((s) => s.is_baseline && s.capture_mode === mode) ?? null
}

/** Session label in lists: "15 Oct 2026, 13:59 · baseline · not usable". */
export function optionLabel(s: Session, all: Session[]): string {
  const day = dayOf(s)
  const same = all.filter((x) => dayOf(x) === day).length > 1
  const when = new Date(s.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', ...(same ? { hour: '2-digit', minute: '2-digit' } : {}) })
  const st = sessionState(s)
  const tag = st === 'baseline' ? ' · baseline' : st === 'rejected' ? ' · not usable' : st === 'pending' ? ' · still measuring' : st === 'failed' ? ' · did not finish' : st === 'unmeasured' ? ' · not measured' : st === 'former' ? ' · earlier baseline' : ''
  return `${when}${tag}`
}

/** "14 Oct" or, when the series is short (the self-tanner run), "+24 h". */
export function shortWhen(s: Session, all: Session[]): string {
  const day = fmtDate(s.created_at)
  if (all.filter((x) => fmtDate(x.created_at) === day).length > 1) return new Date(s.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return day
}

export { baselineFor }

/** Words for the advisor question about one metric, built only from measured values. */
export function metricQuestion(m: Metric, s: Session, baseline: Session | null): string {
  const band = bandOf(baseline, m.id)
  const kind = verdictKind(m, s)
  const parts = [`My ${METRIC_META[m.id].label.toLowerCase()} on ${fmtDate(s.created_at, { day: 'numeric', month: 'long' })} read ${valueText(m)}`]
  if (m.delta !== null && !s.is_baseline) parts.push(`a change of ${deltaText(m)} since my baseline`)
  if (band !== null && !s.is_baseline) parts.push(`normal range ${bandText(m, band)}`)
  return `${parts.join(', ')} (Willow says: ${kind === 'changed' ? 'changed' : kind === 'normal' ? 'within normal range' : kind === 'baseline' ? 'this is my baseline' : kind === 'notEnough' ? 'not enough data yet' : 'could not compare'}). What could explain this, and what should I keep the same next time?`
}

export function siteHasSpots(site: Site): boolean {
  return site === 'face_full' || site === 'cheek_macro' || site === 'nose_macro'
}

/** A session can become the baseline when it was analysed, measured and passed the quality check (api 409 otherwise). */
export function canBeBaseline(s: Session): boolean {
  const st = sessionState(s)
  return st === 'compared' || st === 'former'
}

/** The session a calendar day stands for: the latest analysed one, else the latest. */
export function daySession(list: Session[]): Session {
  return [...list].reverse().find((s) => s.status === 'done') ?? list[list.length - 1]
}
