import { MousePointerClick } from 'lucide-react'

import { useView } from '../useView'
import { proofApi, type ClicksView } from '../proofApi'
import type { ProductDetail } from '../types'
import { int, Panel } from '../ui'
import { FeelPanel } from './FeelPanel'

/*
 * "Store clicks, 30 days" on the product page (GET /v1/retailer/clicks?days=30): how often shoppers in the Willow
 * app tapped through to a store for this product, per store. Public aggregate; groups under 10 come back as
 * "<10" and are shown that way. Nothing is shown when this api build has no click counts.
 */

const show = (v: number | string) => (typeof v === 'number' ? int(v) : v)

/** How it feels beside the store clicks; the feel panel takes the row alone when there are no click counts. */
export function FeelAndClicks({ x }: { x: ProductDetail }) {
  const v = useView<ClicksView>('store-clicks|30', () => proofApi.clicks(30))
  if (v.status !== 'ready') return <FeelPanel x={x} />
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-8">
        <FeelPanel x={x} />
      </div>
      <div className="min-w-0 lg:col-span-4">
        <StoreClicks productId={x.product.product_id} data={v.data} />
      </div>
    </div>
  )
}

function StoreClicks({ productId, data }: { productId: string; data: ClicksView }) {
  const v = { data }
  const total = v.data.products.find((p) => p.product_id === productId)
  const stores = v.data.items.filter((i) => i.product_id === productId)
  return (
    <Panel title="Store clicks, 30 days" id="clicks-h" description="Taps from the Willow app through to a store. A click is not a sale; Proof sees no checkout." meta={total ? <span className="text-proof-small text-ink-2 tnum">{show(total.clicks)} in all</span> : null}>
      {stores.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {stores.map((s) => (
            <li key={s.store} className="flex items-center justify-between gap-3 border-b border-line py-2 text-proof-small last:border-b-0">
              <span className="flex items-center gap-2 text-ink">
                <MousePointerClick size={14} strokeWidth={1.7} aria-hidden className="text-ink-2" /> {s.store}
              </span>
              <span className="text-ink tnum">{show(s.clicks)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-proof-small text-ink-2">No store clicks for this product in the last 30 days.</p>
      )}
      <p className="m-0 pt-2 text-proof-label text-ink-2">Groups under 10 clicks show as “&lt;10”.</p>
    </Panel>
  )
}
