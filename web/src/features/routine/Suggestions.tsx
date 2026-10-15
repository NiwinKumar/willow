import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { RoutineEntry, Session } from '../../data/types'
import { daysBetween, fmtDate, plural } from '../../lib/format'
import { METRIC_META, fmtSigned, unitOf } from '../../lib/metrics'
import { outcomeFor } from '../../lib/outcome'
import { CategoryOrb } from './productUi'
import { entryName, type Finding } from './routineModel'

const usable = (s: Session) => s.status === 'done' && s.measured !== false && Boolean(s.result?.quality.passed)

/**
 * "Suggested today" (design: three aura cards), built only from what the api answered: a gap from the
 * routine check ("■ MORNING · MISSING") and a product whose start was followed by a real change ("◆").
 * The design's "TONIGHT · alternate nights" card needs a schedule the api does not store, so it is not
 * drawn. Nothing to suggest: the section is not shown.
 */
export function Suggestions({ findings, entries, sessions, onFind }: { findings: Finding[]; entries: RoutineEntry[]; sessions: Session[]; onFind: (f: Finding) => void }) {
  const navigate = useNavigate()
  const gaps = findings.filter((f) => f.kind === 'Gap').slice(0, 2)
  const changes = entries
    .map((e) => ({ e, o: outcomeFor(e, sessions) }))
    .flatMap(({ e, o }) => {
      if (o.kind !== 'real') return []
      const latest = sessions.filter((s) => s.site === o.site && usable(s)).at(-1)
      const m = latest?.result?.metrics.find((x) => x.id === o.metric)
      return latest && m && m.delta !== null ? [{ e, o, latest, m }] : []
    })
    .slice(0, 3 - gaps.length)
  if (gaps.length + changes.length === 0) return null

  const card = 'relative isolate flex min-h-[230px] flex-[1_1_260px] flex-col gap-3 overflow-hidden rounded-[32px] p-5 squircle'
  return (
    <section aria-labelledby="suggested-h" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5 px-1.5 pt-1">
        <h2 id="suggested-h" className="text-[20px] font-normal tracking-[-0.01em]">
          Suggested today
        </h2>
        <span className="font-mono text-[10.5px] tracking-[.08em] text-ink-2">■ UPDATES WITH EACH CHECK-IN AND ROUTINE CHANGE</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {gaps.map((f, i) => {
          const sun = f.find?.category === 'sunscreen'
          return (
            <article
              key={f.key}
              className={`${card} text-ink`}
              style={{ background: 'radial-gradient(90% 90% at 100% 0%, #FFF3A8 0%, transparent 60%), radial-gradient(80% 80% at 0% 100%, #FFB27A 0%, transparent 65%), #FFE2CF', boxShadow: 'inset 0 0 50px 8px rgba(255,255,255,.45), 0 30px 60px -44px rgba(255,107,74,.6)', animation: `wRise .5s ${i * 0.07}s both` }}
            >
              <div className="flex items-start justify-between gap-2.5">
                <span aria-hidden className="relative grid size-[58px] place-items-center rounded-full border-[1.5px] border-dashed border-ink/40 bg-white/35 font-mono text-[11px] tracking-[.06em]">
                  <span className="absolute -inset-[9px] -z-10 rounded-full motion-safe:animate-breathe" style={{ background: 'radial-gradient(circle, rgba(255,243,168,.9), transparent 70%)' }} />
                  {sun ? 'SPF' : '+'}
                </span>
                <span className="font-mono text-[10.5px] tracking-[.08em]">■ {sun ? 'MORNING · MISSING' : 'MISSING STEP'}</span>
              </div>
              <span className="text-[19px] leading-[1.2] tracking-[-0.01em] text-balance">{sun ? 'Add a sunscreen to your mornings.' : f.title}</span>
              <span className="text-[12.5px] leading-[1.45] text-pretty text-[#3E3C38]">{f.fix}</span>
              <button type="button" onClick={() => onFind(f)} className="mt-auto min-h-11 self-start rounded-pill bg-selected px-4 text-[13px] text-inverse transition-transform hover:-translate-y-px">
                Find one
              </button>
            </article>
          )
        })}
        {changes.map(({ e, o, latest, m }, i) => (
          <article
            key={e.id}
            className={`${card} text-willow-900`}
            style={{ background: 'radial-gradient(90% 90% at 0% 0%, #B8E986 0%, transparent 60%), radial-gradient(80% 90% at 100% 100%, #4FB866 0%, transparent 62%), #CDEFB5', boxShadow: 'inset 0 0 50px 8px rgba(255,255,255,.45), 0 30px 60px -44px rgba(15,59,58,.55)', animation: `wRise .5s ${(gaps.length + i) * 0.07}s both` }}
          >
            <div className="flex items-start justify-between gap-2.5">
              <span className="flex items-center gap-2.5">
                <CategoryOrb category={e.category} size={46} />
                <span className="flex flex-col">
                  <span className="font-dot text-[26px] leading-[.9]">{fmtSigned(m.delta, m)}</span>
                  <span className="text-[11px]">
                    ◆ {METRIC_META[o.metric].label.toLowerCase()}
                    {unitOf(m) ? ` · ${unitOf(m)}` : ''}
                  </span>
                </span>
              </span>
              <span className="font-mono text-[10.5px] tracking-[.08em]">■ CHANGED</span>
            </div>
            <span className="text-[19px] leading-[1.2] tracking-[-0.01em] text-balance">
              {METRIC_META[o.metric].label} changed after you started {entryName(e)}.
            </span>
            <span className="text-[12.5px] leading-[1.45] text-pretty">
              It moved beyond your normal range since you started it on {fmtDate(e.started_at)}. Timing is an association, not proof.
            </span>
            <button type="button" onClick={() => navigate(`/result/${latest.id}`)} className="mt-auto min-h-11 self-start rounded-pill bg-white/60 px-4 text-[13px] transition-colors hover:bg-white/85">
              See the reading
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

/**
 * Product test band (design: "■ PRODUCT TEST · FOREARM"), only when forearm check-ins exist. The api
 * links no routine product to the test and sets no test length, so it shows the day since the forearm
 * baseline and one dot per check-in.
 */
export function ProductTestCard({ treated }: { treated: Session[] }) {
  const navigate = useNavigate()
  const [now] = useState(() => new Date().toISOString())
  if (treated.length === 0) return null
  const base = treated.filter((s) => s.is_baseline).at(-1) ?? treated[0]
  const day = Math.max(0, daysBetween(base.created_at, now))
  const after = treated.filter((s) => !s.is_baseline && s.created_at > base.created_at)
  const dots = treated.slice(-28)
  return (
    <section
      aria-label="Product test"
      className="flex flex-wrap items-center gap-x-8 gap-y-[18px] rounded-xl p-[clamp(22px,3vw,32px)] text-willow-900 squircle"
      style={{ background: 'radial-gradient(120% 140% at 0% 0%, #B8E986 0%, transparent 55%), radial-gradient(120% 140% at 100% 100%, #4FB866 0%, transparent 60%), #DDF3C9', boxShadow: 'inset 0 0 60px 10px rgba(255,255,255,.45), 0 30px 60px -44px rgba(15,59,58,.5)' }}
    >
      <div className="flex flex-[1_1_320px] flex-col gap-2">
        <span className="font-mono text-[12px] tracking-[.08em]">■ PRODUCT TEST · FOREARM</span>
        <span className="text-[clamp(22px,2.4vw,28px)] tracking-[-0.01em] text-pretty">Treated square vs untouched square</span>
        <span className="max-w-[460px] text-[14px] leading-[1.45] text-pretty">
          One square treated, one left untouched. {after.length ? `${plural(after.length, 'check-in', 'check-ins')} since the baseline; the test shows each verdict.` : 'Take a check-in after the baseline to compare the two squares.'}
        </span>
      </div>
      <div className="flex flex-[0_1_260px] flex-col gap-2.5">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[15px]">Day</span>
          <span className="font-dot text-[44px] leading-[.9]">{day}</span>
          <span className="text-[15px]">since the baseline</span>
        </span>
        <span aria-label={`${plural(treated.length, 'forearm check-in', 'forearm check-ins')}`} role="img" className="grid gap-[5px]" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
          {dots.map((s, i) => (
            <span key={s.id} className="aspect-square rounded-full bg-willow-900" style={{ boxShadow: i === dots.length - 1 ? '0 0 0 3px rgba(255,255,255,.8)' : 'none' }} />
          ))}
        </span>
      </div>
      <button type="button" onClick={() => navigate('/test')} className="flex min-h-[52px] items-center gap-3 rounded-pill bg-willow-900 pr-1.5 pl-[22px] text-[15px] text-inverse transition-transform hover:-translate-y-0.5">
        Open test
        <span aria-hidden className="grid size-10 place-items-center rounded-full bg-white text-willow-900">
          →
        </span>
      </button>
    </section>
  )
}
