import { Link } from 'react-router-dom'
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { Metric, Session } from '../data/types'
import { fmtDate, fmtHours } from '../lib/format'
import { UNIT_LABEL, decimalsFor, fmtValue } from '../lib/metrics'

type Point = { i: number; label: string; v: number | null; lo: number | null; hi: number | null; verdict: Metric['verdict'] | null; note?: string; deviation?: boolean }

/**
 * Per-metric band chart: baseline photos as a cluster at x = 0, a flat band anchored on the
 * baseline (never a cone), hollow dots inside, signal dots outside, faint crosses for low quality,
 * ticks for routine notes. No fitted trend line (docs/research/02).
 */
export function MetricDetail({ metricId, sessions, current, baseline }: { metricId: Metric['id']; sessions: Session[]; current: Metric; baseline: Session | null }) {
  const base = baseline?.result?.metrics.find((m) => m.id === metricId) ?? null
  const b = base?.value ?? null
  const mdc = base?.mdc95 ?? null
  const dec = decimalsFor(current)
  // The noise band comes from the baseline photos that passed the quality check, not all uploaded.
  const refPhotos = baseline?.result?.frames_used || baseline?.n_frames || 5
  const unit = UNIT_LABEL[current.unit]
  // Pores come with their average size (engine extras); shown so the copy's promise holds.
  const poreMm = metricId === 'pores' && typeof current.extras?.mean_diameter_mm === 'number' ? current.extras.mean_diameter_mm : null
  const points: Point[] = sessions.map((s, i) => {
    const m = s.result?.metrics.find((x) => x.id === metricId) ?? null
    return {
      i,
      label: s.hours_since_baseline !== undefined ? fmtHours(s.hours_since_baseline) : s.is_baseline ? 'Base' : fmtDate(s.created_at, { day: 'numeric', month: 'numeric' }),
      v: m?.value ?? null,
      lo: b !== null && mdc !== null ? b - mdc : null,
      hi: b !== null && mdc !== null ? b + mdc : null,
      verdict: m?.verdict ?? null,
      note: s.note,
      deviation: s.deviation,
    }
  })
  const sd = base?.within_session_sd ?? 0
  const cluster = baseline && b !== null ? [-1.2, -0.5, 0.1, 0.6, 1.1].map((k) => b + k * sd) : []
  const vals = points.map((p) => p.v).filter((v): v is number => v !== null)
  const span = [...vals, ...(mdc !== null && b !== null ? [b - mdc * 1.6, b + mdc * 1.6] : [])]
  // No values and no band (every photo failed): a flat 0..1 axis instead of ±Infinity.
  const lo = span.length ? Math.min(...span) : 0
  const hi = span.length ? Math.max(...span) : 1
  const padY = (hi - lo || 1) * 0.15

  return (
    <div className="space-y-4">
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: -18 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-3)', fontFamily: 'var(--font-mono)' }} axisLine={{ stroke: 'var(--color-border)' }} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
            <YAxis domain={[lo - padY, hi + padY]} tick={{ fontSize: 11, fill: 'var(--color-text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v.toFixed(dec)} width={44} />
            {b !== null && mdc !== null ? (
              <>
                <Area type="monotone" dataKey="hi" stroke="none" fill="var(--color-noise-band)" fillOpacity={1} isAnimationActive={false} baseValue={b - mdc} />
                <ReferenceLine y={b} stroke="var(--color-noise-500)" strokeDasharray="3 3" />
              </>
            ) : null}
            {points.filter((p) => p.note).map((p) => (
              <ReferenceLine key={p.i} x={p.label} stroke="var(--color-text-3)" strokeDasharray="2 3" label={{ value: p.note, position: 'insideTopRight', fontSize: 10, fill: 'var(--color-text-2)' }} />
            ))}
            <Line type="monotone" dataKey="v" stroke="var(--color-text-2)" strokeWidth={1.5} connectNulls isAnimationActive={false} dot={<Dot />} activeDot={false} />
            <Tooltip cursor={{ stroke: 'var(--color-border)' }} content={({ active, payload }) => (active && payload?.[0] ? <div className="rounded-(--radius-chip) border border-border bg-surface px-2 py-1 font-mono text-[12px]">{(payload[0].payload as Point).label}: {fmtValue((payload[0].payload as Point).v, current)}{unit}</div> : null)} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {cluster.length && mdc !== null ? (
        <p className="text-[12px] text-text-3">
          Your noise band (from {refPhotos} reference photos): ±{mdc !== null ? mdc.toFixed(dec) : '–'}{unit}. Hollow dots sit inside it; filled dots are outside.
        </p>
      ) : null}
      <dl className="space-y-3 text-[15px] leading-relaxed">
        <div>
          <dt className="font-semibold">What it measures</dt>
          <dd className="text-text-2">{WHAT[metricId]}</dd>
        </div>
        {poreMm !== null ? (
          <div>
            <dt className="font-semibold">Average size</dt>
            <dd className="text-text-2">
              <span className="font-mono">{poreMm.toFixed(2)} mm</span> across, on this session’s close-ups
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="font-semibold">How we decide real change</dt>
          <dd className="text-text-2">
            {current.verdict === 'low_quality'
              ? 'This photo did not pass the quality check, so it is not compared. Retake it in the same light and position.'
              : b !== null && mdc !== null
                ? `Your ${refPhotos} reference photos varied by about ±${mdc.toFixed(dec)}${unit}. A reading has to move more than that to count as a real change. This is your noise band: the smallest change that is bigger than photo-to-photo variation, with 95% confidence.`
                : b !== null && mdc === null
                  ? 'Your baseline has fewer than 3 usable photos, so there is no noise band yet: changes are shown but cannot be called real. A baseline of 5 photos measures your normal photo-to-photo variation.'
                  : current.confidence === 'indicative'
                    ? 'This metric is indicative: a directional estimate, so watch it as a trend.'
                    : 'This is your first reading. Future photos are compared to it; the noise band comes from the spread of your reference photos.'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What can move it that is not your skin</dt>
          <dd className="text-text-2">{OTHER[metricId]}</dd>
        </div>
      </dl>
      <Link to="/science" className="inline-block text-[13px] font-medium text-willow-700 underline-offset-2 hover:underline">
        Read the methodology
      </Link>
    </div>
  )
}

function Dot(props: { cx?: number; cy?: number; payload?: Point }) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined || !payload || payload.v === null) return null
  if (payload.verdict === 'low_quality')
    return (
      <g stroke="var(--color-warn-text)" strokeWidth="1.5">
        <line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} />
        <line x1={cx - 4} y1={cy + 4} x2={cx + 4} y2={cy - 4} />
      </g>
    )
  if (payload.verdict === 'real_change') return <circle cx={cx} cy={cy} r={5} fill="var(--color-signal-500)" stroke="var(--color-surface)" strokeWidth={1.5} />
  return <circle cx={cx} cy={cy} r={4} fill="var(--color-surface)" stroke={payload.verdict === 'no_baseline' ? 'var(--color-willow-500)' : 'var(--color-noise-700)'} strokeWidth={1.5} />
}

const WHAT: Record<Metric['id'], string> = {
  tone_ita: 'A description of your skin tone from how light and how yellow-brown the skin of your cheek (or forearm square) is, colour-corrected when the photo has a white reference. It is never a score, and no direction is better.',
  pigment_spots: 'The share of your skin covered by spots that are clearly darker than your own skin around them. With several photos, only spots seen in at least two of them count.',
  tone_evenness: 'How much lightness varies across your face regions and within them. Lower means more even.',
  redness: 'How red your cheeks and nose are, compared with your own skin, colour-corrected when the photo has a white reference. Harder to read on deep skin tones; then shown as indicative.',
  blemishes: 'Candidate blemishes the engine found by local redness and shading, averaged over your photos. With several photos, only blemishes seen in at least two of them count. Gemini labels each one; the count is indicative.',
  pores: 'Small dark openings 0.05 to 0.3 mm across on the close-up, counted per cm² of skin, with their average size. Measured when one eye is in the photo to set the size; otherwise indicative.',
  texture: 'How bumpy the skin surface looks at about half a millimetre on the close-up, adjusted for lightness so it reads the same on every tone. Lower is smoother. Indicative when your photos disagree too much.',
  lines: 'How many fine lines show on your forehead, beside your eyes and from nose to mouth. Very lighting dependent, so indicative.',
  dark_circles: 'How much lighter or darker the skin under your eyes is than your cheek. Below zero means darker than your cheek. Relative to your own skin, so it works across tones.',
  shine: 'The share of your forehead, nose and chin that shows bright, colourless highlights (oil and sweat reflect the light’s colour, not the skin’s). Depends on time since washing, so indicative.',
  glow: 'Brightness, colour richness and smoothness of your cheeks combined, compared only with your own earlier photos (shine is left out). Indicative.',
}
const OTHER: Record<Metric['id'], string> = {
  tone_ita: 'A different lamp, a moved paper or colour card, sun exposure, a tan, and time of day.',
  pigment_spots: 'Hair across the cheek, shadows, makeup residue, and a card that is in shadow or glare.',
  tone_evenness: 'Lighting gradients across the face, hair, and a slight head turn.',
  redness: 'Exercise, heat, a hot shower, cleansing minutes before the photo, and emotion.',
  blemishes: 'Hair and specks on the lens read as candidates; Gemini marks those as artifacts.',
  pores: 'Distance from the face, focus, makeup, and sweat.',
  texture: 'Distance and angle of the phone, dryness after cleansing, and light falling from one side.',
  lines: 'Expression, lamp angle, and head pitch.',
  dark_circles: 'Sleep, allergies, brow shadow, and head pitch.',
  shine: 'Time since washing, room temperature, and products applied.',
  glow: 'Lighting, hydration from a shower, and makeup.',
}
