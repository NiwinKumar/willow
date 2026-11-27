import { ArrowRight } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { bestSeg, categorySpot, hintOf, verdictLine, type Promo } from '../productModel'
import type { ProductDetail as Detail } from '../types'
import { Button, CurveChart, int, Panel, pct, ProofTierChip, pts, Segmented } from '../ui'

/*
 * The product page's lead (P2B, finals polish): what a buyer came to learn, in the order they ask it.
 *
 * ProductVerdict: the tier and one sentence on what the evidence says against non-users with the same goals, then
 * who it works for (the skin type with the largest lift over non-users of that skin type, 10+ people; goal groups are
 * left to Where it works, since a goal group's rate reads against a different measure than the headline) and how fast, and one targeted action:
 * promote it to the skin type it works best for (the create sheet opens with that skin type ticked).
 * Four tests: (1) it turns the facts strip into a decision and names the group to target, which no other panel
 * says together; (2) plain sentences, the action says what it does; (3) one row, no motion, no new colour;
 * (4) a Panel-weight card on the kit's type steps, the tier chip is the kit's.
 *
 * CategoryStrip: this product's rate as a leaf dot against every other measured product in its category (grey
 * ticks) and their median (an ink line), with the gap in words. Four tests: (1) "is it good for a sunscreen?" at a
 * glance, which the ranked list only answers for the top five; (2) the sentence above says what the dot shows;
 * (3) small, inside the existing panel, the dot glides once from the median to its place (reduced motion: none);
 * (4) leaf = this product, --pf-base = the market, as everywhere in Proof.
 */

export function ProductVerdict({ x, weeksN, promoteTo, promo, campaignTo }: { x: Detail; weeksN: number; promoteTo: string; promo?: Promo; campaignTo?: (id: string) => string }) {
  const p = x.product
  const skin = p.rate !== null ? bestSeg(x.segments.skin) : null
  const reason = !x.eligibility.eligible ? x.eligibility.reasons[0] : null
  // A live or paused campaign is the next step's place; a finished one is history to build on ("run again").
  const live = promo && promo.state !== 'ended' ? promo : null
  const before = promo?.state === 'ended' ? promo : null
  const target = x.eligibility.eligible && skin && !live ? `${promoteTo}&skins=${encodeURIComponent(skin.id)}` : null
  return (
    <section aria-label="Verdict" className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="flex min-w-0 flex-col gap-2.5">
        <p className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-proof-answer text-ink [text-wrap:pretty]">
          <ProofTierChip tier={p.tier} hint={hintOf(p)} />
          <span className="min-w-0">{verdictLine(p)}</span>
        </p>
        {skin || p.weeks !== null || reason || promo ? (
          <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1.5 text-proof-small text-ink-2">
            {skin ? <Fact term="Works best for" value={`${skin.label} skin`} sub={`${pct(skin.rate)} of ${int(skin.n)} changed; ${pct(skin.base_rate)} of that skin type not using it`} /> : null}
            {p.rate !== null && p.weeks !== null ? <Fact term="Change usually begins" value={`by week ${Math.round(p.weeks)}`} sub={`median, of ${weeksN} weeks`} /> : null}
            {reason ? <Fact term="Not promotable yet" value={reason} /> : null}
            {live ? <Fact term={live.state === 'running' ? 'Campaign running' : 'Campaign paused'} value={live.lift !== null ? `${pts(live.lift)} adoption so far` : 'lift once each group has 10 people'} sub={live.sample ? '(sample campaign)' : undefined} /> : null}
            {before ? <Fact term="Promoted before" value={before.lift !== null ? `${pts(before.lift)} adoption against its holdout` : 'ended before a lift was measured'} sub={before.sample ? '(sample campaign)' : undefined} /> : null}
          </dl>
        ) : null}
      </div>
      {live && campaignTo ? (
        <span className="shrink-0">
          <Button to={campaignTo(live.campaignId)}>
            Open the campaign <ArrowRight size={14} strokeWidth={1.7} aria-hidden />
          </Button>
        </span>
      ) : target && skin ? (
        <span className="shrink-0">
          <Button to={target} title={`Open a campaign for ${p.product}, aimed at ${skin.label.toLowerCase()} skin`}>
            {before ? 'Run again for' : 'Promote to'} {skin.label.toLowerCase()} skin <ArrowRight size={14} strokeWidth={1.7} aria-hidden />
          </Button>
        </span>
      ) : null}
    </section>
  )
}

function Fact({ term, value, sub }: { term: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-1.5">
      <dt className="whitespace-nowrap">{term}</dt>
      <dd className="m-0 min-w-0 font-medium text-ink">
        {value}
        {sub ? <span className="ml-1.5 font-normal text-ink-2 tnum">{sub}</span> : null}
      </dd>
    </div>
  )
}

/** This product against the other measured products of its category: ticks, the median and the leaf dot. */
export function CategoryStrip({ x }: { x: Detail }) {
  const spot = categorySpot(x.competitors.rows)
  const [placed, setPlaced] = useState(false)
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setPlaced(true))
    return () => window.cancelAnimationFrame(id)
  }, [])
  if (!spot) return null
  const cat = x.product.category_label.toLowerCase()
  const lo = Math.max(0, Math.floor((spot.min - 0.05) * 20) / 20)
  const hi = Math.min(1, Math.ceil((spot.max + 0.05) * 20) / 20)
  const at = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`
  const level = Math.round(spot.delta * 100) === 0
  return (
    <figure className="m-0 flex flex-col gap-2 px-5 pb-4">
      <figcaption className="text-proof-small text-ink-2 [text-wrap:pretty]">
        {level ? (
          <>
            Level with the median of {spot.others.length} other {cat} ({pct(spot.median)}).
          </>
        ) : (
          <>
            <strong className={`font-semibold tnum ${spot.delta > 0 ? 'text-proof-leaf' : 'text-ink'}`}>{pts(spot.delta)}</strong> against the median of {spot.others.length} other {cat} ({pct(spot.median)}).
          </>
        )}
      </figcaption>
      <div aria-hidden className="relative h-7">
        <span className="absolute inset-x-0 top-1/2 block h-px -translate-y-1/2 bg-line" />
        {spot.others.map((v, i) => (
          <span key={i} className="absolute top-1/2 block h-3 w-px -translate-y-1/2 bg-[var(--pf-base)]" style={{ left: at(v) }} />
        ))}
        <span className="absolute top-0 block h-7 w-0.5 -translate-x-1/2 rounded-pill bg-ink-2" style={{ left: at(spot.median) }} />
        <span
          className="absolute top-1/2 block size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-proof-leaf ring-2 ring-surface transition-[left] duration-500 ease-[var(--ease-standard)] motion-reduce:transition-none"
          style={{ left: at(placed ? spot.self : spot.median) }}
        />
      </div>
      <div aria-hidden className="flex justify-between text-proof-label text-ink-2 tnum">
        <span>{pct(lo)}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="block size-2 rounded-full bg-proof-leaf" /> This product
          </span>
          <span className="flex items-center gap-1.5">
            <span className="block h-2.5 w-0.5 rounded-pill bg-ink-2" /> Median
          </span>
        </span>
        <span>{pct(hi)}</span>
      </div>
    </figure>
  )
}

/*
 * OutcomePanel (Q2, finals polish): the product page's main chart. It answers the one question the page exists for,
 * "does it work better than not using it?", as two step lines by week: its users and people with the same goals
 * who don't use it (the comparison Proven is measured against), with the gap in one sentence above. Below, the path
 * the people who tried it took (tried → reached week 8 → changed → still using), as plain counts. The full
 * flow chart (to "how it feels") stays one click away when the api has its deeper columns; with only two columns
 * it was a tall empty panel.
 * Four tests: (1) the curve and the comparison group were nowhere on this page, only in Compare; (2) labelled
 * lines, a sentence that names both groups with their n; (3) fixed height, no motion; (4) the kit's CurveChart
 * and Segmented, leaf = this product, grey dashed = the comparison, as in Compare.
 */
export function OutcomePanel({ x, weeksN, journey, className = '' }: { x: Detail; weeksN: number; journey: ReactNode | null; className?: string }) {
  const p = x.product
  const [view, setView] = useState<'curve' | 'path'>('curve')
  // Phones: a shorter chart (the row it fills on desktop is stacked there).
  const [narrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches)
  const non = x.journey?.nodes.find((n) => n.id === 'non')?.n ?? null
  const early = x.journey?.nodes.find((n) => n.id === 'early')?.n ?? null
  const changed = p.rate !== null && p.n ? Math.round(p.rate * p.n) : null
  const kept = p.cont8 !== null && p.n ? Math.round(p.cont8 * p.n) : null
  const deep = journey !== null
  if (deep && view === 'path') {
    return (
      <div className={`flex min-w-0 flex-col gap-2 ${className}`}>
        <div className="flex justify-end">
          <Segmented label="Outcome view" value={view} onChange={setView} options={VIEWS} />
        </div>
        {journey}
      </div>
    )
  }
  return (
    <Panel
      title={`Users against people not using it`}
      id="outcome-h"
      className={className}
      actions={deep ? <Segmented label="Outcome view" value={view} onChange={setView} options={VIEWS} /> : null}
      description={
        p.base_rate !== null && p.rate !== null ? (
          <>
            By week {weeksN}, <strong className="font-medium text-ink">{pct(p.rate)}</strong> of {int(p.n)} users saw a visible change; <strong className="font-medium text-ink">{pct(p.base_rate)}</strong>
            {non ? ` of ${int(non)}` : ''} people with the same goals who don’t use it changed anyway
            {p.lift !== null ? (
              <>
                : <strong className={`whitespace-nowrap font-semibold ${p.lift > 0 ? 'text-proof-leaf' : 'text-ink'}`}>{pts(p.lift)}</strong>
                {p.lift_lo !== null && p.lift_hi !== null ? ` (95% interval ${pts(p.lift_lo)} to ${pts(p.lift_hi)})` : ''}.
              </>
            ) : (
              '.'
            )}
          </>
        ) : undefined
      }
    >
      <div className="flex flex-1 flex-col gap-4">
        <CurveChart
          title={`Share whose lasting visible change had begun, by week, users against people with the same goals not using it`}
          weeks={x.curve.weeks}
          height={narrow ? 220 : 330}
          series={[
            { id: 'users', label: 'Users', values: x.curve.users, tone: 'signal', n: p.n },
            ...(x.curve.base.some((v) => v !== null) ? [{ id: 'base', label: 'Not using it', values: x.curve.base, tone: 'muted' as const, n: non }] : []),
          ]}
        />
        <ol aria-label="Path of the people who tried it" className="m-0 mt-auto grid list-none grid-cols-2 gap-px overflow-hidden rounded-ctl border border-line bg-line p-0 sm:grid-cols-4">
          <PathStep i={0} n={p.users} label="tried it" />
          <PathStep i={1} n={p.n} label={`reached week ${weeksN}`} sub={early ? `${int(early)} not yet` : undefined} />
          <PathStep i={2} n={changed} label="saw a visible change" sub={p.rate !== null ? `${pct(p.rate)} of them` : undefined} />
          <PathStep i={3} n={kept} label={`still using at week ${weeksN}`} sub={p.cont8 !== null ? `${pct(p.cont8)} of them` : undefined} />
        </ol>
      </div>
    </Panel>
  )
}

const VIEWS = [
  { value: 'curve' as const, label: 'By week' },
  { value: 'path' as const, label: 'Full path' },
]

/** One step of the path; the four arrive left to right (40 ms apart), as the people moved through them. */
function PathStep({ i, n, label, sub }: { i: number; n: number | null | undefined; label: string; sub?: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 bg-surface px-3 py-2.5 animate-[proofSwap_.32s_var(--ease-standard)_both]" style={{ animationDelay: `${120 + i * 40}ms` }}>
      <span className="text-proof-h text-ink tnum">{n === null || n === undefined ? '—' : int(n)}</span>
      <span className="text-proof-small text-ink-2">{label}</span>
      {sub ? <span className="text-proof-label text-ink-2 tnum">{sub}</span> : null}
    </li>
  )
}
