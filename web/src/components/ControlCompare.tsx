import type { Session } from '../data/types'
import { fmtSigned, fmtValue } from '../lib/metrics'
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
  const band = Math.max(tb.mdc95 ?? 0, cb.mdc95 ?? 0)
  const treatedReal = t.verdict === 'real_change'
  const controlReal = c.verdict === 'real_change'
  const ddReal = !noBand && Math.abs(dd) > band
  const headline = noBand
    ? 'No noise band yet'
    : controlReal
    ? 'Both sides changed'
    : treatedReal && ddReal
      ? 'Real change on the treated side'
      : 'Within normal photo variation on both sides'
  const body = noBand
    ? `Treated moved ${fmtSigned(t.delta, t)} and untreated ${fmtSigned(c.delta, c)}. A baseline with one photo has no noise band, so the difference cannot be judged yet. Take 5 photos of each square and make them your baselines.`
    : controlReal
    ? `Both sides moved outside their bands (treated ${fmtSigned(t.delta, t)}, untreated ${fmtSigned(c.delta, c)}). Something other than the product, such as lighting, sun or temperature, likely moved the reading. We can't attribute this change to the product.`
    : treatedReal && ddReal
      ? `The treated side changed by ${fmtSigned(t.delta, t)} and the untreated side by ${fmtSigned(c.delta, c)}. The gap (${fmtSigned(dd, t)}) is outside photo noise (±${fmtValue(band, t)}), so lighting or time of day are unlikely to explain it and it may be linked to the product. The untreated side staying inside its band is the test working as expected.`
      : `Treated moved ${fmtSigned(t.delta, t)} and untreated ${fmtSigned(c.delta, c)}; both inside their noise bands (±${fmtValue(band, t)}). Nothing measurable yet.`
  return (
    <div className="rounded-(--radius-tile) border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold">Treated vs control</span>
        {noBand ? <VerdictChip verdict="no_baseline" noBand /> : controlReal ? <Chip tone="warn">not attributable</Chip> : <VerdictChip verdict={treatedReal && ddReal ? 'real_change' : 'within_noise'} />}
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
        <Chip tone="neutral">difference {fmtSigned(dd, t)}</Chip>
        <Chip tone="neutral">band ±{fmtValue(band, t)}</Chip>
      </div>
    </div>
  )
}
