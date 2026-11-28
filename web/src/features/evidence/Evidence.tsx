import '../website/website.css'

import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import type { MetricId } from '../../data/types'
import { METRIC_META } from '../../lib/metrics'
import { useDemoStatus } from '../../lib/useDemoStatus'
import { backButton, Lockup, SoftBackdrop } from '../website/Decor'
import { ARMOR, BREAK_IT, CHECKS, wispLink } from './checks'
import { dayOf, evidence, money, partLine, REPO_BLOB, type A11yCell } from './data'
import { EvalSection } from './EvalSection'
import { InstrumentRetest } from './InstrumentRetest'
import { Ext, Section, tile } from './parts'
import { ScaleSection } from './ScaleSection'

const BACKDROP = 'radial-gradient(42% 42% at 88% 12%, rgba(156,211,255,.5), transparent 70%), radial-gradient(42% 44% at 8% 82%, rgba(216,184,255,.42), transparent 70%), var(--bg-canvas)'

/** What is not shown yet, said plainly (docs/METRICS.md "Validation" lists these as planned work). */
const RETEST_PLANNED = 'Test and retest on real skin, across skin tones: planned, not done.'
const NOT_YET = ['A noise band per skin-tone group: planned, not done.', 'Clinical validation: none. Willow checks repeatability against your own photos, nothing more.']
const readingName = (id: string) => METRIC_META[id as MetricId]?.label ?? id.replace(/_/g, ' ')

const cell = (c?: A11yCell) => (c ? `${c.lighthouse ?? 'n/a'}` : 'n/a')
const issues = (c?: A11yCell) => (c ? c.serious : 0)

/**
 * /evidence, "How we know": the checks behind Willow's claims with their results, failures included. Every
 * figure comes from web/src/data/evidence.json (written by api/scripts/evidence_export.py and cost_report.py) or
 * from the live status check; a section whose data is missing is left out.
 */
export default function Evidence() {
  const navigate = useNavigate()
  const { hash } = useLocation()
  const { status } = useDemoStatus()
  useEffect(() => {
    document.title = 'How we know · Willow'
    const el = hash ? document.getElementById(hash.slice(1)) : null
    if (el) el.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [hash])
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  const { evals, armor, cost, a11y, retest } = evidence
  const bq = status?.bigquery
  const simulated = bq?.synthetic
  const real = bq?.people !== undefined && simulated !== undefined ? bq.people - simulated : undefined
  const contents: [string, string][] = [
    ...(evals ? ([['checked', 'Results']] as [string, string][]) : []),
    ['checks', 'The checks'],
    ['break', 'Try to break it'],
    ['bands', 'Error bars'],
    ...(cost ? ([['cost', 'Cost']] as [string, string][]) : []),
    ['simulated', 'Simulated or real'],
    ...(a11y ? ([['access', 'Accessibility']] as [string, string][]) : []),
  ]
  return (
    <div className="relative flex min-h-dvh flex-col gap-5 overflow-x-clip p-[clamp(16px,3vw,32px)]">
      <SoftBackdrop background={BACKDROP} />
      <header className="relative flex items-center justify-between gap-3">
        <button type="button" aria-label="Back" className={backButton} onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}>
          ←
        </button>
        <Lockup />
      </header>

      <main className="relative mx-auto flex w-full max-w-[820px] animate-[wRiseLg_.6s_cubic-bezier(.2,.7,.2,1)_both] flex-col gap-4 pb-12">
        <div className="px-1 pt-[clamp(16px,4vw,36px)]">
          <h1 className="m-0 font-serif text-[clamp(44px,6vw,72px)] leading-[.98] font-normal tracking-[-0.01em]">How we know</h1>
          <p className="mt-3 mb-0 max-w-[620px] text-[17px] leading-[1.5] text-[#3E3C38]">What Willow claims, how each claim is checked, and what the checks found, failures included. Every figure here is read from a results file in the repository.</p>
        </div>
        <nav aria-label="On this page" className="flex flex-wrap gap-1.5 px-1">
          {contents.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="inline-flex min-h-9 items-center rounded-pill bg-white/60 px-3.5 text-[13.5px] text-ink no-underline transition-colors duration-200 hover:bg-white">
              {label}
            </a>
          ))}
        </nav>

        {evals ? <EvalSection e={evals} /> : null}

        <Section id="checks" title="What each check does" lead="Gemini explains; it never measures. Each thing it writes passes these before a person sees it.">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {[...CHECKS, { title: ARMOR.title, line: armor?.configured ? ARMOR.on : ARMOR.off, path: ARMOR.path }].map((c) => (
              <li key={c.title} className={`flex flex-col gap-1 ${tile}`}>
                <span className="text-[15px]">{c.title}</span>
                <span className="text-[13.5px] leading-[1.45] text-ink-2">{c.line}</span>
                <span className="text-[12.5px]">
                  <Ext href={REPO_BLOB + c.path}>{c.path}</Ext>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="break" title="Try to break it" lead="Each one opens Wisp in the app with the question typed; a guest account is enough. The answers are live, so they can differ each time.">
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {BREAK_IT.map((b) => (
              <li key={b.label} className="flex">
                <Link to={wispLink(b.ask)} className="group flex min-h-[72px] w-full flex-col gap-1 rounded-[20px] bg-white/70 p-4 text-ink no-underline transition-[background-color,scale] duration-200 ease-standard hover:bg-white active:scale-[.985]">
                  <span className="flex items-baseline justify-between gap-2 text-[15.5px]">
                    {b.label}
                    <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
                      →
                    </span>
                  </span>
                  <span className="text-[13.5px] leading-[1.45]">“{b.ask}”</span>
                  <span className="text-[13px] leading-[1.45] text-ink-2">What should happen: {b.expect}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[13px] leading-[1.5] text-ink-2">If one gets through, that is a finding. The same kinds of question are in the eval cases above.</p>
        </Section>

        <Section id="bands" title="Measured, with its own error bars" lead="Photos of the same skin never give the same number twice. Willow measures that spread first, then judges every later reading against it.">
          <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3">
            {[
              ['Your noise', 'The baseline check-in takes five photos, set up from scratch each time. Their spread is your photo-to-photo noise.'],
              ['Your band', 'The band (MDC95) is the larger of two 95% limits on that spread. It is wider when there are fewer photos, and there is none under three usable photos.'],
              ['The verdict', 'A later reading counts as a real change only when it moves by more than the band. Inside it, Willow says “within your normal range”.'],
            ].map(([t, d]) => (
              <li key={t} className={`flex flex-col gap-1 ${tile}`}>
                <span className="text-[15px]">{t}</span>
                <span className="text-[13.5px] leading-[1.45] text-ink-2">{d}</span>
              </li>
            ))}
          </ol>
          <p className="m-0 overflow-x-auto rounded-[14px] bg-white px-4 py-3 font-mono text-[12.5px] text-ink" tabIndex={0} role="group" aria-label="The band’s formula">
            band = max(1.96 · √2 · sd, t₀.₉₇₅,ₙ₋₁ · sd · √(1 + 1/n))
          </p>
          {retest ? (
            <div className={`flex flex-col gap-2 ${tile}`}>
              <h3 className="m-0 text-[15px] font-normal">Tested on real skin</h3>
              <p className="m-0 text-[13.5px] leading-[1.45] text-ink-2">
                {retest.people} people took two check-ins within {retest.max_hours_apart} hours, in different rooms, with nothing changed. Willow called {retest.false_changes} of {retest.readings} readings a change when there was none.
              </p>
              <ul className="m-0 flex list-none flex-col p-0 text-[13.5px]">
                {retest.by_reading.map((r) => (
                  <li key={r.metric_id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-ink/[.07] py-1.5">
                    <span>{readingName(r.metric_id)}</span>
                    <span className="text-ink-2 tnum">
                      {r.false_changes} of {r.pairs} called a change
                      {r.median_move_vs_noise_band !== null ? ` · moved ${r.median_move_vs_noise_band} of the band (median)` : ''}
                    </span>
                  </li>
                ))}
                {retest.by_tone_band.map((t) => (
                  <li key={t.band} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-ink/[.07] py-1.5">
                    <span>Skin tone group: {t.band}</span>
                    <span className="text-ink-2 tnum">
                      {t.people} people · {t.false_changes} of {t.readings} called a change
                    </span>
                  </li>
                ))}
              </ul>
              <span className="text-[12.5px]">
                Counted on {dayOf(retest.generated_at)}. <Ext href={`${REPO_BLOB}api/scripts/retest_report.py`}>How this is counted</Ext>
              </span>
            </div>
          ) : null}
          <div className={`flex flex-col gap-1.5 ${tile}`}>
            <h3 className="m-0 text-[15px] font-normal">Not shown yet</h3>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13.5px] leading-[1.45] text-ink-2">
              {(retest ? NOT_YET : [RETEST_PLANNED, ...NOT_YET]).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <p className="m-0 text-[13px]">
            <Ext href={`${REPO_BLOB}docs/METRICS.md`}>The formulas for every reading</Ext>
          </p>
        </Section>
        <InstrumentRetest />

        {cost ? (
          <Section id="cost" title="What it costs and how it scales" lead={`Median use from ${cost.window_days} days of production logs, at list prices read on ${dayOf(cost.priced_on)}.`}>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {cost.rows.map((r) => (
                <li key={r.unit} className={`flex flex-col gap-1 ${tile}`}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px]">{r.unit}</span>
                    <span className="text-[17px] whitespace-nowrap tnum">{money(r.usd)}</span>
                  </span>
                  <span className="text-[13.5px] leading-[1.45] text-ink-2">{r.what}</span>
                  <span className="text-[12.5px] leading-[1.45] text-ink-2">{r.parts.map(partLine).join(' · ')}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
              US dollars and cents, per one use. {cost.note} Each photo set gets its own engine instance on Cloud Run, so cost grows with use, one check-in at a time. <Ext href={`${REPO_BLOB}api/scripts/cost_report.py`}>How this is computed</Ext>
            </p>
          </Section>
        ) : null}
        <ScaleSection />

        <Section id="simulated" title="Simulated, and labelled">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={`flex flex-col gap-1.5 ${tile}`}>
              <h3 className="m-0 text-[15px] font-normal">Simulated</h3>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13.5px] leading-[1.45] text-ink-2">
                <li>Proof’s cohort{simulated ? `: ${simulated.toLocaleString('en')} simulated people` : ''}. Every Proof page says so.</li>
                <li>Mei. Her photos are generated and show no real person.</li>
                <li>Sample campaigns in Proof’s demo seats.</li>
              </ul>
            </div>
            <div className={`flex flex-col gap-1.5 ${tile}`}>
              <h3 className="m-0 text-[15px] font-normal">Real</h3>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13.5px] leading-[1.45] text-ink-2">
                <li>The engine. Every number is computed from a photo by code, Mei’s included.</li>
                <li>Every Gemini call. Each answer is written live and checked as above.</li>
                <li>Your own account, and the sample run in the judge tour.</li>
                {real !== undefined && real > 0 ? <li>{real.toLocaleString('en')} people who opted in to share results. Groups under 10 are never shown on their own.</li> : null}
              </ul>
            </div>
          </div>
        </Section>

        {a11y ? (
          <Section id="access" title="Accessibility, audited" lead={`${a11y.tools}, run on ${dayOf(a11y.audited_on)} against ${a11y.against}. Automated checks find only part of what matters; they are a floor.`}>
            <table className="w-full border-collapse text-left text-[14px]">
              <thead>
                <tr className="text-[12px] text-ink-2">
                  <th scope="col" className="py-1.5 pr-2 font-normal">
                    Page
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-normal">
                    Desktop
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-normal">
                    Phone
                  </th>
                  <th scope="col" className="py-1.5 pl-2 font-normal">
                    Serious issues
                  </th>
                </tr>
              </thead>
              <tbody>
                {a11y.rows.map((r) => (
                  <tr key={r.page} className="border-t border-ink/[.08]">
                    <th scope="row" className="py-2 pr-2 font-mono text-[12.5px] font-normal">
                      {r.page}
                    </th>
                    <td className="px-2 py-2 tnum">{cell(r.desktop)}</td>
                    <td className="px-2 py-2 tnum">{cell(r.mobile)}</td>
                    <td className="py-2 pl-2 tnum">{issues(r.desktop) + issues(r.mobile)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 text-[13px] leading-[1.5] text-ink-2">Desktop and Phone are Lighthouse accessibility scores out of 100. Serious issues are axe findings rated serious or critical, both sizes added.</p>
          </Section>
        ) : null}

        <div className="flex flex-wrap gap-3 px-1">
          <Link to="/judge" className="flex min-h-[52px] items-center rounded-pill bg-selected px-6 text-[15px] text-inverse no-underline">
            Take the judge tour
          </Link>
          <Link to="/science" className="flex min-h-[52px] items-center rounded-pill bg-white/70 px-6 text-[15px] text-ink no-underline shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]">
            Science and limits
          </Link>
          <Link to="/checks" className="flex min-h-[52px] items-center rounded-pill bg-white/70 px-6 text-[15px] text-ink no-underline shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]">
            How products are checked
          </Link>
        </div>
      </main>
    </div>
  )
}
