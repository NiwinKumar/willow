/**
 * Illustrative sample journeys for demo mode, generated deterministically from the contract fixture.
 * Clearly labelled "sample" in the UI until Harshini's consented captures are seeded (docs/DEMO_PLAN.md).
 */
import { FIXTURE } from '../data/fixture'
import type { AnalysisResult, Explanation, Metric, Roi, Session, Site, SiteSeries } from '../data/types'
import { METRIC_META, fmtSigned, fmtValue } from '../lib/metrics'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function gauss(rng: () => number) {
  const u = 1 - rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const BASE_DATE = new Date('2026-08-29T13:00:00Z')
const iso = (d: Date) => d.toISOString()
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)
const addHours = (d: Date, n: number) => new Date(d.getTime() + n * 3_600_000)

export const FACE_ROIS: Roi[] = [
  { name: 'forehead', polygon: [[1000, 900], [2024, 900], [1960, 1350], [1064, 1350]] },
  { name: 'left_cheek', polygon: [[880, 1750], [1340, 1700], [1380, 2250], [960, 2300]] },
  { name: 'right_cheek', polygon: [[1684, 1700], [2144, 1750], [2064, 2300], [1644, 2250]] },
  { name: 'nose', polygon: [[1400, 1500], [1624, 1500], [1680, 2050], [1344, 2050]] },
  { name: 'chin', polygon: [[1240, 2650], [1784, 2650], [1700, 3000], [1324, 3000]] },
  { name: 'left_under_eye', polygon: [[960, 1520], [1360, 1500], [1360, 1660], [980, 1680]] },
  { name: 'right_under_eye', polygon: [[1664, 1500], [2064, 1520], [2044, 1680], [1664, 1660]] },
]
export const FOREARM_ROIS: Roi[] = [{ name: 'square', polygon: [[1000, 1300], [2024, 1300], [2024, 2324], [1000, 2324]] }]

/** Which ROI each metric lights up on the stage (layers). */
export const METRIC_ROIS: Partial<Record<Metric['id'], string[]>> = {
  tone_ita: ['left_cheek', 'right_cheek', 'square', 'forearm_square'],
  pigment_spots: ['left_cheek', 'right_cheek', 'forehead'],
  tone_evenness: ['forehead', 'left_cheek', 'right_cheek', 'nose', 'chin'],
  redness: ['left_cheek', 'right_cheek', 'nose', 'square', 'forearm_square'],
  blemishes: ['forehead', 'left_cheek', 'right_cheek', 'chin'],
  lines: ['forehead'],
  dark_circles: ['left_under_eye', 'right_under_eye'],
  shine: ['forehead', 'nose'],
  glow: ['left_cheek', 'right_cheek'],
}

function explain(metrics: Metric[], hoursLabel: string | null): Explanation {
  const real = metrics.filter((m) => m.verdict === 'real_change')
  const items = metrics
    .filter((m) => m.verdict !== 'no_baseline' && m.delta !== null)
    .slice(0, 4)
    .map((m) => {
      const d = fmtSigned(m.delta, m)
      const band = m.mdc95 !== null ? fmtValue(m.mdc95, m) : null
      const summary =
        m.verdict === 'real_change'
          ? `${METRIC_META[m.id].label} moved ${d}, outside your noise band of ±${band}. That is a measurable change (${METRIC_META[m.id][m.direction === 'decrease' ? 'decrease' : 'increase']}).`
          : m.verdict === 'low_quality'
            ? `${METRIC_META[m.id].label} could not be compared this time because the photo quality differed from your reference.`
            : band
              ? `${METRIC_META[m.id].label} moved ${d}, inside your noise band of ±${band}. No clear change yet.`
              : `${METRIC_META[m.id].label} looks similar (${d}); this metric is indicative, so it is a trend, not a verdict.`
      return { metric_id: m.id, summary, quoted_numbers: [d, band].filter((x): x is string => x !== null) }
    })
  return {
    headline: real.length === 0 ? 'No measurable change since your baseline' : `${real.length} real change${real.length > 1 ? 's' : ''} since your baseline${hoursLabel ? ` (${hoursLabel})` : ''}`,
    items,
    next_steps:
      real.length === 0
        ? ['Keep the same lamp, distance and settings for every session.', 'Most skincare effects take 4 to 8 weeks to exceed photo noise.']
        : ['Keep the routine as it is for another two weeks before changing anything.', 'Retake under the same light to confirm the change holds.'],
    disclaimer: 'Cosmetic appearance tracking, not a diagnosis. Sample explanation written from the measured numbers.',
  }
}

function session(
  idx: number,
  site: Site,
  date: Date,
  metrics: Metric[],
  opts: { baseline?: boolean; hours?: number; nFrames?: number; quality?: AnalysisResult['quality']; note?: string; deviation?: boolean; rois: Roi[] },
): Session {
  const id = `s_${date.toISOString().slice(0, 10).replaceAll('-', '')}_${site.slice(0, 4)}${String(idx).padStart(4, '0')}`
  const result: AnalysisResult = {
    ...FIXTURE,
    session_id: id,
    user_id: 'demo_willow',
    site,
    frames_used: opts.nFrames ?? 3,
    quality: opts.quality ?? { ...FIXTURE.quality, per_frame: undefined },
    metrics,
    candidates: site === 'face_full' ? FIXTURE.candidates : [],
    overlays: [],
    rois: opts.rois,
    image_size: { width: 3024, height: 4032 },
    warnings: [],
  }
  return {
    id,
    site,
    capture_mode: 'calibrated_raw',
    created_at: iso(date),
    status: 'done',
    n_frames: opts.nFrames ?? 3,
    is_baseline: Boolean(opts.baseline),
    result,
    labels: site === 'face_full' ? { c_001: 'post_blemish_mark', c_002: 'freckle' } : {},
    explanation: explain(metrics, opts.hours !== undefined ? (opts.hours === 0 ? null : `+${opts.hours} h`) : null),
    preview: null,
    note: opts.note,
    deviation: opts.deviation,
    hours_since_baseline: opts.hours,
  }
}

function withBaseline(m: Metric, baselineValue: number, value: number, baselineMdc: number | null, lowQuality = false): Metric {
  const delta = +(value - baselineValue).toFixed(3)
  let verdict: Metric['verdict'] = 'within_noise'
  if (lowQuality) verdict = 'low_quality'
  else if (m.confidence === 'measured' && baselineMdc !== null && Math.abs(delta) > baselineMdc) verdict = 'real_change'
  return { ...m, value: +value.toFixed(3), delta, verdict, direction: delta < 0 ? 'decrease' : delta > 0 ? 'increase' : 'none' }
}

/** Face: 5-frame baseline then six weekly check-ins; azelaic acid started at week 2; dark spots clear the band by week 6. */
export function faceSeries(): SiteSeries {
  const rng = mulberry32(42)
  const fixtureMetrics = FIXTURE.metrics
  const baseVals = Object.fromEntries(fixtureMetrics.map((m) => [m.id, (m.value ?? 0) - (m.delta ?? 0)])) as Record<string, number>
  const sessions: Session[] = []
  const baselineMetrics: Metric[] = fixtureMetrics.map((m) => ({ ...m, value: +baseVals[m.id].toFixed(3), delta: null, verdict: 'no_baseline', direction: 'none' }))
  sessions.push(session(0, 'face_full', BASE_DATE, baselineMetrics, { baseline: true, nFrames: 5, rois: FACE_ROIS }))
  const effect: Record<string, number[]> = { pigment_spots: [0, 0, -0.05, -0.2, -0.4, -0.62, -0.7], redness: [0, 0.1, -0.2, -0.3, -0.5, -0.6, -0.8], blemishes: [0, 0, -1, -1, -2, -2, -2] }
  for (let w = 1; w <= 6; w++) {
    const low = w === 3
    const metrics = fixtureMetrics.map((m) => {
      const sd = m.within_session_sd ?? 0
      const noise = gauss(rng) * sd * 0.9
      const eff = effect[m.id]?.[w] ?? 0
      const value = baseVals[m.id] + eff + noise
      return withBaseline(m, baseVals[m.id], w === 6 ? (m.value ?? value) : value, m.mdc95, low && ['redness', 'tone_ita'].includes(m.id))
    })
    sessions.push(
      session(w, 'face_full', addDays(BASE_DATE, 7 * w), metrics, {
        nFrames: 3,
        rois: FACE_ROIS,
        quality: low ? { passed: true, card_detected: true, card_delta_e_mean: 5.4, sharpness: 310, clipped_pct: 1.9, pose: { yaw: 6.5, pitch: 1, roll: 0.3 }, reasons: ['card_delta_e_high'] } : undefined,
        note: w === 2 ? 'Started azelaic acid' : w === 4 ? 'Slept badly, different lamp position' : undefined,
        deviation: w === 4,
      }),
    )
  }
  return { site: 'face_full', sessions }
}

/** Self-tanner split forearm: treated vs control over 0 / 1 / 4 / 24 / 48 / 72 / 96 hours. */
export function forearmSeries(site: 'forearm_treated' | 'forearm_control'): SiteSeries {
  const rng = mulberry32(site === 'forearm_treated' ? 7 : 11)
  const hours = [0, 1, 4, 24, 48, 72, 96]
  const itaBase = site === 'forearm_treated' ? 41.2 : 41.0
  const redBase = site === 'forearm_treated' ? 11.8 : 11.6
  const itaEffect = site === 'forearm_treated' ? [0, -0.4, -1.8, -6.2, -8.9, -9.6, -9.1] : [0, 0.2, -0.3, 0.4, -0.5, 0.1, -0.2]
  const redEffect = site === 'forearm_treated' ? [0, 0.3, 0.9, 0.6, 0.4, 0.2, 0.1] : [0, 0.1, -0.2, 0.2, 0.1, -0.1, 0.0]
  const tone = FIXTURE.metrics.find((m) => m.id === 'tone_ita')!
  const red = FIXTURE.metrics.find((m) => m.id === 'redness')!
  const toneBase: Metric = { ...tone, value: itaBase, delta: null, verdict: 'no_baseline', direction: 'none', within_session_sd: 0.58, mdc95: 1.6, extras: { l_star: 66.1, b_star: 18.9, ita_band: 'light', monk_estimate: 4 } }
  const redBaseM: Metric = { ...red, value: redBase, delta: null, verdict: 'no_baseline', direction: 'none', within_session_sd: 0.4, mdc95: 1.1, extras: { erythema_index: 38.4 } }
  const sessions: Session[] = []
  hours.forEach((h, i) => {
    const date = addHours(BASE_DATE, h)
    if (h === 0) {
      sessions.push(session(i, site, date, [toneBase, redBaseM], { baseline: true, nFrames: 5, hours: 0, rois: FOREARM_ROIS }))
      return
    }
    const t = withBaseline(toneBase, itaBase, itaBase + itaEffect[i] + gauss(rng) * 0.45, 1.6)
    const r = withBaseline(redBaseM, redBase, redBase + redEffect[i] + gauss(rng) * 0.3, 1.1)
    sessions.push(session(i, site, date, [t, r], { nFrames: 3, hours: h, rois: FOREARM_ROIS, note: i === 1 && site === 'forearm_treated' ? 'Self-tanner applied' : undefined }))
  })
  return { site, sessions }
}

export const DEMO_SERIES: Record<string, SiteSeries> = {
  face_full: faceSeries(),
  forearm_treated: forearmSeries('forearm_treated'),
  forearm_control: forearmSeries('forearm_control'),
}
export const DEMO_SITES = Object.keys(DEMO_SERIES) as Site[]
