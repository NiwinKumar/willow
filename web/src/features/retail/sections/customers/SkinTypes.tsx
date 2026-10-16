import { csvMeta, csvName } from '../../data'
import type { Insights, Segments } from '../../types'
import { DataTable, int, MIN_GROUP, Panel, pct, ProductCell, RateCell, ShareBar, Suppressed, type Column } from '../../ui'
import { rateInterval } from '../../ui/insight'
import { YoursTag } from '../shared'

/*
 * Skin types (by_skin): one row each, with its people, its three most-chosen goals as share bars, and its top
 * product by lift. A row opens the skin type's drawer (`skin` in the URL) with every top product.
 */

type SkinRow = Segments['by_skin'][number]

export function SkinTypes({ s, d, selected, onOpen, mine }: { s: Segments; d: Insights; selected: string | null; onOpen: (skin: string) => void; mine: string | null }) {
  const columns: Column<SkinRow>[] = [
    { id: 'skin', header: 'Skin type', rowHeader: true, width: '15%', sortValue: (r) => r.label, cell: (r) => <span className="font-medium text-ink">{r.label}</span> },
    { id: 'people', header: 'People', align: 'right', width: '10%', sortValue: (r) => r.users, cell: (r) => (r.users === null ? <Suppressed short /> : <span className="tnum">{int(r.users)}</span>), csv: (r) => r.users ?? 'suppressed' },
    {
      id: 'goals',
      header: 'Top goals',
      headerText: 'Top goals (share of the skin type)',
      width: '40%',
      cell: (r) => {
        if (!r.top_goals.length) return <span className="text-proof-small text-ink-2">No goal with {MIN_GROUP}+ people</span>
        const max = Math.max(0.01, ...r.top_goals.map((g) => g.share))
        return (
          <span className="grid grid-cols-3 gap-4 pr-2">
            {r.top_goals.slice(0, 3).map((g) => (
              <span key={g.goal_id} className="flex min-w-0 flex-col gap-1">
                <span className="flex min-w-0 items-baseline justify-between gap-2 text-proof-label">
                  <span className="truncate text-ink">{g.label}</span>
                  <span className="shrink-0 text-ink-2 tnum">{pct(g.share)}</span>
                </span>
                <ShareBar value={g.share} max={max} />
              </span>
            ))}
          </span>
        )
      },
      csv: (r) => r.top_goals.map((g) => `${g.label} ${Math.round(g.share * 100)}%`).join('; '),
    },
    {
      id: 'top',
      header: 'Top product',
      headerText: 'Top product by lift (brand)',
      width: '35%',
      cell: (r) => {
        const p = r.top_products[0]
        if (!p) return <span className="text-proof-small text-ink-2">None with {MIN_GROUP}+ users</span>
        const ci = rateInterval(p.rate, p.n)
        return (
          <span className="flex min-w-0 items-center justify-between gap-3">
            <ProductCell p={{ product: p.product, brand: p.brand, category: '', image_url: p.image_url }} size={28} tag={mine === p.brand ? <YoursTag /> : undefined} />
            <RateCell rate={p.rate} n={p.n} lo={ci?.lo} hi={ci?.hi} />
          </span>
        )
      },
      csv: (r) => (r.top_products[0] ? `${r.top_products[0].product} (${r.top_products[0].brand}) ${Math.round(r.top_products[0].rate * 100)}% n=${r.top_products[0].n}` : ''),
    },
  ]
  return (
    <Panel flush>
      <DataTable
        caption="Skin types"
        heading={<h2 className="m-0 text-proof-h text-ink">Skin types</h2>}
        columns={columns}
        rows={s.by_skin}
        rowKey={(r) => r.skin}
        selectedKey={selected}
        onRowClick={(r) => onOpen(r.skin)}
        rowLabel={(r) => `${r.label} skin: open goals and top products`}
        defaultSort={{ id: 'people', dir: 'desc' }}
        csv={{ name: csvName('customers-skin-types', d), meta: csvMeta(s) }}
        minWidth={820}
      />
    </Panel>
  )
}
