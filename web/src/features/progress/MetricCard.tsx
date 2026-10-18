import { BandBar } from '../../components/charts'
import { VerdictGlyph } from '../../components/willow/Verdict'
import type { Metric, Session } from '../../data/types'
import { METRIC_META, fmtValue, unitOf } from '../../lib/metrics'
import { changeWay, verdictKind, wordsFor } from '../../lib/verdict'
import { EMPTY_CARD, METRIC_LOOK } from './metricLook'
import { verdictHeadline } from './headline'
import { valueText } from './model'

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

/** Day-detail tile: smaller number, a track with a round marker, the change in words (no numbers: those are in the detail). With `onOpen` it is a button that opens the metric's detail. */
export function MetricTile({ metric: m, session, band, place, onOpen, delay = 0 }: { metric: Metric; session: Session; band: number | null; place?: string; onOpen?: () => void; delay?: number }) {
  const look = METRIC_LOOK[m.id]
  const none = m.value === null
  const unit = unitOf(m).trim()
  const compared = !session.is_baseline && m.delta !== null
  // In words only: the numbers behind it (change, normal range) are in the metric's detail.
  const plain = none ? 'No reading on this day' : session.is_baseline ? 'Later days are compared with this value' : !compared ? 'Not compared with a baseline' : null
  const said = verdictHeadline(m, session)
  const Tag = onOpen ? 'button' : 'div'
  return (
    <Tag
      {...(onOpen ? { type: 'button' as const, onClick: onOpen, 'aria-label': `${METRIC_META[m.id].label}${place ? `, ${place}` : ''}: ${said ? said.headline : none ? 'not measured' : valueText(m)}${plain && !said ? `. ${plain}` : ''}. Open detail` } : {})}
      className={`flex min-h-[230px] animate-[wRise_.5s_both] flex-col justify-between gap-3.5 rounded-[36px] p-[22px] text-left shadow-[inset_0_0_40px_rgba(255,255,255,.3),0_30px_60px_-46px_rgba(0,0,0,.5)] squircle ${onOpen ? 'transition-transform duration-300 ease-standard hover:-translate-y-0.5 active:scale-[.98]' : ''}`}
      style={{ background: none ? EMPTY_CARD.bg : look.bg, color: none ? EMPTY_CARD.fg : look.fg, animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-col gap-0.5">
          <span className="text-[16px]">{METRIC_META[m.id].label}</span>
          {place ? <span className="text-[12px] opacity-75">{place}</span> : null}
        </span>
        <Pill metric={m} session={session} size="sm" />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-dot text-[clamp(31px,2.99vw,39px)] leading-[.9] font-extrabold tnum">{none ? '—' : fmtValue(m.value, m)}</span>
        {!none && unit ? <span className="text-[15px]">{unit}</span> : null}
      </div>
      <div className="flex flex-col gap-2">
        <BandBar variant="tile" ratio={compared && band && m.delta !== null ? m.delta / band : null} hasBand={band !== null && compared} hasValue={!none} />
        {said ? <span className="text-[15px] leading-[1.3]">{said.headline}</span> : plain ? <span className="text-[14px] leading-[1.35]">{plain}</span> : null}
      </div>
    </Tag>
  )
}
