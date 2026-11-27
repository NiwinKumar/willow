import { HeartPulse } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useQuery } from '../../../../lib/query'
import { useOrg } from '../../org'
import { proofApi, type ClicksView, type FitView } from '../../proofApi'
import { sectionPath, useRetailState } from '../../state'
import { Bone, EmptyState, int, Panel } from '../../ui'

/*
 * Fit and reactions (Customers, #fit): what opted-in shoppers tell Willow beyond their photos. Ingredient groups
 * they avoid, products they put on their avoid list or reported a reaction to (GET /v1/proof/orgs/{org}/fit), and
 * taps on "Buy at <store>" in the last 30 days (GET /v1/retailer/clicks). Counts of people (clicks: taps), each
 * 10 or more; smaller groups are left out by the api. A brand sees its own products only. With little real data
 * the panel says so instead of drawing empty charts.
 */

const SHOWN = 6

export function Fit({ className = '' }: { className?: string }) {
  const { org, lockedBrand } = useOrg()
  const { carry } = useRetailState()
  const fit = useQuery<FitView>(['proof-fit', org?.id ?? ''], (t) => proofApi.fit(t, org!.id), { enabled: Boolean(org), staleMs: 5 * 60_000 })
  const clicks = useQuery<ClicksView>(['retail-clicks', 30], () => proofApi.clicks(30), { public: true, staleMs: 5 * 60_000 })
  const loading = (org && fit.status === 'loading') || clicks.status === 'loading'
  const f = fit.data ?? null
  const clickRows = (clicks.data?.products ?? []).filter((p) => typeof p.clicks === 'number' && (!lockedBrand || p.brand === lockedBrand)).slice(0, SHOWN)
  const nothing = !loading && !f?.avoid.length && !f?.products.length && !clickRows.length

  return (
    <Panel title="Fit and reactions" id="fit-h" className={className} description="What opted-in shoppers tell Willow besides their photos: what they avoid, what they reacted to, and where they tapped to buy. Counts of people, 10 or more each." footnote={f?.basis ?? 'Groups under 10 are left out.'}>
      {loading ? (
        <div className="flex flex-col gap-2">
          <Bone className="h-4 w-2/3" />
          <Bone className="h-4 w-1/2" />
          <Bone className="h-4 w-3/5" />
        </div>
      ) : nothing ? (
        <EmptyState
          compact
          icon={<HeartPulse size={18} strokeWidth={1.6} />}
          title="Not enough shoppers have shared this yet"
          body={`${f?.profiled ? `${int(f.profiled)} opted-in people have a safety profile, ` : 'Fewer than 10 opted-in people have a safety profile, '}and no product reaches 10 people on an avoid list, with a reaction or with store taps. The simulated cohort has no safety profiles, so this view fills only from real people.`}
          secondary={{ label: 'How sharing works', to: `${sectionPath('research')}${carry}${carry ? '&' : '?'}tab=sharing` }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Column title="Avoided ingredients" sub={f?.profiled ? `of ${int(f.profiled)} with a safety profile` : 'Fewer than 10 with a profile'} rows={(f?.avoid ?? []).slice(0, SHOWN).map((a) => ({ key: a.id, label: a.label, value: `${int(a.people)} people` }))} empty="No group reaches 10 people." />
          <Column
            title="Avoided or reacted to"
            sub={f?.hidden ? `${int(f.hidden)} more products under 10 people` : 'Products'}
            rows={(f?.products ?? []).slice(0, SHOWN).map((p) => ({ key: p.product_id, label: p.product, hint: lockedBrand ? undefined : p.brand, value: [p.reacted !== null ? `${int(p.reacted)} reacted` : null, p.avoided !== null ? `${int(p.avoided)} avoid` : null].filter(Boolean).join(' · '), to: `${sectionPath('products', p.product_id)}${carry}` }))}
            empty="No product reaches 10 people."
          />
          <Column title="Store taps, 30 days" sub={clicks.data ? `${typeof clicks.data.total === 'number' ? int(clicks.data.total) : clicks.data.total} in total` : 'Unavailable'} rows={clickRows.map((p) => ({ key: p.product_id, label: p.product ?? p.product_id, hint: lockedBrand ? undefined : (p.brand ?? undefined), value: `${int(p.clicks as number)} taps`, to: `${sectionPath('products', p.product_id)}${carry}` }))} empty="No product reaches 10 taps." />
        </div>
      )}
    </Panel>
  )
}

type Row = { key: string; label: string; hint?: string; value: string; to?: string }

function Column({ title, sub, rows, empty }: { title: string; sub: string; rows: Row[]; empty: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="flex flex-col">
        <span className="text-proof-body font-medium text-ink">{title}</span>
        <span className="text-proof-label text-ink-2">{sub}</span>
      </span>
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.key} className="flex min-h-10 items-center justify-between gap-3 border-b border-line last:border-b-0">
              <span className="flex min-w-0 flex-col">
                {r.to ? (
                  <Link to={r.to} className="truncate text-proof-small text-ink no-underline hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  <span className="truncate text-proof-small text-ink">{r.label}</span>
                )}
                {r.hint ? <span className="truncate text-proof-label text-ink-2">{r.hint}</span> : null}
              </span>
              <span className="shrink-0 text-proof-small text-ink-2 tnum">{r.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-proof-small text-ink-2">{empty}</p>
      )}
    </div>
  )
}
