import { X } from 'lucide-react'

import { Button } from '../../components/ui/Button'
import { useOwner, useProductRequests } from '../../data/hooks'
import type { Product } from '../../data/types'
import { api, type ProductRequest } from '../../lib/api'
import { setQueryData } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import { ProductImage } from './productUi'

/**
 * A product the person requested has been checked: "Added to the catalog" with Add to routine, or a quiet
 * "couldn't add". Shown once per answer (closing it, or adding the product, marks it seen).
 */
export function RequestNotice({ onAdd }: { onAdd: (p: Product) => void }) {
  const uid = useOwner()
  const { getIdToken } = useAuth()
  const requests = useProductRequests()
  const r = (requests.data ?? []).find((x) => x.status !== 'pending' && !x.seen)
  if (!r) return null

  const seen = () => {
    setQueryData<ProductRequest[]>(['product-requests', uid], (prev) => (prev ?? []).map((x) => (x.id === r.id ? { ...x, seen: true } : x)))
    void getIdToken()
      .then((t) => api.seenProductRequest(t, r.id))
      .catch(() => undefined)
  }
  const what = [r.brand, r.name].filter(Boolean).join(' ') || 'The product you asked for'
  const added = r.status === 'added' && r.product
  return (
    <section aria-label="Product request" className="card flex flex-wrap items-center gap-3 px-5 py-3.5" style={{ animation: 'wRise .35s both' }}>
      {added ? <ProductImage product={r.product!} size={40} decorative /> : null}
      <div className="flex min-w-0 flex-1 basis-[220px] flex-col gap-0.5">
        <h2 className="text-[16px] font-normal">{added ? 'Added to the catalog' : 'About your request'}</h2>
        <span className="text-[13px] leading-[1.45] text-ink-2">{added ? `${what} is in Willow now, with its ingredients and store links.` : `We couldn’t add ${what}: we couldn’t verify its ingredients.`}</span>
      </div>
      <div className="flex items-center gap-1">
        {added ? (
          <Button
            variant="outline"
            onClick={() => {
              seen()
              onAdd(r.product!)
            }}
          >
            Add to routine
          </Button>
        ) : null}
        <button type="button" onClick={seen} aria-label="Close" className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-ink/5">
          <X size={18} strokeWidth={1.6} aria-hidden />
        </button>
      </div>
    </section>
  )
}
