import type { MetricId, Unit } from '../../data/types'
import { decimalsFor, fmtValue, METRIC_META, unitOf } from '../../lib/metrics.ts'

/**
 * "Same face, two photos" on the judge tour (NoiseDemo.tsx): each of Mei's five week-one face photos measured on its
 * own by the real engine, so two photos of one sitting can be compared the way a score app compares them.
 *
 * Source (stored results of one engine run, never Gemini): session s_20260823_810e21e6, the demo account's week-one
 * face baseline (uploads/demo_willow/…/frame_1-5.jpg, generated photos of a simulated person), run through
 * engine/app/pipeline_face.analyze_face with the per-photo values read from the frames it averages. The per-photo
 * values, `sd` and `spread` (that run's within-session SD and session mdc95) were measured with engine 0.4.2 (Nov 28
 * 2026; the stored session, engine 0.4.0, agrees to the third decimal on redness and blemishes). Engine 0.4.3 moves no
 * value, only colour and light bands (engine/app/__init__.py: "values do not move"), so they are also what 0.4.3 gives. `band` is her normal
 * range as engine 0.4.3 reports it (run on the same five files, Nov 29 2026): the spread, or for colour and light
 * readings the between-room floor when that is wider (engine/app/config.py ROOM_LIGHT_FLOOR: redness 3.63, shine 6.69; glow's own spread is already
 * wider). NOISE_SOURCE.engine is therefore 0.4.3. The engine stores only the session mean, so these per-photo values are
 * kept here; re-run the same five files to check them. Skin tone and under-eye are left out: a tone is never framed as
 * a change to chase.
 */
export const NOISE_SOURCE = { session: 's_20260823_810e21e6', engine: '0.4.3', photos: 5 } as const

type Reading = { unit: Unit; values: [number, number, number, number, number]; sd: number; spread: number; band: number }

export const NOISE_READINGS = {
  blemishes: { unit: 'count', values: [61, 52, 59, 55, 53], sd: 3.873, spread: 11.779, band: 11.779 },
  redness: { unit: 'a_star', values: [14.704, 15.281, 14.993, 15.333, 14.493], sd: 0.363, spread: 1.104, band: 3.63 },
  pigment_spots: { unit: 'pct_area', values: [0.275, 1.346, 1.122, 0.202, 1.126], sd: 0.534, spread: 1.623, band: 1.623 },
  glow: { unit: 'index', values: [58.58, 70.658, 69.154, 71.326, 68.314], sd: 5.184, spread: 15.768, band: 15.768 },
  shine: { unit: 'pct_area', values: [2.901, 3.15, 2.66, 3.378, 2.487], sd: 0.36, spread: 1.095, band: 6.69 },
  lines: { unit: 'index', values: [2.995, 3.025, 3.015, 3.56, 3.25], sd: 0.3, spread: 0.912, band: 0.912 },
} satisfies Partial<Record<MetricId, Reading>>

export type NoiseMetric = keyof typeof NOISE_READINGS
export const NOISE_METRICS = Object.keys(NOISE_READINGS) as NoiseMetric[]
/** Photo numbers as people count them (1-5). */
export const PHOTOS = [1, 2, 3, 4, 5] as const
export type Photo = (typeof PHOTOS)[number]

const shape = (id: NoiseMetric) => ({ id, unit: NOISE_READINGS[id].unit, mdc95: NOISE_READINGS[id].band })

/** A reading as shown in the app (the band sets the decimals), with its unit. */
export const shown = (id: NoiseMetric, v: number) => `${fmtValue(v, shape(id))}${unitOf(shape(id))}`

/**
 * Two photos of one metric: what a score app would report (the raw difference as a change) and what Willow reports
 * (the difference against the person's own band). `position` is the difference on a track whose ends are 1.4 bands,
 * from -1 to 1, for the drawing.
 */
export function compare(id: NoiseMetric, a: Photo, b: Photo) {
  const r = NOISE_READINGS[id]
  const va = r.values[a - 1]
  const vb = r.values[b - 1]
  const diff = vb - va
  const label = METRIC_META[id].label
  const places = decimalsFor(shape(id))
  const size = Math.abs(diff).toFixed(places)
  const percent = va ? Math.round((Math.abs(diff) / Math.abs(va)) * 100) : null
  const still = Number(size) === 0
  const scoreApp = still
    ? `${label} unchanged`
    : id === 'blemishes'
      ? `${size} ${diff < 0 ? 'fewer' : 'more'} blemishes${percent !== null ? `, ${diff < 0 ? '−' : '+'}${percent}%` : ''}`
      : `${label} ${diff < 0 ? 'down' : 'up'} ${percent ?? size}${percent !== null ? '%' : ''}`
  const inside = Math.abs(diff) <= r.band
  const scale = r.band * 1.4
  return {
    a: shown(id, va),
    b: shown(id, vb),
    diff: `${diff < 0 && !still ? '−' : still ? '' : '+'}${size}`,
    band: `±${r.band.toFixed(places)}`,
    spread: `±${r.spread.toFixed(places)}`,
    /** The normal range is the between-room floor, wider than how her photos of one sitting vary. */
    fromRoom: r.band > r.spread,
    scoreApp,
    inside,
    willow: inside ? 'Within your normal range' : 'Outside your normal range',
    position: Math.max(-1, Math.min(1, diff / scale)),
    bandShare: r.band / scale,
  }
}

/** Every pair of the five photos, for every metric here: [metric, a, b] where the difference is outside the band. */
export function outsideTheBand(): [NoiseMetric, Photo, Photo][] {
  const out: [NoiseMetric, Photo, Photo][] = []
  for (const id of NOISE_METRICS)
    for (const a of PHOTOS) for (const b of PHOTOS) if (a < b && !compare(id, a, b).inside) out.push([id, a, b])
  return out
}
