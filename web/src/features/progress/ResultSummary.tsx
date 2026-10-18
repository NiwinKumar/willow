import { VerdictGlyph } from '../../components/willow/Verdict'
import type { Metric, Session } from '../../data/types'
import { METRIC_META } from '../../lib/metrics'
import { changeWay, verdictKind } from '../../lib/verdict'
import type { Hero } from './hero'
import { deltaText } from './model'

const SHOWN = 4

/**
 * The top of a result, small: where the reading stands (what it is compared with, how many photos counted), the
 * verdict counts, and the readings that moved beyond the normal range with how far. Without comparison (a
 * baseline, a check-in that could not be measured) the short line the hero used to carry says what happened.
 */
export function ResultSummary({ hero, photos, session, ordered, onOpenMetric }: { hero: Hero; photos: string; session: Session; ordered: Metric[]; onOpenMetric: (m: Metric) => void }) {
  const moved = ordered.filter((m) => verdictKind(m, session) === 'changed')
  return (
    <section aria-label="Summary" className="flex flex-col gap-3 rounded-[28px] bg-surface p-4 shadow-[0_30px_70px_-50px_rgba(0,0,0,.35)] squircle">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="size-7 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,.5)]" style={{ background: hero.bg }} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[10.5px] tracking-[.08em] text-ink-2">■ {hero.eyebrow}</span>
          <span className="truncate text-[15px] leading-[1.25]">{hero.kicker}</span>
        </div>
        <span className="shrink-0 rounded-pill bg-sunken px-2.5 py-1 text-[12px] text-ink-2">{photos}</span>
      </div>
      {hero.chips.length ? (
        <div className="flex flex-wrap gap-1.5">
          {hero.chips.map((c) => (
            <span key={c.t} className="flex items-center gap-1.5 rounded-pill bg-sunken px-2.5 py-1 text-[12.5px]">
              {c.g === 'text' ? <span aria-hidden>{c.mark}</span> : <VerdictGlyph kind={c.g} way={c.way} />}
              {c.t}
            </span>
          ))}
        </div>
      ) : null}
      {moved.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {moved.slice(0, SHOWN).map((m) => (
            <li key={m.id} className="border-t border-line first:border-t-0">
              <button type="button" onClick={() => onOpenMetric(m)} className="hit44 flex min-h-9 w-full items-center justify-between gap-3 py-1 text-left text-[14px] hover:underline">
                <span className="flex items-center gap-2">
                  <VerdictGlyph kind="changed" way={changeWay(m)} />
                  {METRIC_META[m.id].label}
                </span>
                <span className="font-mono text-[12.5px] tnum">{deltaText(m)}</span>
              </button>
            </li>
          ))}
          {moved.length > SHOWN ? <li className="pt-1 text-[12.5px] text-ink-2">+ {moved.length - SHOWN} more in Measurements</li> : null}
        </ul>
      ) : (
        <p className="m-0 text-[13.5px] leading-[1.45] text-ink-2">{hero.text}</p>
      )}
    </section>
  )
}
