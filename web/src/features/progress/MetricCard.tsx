import { BandBar } from '../../components/charts'
import { bandPosition } from '../../components/charts/chartMath'
import { VerdictGlyph } from '../../components/willow/Verdict'
import type { Metric, Session } from '../../data/types'
import { METRIC_META, fmtValue, unitOf } from '../../lib/metrics'
import { VERDICT_WORDS, changeWay, confidenceOf, verdictKind, wordsFor, type VerdictKind } from '../../lib/verdict'
import { EMPTY_CARD, METRIC_LOOK } from './metricLook'
import { verdictHeadline } from './headline'
import { bandText, deltaText, valueText } from './model'

/** The verdict pill the cards draw: black with the ember ◆ for Improved / Shifted, frosted otherwise. Glyph + words. */
function Pill({ metric, session, size = 'md' }: { metric: Metric; session: Session; size?: 'md' | 'sm' }) {
  const kind = verdictKind(metric, session)
  const way = changeWay(metric)
  const changed = kind === 'changed' && way !== 'otherWay'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill whitespace-nowrap ${size === 'md' ? 'px-3 py-[7px] text-[12px]' : 'px-[11px] py-1.5 text-[12px]'} ${changed ? 'bg-selected text-inverse' : 'bg-white/65'}`}>
      <VerdictGlyph kind={kind} way={way} onDark={changed} />
      {wordsFor(metric, session).label}
    </span>
  )
}

/** The compact card's verdict: a small glyph and a short word, no pill. */
const CARD_VERDICT: Record<VerdictKind, string> = { changed: 'Changed', normal: 'Normal', baseline: 'Baseline', notEnough: 'Too early', notCompared: 'Not compared' }

/** A thin baseline track: the white block is the normal range, the dot is the reading. Decorative: the delta line carries the numbers. */
function Track({ ratio, hasBand, hasValue }: { ratio: number | null; hasBand: boolean; hasValue: boolean }) {
  const pos = bandPosition(hasBand ? ratio : null)
  return (
    <span aria-hidden className="relative block h-1.5 rounded-pill bg-current/15">
      <span className="absolute inset-y-0 left-[35%] w-[30%] rounded-pill bg-white/70" style={{ opacity: hasBand ? 1 : 0.3 }} />
      <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current shadow-[0_0_0_2px_rgba(255,255,255,.7)] transition-[left] duration-[600ms]" style={{ left: `${pos}%`, opacity: hasValue ? 1 : 0 }} />
    </span>
  )
}

/**
 * A compact measurement card: name and verdict on one line, the number in Doto with its unit, a thin baseline
 * track (the white block is the baseline's normal range) and one line of change. The whole card opens the metric sheet.
 */
export function MetricCard({ metric: m, session, band, compared, against, onOpen, delay = 0 }: { metric: Metric; session: Session; band: number | null; compared: boolean; against?: string; onOpen: () => void; delay?: number }) {
  const look = METRIC_LOOK[m.id]
  const none = m.value === null
  const kind = verdictKind(m, session)
  const unit = unitOf(m).trim()
  const ratio = compared && band && m.delta !== null ? m.delta / band : null
  const said = verdictHeadline(m, session, against)
  const bandLabel = band !== null ? `range ${bandText(m, band)}` : 'no normal range yet'
  const deltaLabel = none ? 'No reading' : session.is_baseline ? `Baseline · ${bandLabel}` : !compared ? VERDICT_WORDS.notCompared.short : `Δ ${deltaText(m)} · ${bandLabel}`
  const fullDelta = `${deltaLabel} · ${confidenceOf(m, session).label.toLowerCase()}`
  return (
    <button
      type="button"
      onClick={onOpen}
      title={said ? `${said.headline}. ${fullDelta}` : fullDelta}
      aria-label={`${METRIC_META[m.id].label}: ${said ? `${said.headline}, ${said.numbers ?? ''}` : `${none ? 'not measured' : valueText(m)}, ${wordsFor(m, session).label}`}. Open detail`}
      className="relative flex h-full min-h-[116px] min-w-0 animate-[wRise_.5s_both] flex-col justify-between gap-2 rounded-[24px] p-3.5 text-left shadow-[inset_0_0_30px_4px_rgba(255,255,255,.35),0_18px_36px_-30px_rgba(0,0,0,.4)] transition-transform duration-[400ms] ease-[cubic-bezier(.2,.7,.2,1)] squircle hover:-translate-y-0.5"
      style={{ background: none ? EMPTY_CARD.bg : look.bg, color: none ? EMPTY_CARD.fg : look.fg, animationDelay: `${delay}ms` }}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[14px] font-medium">{METRIC_META[m.id].label}</span>
        <span title={wordsFor(m, session).long} className="inline-flex shrink-0 items-center gap-1 text-[11px] opacity-85">
          <VerdictGlyph kind={kind} way={changeWay(m)} size={10} />
          <span className="sr-only min-[480px]:not-sr-only">{kind === 'changed' ? wordsFor(m, session).short : CARD_VERDICT[kind]}</span>
        </span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-dot text-[30px] leading-none tnum">{none ? '—' : fmtValue(m.value, m)}</span>
        {!none && unit ? <span className="min-w-0 truncate text-[12px] opacity-85">{unit}</span> : null}
      </span>
      <span className="flex flex-col gap-1.5">
        <Track ratio={ratio} hasBand={band !== null && compared} hasValue={!none} />
        <span className="truncate text-[12px] leading-[1.3] opacity-90">{deltaLabel}</span>
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
