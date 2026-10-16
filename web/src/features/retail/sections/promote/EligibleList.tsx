import { useState, type ReactNode } from 'react'

import type { PromoEligibility } from '../../../../lib/api'
import { goalLabel, skinLabel } from '../../promote'
import { sectionPath } from '../../state'
import type { ProductRow } from '../../types'
import { Button, DataTable, LiftValue, pct, ProductCell, ProofTierChip, RateCell, type Column } from '../../ui'
import { HeadTip } from './CampaignsTable'

/*
 * Products this workspace can promote (Proven, and its own brand in a brand workspace), best lift first: the
 * outcome against non-users, the lift, what the evidence lets a campaign target, and Promote. Five at first,
 * "Show all" for the rest. Not-eligible products sit behind one toggle, each with the api's reason.
 */

const FIRST = 5
const GHOST = 'hit44 inline-flex h-8 items-center gap-1.5 rounded-ctl border-0 bg-transparent px-2.5 text-proof-small font-medium text-ink transition-colors hover:bg-pf-hover'

export function EligibleList({ title, eligible, notEligible, extras, runningFor, onPromote, carry, empty }: {
  title: string
  eligible: PromoEligibility[]
  notEligible: PromoEligibility[]
  extras: Map<string, ProductRow>
  runningFor: Map<string, number>
  onPromote: (id: string) => void
  carry: string
  /** Shown instead of the table when nothing is eligible. */
  empty: ReactNode
}) {
  const [all, setAll] = useState(false)
  const [blockedOpen, setBlocked] = useState(false)
  // With nothing eligible, what each product still needs is the useful answer: always shown.
  const blocked = blockedOpen || !eligible.length
  const rows = all ? eligible : eligible.slice(0, FIRST)
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
        const live = runningFor.get(p.product_id) ?? 0
        return <ProductCell p={product(p)} tag={live ? <span className="ml-1.5 shrink-0 text-proof-leaf">· {live === 1 ? 'Running' : `${live} running`}</span> : undefined} />
      },
    },
    {
      id: 'rate',
      header: <HeadTip label="Visible change" tip="Share of its users with a visible change held to week 8, against non-users with the same goals. Hover a figure for n and the 95% interval." />,
      headerText: 'Visible change vs non-users',
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
      header: 'Lift',
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
      cell: (p) => (
        <span className="inline-flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Button kind="secondary" size="sm" onClick={() => onPromote(p.product_id)} label={`Promote ${p.product}`}>
            Promote
          </Button>
        </span>
      ),
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
              <span className="text-proof-small text-ink-2 tnum">{eligible.length}</span>
            </>
          }
          columns={columns}
          rows={rows}
          rowKey={(p) => p.product_id}
          onRowClick={(p) => onPromote(p.product_id)}
          rowLabel={(p) => `Promote ${p.product}`}
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
            <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className={GHOST}>
              {all ? 'Show fewer' : `Show all ${eligible.length}`}
            </button>
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
