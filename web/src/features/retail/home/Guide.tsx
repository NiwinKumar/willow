import { Check, ChevronDown, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useOnceFlag } from '../rangeStore'
import { sectionPath, useRetailState } from '../state'

/*
 * "How Proof works": a first-run guide that ticks itself from real state (range connected, a product's proof
 * opened, a first decision, a campaign). Shown in full while fewer than two steps are done; after that it folds
 * into a small progress chip in Home's header ("Getting started · 2 of 4") that opens it again. Hidden for good
 * with "Hide guide", or once all four are done.
 *
 * Four tests (the chip): it keeps the next step one click away without a panel taking the fold (1); a ring with
 * "2 of 4" reads as progress (2); it sits in the header's action row, nothing moves (3); kit pill and ring (4).
 */

type Step = { title: string; body: string; items: { label: string; done: boolean; to: string | null }[] }

export function useGuide({ mix, rangeConnected, decided, campaigns }: { mix: 'retailer' | 'brand'; rangeConnected: boolean; decided: boolean; campaigns: boolean }) {
  const [hidden, hide] = useOnceFlag('guide-hidden')
  const [visited] = useOnceFlag('visited-product')
  const { carry } = useRetailState()
  const steps: Step[] = [
    {
      title: 'Connect your range',
      body: mix === 'brand' ? 'Your products arrive from the retailer’s item file, matched to the measured catalog.' : 'Upload your item file once; Proof matches it to the measured catalog.',
      items: [{ label: mix === 'brand' ? 'Your products are in the catalog' : 'Item file connected', done: rangeConnected, to: `${sectionPath('range')}${carry}` }],
    },
    {
      title: 'See what works',
      body: 'How often each product’s users see a visible change, against people with the same goals who don’t use it.',
      items: [{ label: 'Open a product’s proof', done: visited, to: `${sectionPath('products')}${carry}` }],
    },
    {
      title: 'Act and measure',
      body: 'Decide on a card; promote a Proven product with a randomised holdout to measure the lift.',
      items: [
        { label: 'Decide on a first card', done: decided, to: null },
        { label: 'Launch or approve a campaign', done: campaigns, to: `${sectionPath('campaigns')}${carry}` },
      ],
    },
  ]
  const all = steps.flatMap((s) => s.items)
  const done = all.filter((i) => i.done).length
  const next = all.find((i) => !i.done) ?? null
  return { steps, done, total: all.length, next, hidden: hidden || done === all.length, hide, compact: done >= 2 }
}

export type Guide = ReturnType<typeof useGuide>

/** The folded guide: a ring and "Getting started · 2 of 4"; opens the full guide. */
export function GuideChip({ g, open, onToggle }: { g: Guide; open: boolean; onToggle: () => void }) {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls="guide-h" className="hit44 inline-flex h-9 items-center gap-2 rounded-pill border border-line bg-surface pl-2 pr-3 text-proof-small text-ink transition-colors hover:border-line-strong hover:bg-pf-hover">
      <svg aria-hidden width={18} height={18} viewBox="0 0 18 18" className="-rotate-90">
        <circle cx={9} cy={9} r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth={2.5} />
        <circle cx={9} cy={9} r={r} fill="none" stroke="var(--proof-leaf)" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={`${(c * g.done) / g.total} ${c}`} className="transition-[stroke-dasharray] duration-500" />
      </svg>
      <span>Getting started</span>
      <span className="text-ink-2 tnum">
        {g.done} of {g.total}
      </span>
      <ChevronDown size={14} strokeWidth={1.7} aria-hidden className={`text-ink-2 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}

export function GuidePanel({ g, onClose }: { g: Guide; onClose?: () => void }) {
  return (
    <section aria-labelledby="guide-h" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 animate-[proofPage_.24s_var(--ease-standard)_both]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="guide-h" className="m-0 text-proof-h text-ink">
          How Proof works
        </h2>
        <span className="flex items-center gap-1">
          <span className="mr-2 text-proof-small text-ink-2 tnum">
            {g.done} of {g.total} done
          </span>
          <button type="button" onClick={g.hide} className="hit44 rounded-ctl border-0 bg-transparent px-2 py-1 text-proof-small text-ink-2 hover:bg-pf-hover hover:text-ink">
            Hide guide
          </button>
          {onClose ? (
            <button type="button" onClick={onClose} aria-label="Fold the guide" className="hit44 grid size-8 place-items-center rounded-ctl border-0 bg-transparent text-ink-2 hover:bg-pf-hover hover:text-ink">
              <X size={15} strokeWidth={1.7} aria-hidden />
            </button>
          ) : null}
        </span>
      </div>
      <ol className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-3">
        {g.steps.map((s, i) => {
          const stepDone = s.items.every((x) => x.done)
          return (
            <li key={s.title} className="flex gap-3">
              <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full text-proof-label font-medium tnum transition-colors duration-300 ${stepDone ? 'bg-proof-leaf text-[var(--bg-canvas)]' : 'bg-proof-leaf-soft text-proof-leaf'}`}>
                {stepDone ? <Check size={13} strokeWidth={3} /> : i + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="text-proof-body font-medium text-ink">{s.title}</span>
                <span className="text-proof-small text-ink-2">{s.body}</span>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {s.items.map((it) => (
                    <li key={it.label} className="flex items-center gap-2 text-proof-small">
                      <span aria-hidden className={`grid size-4 place-items-center rounded-full border transition-colors duration-300 ${it.done ? 'border-proof-leaf bg-proof-leaf text-[var(--bg-canvas)]' : 'border-line-strong'}`}>{it.done ? <Check size={10} strokeWidth={3.2} /> : null}</span>
                      <span className="sr-only">{it.done ? 'Done: ' : 'To do: '}</span>
                      {it.to && !it.done ? (
                        <Link to={it.to} className="text-ink no-underline hover:underline">
                          {it.label}
                        </Link>
                      ) : (
                        <span className={it.done ? 'text-ink-2 line-through decoration-line-strong' : 'text-ink'}>{it.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
