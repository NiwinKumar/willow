import { FlaskConical, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { ProductTest, RoutineEntry, Session } from '../../data/types'
import { fmtDate, plural } from '../../lib/format'
import { readForearm, type ForearmRead } from '../home/forearm'
import { PlanDotMark } from '../home/Tiles'
import { VERDICT_AFTER_DAYS, type useProductTests } from './productTests'
import { ProductImage } from './productUi'
import { entryName, imageOf, metaLine } from './routineModel'
import { StartTest, type TestPreset } from './StartTest'

const BAND = { background: 'radial-gradient(120% 140% at 0% 0%, #B8E986 0%, transparent 55%), radial-gradient(120% 140% at 100% 100%, #4FB866 0%, transparent 60%), #DDF3C9', boxShadow: 'inset 0 0 50px 8px rgba(255,255,255,.45), 0 26px 54px -42px rgba(15,59,58,.5)' }

const OpenTest = ({ onClick, children = 'Open test' }: { onClick: () => void; children?: string }) => (
  <button type="button" onClick={onClick} className="flex min-h-11 items-center gap-2.5 self-start rounded-pill bg-willow-900 pr-1.5 pl-[18px] text-[14px] text-inverse transition-transform hover:-translate-y-0.5">
    {children}
    <span aria-hidden className="grid size-8 place-items-center rounded-full bg-white text-willow-900">
      →
    </span>
  </button>
)

/**
 * The product test as a plain strip under the routine: what is running ("day N of M", one dot per day, where it
 * stands) with a way in to the test; with none running, one line on what a forearm test is and a button to the
 * Product tests tab, where a test is started. Neutral on purpose: colour on this page marks what needs a look.
 */
export function TestStrip({ read, onStart }: { read: ForearmRead | null; onStart: () => void }) {
  const navigate = useNavigate()
  return (
    <section aria-label="Product test" className="card flex flex-1 flex-wrap content-between items-center gap-x-6 gap-y-4 p-5">
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full text-willow-900" style={{ background: 'radial-gradient(circle at 34% 28%, #fff 0%, #B8E986 40%, #4FB866 100%)' }}>
        <FlaskConical size={20} strokeWidth={1.6} />
      </span>
      {read ? (
        <>
          <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
            <span className="font-mono text-[10.5px] tracking-[.08em] text-ink-2">PRODUCT TEST · FOREARM</span>
            <span className="text-[17px] leading-[1.25] tracking-[-0.01em] text-pretty">{read.name ? `${read.name} on your forearm` : 'Treated arm vs control arm'}</span>
            <span className="text-[13.5px] leading-[1.4] text-ink-2">
              <span aria-hidden>{read.standing.g} </span>
              {read.standing.t}
            </span>
          </div>
          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-2">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[14px]">Day</span>
              <span className="font-dot text-[30px] leading-[.9]">{read.day}</span>
              <span className="text-[14px] text-ink-2">{read.of ? `of ${read.of}` : 'since the baseline'}</span>
            </span>
            <span aria-hidden className="grid max-w-[420px] gap-[4px]" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
              {read.dots.map((dot, i) => (
                <PlanDotMark key={i} dot={dot} ring="var(--bg-surface)" />
              ))}
            </span>
          </div>
          <OpenTest onClick={() => navigate('/test')} />
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
            <span className="font-mono text-[10.5px] tracking-[.08em] text-ink-2">PRODUCT TEST · FOREARM</span>
            <span className="text-[17px] leading-[1.25] tracking-[-0.01em] text-pretty">Try a product on your forearm first</span>
            <span className="text-[13.5px] leading-[1.4] text-ink-2">One square treated, one left untouched on the other arm, photographed together.</span>
          </div>
          <OpenTest onClick={onStart}>Start a test</OpenTest>
        </>
      )}
    </section>
  )
}

/**
 * The Product tests tab: where a forearm test is started and followed. Left, the test in progress (or how a test
 * works); right, what to test and for how long. Past tests sit below. The verdict itself lives on /test.
 */
export function ProductTests({ current, tests, treated, controls }: { current: RoutineEntry[]; tests: ReturnType<typeof useProductTests>; treated: Session[]; controls: Session[] }) {
  const navigate = useNavigate()
  const running = tests.running
  const read = readForearm(treated, controls, running)
  const past = (tests.data ?? []).filter((t) => t.ended_at)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <section aria-label={running ? 'Test in progress' : 'How a forearm test works'} className="flex flex-col gap-3.5 rounded-[28px] p-5 text-willow-900 squircle sm:p-6" style={BAND}>
          <span className="font-mono text-[11px] tracking-[.08em]">■ {running ? 'TEST IN PROGRESS' : read ? 'FOREARM CHECK-INS' : 'HOW IT WORKS'}</span>
          {read ? (
            <>
              <span className="text-[clamp(22px,2.4vw,28px)] leading-[1.15] tracking-[-0.01em] text-pretty">{read.name ?? 'Treated arm vs control arm'}</span>
              <span className="flex items-baseline gap-2">
                <span className="text-[15px]">Day</span>
                <span className="font-dot text-[56px] leading-[.9]">{read.day}</span>
                <span className="text-[15px]">{read.of ? `of ${read.of} days` : 'since the baseline'}</span>
              </span>
              <span aria-hidden className="grid max-w-[460px] gap-[5px]" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
                {read.dots.map((dot, i) => (
                  <PlanDotMark key={i} dot={dot} />
                ))}
              </span>
              <span className="max-w-[460px] text-[14px] leading-[1.45] text-pretty">
                <span aria-hidden>{read.standing.g} </span>
                {read.standing.t}.
              </span>
              <OpenTest onClick={() => navigate('/test')} />
            </>
          ) : (
            <>
              <span className="text-[clamp(22px,2.4vw,28px)] leading-[1.15] tracking-[-0.01em] text-pretty">Test a product on one forearm square</span>
              <ol className="flex max-w-[460px] flex-1 flex-col justify-between gap-3 text-[14px] leading-[1.45]">
                {['Choose what to test, and for how long.', 'Use it on a small square on one forearm. Leave the same square on the other forearm untouched.', `Photograph both arms together before the first use, then every few days. Willow gives a verdict after day ${VERDICT_AFTER_DAYS}.`].map((s, i) => (
                  <li key={s} className="flex gap-3">
                    <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-willow-900 font-mono text-[11px] text-inverse">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <StartPanel current={current} running={running} ready={tests.status === 'ready'} />
      </div>

      {past.length ? (
        <section aria-labelledby="past-tests-h" className="card flex flex-col gap-1 px-5 py-4">
          <h2 id="past-tests-h" className="pb-1 text-[15px] font-normal">
            Past tests
          </h2>
          <ul className="flex flex-col">
            {past.map((t) => (
              <PastRow key={t.id} t={t} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function PastRow({ t }: { t: ProductTest }) {
  return (
    <li className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken">
        <FlaskConical size={16} strokeWidth={1.6} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14.5px]">{t.name}</span>
        <span className="text-[12px] text-ink-2">
          {fmtDate(t.started_at)} to {fmtDate(t.ended_at!)} · {plural(t.length_days, 'day', 'days')} planned
        </span>
      </span>
    </li>
  )
}

const OTHER = 'other'

/** "What do you want to test?": a product from the routine (its name is kept) or something else (a self-tanner). */
function StartPanel({ current, running, ready }: { current: RoutineEntry[]; running: ProductTest | null; ready: boolean }) {
  const [pick, setPick] = useState<string | null>(null)
  const entry = current.find((e) => e.id === pick) ?? null
  const preset: TestPreset | null = entry ? { entry_id: entry.id, name: entryName(entry), fixedName: true } : pick === OTHER ? { name: '' } : null

  return (
    <section aria-labelledby="start-test-h" className="card @container flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-0.5">
        <h2 id="start-test-h" className="text-[18px] font-normal tracking-[-0.01em]">
          Start a test
        </h2>
        <span className="text-[13px] text-ink-2">{running ? `A test of ${running.name} is running. End it on the test page before starting another.` : 'What do you want to try on your forearm?'}</span>
      </div>
      {running ? null : (
        <>
          <div role="radiogroup" aria-label="What to test" className="flex flex-col gap-1">
            <div className="grid max-h-[264px] content-start gap-1 overflow-y-auto pr-0.5 @min-[460px]:grid-cols-2">
              {current.map((e) => {
                const on = pick === e.id
                return (
                  <button key={e.id} type="button" role="radio" aria-checked={on} disabled={!ready} onClick={() => setPick(e.id)} className={`flex min-h-11 items-center gap-2.5 rounded-[14px] px-2 py-1 text-left transition-colors disabled:opacity-60 ${on ? 'bg-selected text-inverse' : 'bg-sunken hover:bg-ink/5'}`}>
                    <ProductImage product={imageOf(e)} size={30} decorative />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13.5px] leading-tight">{entryName(e)}</span>
                      <span className={`truncate text-[11.5px] leading-tight ${on ? 'opacity-75' : 'text-ink-2'}`}>{metaLine(e.brand, e.category)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <button type="button" role="radio" aria-checked={pick === OTHER} disabled={!ready} onClick={() => setPick(OTHER)} className={`flex min-h-11 items-center gap-2.5 rounded-[14px] border border-dashed px-2 py-1 text-left transition-colors disabled:opacity-60 ${pick === OTHER ? 'border-transparent bg-selected text-inverse' : 'border-line-strong hover:bg-ink/5'}`}>
              <span aria-hidden className="grid size-[30px] shrink-0 place-items-center rounded-full bg-white/80 text-ink">
                <Plus size={16} strokeWidth={1.8} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px] leading-tight">Something else</span>
                <span className={`truncate text-[11.5px] leading-tight ${pick === OTHER ? 'opacity-75' : 'text-ink-2'}`}>A self-tanner or a product not in your routine</span>
              </span>
            </button>
          </div>
          {preset ? (
            <div className="rounded-[20px] bg-sunken p-4" style={{ animation: 'wRise .3s both' }}>
              <StartTest key={pick} hideIntro preset={preset} onCancel={() => setPick(null)} onStarted={() => setPick(null)} />
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
