import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { bestSeg, categorySpot, hintOf, verdictLine } from '../productModel'
import type { ProductDetail as Detail } from '../types'
import { Button, int, pct, ProofTierChip, pts } from '../ui'

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

export function ProductVerdict({ x, weeksN, promoteTo }: { x: Detail; weeksN: number; promoteTo: string }) {
  const p = x.product
  const skin = p.rate !== null ? bestSeg(x.segments.skin) : null
  const reason = !x.eligibility.eligible ? x.eligibility.reasons[0] : null
  const target = x.eligibility.eligible && skin ? `${promoteTo}&skins=${encodeURIComponent(skin.id)}` : null
  return (
    <section aria-label="Verdict" className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="flex min-w-0 flex-col gap-2.5">
        <p className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-proof-answer text-ink [text-wrap:pretty]">
          <ProofTierChip tier={p.tier} hint={hintOf(p)} />
          <span className="min-w-0">{verdictLine(p)}</span>
        </p>
        {skin || p.weeks !== null || reason ? (
          <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1.5 text-proof-small text-ink-2">
            {skin ? <Fact term="Works best for" value={`${skin.label} skin`} sub={`${pct(skin.rate)} of ${int(skin.n)}, non-users ${pct(skin.base_rate)}`} /> : null}
            {p.rate !== null && p.weeks !== null ? <Fact term="Change usually begins" value={`by week ${Math.round(p.weeks)}`} sub={`median, of ${weeksN} weeks`} /> : null}
            {reason ? <Fact term="Not promotable yet" value={reason} /> : null}
          </dl>
        ) : null}
      </div>
      {target && skin ? (
        <span className="shrink-0">
          <Button to={target} title={`Open a campaign for ${p.product}, aimed at ${skin.label.toLowerCase()} skin`}>
            Promote to {skin.label.toLowerCase()} skin <ArrowRight size={14} strokeWidth={1.7} aria-hidden />
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
