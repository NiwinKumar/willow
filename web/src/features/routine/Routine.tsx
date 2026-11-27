import { History, ListChecks } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Disclaimer } from '../../components/willow/Disclaimer'
import { useRoutine, useRoutineCheck, useRoutineLog } from '../../data/hooks'
import type { Product, RoutineEntry } from '../../data/types'
import { useData } from '../../data/useData'
import { localDay } from '../../lib/api'
import { fmtDate, plural } from '../../lib/format'
import { AddProductSheet, type AddPreset } from './AddProductSheet'
import { readForearm } from '../home/forearm'
import { CategoryOrb } from './productUi'
import { ProductSheet, type ProductTarget } from './ProductSheet'
import { useProductTests } from './productTests'
import { entryName, findingsOf, useOutcomeSessions, type Finding } from './routineModel'
import { addDays } from './schedule'
import { RoutineCheckCard } from './RoutineCheckCard'
import { SlotCard } from './SlotCard'
import { SponsoredCard } from './SponsoredCard'
import { ProductTests, TestStrip } from './TestsTab'
import { RoutineHistory } from './RoutineHistory'
import { Suggestions } from './Suggestions'
import { suggestionsOf } from './suggestedToday'
import { FeelNudge } from './FeelCard'
import { RequestNotice } from './RequestNotice'
import { failureText, useRoutineWrites } from './writes'
import { useChecks, useEvidenceClock, useSafety } from '../../lib/safety'
import type { ClickSurface } from '../../lib/clicks'
import { isSample } from './actives'
import { CheckForMe } from './checked'
import { EntryActions } from './EntryActions'
import { ReactionSheet, type ReactionTarget } from './ReactionSheet'
import { ShelfVerdict } from './ShelfVerdict'
import { SwapSheet, type SwapTarget } from './SwapSheet'
import { TestSheet, type TestTarget } from './TestSheet'

type Tab = 'routine' | 'verdict' | 'tests'
const TITLES: Record<Tab, string> = { routine: 'Your routine', verdict: 'Is it working?', tests: 'Test a product' }

const ORDER = ['cleanser', 'toner', 'serum', 'treatment', 'exfoliant', 'moisturizer', 'eye_care', 'mask', 'sunscreen']
// Unknown categories (label scans) sort just before sunscreen, never above the cleanser.
const rank = (c: string) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length - 1.5)
const byStep = (a: RoutineEntry, b: RoutineEntry) => rank(a.category) - rank(b.category)

/** The routine page (design: Willow App Routine, view="routine"), on the person's own routine. */
export default function Routine() {
  const data = useData()
  const navigate = useNavigate()
  const location = useLocation()
  const routine = useRoutine()
  const entries = useMemo(() => routine.data ?? [], [routine.data])
  const current = useMemo(() => entries.filter((e) => !e.ended_at), [entries])
  const stopped = useMemo(() => entries.filter((e) => e.ended_at), [entries])
  const check = useRoutineCheck(routine.data)
  const findings = useMemo(() => (check.data ? findingsOf(check.data, entries) : []), [check.data, entries])
  const today = localDay()
  const log = useRoutineLog()
  const ticks = log.data?.find((d) => d.date === today)?.used ?? {}
  const yesterday = addDays(today, -1)
  const lastNight = useRoutineLog(yesterday, yesterday)
  const usedLastNight = (id: string) => Boolean(lastNight.data?.find((d) => d.date === yesterday)?.used[id]?.includes('pm'))
  const tests = useProductTests()
  const sessions = useOutcomeSessions()
  const faceMeasured = sessions.some((s) => s.site === 'face_full' && s.status === 'done' && s.measured !== false && s.result?.quality.passed)
  const writes = useRoutineWrites()

  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = tabParam === 'tests' || tabParam === 'verdict' ? tabParam : 'routine'
  const setTab = (t: Tab) => setParams(t === 'routine' ? {} : { tab: t }, { replace: true })
  const [history, setHistory] = useState(false)
  const [add, setAdd] = useState<AddPreset | null>(null)
  const [info, setInfo] = useState<ProductTarget | null>(null)
  const [infoSurface, setInfoSurface] = useState<ClickSurface>('product_sheet')
  const [more, setMore] = useState<RoutineEntry | null>(null)
  const [testing, setTesting] = useState<TestTarget | null>(null)
  const [reaction, setReaction] = useState<ReactionTarget | null>(null)
  const [swap, setSwap] = useState<SwapTarget | null>(null)
  const clock = useEvidenceClock()
  const safety = useSafety()
  // A product the advisor offered ("Add to routine" in its product sheet) arrives as router state.
  const incoming = (location.state as { addProduct?: Product } | null)?.addProduct
  const sheetPreset: AddPreset | null = incoming ? { product: incoming } : add
  const closeAdd = () => {
    setAdd(null)
    if (incoming) navigate(location.pathname, { replace: true, state: null })
  }

  const productIds = useMemo(() => current.map((e) => e.product_id).filter((x): x is string => Boolean(x)), [current])
  const checks = useChecks(productIds)
  const sample = current.some(isSample)
  const onPick = (id: 'details' | 'test' | 'reaction' | 'swap', e: RoutineEntry) => {
    if (id === 'details') setInfo({ entry: e })
    else if (id === 'test') setTesting({ entry_id: e.id, product_id: e.product_id ?? undefined, name: entryName(e) })
    else if (id === 'reaction') setReaction({ product_id: e.product_id, entry_id: e.id, name: entryName(e) })
    else if (e.product_id) setSwap({ product_id: e.product_id, name: entryName(e) })
  }
  const am = current.filter((e) => e.slots.includes('am')).sort(byStep)
  const pm = current.filter((e) => e.slots.includes('pm')).sort(byStep)
  const loading = routine.status === 'loading' || routine.status === 'idle'
  const failed = routine.status === 'error'
  const inRoutine = useMemo(() => new Set(current.map((e) => e.product_id).filter((x): x is string => Boolean(x))), [current])
  // every catalog product ever in the routine (stopped too): the sponsored card never offers one of them
  const everAdded = useMemo(() => new Set(entries.map((e) => e.product_id).filter((x): x is string => Boolean(x))), [entries])
  const both = am.length > 0 && pm.length > 0
  // "last changed": the newest add, stop, slot or schedule change (updated_at; created_at for older entries).
  const changed = entries.map((e) => e.updated_at ?? e.created_at ?? e.started_at).sort().at(-1)
  const meta = loading ? 'Loading…' : failed ? 'Not loaded' : current.length === 0 ? 'No products yet' : `${plural(current.length, 'product', 'products')} · ${both ? 'morning and evening' : am.length ? 'morning only' : 'evening only'}${changed ? ` · last changed ${fmtDate(changed)}` : ''}`
  const find = (f: Finding) => setAdd({ mode: 'search', ...f.find, slot: f.find?.category === 'sunscreen' ? 'am' : undefined })
  const treated = data.series('forearm_treated')?.sessions ?? []
  const controls = data.series('forearm_control')?.sessions ?? []
  const alternate = async (on: RoutineEntry, off: RoutineEntry) => {
    try {
      await writes.alternate(on, off)
    } catch (e) {
      toast(failureText(e, `Couldn't set ${entryName(on)} and ${entryName(off)} to alternate. Nothing changed; try again.`))
    }
  }
  // From the check card: the product not used last night goes tonight.
  const alternateFinding = async (f: Finding) => {
    const [a, b] = f.entries
    await (usedLastNight(b.id) && !usedLastNight(a.id) ? alternate(a, b) : alternate(b, a))
  }

  const testRead = readForearm(treated, controls, tests.running)
  const suggested = suggestionsOf(findings, current, sessions, usedLastNight)
  const showTests = tab === 'tests' && !loading && !failed
  const showVerdict = tab === 'verdict' && !loading && !failed
  const attention = !loading && !failed
  const testCount = tests.data?.length ?? 0

  return (
    <main className="relative mx-auto flex max-w-[1320px] flex-col gap-3 px-[clamp(16px,4vw,40px)] pt-2">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-3 pt-[clamp(4px,1vw,12px)] sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="font-serif text-[clamp(30px,3vw,40px)] leading-[.95] font-normal">{tab === 'tests' ? 'Test a product' : tab === 'verdict' ? 'Is it working?' : 'Your routine'}</h1>
          <span className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
            {tab === 'tests' ? 'One product at a time, on a small square of one forearm.' : tab === 'verdict' ? 'Each product against your own readings and its usual trial length.' : meta}
            {sample && tab === 'routine' ? <span className="rounded-pill bg-[var(--synthetic-bg)] px-2.5 py-0.5 font-mono text-[11px] tracking-[.04em] text-[var(--synthetic-fg)]">SAMPLE ROUTINE</span> : null}
          </span>
        </div>
        <button type="button" onClick={() => setAdd({ mode: 'search' })} className="order-2 flex min-h-9 items-center gap-2 rounded-pill bg-selected pr-1 pl-4 text-[14px] text-inverse transition-transform hover:-translate-y-0.5 sm:order-3">
          Add product
          <span aria-hidden className="grid size-7 place-items-center rounded-full bg-white text-[18px] leading-none text-ink">
            +
          </span>
        </button>
        <div className="order-3 flex basis-full flex-wrap items-center gap-2 xl:order-2 xl:basis-auto">
          <SegmentedControl
            frosted
            label="Routine or product tests"
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'routine', label: 'Routine' },
              { value: 'verdict', label: 'Is it working?' },
              { value: 'tests', label: tests.running ? 'Tests · running' : testCount ? `Tests · ${testCount}` : 'Tests' },
            ]}
          />
          <button type="button" onClick={() => navigate('/plan')} className="hit44 glass-pill flex min-h-9 items-center gap-1.5 rounded-pill px-3.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,.75)] transition-colors hover:bg-white/80">
            <ListChecks size={15} strokeWidth={1.7} aria-hidden />
            Build me a routine
          </button>
          <button type="button" onClick={() => setHistory(true)} className="hit44 glass-pill flex min-h-9 items-center gap-1.5 rounded-pill px-3.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,.75)] transition-colors hover:bg-white/80">
            <History size={15} strokeWidth={1.7} aria-hidden />
            History{stopped.length ? <span className="font-mono text-[11px] text-ink-2">{stopped.length}</span> : null}
          </button>
        </div>
      </div>

      {/* Asks that need an answer come first, above the check. */}
      {attention && sample && tab === 'routine' ? (
        <section aria-label="Sample routine" className="card flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5" style={{ animation: 'wRise .5s both' }}>
          <span className="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
            <span className="text-[16px]">This is a sample routine</span>
            <span className="text-[13px] leading-[1.45] text-ink-2">It was set up to show how the routine check works, not picked for your skin. Replace it with what you use, or let Willow build one around your skin, budget and answers.</span>
          </span>
          <span className="flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate('/plan')} className="min-h-10 rounded-pill bg-selected px-4 text-[14px] text-inverse transition-[scale] duration-200 ease-standard active:scale-[.97]">
              Build me a routine
            </button>
            <button type="button" onClick={() => setAdd({ mode: 'search' })} className="min-h-10 rounded-pill bg-white px-4 text-[14px] shadow-[inset_0_0_0_1px_var(--line-strong)] transition-[background-color,scale] duration-200 ease-standard hover:bg-sunken active:scale-[.97]">
              Replace with my own
            </button>
          </span>
        </section>
      ) : null}

      {attention && !showTests && !showVerdict ? (
        <>
          <RequestNotice onAdd={(p) => setAdd({ product: p })} />
          <FeelNudge entries={entries} onOpen={(e) => setInfo({ entry: e, focus: 'feel' })} />
        </>
      ) : null}

      {attention && !showTests && !showVerdict && current.length ? (
        <div className="@container">
          <div className="grid items-stretch gap-3 @min-[1020px]:grid-cols-[minmax(0,1fr)_360px]">
            <RoutineCheckCard check={check} findings={findings} count={current.length} onFind={find} onAlternate={alternateFinding} />
            <div className="flex min-w-0 flex-col gap-3 empty:hidden [&>section]:flex-1">
              {suggested.any ? <Suggestions findings={findings} entries={current} sessions={sessions} usedLastNight={usedLastNight} onFind={find} onAlternate={alternate} /> : <TestStrip read={testRead} onStart={() => setTab('tests')} />}
            </div>
          </div>
        </div>
      ) : null}

      {showTests ? (
        <ProductTests current={current} tests={tests} treated={treated} controls={controls} />
      ) : showVerdict ? (
        current.length ? (
          <ShelfVerdict entries={current} sessions={sessions} check={check.data} clock={clock.data ?? null} checks={checks.checks} onOpen={(e) => setInfo({ entry: e })} onStop={(e) => void writes.stop(e)} onSwap={(e) => onPick('swap', e)} />
        ) : (
          <section className="card flex flex-col items-start gap-2 p-5" style={{ animation: 'wRise .5s both' }}>
            <span className="text-[17px]">No products to judge yet</span>
            <span className="text-[13.5px] leading-[1.5] text-ink-2">Add what you use, or build a routine. Each product gets a verdict here once its usual trial length has passed.</span>
            <button type="button" onClick={() => navigate('/plan')} className="mt-1 min-h-10 rounded-pill bg-selected px-4 text-[14px] text-inverse transition-[scale] duration-200 ease-standard active:scale-[.97]">
              Build me a routine
            </button>
          </section>
        )
      ) : loading ? (
        <div className="@container"><div role="status" aria-label="Loading routine" className="grid gap-3 @min-[1020px]:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-3 @min-[600px]:grid-cols-2">
            {[
              { bg: 'var(--bg-surface)', a: 'var(--bg-canvas)', b: '#F7F6F3', card: 'rgba(255,255,255,.7)', rows: 4 },
              { bg: '#15122A', a: 'rgba(255,255,255,.06)', b: 'rgba(255,255,255,.16)', card: 'rgba(255,255,255,.05)', rows: 4 },
            ].map((sk, k) => {
              const shimmer = { background: `linear-gradient(90deg, ${sk.a} 0%, ${sk.b} 50%, ${sk.a} 100%)`, backgroundSize: '200% 100%' }
              return (
                <div key={k} className="flex flex-col gap-2 rounded-[28px] p-3" style={{ background: sk.bg }}>
                  <span className="mx-2 mt-1 mb-0.5 block h-[22px] w-[110px] rounded-[8px] motion-safe:animate-[wShimmer_1.4s_linear_infinite]" style={shimmer} />
                  {Array.from({ length: sk.rows }, (_, r) => (
                    <span key={r} className="flex items-center gap-2.5 rounded-[20px] p-1.5" style={{ background: sk.card }}>
                      <span className="block size-[46px] shrink-0 rounded-[16px] motion-safe:animate-[wShimmer_1.4s_linear_infinite]" style={shimmer} />
                      <span className="flex flex-1 flex-col gap-1.5">
                        {['70%', '45%'].map((w, i) => (
                          <span key={w} className="block rounded-[5px] motion-safe:animate-[wShimmer_1.4s_linear_infinite]" style={{ ...shimmer, width: w, height: i ? 10 : 13 }} />
                        ))}
                      </span>
                    </span>
                  ))}
                </div>
              )
            })}
          </div>
          <span className="hidden h-[220px] rounded-[28px] bg-surface @min-[1020px]:block" />
        </div></div>
      ) : failed ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-[32px] bg-surface p-[clamp(24px,4vw,40px)]">
          <span className="font-dot text-[44px] leading-none font-extrabold text-coral">—</span>
          <span className="text-[20px]">Your routine didn’t load</span>
          <span className="leading-[1.5] text-ink-2">{navigator.onLine ? 'Nothing has been lost. Check your connection and try again.' : 'You’re offline. Nothing has been lost; try again when you’re connected.'}</span>
          <button type="button" onClick={() => void routine.refetch()} className="min-h-11 rounded-pill bg-selected px-[22px] text-[15px] text-inverse">
            Try again
          </button>
        </div>
      ) : current.length === 0 ? (
        <div className="flex flex-col gap-3">
          <div className="relative grid items-center gap-6 overflow-hidden rounded-[32px] bg-surface p-[clamp(24px,4vw,40px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))' }}>
            <div className="flex flex-col gap-3">
              <span className="font-dot text-[48px] leading-none font-extrabold">00</span>
              <span className="text-[clamp(22px,2.4vw,28px)] leading-[1.15] tracking-[-0.02em]">No products yet</span>
              <span className="max-w-[440px] leading-[1.55] text-[#3E3C38]">Add what you use and when you started. Willow lines start dates up with your readings and checks the ingredients against each other. Starting from nothing? Willow can build a three-step routine around your skin, budget and answers, every product checked for you.</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => navigate('/plan')} className="min-h-11 rounded-pill bg-cta px-5 text-[15px] text-ink">
                  Build me a routine
                </button>
                <button type="button" onClick={() => setAdd({ mode: 'search' })} className="min-h-11 rounded-pill bg-selected px-5 text-[15px] text-inverse">
                  Search catalog
                </button>
                <button type="button" onClick={() => setAdd({ mode: 'request' })} className="min-h-11 rounded-pill border border-ink/15 bg-white px-5 text-[15px]">
                  Request a product
                </button>
              </div>
            </div>
            <div aria-hidden className="flex justify-center gap-3">
              {['serum', 'exfoliant', 'toner'].map((c, i) => (
                <span key={c} className="opacity-35">
                  <span className="block motion-safe:animate-[wBreathe_5s_ease-in-out_infinite]" style={{ animationDelay: `${-i * 1.6}s` }}>
                    <CategoryOrb category={c} size={72} />
                  </span>
                </span>
              ))}
            </div>
          </div>
          <RoutineCheckCard check={check} findings={findings} count={0} onFind={find} onAlternate={alternateFinding} />
        </div>
      ) : (
        <div className="@container flex flex-col gap-3">
          <div className="grid items-stretch gap-3 @min-[620px]:grid-cols-2 @min-[1020px]:has-[.side>*]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_300px]">
            {(['am', 'pm'] as const).map((slot) => (
              <SlotCard
                key={slot}
                slot={slot}
                entries={slot === 'am' ? am : pm}
                ticked={(id) => (ticks[id] ?? []).includes(slot)}
                sessions={sessions}
                clock={clock.data ?? null}
                checks={checks.checks}
                onOpen={(e) => setInfo({ entry: e })}
                onStop={(e) => void writes.stop(e)}
                onMore={setMore}
                onAdd={() => setAdd({ mode: 'search', slot })}
              />
            ))}
            <div className="side flex min-w-0 flex-col gap-3 empty:hidden @min-[620px]:col-span-2 @min-[1020px]:col-span-1">
              {suggested.any ? <TestStrip read={testRead} onStart={() => setTab('tests')} /> : null}
              <SponsoredCard
                inRoutine={everAdded}
                onView={(productId) => {
                  setInfoSurface('sponsored')
                  setInfo({ productId })
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="mx-1 mt-1 flex flex-col gap-2">
        {!loading && !failed && !showTests && !showVerdict && current.length ? <CheckForMe /> : null}
        {!loading && !failed && !showTests && current.length ? (
          <p className="max-w-[820px] text-[12.5px] leading-[1.5] text-ink-2">
            {faceMeasured ? '◆ marks a change in your readings after you started a product. ' : 'Take a face check-in to see, over the weeks, whether each product lines up with a change in your readings. '}
            Timing is an association: light, season and other products change too, so it isn’t proof a product caused a change.
          </p>
        ) : null}
        <Disclaimer />
      </div>
      <div className="h-[clamp(24px,5vw,72px)]" />

      <RoutineHistory
        open={history}
        onClose={() => setHistory(false)}
        current={current}
        stopped={stopped}
        onOpen={(e) => {
          setHistory(false)
          setInfo({ entry: e })
        }}
      />
      <AddProductSheet open={sheetPreset !== null} preset={sheetPreset} inRoutine={inRoutine} onClose={closeAdd} />
      <EntryActions entry={more} onClose={() => setMore(null)} onPick={onPick} />
      <TestSheet target={testing} onClose={() => setTesting(null)} />
      <ReactionSheet target={reaction} onClose={() => setReaction(null)} />
      <SwapSheet
        target={swap}
        market={safety.data?.market}
        onClose={() => setSwap(null)}
        onView={(p) => {
          setSwap(null)
          setInfo({ product: p })
        }}
      />
      <ProductSheet
        target={info}
        surface={infoSurface}
        onClose={() => {
          setInfo(null)
          setInfoSurface('product_sheet')
        }}
        onAdd={(p) => {
          setInfo(null)
          setInfoSurface('product_sheet')
          setAdd({ product: p })
        }}
      />
    </main>
  )
}
