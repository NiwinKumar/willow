import { ArrowRight, Megaphone } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ProductsLead as Lead } from '../productModel'
import type { ProofTier } from '../types'
import { Button, int, pts, TierDot } from '../ui'

/*
 * The Products page's lead (P2B, finals polish): the three decisions the table holds, before the table. A buyer
 * opens Products to decide what to promote, what to wait on and what to question; the tabs count tiers but not
 * which of them need an action.
 *  - Ready to promote: Proven with no campaign running, with the strongest one and a Promote button.
 *  - Close to Proven: Promising, the nearest one and how many more people at week 8 would settle it.
 *  - No clear effect: measured, users change about as much as non-users: the products to question.
 * Each figure opens its tab. Follows the search and filters above the table.
 * Four tests: (1) it says which rows need a decision and the next step for the top one, which the tab counts don't;
 * (2) a figure with a plain label and one line under it; (3) one compact row above the fold, no motion beyond the
 * kit's hover; (4) the KpiStrip's look (hairline cells, kpi type, tier dots), one primary button.
 */

export function ProductsLead({ lead, promoteTo, onTier }: { lead: Lead; promoteTo: (id: string) => string; onTier: (t: ProofTier) => void }) {
  const top = lead.toPromote[0]
  const near = lead.close[0]
  const asked = lead.unclear[0]
  return (
    <section aria-label="What to act on" className="grid grid-cols-1 overflow-hidden rounded-card border border-line bg-surface md:grid-cols-3">
      <Cell
        tier="proven"
        label="Ready to promote"
        value={lead.toPromote.length}
        onOpen={() => onTier('proven')}
        note={lead.toPromote.length ? 'Proven, no campaign running' : lead.proven ? 'Every Proven product has a campaign' : 'No product here is Proven yet'}
        detail={
          top ? (
            <span className="flex min-w-0 items-center justify-between gap-3">
              <Line name={top.product} meta={pts(top.lift)} />
              <Button to={promoteTo(top.product_id)} kind="primary" size="sm" label={`Promote ${top.product}`}>
                <Megaphone size={14} strokeWidth={1.7} aria-hidden /> Promote
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
        note="Ahead of non-users; the interval still reaches zero"
        detail={
          near ? (
            <Line name={near.product} meta={near.to_proven ? `${int(near.to_proven)} more at week 8` : null} />
          ) : null
        }
      />
      <Cell
        tier="unclear"
        label="No clear effect"
        value={lead.unclear.length}
        onOpen={() => onTier('unclear')}
        note="Users change about as much as non-users"
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
    <span className="flex min-w-0 items-baseline gap-1.5 text-proof-small" title={name}>
      <span className="min-w-0 truncate text-ink">{name}</span>
      {meta ? <span className="shrink-0 text-ink-2 tnum">· {meta}</span> : null}
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
        <span className="flex items-baseline gap-2">
          <span className="text-proof-kpi text-ink tnum">{int(value)}</span>
          <span className="min-w-0 text-proof-small text-ink-2 md:truncate">{note}</span>
        </span>
      </button>
      {detail ? <div className="min-h-8 min-w-0 content-center">{detail}</div> : null}
    </div>
  )
}
