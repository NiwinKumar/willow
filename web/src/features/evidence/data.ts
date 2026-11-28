import raw from '../../data/evidence.json'

/**
 * web/src/data/evidence.json, typed. Each key is written by a script from real results and may be missing:
 * `evals` and `armor` by api/scripts/evidence_export.py (the latest api/evals/results file), `cost` by
 * api/scripts/cost_report.py (production logs), `a11y` by evidence_export.py --a11y (an axe and Lighthouse run),
 * `retest` by api/scripts/retest_report.py (volunteers' repeat check-ins).
 * A section whose key is missing is left out of the page; nothing on it is typed in by hand.
 */
export type EvalRow = { job: string; job_name: string; model: string; cases: number; adversarial: number; first_try_pass: number; final_pass: number; fallback: number; behaviour_ok: number; adversarial_ok: number; p50_s: number | null; p95_s: number | null }
export type EvalModel = { model: string; available: boolean; error?: string; cases?: number; invented_shown?: number; wording_shown?: number; errors?: number; calls?: number }
export type FailureKind = 'fallback' | 'slipped' | 'fixed'
export type Failure = { kind: FailureKind; job: string; job_name: string; model: string; case_id: string; adversarial: boolean; asked: string; check: string; check_path: string; answers_asked: number; shown: string; shown_cut: boolean }
export type Evals = {
  generated_at: string
  source: string
  run_started_at: string
  model_calls: number | null
  headline: { answers: number; adversarial: number; invented_shown: number; wording_shown: number; errors: number; first_try_rejected: number; fixed_on_retry: number; fallback: number; slipped: number; flagged: number }
  models: EvalModel[]
  rows: EvalRow[]
  failures: Failure[]
  production: { since: string; rejected: number; by_validators: number; by_schema: number; logged_calls: number } | null
}
type CostPart = { job?: string; engine_site?: string; calls_seen?: number; runs_seen?: number; median_seconds?: number; median_input_tokens?: number; median_output_tokens?: number; model?: string; per_unit?: number }
export type Cost = { generated_at: string; window_days: number; priced_on: string; note?: string; rows: { unit: string; what: string; usd: number; parts: CostPart[] }[] }
export type A11yCell = { lighthouse: number | null; serious: number; other: number }
export type A11y = { audited_on: string; tools: string; against: string; rows: { page: string; desktop?: A11yCell; mobile?: A11yCell }[] }
/** Test and retest on real skin (api/scripts/retest_report.py): two check-ins within a day, nothing changed. */
export type Retest = {
  generated_at: string
  people: number
  max_hours_apart: number
  readings: number
  false_changes: number
  false_change_rate: number | null
  by_reading: { metric_id: string; pairs: number; false_changes: number; median_move_vs_noise_band: number | null }[]
  by_tone_band: { band: string; people: number; readings: number; false_changes: number }[]
}
export type Evidence = { evals?: Evals; armor?: { configured: boolean }; cost?: Cost; a11y?: A11y; retest?: Retest }

export const evidence = raw as unknown as Evidence

export const REPO_BLOB = 'https://github.com/NiwinKumar/willow/blob/main/'

export const pct = (x: number) => `${Math.round(x * 100)}%`
/** "gemini-3.8-flash" reads as "3.8 Flash". */
export const modelName = (m: string) =>
  m
    .replace(/^gemini-/, '')
    .split('-')
    .map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
/** "27 Nov 2026", in UTC (the files' own clock). */
export const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
/** US$0.0253 reads as "2.5¢"; a dollar or more as "$1.20". */
export const money = (usd: number) => (usd >= 1 ? `$${usd.toFixed(2)}` : `${(usd * 100).toFixed(usd < 0.01 ? 2 : 1)}¢`)
/** How one part of a cost row was measured: "23 engine runs, median 40.8 s". */
export function partLine(p: CostPart): string {
  if (p.engine_site) return `${p.runs_seen} engine runs, median ${p.median_seconds} s`
  const times = p.per_unit && p.per_unit > 1 ? `, ${p.per_unit} per unit` : ''
  return `${p.job}: ${p.calls_seen} calls, median ${p.median_input_tokens?.toLocaleString('en')} tokens in and ${p.median_output_tokens?.toLocaleString('en')} out${times}`
}
