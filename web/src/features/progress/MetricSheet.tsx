import { Link } from 'react-router-dom'

import { TimelineChart } from '../../components/charts'
import { Sheet } from '../../components/ui/Sheet'
import { VerdictGlyph } from '../../components/willow/Verdict'
import type { Metric, Session } from '../../data/types'
import { METRIC_META, fmtValue, unitOf } from '../../lib/metrics'
import { VERDICT_WORDS, confidenceOf, verdictKind } from '../../lib/verdict'
import { METRIC_LOOK } from './metricLook'
import { bandOf, bandText, deltaText, metricOf, sessionState, valueText } from './model'
import { metricSeries } from './series'

/** Why this verdict, in one sentence, from the same numbers the stats show. */
function why(m: Metric, s: Session, band: number | null): string {
  const kind = verdictKind(m, s)
  if (kind === 'changed' && band !== null) return `The change (${deltaText(m)}) is larger than your normal range of ${bandText(m, band)}.`
  if (kind === 'normal' && band !== null) return `The change (${deltaText(m)}) is inside your normal range of ${bandText(m, band)}.`
  if (kind === 'baseline') return 'This check-in is your baseline. Later check-ins are compared with it.'
  if (kind === 'notEnough') return 'Your baseline has fewer than 3 usable photos, so there is no normal range yet: the change is shown but cannot be called a change.'
  if (m.value === null) return 'No value was produced this time. Missing values stay missing.'
  if (m.verdict === 'low_quality') return 'The photo did not pass the quality check for this reading, so it is not compared.'
  if (sessionState(s) === 'former') return 'This was your baseline until you chose another one, so it is not compared with it.'
  return 'This reading could not be compared with your baseline: the baseline was measured differently or does not have it.'
}

/**
 * Metric detail (design bottom sheet): what the number is, baseline / this check-in / change / normal range /
 * confidence, the verdict and why, the metric over time in this site and mode, what else moves it.
 */
export function MetricSheet({ metric, session, baseline, sessions, onClose, onAsk }: { metric: Metric | null; session: Session; baseline: Session | null; sessions: Session[]; onClose: () => void; onAsk: (m: Metric) => void }) {
  const m = metric
  const open = Boolean(m)
  if (!m) return <Sheet open={false} onClose={onClose} title="Metric detail" variant="bottom" size="lg">{null}</Sheet>
  const look = METRIC_LOOK[m.id]
  const kind = verdictKind(m, session)
  const band = bandOf(baseline, m.id)
  const bm = metricOf(baseline, m.id)
  const conf = confidenceOf(m, session)
  const series = metricSeries(sessions, session.capture_mode, m.id, baseline)
  const highlight = series.sessions.findIndex((s) => s.id === session.id)
  const unit = unitOf(m).trim()
  const label = METRIC_META[m.id].label
  const stats: [string, string, boolean][] = [
    ['Baseline', session.is_baseline ? valueText(m) : bm ? valueText(bm) : '—', false],
    ['This check-in', valueText(m), false],
    ['Change', session.is_baseline || m.delta === null ? '—' : deltaText(m), true],
    ['Normal range', band !== null ? bandText(m, band) : 'none yet', false],
    ['Confidence', conf.label.toLowerCase(), false],
  ]
  const numeric = (v: string) => /^[±+−-]?[\d.,]+/.test(v)
  return (
    <Sheet open={open} onClose={onClose} title={`${label} detail`} hideTitle variant="bottom" size="lg">
      <div className="flex flex-col gap-5 pb-2">
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[12px] leading-[1.4] text-ink-2 uppercase">
            ■ {conf.label} · {look.unitLabel}
          </span>
          <h2 className="m-0 font-serif text-[clamp(28px,3.25vw,42px)] leading-[1.05] font-normal">{label}</h2>
        </div>
        <p className="m-0 max-w-[760px] text-[17px] leading-[1.55] text-ink-2">{look.explain}</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
          {stats.map(([k, v, dark]) => (
            <div key={k} className={`flex flex-col gap-2 rounded-[24px] p-4 ${dark ? 'bg-selected text-inverse' : 'bg-sunken'}`}>
              <span className="text-[13px] opacity-80">{k}</span>
              <span className={numeric(v) ? 'font-dot text-[30px] leading-[1.1] font-extrabold tnum' : 'text-[20px] leading-[1.1]'}>{v}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3.5 rounded-[28px] bg-selected px-5 py-[18px] text-inverse">
          <VerdictGlyph kind={kind} size={20} onDark />
          <span className="flex flex-col gap-[3px]">
            <span className="text-[17px]">{VERDICT_WORDS[kind].label}</span>
            <span className="text-[14px] text-white/70">{why(m, session, band)}</span>
          </span>
        </div>
        {series.points.length ? (
          <div className="rounded-[30px] bg-selected p-[18px] text-inverse">
            <TimelineChart
              points={series.points}
              baseIndex={series.baseIndex}
              // The band drawn around the chart's baseline (a former baseline's chart uses today's baseline).
              band={series.band}
              format={series.format}
              // The band label reads as the stats above it do (this check-in's precision).
              bandValue={series.band !== null ? fmtValue(series.band, m) : undefined}
              unit={unit}
              highlight={highlight >= 0 ? highlight : null}
              summary={`${label} across ${series.points.length} check-ins${series.band !== null ? `, normal range ${bandText(m, series.band)} around the baseline` : ', no normal range yet'}. This check-in: ${valueText(m)}.`}
              caption={`${label} by check-in`}
            />
          </div>
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3.5">
          <div className="flex flex-col gap-2 rounded-[28px] bg-sunken px-5 py-[18px]">
            <span className="text-[15px]">Could also be affected by</span>
            <span className="text-[14px] leading-normal text-ink-2">{look.confounders}</span>
          </div>
          <div className="flex flex-col gap-2 rounded-[28px] bg-sunken px-5 py-[18px]">
            <span className="text-[15px]">Direction</span>
            <span className="text-[14px] leading-normal text-ink-2">
              {look.direction}
              {METRIC_META[m.id].note ? ` ${METRIC_META[m.id].note}` : ''}
            </span>
          </div>
        </div>
        {m.id === 'pores' && typeof m.extras?.mean_diameter_mm === 'number' && m.extras.mean_diameter_mm > 0 ? (
          <p className="m-0 text-[14px] text-ink-2">Average size {(m.extras.mean_diameter_mm as number).toFixed(2)} mm across, on this check-in’s close-ups.</p>
        ) : null}
        <div className="flex flex-wrap gap-[18px]">
          <Link to="/science" className="flex min-h-11 items-center text-[15px]">
            How this is measured
          </Link>
          <button type="button" onClick={() => onAsk(m)} className="flex min-h-11 items-center text-[15px] underline">
            Ask the advisor about this
          </button>
        </div>
      </div>
    </Sheet>
  )
}
