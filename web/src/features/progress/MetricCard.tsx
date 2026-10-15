import { BandBar } from '../../components/charts'
import { VerdictGlyph } from '../../components/willow/Verdict'
import type { Metric, Session } from '../../data/types'
import { METRIC_META, fmtValue, unitOf } from '../../lib/metrics'
import { VERDICT_WORDS, confidenceOf, verdictKind } from '../../lib/verdict'
import { EMPTY_CARD, METRIC_LOOK } from './metricLook'
import { bandText, deltaText } from './model'

/** The verdict pill the cards draw: black with the ember ◆ for Changed, frosted otherwise. Glyph + words. */
function Pill({ metric, session, size = 'md' }: { metric: Metric; session: Session; size?: 'md' | 'sm' }) {
  const kind = verdictKind(metric, session)
  const changed = kind === 'changed'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill whitespace-nowrap ${size === 'md' ? 'px-3 py-[7px] text-[12px]' : 'px-[11px] py-1.5 text-[12px]'} ${changed ? 'bg-selected text-inverse' : 'bg-white/65'}`}>
      <VerdictGlyph kind={kind} onDark={changed} />
      {VERDICT_WORDS[kind].label}
    </span>
  )
}

/**
 * A measurement card (design "Measurements"): verdict pill, name and what the number is, the number in Doto,
 * the band bar (the white block is the baseline's normal range) and the change against the baseline.
 */
export function MetricCard({ metric: m, session, band, compared, onOpen, delay = 0 }: { metric: Metric; session: Session; band: number | null; compared: boolean; onOpen: () => void; delay?: number }) {
  const look = METRIC_LOOK[m.id]
  const none = m.value === null
  const kind = verdictKind(m, session)
  const unit = unitOf(m).trim()
  const ratio = compared && band && m.delta !== null ? m.delta / band : null
  const deltaLabel = none ? 'No reading' : session.is_baseline ? 'Baseline value' : !compared ? VERDICT_WORDS.notCompared.short : `Δ ${deltaText(m)}`
  const bandLabel = band !== null ? `range ${bandText(m, band)} · ${confidenceOf(m, session).label.toLowerCase()}` : 'no normal range yet'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${METRIC_META[m.id].label}: ${none ? 'not measured' : `${fmtValue(m.value, m)}${unit ? ` ${unit}` : ''}`}, ${VERDICT_WORDS[kind].label}. Open detail`}
      className="relative flex min-h-[320px] animate-[wRise_.5s_both] flex-col justify-between gap-[18px] rounded-[40px] p-6 text-left shadow-[inset_0_0_40px_8px_rgba(255,255,255,.4),0_30px_60px_-44px_rgba(0,0,0,.5)] transition-transform duration-[400ms] ease-[cubic-bezier(.2,.7,.2,1)] squircle hover:-translate-y-[5px]"
      style={{ background: none ? EMPTY_CARD.bg : look.bg, color: none ? EMPTY_CARD.fg : look.fg, animationDelay: `${delay}ms` }}
    >
      <span className="flex flex-col items-start gap-3">
        <Pill metric={m} session={session} />
        <span className="flex flex-col gap-[3px]">
          <span className="text-[20px]">{METRIC_META[m.id].label}</span>
          <span className="text-[13px] opacity-85">{look.unitLabel}</span>
        </span>
      </span>
      <span className="flex items-baseline gap-2">
        <span className="font-dot text-[clamp(39px,3.9vw,49px)] leading-[.9] tnum">{none ? '—' : fmtValue(m.value, m)}</span>
        {!none && unit ? <span className="text-[16px] opacity-85">{unit}</span> : null}
      </span>
      <span className="flex flex-col gap-2.5">
        <BandBar ratio={ratio} hasBand={band !== null && compared} hasValue={!none} />
        <span className="flex flex-wrap justify-between gap-2 text-[14px]">
          <span className="whitespace-nowrap">{deltaLabel}</span>
          <span className="opacity-85">{bandLabel}</span>
        </span>
      </span>
    </button>
  )
}

/** Day-detail tile: smaller number, a track with a round marker, one line of change text. */
export function MetricTile({ metric: m, session, band, baselineDay, delay = 0 }: { metric: Metric; session: Session; band: number | null; baselineDay: string | null; delay?: number }) {
  const look = METRIC_LOOK[m.id]
  const none = m.value === null
  const unit = unitOf(m).trim()
  const compared = !session.is_baseline && m.delta !== null
  const text = none
    ? 'No reading on this day'
    : session.is_baseline
      ? 'Later days are compared with this value'
      : !compared
        ? 'Not compared with a baseline'
        : `Δ ${deltaText(m)}${baselineDay ? ` vs ${baselineDay}` : ''}${band !== null ? ` · normal range ${bandText(m, band)}` : ' · no normal range yet'}`
  return (
    <div
      className="flex min-h-[230px] animate-[wRise_.5s_both] flex-col justify-between gap-3.5 rounded-[36px] p-[22px] shadow-[inset_0_0_40px_rgba(255,255,255,.3),0_30px_60px_-46px_rgba(0,0,0,.5)] squircle"
      style={{ background: none ? EMPTY_CARD.bg : look.bg, color: none ? EMPTY_CARD.fg : look.fg, animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-[16px]">{METRIC_META[m.id].label}</span>
        <Pill metric={m} session={session} size="sm" />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-dot text-[clamp(31px,2.99vw,39px)] leading-[.9] font-extrabold tnum">{none ? '—' : fmtValue(m.value, m)}</span>
        {!none && unit ? <span className="text-[15px]">{unit}</span> : null}
      </div>
      <div className="flex flex-col gap-2">
        <BandBar variant="tile" ratio={compared && band && m.delta !== null ? m.delta / band : null} hasBand={band !== null && compared} hasValue={!none} />
        <span className="text-[13px] leading-[1.4]">{text}</span>
      </div>
    </div>
  )
}
