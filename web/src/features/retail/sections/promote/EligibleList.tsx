import { useState, type ReactNode } from 'react'

import type { PromoEligibility } from '../../../../lib/api'
import { goalLabel, skinLabel } from '../../promote'
import { promoNote, type Promo } from '../../productModel'
import { sectionPath } from '../../state'
import type { ProductRow } from '../../types'
import { Button, DataTable, int, LiftValue, pct, ProductCell, ProofTierChip, RateCell, type Column } from '../../ui'
import { HeadTip } from './CampaignsTable'

/*
 * Products this workspace can promote (Proven, and its own brand in a brand workspace), best lift first: the
 * outcome against people with the same goals not using it, the lift, what the evidence lets a campaign target, and
 * Promote. Five at first, then 50 more at a time. A product with a campaign carries it: "Campaign running" (the
 * button opens it), or "Promoted before, +8 pts adoption" with "Run again" (a finished sample is history too).
 * Not-eligible products sit behind one toggle, each with the api's reason.
 */

const FIRST = 5
const MORE = 50
const GHOST = 'hit44 inline-flex h-8 items-center gap-1.5 rounded-ctl border-0 bg-transparent px-2.5 text-proof-small font-medium text-ink transition-colors hover:bg-pf-hover'

export function EligibleList({ title, eligible, notEligible, extras, promo, onPromote, onOpenCampaign, carry, empty }: {
  title: string
  eligible: PromoEligibility[]
  notEligible: PromoEligibility[]
  extras: Map<string, ProductRow>
  /** This workspace's campaigns per product (promoHistory). */
  promo: ReadonlyMap<string, Promo>
  onPromote: (id: string) => void
  onOpenCampaign: (id: string) => void
  carry: string
  /** Shown instead of the table when nothing is eligible. */
  empty: ReactNode
}) {
  const [limit, setLimit] = useState(FIRST)
  const [blockedOpen, setBlocked] = useState(false)
  // With nothing eligible, what each product still needs is the useful answer: always shown.
  const blocked = blockedOpen || !eligible.length
  const rows = eligible.slice(0, limit)
  const product = (p: PromoEligibility) => {
    const x = extras.get(p.product_id)
    return { product: p.product, brand: p.brand, category: x?.category ?? '', image_url: x?.image_url }
  }
  const columns: Column<PromoEligibility>[] = [
    {
      id: 'product',
      header: 'Product',
      rowHeader: true,
      width: '38%',
      cell: (p) => {
        const h = promo.get(p.product_id)
        const note = promoNote(h)
        return <ProductCell p={product(p)} logo tag={note ? <span className={`ml-1.5 shrink-0 ${h?.state === 'running' ? 'text-proof-leaf' : ''}`}>· {note}</span> : undefined} />
      },
    },
    {
      id: 'rate',
      header: <HeadTip label="Visible change" tip="Share of its users with a visible change held to week 8, against people with the same goals not using it (the grey figure). Hover a figure for n and the 95% interval." />,
      headerText: 'Visible change vs same goals, not using it',
      width: '148px',
      cell: (p) => {
        const x = extras.get(p.product_id)
        if (!x) return <span className="text-ink-2">—</span>
        return (
          <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
            <RateCell rate={x.rate} n={x.n} lo={x.rate_lo} hi={x.rate_hi} showN={false} />
            {x.base_rate !== null ? <span className="text-proof-small text-ink-2">vs {pct(x.base_rate)}</span> : null}
          </span>
        )
      },
    },
    {
      id: 'lift',
      header: <HeadTip label="Lift" tip="Users who changed minus people with the same goals not using it, in points. Hover a value for its 95% interval." />,
      headerText: 'Lift vs same goals, not using it (pts)',
      align: 'right',
      width: '76px',
      cell: (p) => {
        const x = extras.get(p.product_id)
        return <LiftValue lift={x?.lift} lo={x?.lift_lo} hi={x?.lift_hi} />
      },
    },
    {
      id: 'targets',
      header: <HeadTip label="Can target" tip="The goals and skin types where this product shows its own positive lift with 10+ people. A campaign can narrow them, never widen them." />,
      headerText: 'Can target',
      cell: (p) => {
        const goals = p.goals.map(goalLabel).join(', ')
        const skins = p.skin_types.length === 5 ? 'every skin type' : p.skin_types.map((s) => skinLabel(s).toLowerCase()).join(', ')
        return (
          <span className="block truncate text-proof-small text-ink-2" title={`${goals} · ${skins}`}>
            <span className="text-ink">{goals}</span> · {skins}
          </span>
        )
      },
    },
    {
      id: 'action',
      header: <span className="sr-only">Promote</span>,
      headerText: 'Promote',
      align: 'right',
      width: '112px',
      cell: (p) => {
        const h = promo.get(p.product_id)
        const live = h && h.state !== 'ended' ? h : null
        return (
          <span className="inline-flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {live ? (
              <Button kind="ghost" size="sm" onClick={() => onOpenCampaign(live.campaignId)} label={`Open the campaign for ${p.product}`}>
                Open
              </Button>
            ) : (
              <Button kind="secondary" size="sm" onClick={() => onPromote(p.product_id)} label={h ? `Run a campaign for ${p.product} again` : `Promote ${p.product}`}>
                {h ? 'Run again' : 'Promote'}
              </Button>
            )}
          </span>
        )
      },
    },
  ]

  return (
    <section aria-labelledby="proof-eligible-h" className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
      {eligible.length ? (
        <DataTable
          caption={title}
          heading={
            <>
              <h2 id="proof-eligible-h" className="m-0 text-proof-h text-ink">
                {title}
              </h2>
              <span className="text-proof-small text-ink-2 tnum">{int(eligible.length)}</span>
            </>
          }
          columns={columns}
          rows={rows}
          rowKey={(p) => p.product_id}
          onRowClick={(p) => {
            const h = promo.get(p.product_id)
            if (h && h.state !== 'ended') onOpenCampaign(h.campaignId)
            else onPromote(p.product_id)
          }}
          rowLabel={(p) => (promo.get(p.product_id)?.state && promo.get(p.product_id)!.state !== 'ended' ? `Open the campaign for ${p.product}` : `Promote ${p.product}`)}
          minWidth={720}
        />
      ) : (
        <>
          <h2 id="proof-eligible-h" className="sr-only">
            {title}
          </h2>
          {empty}
        </>
      )}
      {eligible.length > FIRST || (notEligible.length && eligible.length) ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5">
          {eligible.length > FIRST ? (
            <>
              <span className="px-2.5 text-proof-small text-ink-2 tnum" aria-live="polite">
                Showing {int(rows.length)} of {int(eligible.length)}
              </span>
              {rows.length < eligible.length ? (
                <button type="button" onClick={() => setLimit((l) => l + MORE)} className={GHOST}>
                  Show {int(Math.min(MORE, eligible.length - rows.length))} more
                </button>
              ) : null}
              {rows.length > FIRST ? (
                <button type="button" onClick={() => setLimit(FIRST)} className={GHOST}>
                  Show fewer
                </button>
              ) : null}
            </>
          ) : null}
          {notEligible.length && eligible.length ? (
            <span className="ml-auto">
              <button type="button" aria-expanded={blocked} onClick={() => setBlocked((b) => !b)} className={GHOST}>
                {blocked ? 'Hide' : 'Show'} not eligible yet <span className="tnum text-ink-2">{notEligible.length}</span>
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      {blocked && notEligible.length ? (
        <ul aria-label="Not eligible yet" className="m-0 flex max-h-[420px] list-none flex-col overflow-y-auto border-t border-line bg-pf-bg2 p-0">
          {notEligible.map((p) => (
            <li key={p.product_id} className="grid grid-cols-1 items-center gap-x-6 gap-y-1.5 border-b border-line px-5 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <span className="flex min-w-0 items-center gap-3">
                <span className="min-w-0 flex-1">
                  <ProductCell p={product(p)} to={`${sectionPath('products', p.product_id)}${carry}`} />
                </span>
                <ProofTierChip tier={p.tier} size="sm" />
              </span>
              <span className="text-proof-small text-ink-2">{p.reasons.join(' ')}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
