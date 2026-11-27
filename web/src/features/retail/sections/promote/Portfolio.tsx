import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Portfolio as P } from '../../promote'
import { int, pct, pts } from '../../ui'

/*
 * The campaigns at a glance (P2B, finals polish), above the table: the delivery funnel summed over the campaigns
 * listed (shown → clicked → added to a routine, each step's rate beside it) and what the holdouts say (how many
 * are measured, how many sit clearly above their holdout, the best lift and where it came from).
 * Four tests: (1) a portfolio answer ("is promotion working for us?") that the per-row table makes you add up;
 * (2) three labelled bars that read left to right, plain sentences on the right; (3) one compact card, the bars grow
 * once on arrival (reduced motion: drawn at once); (4) Panel look, leaf only for the added-to-routine step and a
 * positive lift (leaf = the positive outcome), base grey for the rest.
 */

export function Portfolio({ p, openTo }: { p: P; openTo: (id: string) => string }) {
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setGrown(true))
    return () => window.cancelAnimationFrame(id)
  }, [])
  const max = Math.max(1, p.impressions)
  const steps = [
    { id: 'shown', label: 'Card shown', value: p.impressions, rate: null as string | null, tone: 'bg-[var(--pf-base)]' },
    { id: 'clicked', label: 'Clicked', value: p.clicks, rate: p.ctr === null ? null : `${pct(p.ctr)} of shown`, tone: 'bg-[var(--pf-base)]' },
    { id: 'added', label: 'Added to routine', value: p.adds, rate: p.addRate === null ? null : `${pct(p.addRate)} of clicks`, tone: 'bg-proof-leaf' },
  ]
  return (
    <section aria-labelledby="portfolio-h" className="grid grid-cols-1 overflow-hidden rounded-card border border-line bg-surface lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="flex min-w-0 flex-col gap-3 border-line px-5 py-4 max-lg:border-b lg:border-r">
        <h2 id="portfolio-h" className="m-0 text-proof-h text-ink">
          Delivery, all campaigns
        </h2>
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {steps.map((s, i) => (
            <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[128px_minmax(0,1fr)_auto]">
              <span className="truncate text-proof-small text-ink-2">{s.label}</span>
              <span aria-hidden className="relative block h-2 overflow-hidden rounded-pill bg-sunken max-sm:col-span-2 max-sm:row-start-2">
                <span
                  className={`absolute inset-y-0 left-0 block origin-left rounded-pill ${s.tone} transition-transform duration-500 ease-[var(--ease-standard)] motion-reduce:transition-none`}
                  style={{ width: `${Math.max(1.5, (s.value / max) * 100)}%`, transform: `scaleX(${grown ? 1 : 0})`, transitionDelay: `${i * 60}ms` }}
                />
              </span>
              <span className="flex items-baseline justify-end gap-2 whitespace-nowrap max-sm:col-start-2 max-sm:row-start-1">
                <span className="text-proof-body font-medium text-ink tnum">{int(s.value)}</span>
                {s.rate ? <span className="text-proof-label text-ink-2 tnum">{s.rate}</span> : null}
              </span>
            </li>
          ))}
        </ol>
        <p className="m-0 text-proof-label text-ink-2">Shown counts each person once a day; adds are additions to a Willow routine from the card, not store sales.</p>
      </div>
      <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
        <h2 className="m-0 text-proof-h text-ink">Lift against the holdout</h2>
        {p.measured ? (
          <p className="m-0 text-proof-body text-ink-2 [text-wrap:pretty]">
            <strong className="font-semibold text-ink tnum">{p.clear}</strong> of {p.measured} measured {p.measured === 1 ? 'campaign sits' : 'campaigns sit'} clearly above {p.measured === 1 ? 'its' : 'their'} randomised holdout.
            {p.best ? (
              <>
                {' '}
                Best:{' '}
                <Link to={openTo(p.best.id)} className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                  {p.best.product}
                </Link>
                , <strong className={`font-semibold tnum ${p.best.lift > 0 ? 'text-proof-leaf' : 'text-ink'}`}>{pts(p.best.lift)}</strong>.
              </>
            ) : null}
          </p>
        ) : (
          <p className="m-0 text-proof-body text-ink-2">No campaign has 10 people in each group yet, so no lift is measured.</p>
        )}
        {p.collecting ? (
          <p className="m-0 text-proof-small text-ink-2">
            <span className="tnum">{p.collecting}</span> running {p.collecting === 1 ? 'campaign is' : 'campaigns are'} still collecting 10 people per group.
          </p>
        ) : null}
      </div>
    </section>
  )
}
