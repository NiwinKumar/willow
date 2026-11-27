import { csvMeta, csvName } from '../../data'
import type { Insights, Segments } from '../../types'
import { DataTable, HeadTip, int, MIN_GROUP, Panel, pct, ProductCell, RateCell, ShareBar, Suppressed, type Column } from '../../ui'
import { rateInterval, topUnmet } from '../../ui/insight'
import { YoursTag } from '../shared'

/*
 * Skin types (by_skin): one row each, with its people, the goal it is least served on (the matrix's worst cell in
 * its row) and the product that works best for it (top by lift). A row opens the skin type's drawer (`skin` in the URL) with every top product.
 */

type SkinRow = Segments['by_skin'][number]

export function SkinTypes({ s, d, selected, onOpen, mine }: { s: Segments; d: Insights; selected: string | null; onOpen: (skin: string) => void; mine: string | null }) {
  const unmet = topUnmet(s, Infinity)
  const worstOf = (skin: string) => unmet.find((c) => c.skin === skin) ?? null
  const columns: Column<SkinRow>[] = [
    { id: 'skin', header: 'Skin type', rowHeader: true, width: '15%', sortValue: (r) => r.label, cell: (r) => <span className="font-medium text-ink">{r.label}</span> },
    { id: 'people', header: 'People', align: 'right', width: '10%', sortValue: (r) => r.users, cell: (r) => (r.users === null ? <Suppressed short /> : <span className="tnum">{int(r.users)}</span>), csv: (r) => r.users ?? 'suppressed' },
    {
      // Every skin type's three most-chosen goals were the same three at ~30% each: no information. The goal each
      // skin type is least served on tells a buyer what to source for it.
      id: 'gap',
      header: <HeadTip label="Least served goal" tip="The goal where the largest share of people with this skin type saw no visible change by week 8 (groups of 10+ people)." />,
      headerText: 'Least served goal (share with no visible change by week 8)',
      width: '34%',
      sortValue: (r) => worstOf(r.skin)?.unmet ?? null,
      cell: (r) => {
        const w = worstOf(r.skin)
        if (!w) return <span className="text-proof-small text-ink-2">No goal with {MIN_GROUP}+ people</span>
        return (
          <span className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-ink">{w.goalLabel}</span>
            <span className="w-24 shrink-0">
              <ShareBar value={w.unmet} max={1} />
            </span>
            <span className="w-[120px] shrink-0 text-right text-proof-small text-ink-2 tnum">
              <span className="font-medium text-ink">{pct(w.unmet)}</span> no change
            </span>
          </span>
        )
      },
      csv: (r) => {
        const w = worstOf(r.skin)
        return w ? `${w.goalLabel} ${Math.round(w.unmet * 100)}% no visible change of ${w.users}` : ''
      },
    },
    {
      id: 'top',
      header: <HeadTip label="Works best for them" tip="The product with the largest lift for this skin type: the share of its users with this skin type who saw a visible change by week 8, and n." />,
      headerText: 'Product that works best for them, by lift (brand)',
      width: '35%',
      cell: (r) => {
        const p = r.top_products[0]
        if (!p) return <span className="text-proof-small text-ink-2">None with {MIN_GROUP}+ users</span>
        const ci = rateInterval(p.rate, p.n)
        return (
          <span className="flex min-w-0 items-center justify-between gap-3">
            <ProductCell p={{ product: p.product, brand: p.brand, category: '', image_url: p.image_url }} size={28} logo tag={mine === p.brand ? <YoursTag /> : undefined} />
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
        minWidth={940}
      />
    </Panel>
  )
}
