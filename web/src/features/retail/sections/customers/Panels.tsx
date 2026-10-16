import { useState, type ReactNode } from 'react'

import { sectionPath, useRetailState } from '../../state'
import type { ProductRow, Segments } from '../../types'
import { Badge, int, LiftValue, MIN_GROUP, pct, ProductCell, ProofTierChip, RateCell, ShareBar, SidePanel, Suppressed } from '../../ui'
import { rateInterval } from '../../ui/insight'
import { YoursTag } from '../shared'
import { ownForGoal, type SegCell } from './model'

/*
 * The two drawers of Customers: a group (skin type × goal: its unmet share, the best and runner-up product, and in
 * a brand workspace whether the brand has a product for the goal), and a skin type (its goals and top products).
 */

type Catalog = Map<string, ProductRow>

/** Keeps the last value while the drawer slides out. */
function useLast<T>(v: T | null): T | null {
  const [last, setLast] = useState<T | null>(v)
  if (v !== null && v !== last) setLast(v)
  return v ?? last
}

function Block({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-proof-small font-medium text-ink-2">{title}</h3>
      {children}
    </section>
  )
}

function PickRow({ p, catalog, mine, carry }: { p: NonNullable<SegCell['best']>; catalog: Catalog; mine: string | null; carry: string }) {
  const row = catalog.get(p.product_id)
  const ci = rateInterval(p.rate, p.n)
  return (
    <div className="flex items-center justify-between gap-4 rounded-ctl border border-line px-3 py-2.5">
      <ProductCell p={{ product: p.product, brand: p.brand, category: row?.category ?? '', image_url: row?.image_url }} to={`${sectionPath('products', p.product_id)}${carry}`} tag={mine === p.brand ? <YoursTag /> : undefined} />
      <RateCell rate={p.rate} n={p.n} lo={ci?.lo} hi={ci?.hi} />
    </div>
  )
}

export function CellPanel({ cell, s, catalog, mine, onClose }: { cell: SegCell | null; s: Segments; catalog: Catalog; mine: string | null; onClose: () => void }) {
  const { carry } = useRetailState()
  const v = useLast(cell)
  const skin = v ? (s.skin_types.find((t) => t.id === v.skin)?.label ?? v.skin) : ''
  const goal = v ? (s.goals.find((g) => g.id === v.goal)?.label ?? v.goal) : ''
  const own = v && mine ? ownForGoal([...catalog.values()], mine, v.goal) : []
  return (
    <SidePanel open={Boolean(cell)} onClose={onClose} title={v ? `${skin} skin · ${goal}` : 'Group'} subtitle={v && v.users !== null ? `${int(v.users)} people chose this goal` : undefined} labelledBy="customers-cell-title">
      {v ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            {v.unmet === null ? (
              <>
                <Suppressed />
                <span className="text-proof-small text-ink-2">Fewer than {MIN_GROUP} people in this group have 8 weeks of readings yet.</span>
              </>
            ) : (
              <>
                <span className="text-proof-kpi text-ink tnum">{pct(v.unmet)}</span>
                <span className="text-proof-small text-ink-2">saw no visible change by week 8</span>
              </>
            )}
          </div>
          <Block title="Best product for this group">
            {v.best ? <PickRow p={v.best} catalog={catalog} mine={mine} carry={carry} /> : <p className="m-0 text-proof-body text-ink-2">No product has {MIN_GROUP} or more users with {skin.toLowerCase()} skin for this goal yet.</p>}
          </Block>
          {v.runner_up ? (
            <Block title="Runner-up">
              <PickRow p={v.runner_up} catalog={catalog} mine={mine} carry={carry} />
            </Block>
          ) : null}
          {mine ? (
            <Block title={`Your products for ${goal.toLowerCase()}`}>
              {own.length === 0 ? (
                <div className="flex flex-col items-start gap-2 rounded-ctl border border-dashed border-line-strong px-3 py-3">
                  <Badge tone="amber">No product</Badge>
                  <p className="m-0 text-proof-body text-ink-2">{mine} has no catalogue product for {goal.toLowerCase()}.</p>
                </div>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {own.map((p) => (
                    <li key={p.product_id} className="flex items-center justify-between gap-4 rounded-ctl border border-line px-3 py-2.5">
                      <ProductCell p={p} to={`${sectionPath('products', p.product_id)}${carry}`} sub={p.product_id === v.best?.product_id ? <Badge tone="green">Best in this group</Badge> : p.product_id === v.runner_up?.product_id ? <Badge tone="gray">Runner-up here</Badge> : <ProofTierChip tier={p.tier} size="sm" />} />
                      <RateCell rate={p.rate} n={p.n} lo={p.rate_lo} hi={p.rate_hi} />
                    </li>
                  ))}
                </ul>
              )}
              {own.length ? <p className="m-0 text-proof-label text-ink-2">Rates across all skin types. A product missing from this group’s top two has a lower rate here, or fewer than {MIN_GROUP} users with {skin.toLowerCase()} skin.</p> : null}
            </Block>
          ) : null}
          <p className="m-0 text-proof-label text-ink-2">Rates among each product’s users with {skin.toLowerCase()} skin and this goal, by week 8. An association with use, not proof of effect.</p>
        </div>
      ) : null}
    </SidePanel>
  )
}

type SkinRow = Segments['by_skin'][number]

export function SkinPanel({ row, onClose, onGoal, mine }: { row: SkinRow | null; onClose: () => void; onGoal: (skin: string, goal: string) => void; mine: string | null }) {
  const { carry } = useRetailState()
  const v = useLast(row)
  const maxShare = Math.max(0.01, ...(v?.top_goals ?? []).map((g) => g.share))
  return (
    <SidePanel open={Boolean(row)} onClose={onClose} title={v ? `${v.label} skin` : 'Skin type'} subtitle={v ? (v.users === null ? `Fewer than ${MIN_GROUP} people` : `${int(v.users)} people`) : undefined} labelledBy="customers-skin-title">
      {v ? (
        <div className="flex flex-col gap-6">
          <Block title="Top goals">
            {v.top_goals.length === 0 ? (
              <p className="m-0 text-proof-body text-ink-2">No goal has {MIN_GROUP} or more people with this skin type.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {v.top_goals.map((g) => (
                  <li key={g.goal_id}>
                    <button type="button" onClick={() => onGoal(v.skin, g.goal_id)} aria-label={`${g.label}: ${pct(g.share)} of ${v.label.toLowerCase()} skin. Open the group`} className="grid h-9 w-full grid-cols-[minmax(0,1fr)_minmax(60px,40%)_40px] items-center gap-3 rounded-ctl border-0 bg-transparent px-2 text-left hover:bg-pf-hover">
                      <span className="truncate text-proof-body text-ink">{g.label}</span>
                      <ShareBar value={g.share} max={maxShare} />
                      <span className="text-right text-proof-small text-ink tnum">{pct(g.share)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Block>
          <Block title="Top products">
            {v.top_products.length === 0 ? (
              <p className="m-0 text-proof-body text-ink-2">No product has {MIN_GROUP} or more users with {v.label.toLowerCase()} skin yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {v.top_products.map((p) => {
                  const ci = rateInterval(p.rate, p.n)
                  return (
                    <li key={p.product_id} className="grid grid-cols-[minmax(0,1fr)_auto_64px] items-center gap-4 rounded-ctl border border-line px-3 py-2.5">
                      <ProductCell p={{ product: p.product, brand: p.brand, category: '', image_url: p.image_url }} to={`${sectionPath('products', p.product_id)}${carry}`} tag={mine === p.brand ? <YoursTag /> : undefined} />
                      <RateCell rate={p.rate} n={p.n} lo={ci?.lo} hi={ci?.hi} />
                      <span className="text-right">
                        <LiftValue lift={p.lift} />
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="m-0 text-proof-label text-ink-2">Visible-change rate among each product’s users with {v.label.toLowerCase()} skin, and lift over non-users with the same skin type. Ordered by lift.</p>
          </Block>
          {v.conflict_share !== null ? (
            <p className="m-0 text-proof-body text-ink-2">
              <strong className="font-medium text-ink tnum">{pct(v.conflict_share)}</strong> of routines with {v.label.toLowerCase()} skin have a routine conflict.
            </p>
          ) : null}
        </div>
      ) : null}
    </SidePanel>
  )
}
