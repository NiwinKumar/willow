import type { Session } from '../data/types'
import { UNIT_LABEL, fmtSigned, fmtValue } from '../lib/metrics'
import { BandBar } from './BandBar'
import { Chip, VerdictChip } from './Chip'

/** Treated versus control: each arm against its own baseline and band; the headline is on the difference of differences. */
export function ControlCompare({ treated, control, treatedBaseline, controlBaseline, metricId }: { treated: Session; control: Session | null; treatedBaseline: Session | null; controlBaseline: Session | null; metricId: 'tone_ita' | 'redness' }) {
  const t = treated.result?.metrics.find((m) => m.id === metricId)
  const c = control?.result?.metrics.find((m) => m.id === metricId)
  const tb = treatedBaseline?.result?.metrics.find((m) => m.id === metricId)
  const cb = controlBaseline?.result?.metrics.find((m) => m.id === metricId)
  if (!t || !c || !tb || !cb || t.delta === null || c.delta === null) return null
  const noBand = tb.mdc95 === null || cb.mdc95 === null
  const dd = t.delta - c.delta
  // The difference of two readings carries both arms' photo noise (independent errors add in quadrature).
  const band = Math.hypot(tb.mdc95 ?? 0, cb.mdc95 ?? 0)
  const treatedReal = t.verdict === 'real_change'
  const controlReal = c.verdict === 'real_change'
  // The gap counts only beyond the noise for a difference and in the direction the treated side moved.
  const ddReal = !noBand && Math.abs(dd) > band && Math.sign(dd) === Math.sign(t.delta)
  const u = UNIT_LABEL[t.unit]
  const tr = `${fmtSigned(t.delta, t)}${u}`
  const un = `${fmtSigned(c.delta, c)}${u}`
  const kind = noBand
    ? 'no_band'
    : treatedReal && !controlReal && ddReal
      ? 'treated'
      : treatedReal && controlReal && ddReal
        ? 'both_more'
        : controlReal
          ? 'not_attributable'
          : treatedReal
            ? 'treated_small_gap'
            : 'noise'
  const headline = {
    no_band: 'No noise band yet',
    treated: 'Real change on the treated side',
    both_more: 'Both sides changed, the treated side more',
    not_attributable: treatedReal ? 'Both sides changed by a similar amount' : 'Only the untreated side changed',
    treated_small_gap: 'The treated side changed, but not clearly more than the untreated side',
    noise: 'Within normal photo variation on both sides',
  }[kind]
  const body = {
    no_band: `Treated moved ${tr} and untreated ${un}. A baseline with one photo has no noise band, so the difference cannot be judged yet. Take 5 photos of each square and make them your baselines.`,
    treated: `The treated side changed by ${tr} and the untreated side by ${un}. The gap (${fmtSigned(dd, t)}${u}) is outside photo noise for a difference (±${fmtValue(band, t)}${u}), so lighting or time of day are unlikely to explain it and it may be linked to the product. The untreated side staying inside its band is the test working as expected.`,
    both_more: `Both sides moved outside their bands (treated ${tr}, untreated ${un}), so something besides the product, such as light, sun or temperature, moved both. The treated side moved more by ${fmtSigned(dd, t)}${u}, beyond the noise for a difference (±${fmtValue(band, t)}${u}); that extra part may be linked to the product.`,
    not_attributable: `Treated moved ${tr} and untreated ${un}. ${treatedReal ? 'Both moved outside their bands by a similar amount' : 'The untreated side moved outside its band'}, so something other than the product, such as lighting, sun or temperature, likely moved the reading. We can't attribute this to the product.`,
    treated_small_gap: `The treated side moved ${tr}, outside its own band, while the untreated side moved ${un}. The gap (${fmtSigned(dd, t)}${u}) is still inside the noise for a difference (±${fmtValue(band, t)}${u}), so the change cannot yet be separated from drift such as light or time of day.`,
    noise: `Treated moved ${tr} and untreated ${un}; the gap (${fmtSigned(dd, t)}${u}) is inside the noise for a difference (±${fmtValue(band, t)}${u}). Nothing measurable yet.`,
  }[kind]
  return (
    <div className="rounded-(--radius-tile) border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold">Treated vs control</span>
        {kind === 'no_band' ? <VerdictChip verdict="no_baseline" noBand /> : kind === 'not_attributable' ? <Chip tone="warn">not attributable</Chip> : <VerdictChip verdict={kind === 'treated' || kind === 'both_more' ? 'real_change' : 'within_noise'} />}
      </div>
      <p className="mt-1 text-[17px] font-semibold leading-tight">{headline}</p>
      <p className="mt-2 text-[15px] leading-relaxed text-text-2">{body}</p>
      <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[13px]">
        <span className="text-text-2">Treated</span>
        <BandBar value={t.value} baseline={tb.value} mdc95={tb.mdc95} verdict={t.verdict} reach={Math.abs(t.delta)} label={`Treated side ${fmtSigned(t.delta, t)}`} />
        <span className="text-text-2">Untreated</span>
        <BandBar value={c.value} baseline={cb.value} mdc95={cb.mdc95} verdict={c.verdict} reach={Math.abs(t.delta)} label={`Untreated side ${fmtSigned(c.delta, c)}`} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[13px] text-text-2">
        <Chip tone="neutral">difference {fmtSigned(dd, t)}{u}</Chip>
        <Chip tone="neutral">band for the difference ±{fmtValue(band, t)}{u}</Chip>
      </div>
    </div>
  )
}
