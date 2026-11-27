import { ArrowRight, Megaphone, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ProductsLead as Lead, Promo } from '../productModel'
import type { ProofTier } from '../types'
import { Button, int, pts, TierDot } from '../ui'

/*
 * The Products page's lead (P2B, finals polish): the three decisions the table holds, before the table. A buyer
 * opens Products to decide what to promote, what to wait on and what to question; the tabs count tiers but not
 * which of them need an action.
 *  - Ready to promote: Proven with no campaign running, with the strongest one and a Promote button. A product
 *    whose campaign finished is history, not "never promoted": its line says "Promoted before, +8 pts adoption"
 *    and the button reads "Run again" (Q2, finals polish).
 *  - Close to Proven: Promising, the nearest one and how many more people at week 8 would settle it.
 *  - No clear effect: measured, users change about as much as non-users: the products to question.
 * Each figure opens its tab. Follows the search and filters above the table.
 * Four tests: (1) it says which rows need a decision and the next step for the top one, which the tab counts don't;
 * (2) a figure with a plain label and one line under it; (3) one compact row above the fold, no motion beyond the
 * kit's hover; (4) the KpiStrip's look (hairline cells, kpi type, tier dots), one primary button.
 */

export function ProductsLead({ lead, promo, promoteTo, onTier }: { lead: Lead; promo: ReadonlyMap<string, Promo>; promoteTo: (id: string) => string; onTier: (t: ProofTier) => void }) {
  const top = lead.toPromote[0]
  const before = top ? promo.get(top.product_id) : undefined
  const ready = lead.toPromote.length - lead.ranBefore
  const near = lead.close[0]
  const asked = lead.unclear[0]
  return (
    <section aria-label="What to act on" className="grid grid-cols-1 overflow-hidden rounded-card border border-line bg-surface md:grid-cols-3">
      <Cell
        tier="proven"
        label="Ready to promote"
        value={lead.toPromote.length}
        onOpen={() => onTier('proven')}
        note={lead.toPromote.length ? (!lead.ranBefore ? 'Proven, never promoted' : ready ? `Proven, no campaign running · ${int(ready)} never promoted` : 'Proven, no campaign running; all promoted before') : lead.proven ? 'Every Proven product has a campaign running' : 'No product here is Proven yet'}
        detail={
          top ? (
            <span className="flex min-w-0 items-center justify-between gap-3">
              <Line name={top.product} meta={before ? (before.lift !== null ? `promoted before, ${pts(before.lift)} adoption` : 'promoted before') : `${pts(top.lift)} lift`} />
              <Button to={promoteTo(top.product_id)} kind="primary" size="sm" label={before ? `Run a campaign for ${top.product} again` : `Promote ${top.product}`}>
                {before ? <RotateCcw size={14} strokeWidth={1.7} aria-hidden /> : <Megaphone size={14} strokeWidth={1.7} aria-hidden />} {before ? 'Run again' : 'Promote'}
              </Button>
            </span>
          ) : null
        }
      />
      <Cell
        tier="promising"
        label="Close to Proven"
        value={lead.close.length}
        onOpen={() => onTier('promising')}
        note="Ahead of people with the same goals not using it; the interval still reaches zero"
        detail={
          near ? (
            <Line name={near.product} meta={near.to_proven ? `needs ${int(near.to_proven)} more at week 8` : null} />
          ) : null
        }
      />
      <Cell
        tier="unclear"
        label="No clear effect"
        value={lead.unclear.length}
        onOpen={() => onTier('unclear')}
        note="Users change about as much as people not using it"
        detail={
          asked ? (
            <Line name={asked.product} meta={asked.users ? `${int(asked.users)} users` : null} />
          ) : null
        }
      />
    </section>
  )
}

/** One product in a cell: the name truncates, its figure never does. */
function Line({ name, meta }: { name: string; meta: string | null }) {
  return (
    // Stacked: name over its figure, so a long name and "promoted before, +11 pts adoption" both stay readable.
    <span className="flex min-w-0 flex-col text-proof-small" title={name}>
      <span className="min-w-0 truncate text-ink">{name}</span>
      {meta ? <span className="truncate text-proof-label text-ink-2 tnum">{meta}</span> : null}
    </span>
  )
}

function Cell({ tier, label, value, note, detail, onOpen }: { tier: ProofTier; label: string; value: number; note: string; detail: ReactNode; onOpen: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-line px-5 py-4 [&:not(:last-child)]:border-b md:[&:not(:last-child)]:border-b-0 md:[&:not(:last-child)]:border-r">
      <button type="button" onClick={onOpen} aria-label={`${label}: ${value}. Show them`} className="group -mx-1.5 -my-1 flex min-w-0 flex-col gap-1 rounded-ctl border-0 bg-transparent px-1.5 py-1 text-left transition-colors hover:bg-pf-hover active:scale-[.99]">
        <span className="flex items-center gap-2 text-proof-small text-ink-2">
          <TierDot tier={tier} />
          {label}
          <ArrowRight size={13} strokeWidth={1.7} aria-hidden className="-translate-x-1 opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
        </span>
        <span className="flex items-center gap-3">
          {/* keyed by value: a filter that changes the count cross-fades it instead of swapping digits in place */}
          <span key={value} className="text-proof-kpi text-ink tnum animate-[proofSwap_.22s_var(--ease-standard)_both]">
            {int(value)}
          </span>
          <span className="min-w-0 text-proof-small leading-[18px] text-ink-2 [text-wrap:pretty] md:line-clamp-2">{note}</span>
        </span>
      </button>
      {detail ? <div className="min-h-8 min-w-0 content-center">{detail}</div> : null}
    </div>
  )
}
