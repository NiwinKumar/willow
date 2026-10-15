import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { ProductTest, RoutineEntry, Session } from '../../data/types'
import { fmtDate } from '../../lib/format'
import { METRIC_META, fmtSigned, unitOf } from '../../lib/metrics'
import { outcomeFor } from '../../lib/outcome'
import { readForearm } from '../home/forearm'
import { shortName } from '../home/derive'
import { PlanDotMark } from '../home/Tiles'
import { ProductImage } from './productUi'
import { VERDICT_AFTER_DAYS, testDay } from './productTests'
import { entryName, imageOf, type Finding } from './routineModel'
import { alternatesWith, restsOn } from './schedule'
import { StartTest } from './StartTest'

/**
 * "Suggested today" (design: three aura cards), built only from what the api answered: tonight's alternating
 * pair ("■ TONIGHT", from the schedules) or a conflict the check says to alternate ("Alternate nights" sets
 * both schedules), a gap from the routine check ("■ MORNING · MISSING") and a product whose start was
 * followed by a real change ("◆"). Nothing to suggest: the section is not shown.
 */
export function Suggestions({ findings, entries, sessions, usedLastNight, onFind, onAlternate }: {
  findings: Finding[]
  entries: RoutineEntry[]
  sessions: Session[]
  /** Ticked as used yesterday evening (decides which of a new pair goes tonight). */
  usedLastNight: (id: string) => boolean
  onFind: (f: Finding) => void
  onAlternate: (tonight: RoutineEntry, rests: RoutineEntry) => Promise<void>
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const tonight = tonightOf(findings, entries, usedLastNight)
  const gaps = findings.filter((f) => f.kind === 'Gap').slice(0, tonight ? 1 : 2)
  const changes = entries
    .map((e) => ({ e, o: outcomeFor(e, sessions) }))
    .flatMap(({ e, o }) => {
      if (o.kind !== 'real') return []
      // The session the outcome judged (not simply the newest photo, which may be within range again).
      const latest = o.session
      const m = latest.result?.metrics.find((x) => x.id === o.metric)
      return m && m.delta !== null ? [{ e, o, latest, m }] : []
    })
    .slice(0, 3 - gaps.length - (tonight ? 1 : 0))
  if (gaps.length + changes.length === 0 && !tonight) return null

  const card = 'relative isolate flex min-h-[230px] flex-[1_1_260px] flex-col gap-3 overflow-hidden rounded-[32px] p-5 squircle'
  const alternate = async (on: RoutineEntry, off: RoutineEntry) => {
    setBusy(true)
    try {
      await onAlternate(on, off)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-labelledby="suggested-h" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5 px-1.5 pt-1">
        <h2 id="suggested-h" className="text-[20px] font-normal tracking-[-0.01em]">
          Suggested today
        </h2>
        <span className="font-mono text-[10.5px] tracking-[.08em] text-ink-2">■ UPDATES WITH EACH CHECK-IN AND ROUTINE CHANGE</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {tonight ? (
          <article
            className={`${card} text-inverse`}
            style={{ background: 'radial-gradient(90% 80% at 80% 0%, #6B5BFF 0%, transparent 60%), radial-gradient(70% 70% at 0% 100%, #F25FA8 0%, transparent 65%), #1A1745', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08), inset 0 -30px 60px rgba(122,92,255,.25), 0 30px 60px -40px rgba(29,35,122,.8)', animation: 'wRise .5s both' }}
          >
            <div className="flex items-start justify-between gap-2.5">
              <span aria-hidden className="relative h-[58px] w-[84px]">
                <span className="absolute top-0 left-0 motion-safe:animate-breathe">
                  <ProductImage product={imageOf(tonight.on)} size={56} />
                </span>
                <span className="absolute top-[18px] left-[44px] rounded-full shadow-[0_0_0_2px_#1A1745]">
                  <ProductImage product={imageOf(tonight.off)} size={38} muted rest />
                </span>
                <span className="absolute top-3 left-[66px] grid size-[18px] place-items-center rounded-full bg-[#1A1745] text-[10px]">☾</span>
              </span>
              <span className="font-mono text-[10.5px] tracking-[.08em] text-[#C9CFFF]">■ TONIGHT</span>
            </div>
            <span className="text-[19px] leading-[1.2] tracking-[-0.01em] text-balance">
              {tonight.done ? `${shortName(tonight.on)} tonight. ${shortName(tonight.off)} rests.` : `${shortName(tonight.on)} and ${shortName(tonight.off)} on the same night.`}
            </span>
            <span className="text-[12.5px] leading-[1.45] text-pretty text-[#D5D8FF]">
              {tonight.done
                ? `${usedLastNight(tonight.off.id) ? `You used ${shortName(tonight.off).toLowerCase()} last night. ` : ''}Alternating the two lowers the chance of irritation.`
                : `${tonight.finding?.title ?? ''} Alternating nights lowers the chance of irritation: ${shortName(tonight.on).toLowerCase()} tonight, ${shortName(tonight.off).toLowerCase()} tomorrow.`}
            </span>
            {tonight.done ? (
              <span className="mt-auto inline-flex min-h-9 items-center self-start rounded-pill bg-white/15 px-3.5 text-[13px]">✓ Alternating nights</span>
            ) : (
              <button type="button" disabled={busy} aria-busy={busy} onClick={() => void alternate(tonight.on, tonight.off)} className="mt-auto min-h-11 self-start rounded-pill bg-white/92 px-4 text-[13px] text-ink transition-transform hover:-translate-y-px disabled:opacity-60">
                {busy ? 'Saving…' : 'Alternate nights'}
              </button>
            )}
          </article>
        ) : null}
        {gaps.map((f, i) => {
          const sun = f.find?.category === 'sunscreen'
          return (
            <article
              key={f.key}
              className={`${card} text-ink`}
              style={{ background: 'radial-gradient(90% 90% at 100% 0%, #FFF3A8 0%, transparent 60%), radial-gradient(80% 80% at 0% 100%, #FFB27A 0%, transparent 65%), #FFE2CF', boxShadow: 'inset 0 0 50px 8px rgba(255,255,255,.45), 0 30px 60px -44px rgba(255,107,74,.6)', animation: `wRise .5s ${(i + (tonight ? 1 : 0)) * 0.07}s both` }}
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
            style={{ background: 'radial-gradient(90% 90% at 0% 0%, #B8E986 0%, transparent 60%), radial-gradient(80% 90% at 100% 100%, #4FB866 0%, transparent 62%), #CDEFB5', boxShadow: 'inset 0 0 50px 8px rgba(255,255,255,.45), 0 30px 60px -44px rgba(15,59,58,.55)', animation: `wRise .5s ${(gaps.length + (tonight ? 1 : 0) + i) * 0.07}s both` }}
          >
            <div className="flex items-start justify-between gap-2.5">
              <span className="flex items-center gap-2.5">
                <ProductImage product={imageOf(e)} size={46} />
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
 * Tonight's pair: two evening products already alternating (done), else the first conflict the check says to
 * alternate. In a new pair the product not used last night goes tonight.
 */
function tonightOf(findings: Finding[], entries: RoutineEntry[], usedLastNight: (id: string) => boolean): { on: RoutineEntry; off: RoutineEntry; done: boolean; finding?: Finding } | null {
  const pm = entries.filter((e) => e.slots.includes('pm') && !e.ended_at)
  for (const a of pm)
    for (const b of pm)
      if (a.id < b.id && alternatesWith(a, b)) {
        const [on, off] = restsOn(a) ? [b, a] : [a, b]
        return { on, off, done: true }
      }
  const f = findings.find((x) => x.kind === 'Conflict' && x.alternate && x.entries.length === 2 && x.entries.every((e) => e.slots.includes('pm')))
  if (!f) return null
  const [a, b] = f.entries
  const [on, off] = usedLastNight(b.id) && !usedLastNight(a.id) ? [a, b] : [b, a]
  return { on, off, done: false, finding: f }
}

const BAND = { background: 'radial-gradient(120% 140% at 0% 0%, #B8E986 0%, transparent 55%), radial-gradient(120% 140% at 100% 100%, #4FB866 0%, transparent 60%), #DDF3C9', boxShadow: 'inset 0 0 60px 10px rgba(255,255,255,.45), 0 30px 60px -44px rgba(15,59,58,.5)' }

/**
 * Product test band (design: "■ PRODUCT TEST · FOREARM"). With a running test: the product, "day N of M",
 * the plan's dots and where it stands (a verdict only after day 14). Forearm photos without a test: day N
 * since the baseline. Neither: a way in, including the design's "Self-tanner test".
 */
export function ProductTestCard({ treated, controls, test }: { treated: Session[]; controls: Session[]; test: ProductTest | null }) {
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)
  const read = readForearm(treated, controls, test)
  if (!read)
    return (
      <section aria-label="Product test" className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl p-[clamp(22px,3vw,32px)] text-willow-900 squircle" style={BAND}>
        <div className="flex flex-[1_1_320px] flex-col gap-2">
          <span className="font-mono text-[12px] tracking-[.08em]">■ PRODUCT TEST · FOREARM</span>
          <span className="text-[clamp(22px,2.4vw,28px)] tracking-[-0.01em] text-pretty">Try a product on your forearm first</span>
          {starting ? (
            <div className="max-w-[520px] rounded-[24px] bg-white/70 p-4">
              <StartTest preset={{ name: 'Self-tanner' }} onCancel={() => setStarting(false)} />
            </div>
          ) : (
            <span className="max-w-[520px] text-[14px] leading-[1.45] text-pretty">One square treated, one left untouched on the other arm, photographed together. Open a product above and choose “Start a forearm test”, or test a self-tanner.</span>
          )}
        </div>
        {starting ? null : (
          <button type="button" onClick={() => setStarting(true)} className="flex min-h-[52px] items-center gap-3 rounded-pill bg-willow-900 pr-1.5 pl-[22px] text-[15px] text-inverse transition-transform hover:-translate-y-0.5">
            Self-tanner test
            <span aria-hidden className="grid size-10 place-items-center rounded-full bg-white text-willow-900">
              →
            </span>
          </button>
        )}
      </section>
    )
  const d = test ? testDay(test) : null
  return (
    <section aria-label="Product test" className="flex flex-wrap items-center gap-x-8 gap-y-[18px] rounded-xl p-[clamp(22px,3vw,32px)] text-willow-900 squircle" style={BAND}>
      <div className="flex flex-[1_1_320px] flex-col gap-2">
        <span className="font-mono text-[12px] tracking-[.08em]">■ PRODUCT TEST · FOREARM</span>
        <span className="text-[clamp(22px,2.4vw,28px)] tracking-[-0.01em] text-pretty">{test ? test.name : 'Treated arm vs control arm'}</span>
        <span className="max-w-[460px] text-[14px] leading-[1.45] text-pretty">
          One square treated, one left untouched.{' '}
          {d && !d.ready ? `Too early for a verdict; Willow gives one after day ${VERDICT_AFTER_DAYS}.` : `${read.standing.t}.`}
        </span>
      </div>
      <div className="flex flex-[0_1_260px] flex-col gap-2.5">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[15px]">Day</span>
          <span className="font-dot text-[44px] leading-[.9]">{read.day}</span>
          <span className="text-[15px]">{read.of ? `of ${read.of} days` : 'since the baseline'}</span>
        </span>
        <span aria-hidden className="grid gap-[5px]" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
          {read.dots.map((dot, i) => (
            <PlanDotMark key={i} dot={dot} />
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
