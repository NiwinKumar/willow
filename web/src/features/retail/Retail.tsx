import './retail.css'

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { LogoMark } from '../../components/willow/Logo'
import { Disclaimer } from '../../components/willow/Disclaimer'
import { api } from '../../lib/api'
import { AskAggregates } from './AskAggregates'
import { cohortKind, DATA_STUDIO, MIN_GROUP, outcomes, totalUsers, type CohortKind, type Insights } from './data'
import { BrandsCard, ConflictsCard, GapsCard, NeedsCard, OutcomesCard } from './Sections'

/**
 * Retailer insights (Willow Retail.dc.html): a standalone dark dashboard over the public, suppressed
 * aggregates (GET /v1/retailer/insights) and the Gemini "Ask" (POST /v1/retailer/ask, guest sign-in).
 */
export default function Retail() {
  const [d, setD] = useState<Insights | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    api
      .retailerInsights()
      .then((r) => alive && setD(r))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [attempt])

  // The whole document goes dark while this page is open (overscroll, the toast), and back when it closes.
  useEffect(() => {
    const html = document.documentElement
    const before = html.dataset.theme
    html.dataset.theme = 'dark'
    html.style.colorScheme = 'dark'
    return () => {
      if (before === undefined) delete html.dataset.theme
      else html.dataset.theme = before
      html.style.colorScheme = ''
    }
  }, [])

  const state = d ? (totalUsers(d.cohort) === 0 ? 'empty' : 'ready') : failed ? 'failed' : 'loading'
  return (
    <div data-theme="dark" className="relative min-h-dvh overflow-x-clip bg-canvas pb-20 font-ui text-ink">
      <Backdrop />
      {d ? <CohortBanner d={d} /> : null}
      <Header ready={state === 'ready'} />

      <main className="relative z-[1] mx-auto flex max-w-[1320px] flex-col gap-4 px-[clamp(16px,4vw,40px)]">
        <div className="flex flex-wrap items-end justify-between gap-5 pb-1 pt-[clamp(16px,4vw,48px)]">
          <h1 className="m-0 text-[clamp(44px,6.5vw,96px)] font-light leading-[.92] tracking-[-0.035em]">
            What customers
            <br />
            are trying to change
          </h1>
          <p className="m-0 max-w-[420px] leading-normal text-ink-2">
            Anonymised aggregates. Every rate shows its denominator. Groups below {MIN_GROUP} people are suppressed everywhere, including exports and answers.
          </p>
        </div>

        <p className="m-0 rounded-[20px] border border-line bg-surface px-4 py-3 text-[13px] text-ink-2 lg:hidden">
          Best on a laptop. On a smaller screen the cards stack and wide tables scroll sideways.
        </p>

        {d ? (
          <p aria-live="polite" className="m-0 py-2 font-mono text-[13px] text-ink-2">
            {totalUsers(d.cohort)} USERS · {d.cohort.weeks} WEEKLY READINGS EACH · ALL DATA TO DATE
          </p>
        ) : null}

        {state === 'loading' ? <Loading /> : null}
        {state === 'failed' ? (
          <Notice
            role="alert"
            glyph="—"
            title="Aggregates couldn’t load"
            text="The warehouse didn’t respond. No partial numbers are shown."
            action={{
              label: 'Retry',
              onClick: () => {
                setFailed(false)
                setAttempt((a) => a + 1)
              },
            }}
          />
        ) : null}
        {state === 'empty' ? <Notice glyph="00" title="No consented data yet" text="No one has shared aggregate results yet, so there is nothing to show." /> : null}
        {state === 'ready' && d ? <Dashboard d={d} /> : null}
      </main>
    </div>
  )
}

function Dashboard({ d }: { d: Insights }) {
  return (
    <>
      <Kpis d={d} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-4">
        <NeedsCard d={d} />
        <BrandsCard d={d} />
      </div>
      <OutcomesCard d={d} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-4">
        <GapsCard d={d} />
        <ConflictsCard d={d} />
      </div>
      <AskAggregates d={d} />
      <About d={d} />
    </>
  )
}

/* ───────────────────────────── chrome ───────────────────────────── */

function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[1000px] overflow-hidden"
      style={{ background: 'radial-gradient(40% 40% at 0% 0%, rgba(29,60,160,.55), transparent 70%), radial-gradient(35% 40% at 100% 10%, rgba(14,80,70,.45), transparent 70%)' }}
    >
      {[0, 1].map((i) => (
        <div
          key={i}
          className="absolute size-[40vw] rounded-full blur-[60px]"
          style={{ left: i ? '60%' : '-10%', top: i ? '-10%' : 0, background: i ? 'rgba(20,120,100,.35)' : 'rgba(40,80,220,.35)', animation: `wDrift ${20 + i * 5}s ease-in-out infinite alternate` }}
        />
      ))}
    </div>
  )
}

const BANNER: Record<CohortKind, (d: Insights) => string> = {
  simulated: (d) => `■ SIMULATED EVIDENCE · ${d.cohort.synthetic} SYNTHETIC USERS GENERATED FROM MEASURED NOISE · NOT REAL CUSTOMERS`,
  mixed: (d) => `■ MIXED COHORT · ${d.cohort.real} REAL CONSENTED ${d.cohort.real === 1 ? 'USER' : 'USERS'} + ${d.cohort.synthetic} SIMULATED · COUNTED TOGETHER IN EVERY AGGREGATE`,
  real: () => '■ REAL CONSENTED USERS ONLY · SMALL COHORT · GROUPS UNDER 10 SUPPRESSED',
}

/** SyntheticBanner (docs/DESIGN.md): yellow hatched while any row is simulated, lime when every row is real. */
function CohortBanner({ d }: { d: Insights }) {
  const kind = cohortKind(d.cohort)
  return (
    <div role="note" className={`sticky top-0 z-30 flex justify-center px-4 py-2.5 text-center font-mono text-[12px] tracking-[.06em] ${kind === 'real' ? 'retail-real' : 'retail-synthetic'}`}>
      <span className="hidden sm:inline">{BANNER[kind](d)}</span>
      {/* Phone: the same facts, short enough to keep the sticky strip to one line or two. */}
      <span className="sm:hidden">{kind === 'real' ? '■ REAL CONSENTED USERS ONLY' : `■ ${kind === 'mixed' ? 'MIXED' : 'SIMULATED'} · ${d.cohort.synthetic} SYNTHETIC${d.cohort.real ? ` + ${d.cohort.real} REAL` : ''} USERS`}</span>
    </div>
  )
}

const SECTIONS = [
  ['needs', 'Needs'],
  ['outcomes', 'Outcomes'],
  ['brands', 'Brands'],
  ['gaps', 'Gaps'],
  ['conflicts', 'Conflicts'],
  ['ask', 'Ask'],
] as const

/** The section in view, for the nav pill (the design marked "Ask" only; this follows the scroll). */
function useSectionInView(ready: boolean): string | null {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    // The sections exist only once the dashboard is drawn (never on the loading, failed or empty states).
    if (!ready) return
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target.id, e.isIntersecting))
        setActive(SECTIONS.map(([id]) => id).find((id) => seen.get(id)) ?? null)
      },
      { rootMargin: '-30% 0px -55% 0px' },
    )
    SECTIONS.forEach(([id]) => {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [ready])
  return active
}

function Header({ ready }: { ready: boolean }) {
  const active = useSectionInView(ready)
  return (
    <header className="relative z-[2] flex flex-wrap items-center justify-between gap-3 px-[clamp(16px,4vw,40px)] py-[18px]">
      <Link to="/" aria-label="Willow home" className="flex items-center gap-2.5 no-underline">
        <LogoMark size={32} />
        <span className="text-[26px] font-light tracking-[-0.03em] text-white">willow</span>
        <span className="rounded-pill border border-[#333] px-3 py-1.5 font-mono text-[12px] text-[#C9C6C0]">RETAIL</span>
      </Link>
      <nav aria-label="Sections" className="no-scrollbar flex max-w-full gap-0.5 overflow-x-auto rounded-pill border border-muted bg-sunken p-[5px]">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={active === id ? 'true' : undefined}
            className={`whitespace-nowrap rounded-pill px-4 py-2.5 text-[14px] no-underline transition-[background] duration-200 ${active === id ? 'bg-selected text-inverse' : 'text-ink hover:bg-muted'}`}
          >
            {label}
          </a>
        ))}
      </nav>
      <a href={DATA_STUDIO} target="_blank" rel="noopener noreferrer" className="flex min-h-[46px] items-center gap-2 rounded-pill bg-cta px-[18px] text-[14px] text-inverse no-underline hover:bg-cta-hover">
        Open Data Studio report ↗<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </header>
  )
}

/* ───────────────────────────── states ───────────────────────────── */

function Loading() {
  return (
    <div role="status" aria-label="Loading aggregates" className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="retail-shimmer h-[150px] rounded-[32px]" />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-4">
        <div className="retail-shimmer h-[520px] rounded-[44px] [animation-delay:.1s]" />
        <div className="retail-shimmer h-[520px] rounded-[44px] [animation-delay:.2s]" />
      </div>
      <span className="flex items-center gap-2.5 text-[14px] text-ink-2">
        <span aria-hidden className="flex gap-1">
          {[0, 0.15, 0.3].map((delay) => (
            <span key={delay} className="size-[7px] rounded-full bg-white animate-[wBounce_1.1s_infinite]" style={{ animationDelay: `${delay}s` }} />
          ))}
        </span>
        Loading aggregates…
      </span>
    </div>
  )
}

function Notice({ glyph, title, text, action, role }: { glyph: string; title: string; text: string; action?: { label: string; onClick: () => void }; role?: 'alert' }) {
  return (
    <div role={role} className="flex min-h-[320px] flex-col items-center justify-center gap-3.5 rounded-[44px] bg-surface p-6 text-center">
      <span className={`font-dot text-[64px] ${role === 'alert' ? 'text-coral' : ''}`}>{glyph}</span>
      <span className="text-[20px]">{title}</span>
      <span className="max-w-[420px] leading-normal text-ink-2">{text}</span>
      {action ? (
        <button type="button" onClick={action.onClick} className="min-h-[50px] rounded-pill bg-selected px-[22px] text-inverse">
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

/* ───────────────────────────── KPIs ───────────────────────────── */

function Kpis({ d }: { d: Insights }) {
  const kind = cohortKind(d.cohort)
  const active = d.tiles.find((t) => t.label === 'Active users')
  const median = d.tiles.find((t) => t.label.startsWith('Median weeks'))
  const unmet = d.tiles.find((t) => t.label.startsWith('Unmet'))
  const evidence = outcomes(d).length
  const kpis = [
    {
      // Simulated people never consented to anything: only real rows are "consented users".
      label: kind === 'simulated' ? 'Simulated users' : kind === 'real' ? 'Consented users' : 'Users',
      value: String(totalUsers(d.cohort)),
      unit: kind === 'simulated' ? 'synthetic' : kind,
      note: `${kind === 'mixed' ? `${d.cohort.real} REAL · ${d.cohort.synthetic} SIMULATED · ` : ''}${active ? `${active.n} REACHED WEEK ${d.cohort.weeks}` : ''}`,
    },
    { label: 'Products with outcomes', value: String(evidence), unit: evidence === 1 ? 'product' : 'products', note: `EACH WITH ${MIN_GROUP}+ PEOPLE AT WEEK ${d.cohort.weeks}` },
    median ? { label: 'Median time to change', value: median.value, unit: median.value === '–' ? '' : 'weeks', note: `ALL GOALS · n=${median.n}` } : null,
    unmet ? { label: `No real change by week ${d.cohort.weeks}`, value: unmet.value.replace('%', ''), unit: unmet.value.endsWith('%') ? '%' : '', note: `IN A GOAL METRIC · n=${unmet.n}` } : null,
  ].filter((k): k is { label: string; value: string; unit: string; note: string } => k !== null)
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
      {kpis.map((k, i) => (
        <div key={k.label} className="flex flex-col gap-3.5 rounded-[32px] border border-line bg-surface p-[22px] animate-[wRise_.5s_both]" style={{ animationDelay: `${i * 70}ms` }}>
          <span className="text-[14px] text-ink-2">{k.label}</span>
          <span className="flex items-baseline gap-2">
            <span className="font-dot text-[52px] leading-[.9]">{k.value === '–' ? '—' : k.value}</span>
            <span className="text-[14px] text-ink-2">{k.unit}</span>
          </span>
          <span className="font-mono text-[12px] text-ink-2">{k.note}</span>
        </div>
      ))}
    </div>
  )
}

/* ───────────────────────────── about the data ───────────────────────────── */

function About({ d }: { d: Insights }) {
  const kind = cohortKind(d.cohort)
  const items = [
    {
      k: 'COHORT',
      v:
        kind === 'real'
          ? `${d.cohort.real} real people who opted in to anonymised sharing. Small, so many groups fall below the threshold.`
          : `${d.cohort.synthetic} synthetic people${d.cohort.real ? ` and ${d.cohort.real} real people who opted in` : ''}, each with one to three goals, a routine of real catalogue products and ${d.cohort.weeks} weekly readings; ${Math.round(d.cohort.dropout * 100)}% stopped early. Fixed seed (${d.cohort.seed}), so the numbers are reproducible.${d.cohort.real ? '' : ' No real customer is represented.'}`,
    },
    {
      k: 'REAL CHANGE',
      v: `A person counts when a goal metric is still beyond their own photo noise band at the week-${d.cohort.weeks} reading, in the desired direction. One lucky reading earlier does not count.`,
    },
    { k: 'SUPPRESSION', v: `Any group with fewer than ${MIN_GROUP} people is hidden in the data query and the api, so also in charts, tables, exports and answers.` },
    {
      k: 'ASSUMPTIONS',
      v: 'Outcomes are associations with product use, not proof of effect: people chose their own products and groups are not randomised. In the simulation each product moves its target metrics by 0.2 to 1.1 times the noise band, about 3 in 10 have no effect, and tone band and region have no effect.',
    },
  ]
  return (
    <section aria-label="About this data" className="flex flex-col gap-5 rounded-[44px] border border-line bg-surface p-[clamp(20px,3vw,32px)]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-5">
        {items.map((p) => (
          <div key={p.k} className="flex flex-col gap-2">
            <span className="font-mono text-[12px] text-ink-2">■ {p.k}</span>
            <span className="text-[15px] leading-normal text-[#E4E1DB]">{p.v}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Disclaimer />
        <Link to="/" className="min-h-11 content-center text-[14px] text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          ← Back to the Willow website
        </Link>
      </div>
    </section>
  )
}
