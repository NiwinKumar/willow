import { Camera } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useOwner, useProductRequests } from '../../data/hooks'
import type { Product } from '../../data/types'
import { api, type ProductRequest } from '../../lib/api'
import { needsFactsRequest } from '../../lib/catalog'
import { packImage } from '../../lib/image'
import { setQueryData } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import { failureText } from './writes'

/** person|product pairs already asked for this session, so reopening the sheet never asks twice. */
const queued = new Set<string>()

/**
 * An index product (the catalog knows it by name only, without its ingredient list): one compact line saying its
 * full facts are coming, and "Scan the label", the same pack-photo reading as Request a product. The label is
 * read first (a blurry or different product's label is caught here), then sent with the request for its facts.
 * Opening the sheet also queues that request once (POST /v1/product-requests {product_id}; asking again answers
 * the same request), so the people who look at a product move it up the list.
 */
export function FullFactsComing({ product }: { product: Product }) {
  const { getIdToken } = useAuth()
  const uid = useOwner()
  const requests = useProductRequests()
  const [state, setState] = useState<'idle' | 'reading' | 'sent'>('idle')
  const [note, setNote] = useState<string | null>(null)
  const id = product.product_id

  const keep = (made: ProductRequest) => setQueryData<ProductRequest[]>(['product-requests', uid], (prev) => [made, ...(prev ?? []).filter((r) => r.id !== made.id)])

  useEffect(() => {
    if (!uid || requests.status !== 'ready' || !needsFactsRequest(product, requests.data)) return
    const key = `${uid}|${id}`
    if (queued.has(key)) return
    queued.add(key)
    getIdToken()
      .then((t) => api.requestProduct(t, { product_id: id }))
      .then(keep)
      .catch(() => {
        /* in the background: the line still says the facts are coming, and the next opening asks again */
        queued.delete(key)
      })
    // keep: a new function each render, and only the request list's arrival matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, id, requests.status, requests.data, getIdToken])

  const scan = async (file: File | undefined) => {
    if (!file) return
    setNote(null)
    setState('reading')
    try {
      const img = await packImage(file).catch(() => {
        throw new Error('photo')
      })
      const token = await getIdToken()
      const read = await api.labelScan(token, [img])
      if (read.scan.failure && !read.scan.inci.length) {
        setNote('That photo is hard to read. Try again with the ingredient list flat, in focus and out of glare.')
        setState('idle')
        return
      }
      if (read.match && read.match.product_id !== id) {
        setNote(`That label reads as ${read.match.brand} ${read.match.name}, not this product. Try the right pack.`)
        setState('idle')
        return
      }
      keep(await api.requestProduct(token, { product_id: id, photo: img }))
      setState('sent')
    } catch (e) {
      setNote(e instanceof Error && e.message === 'photo' ? 'That photo could not be opened. Try another photo of the label.' : failureText(e, "Couldn't send the label. Try again."))
      setState('idle')
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-[20px] bg-sunken px-4 py-3" style={{ animation: 'wRise .4s var(--ease-standard) both' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13.5px] leading-[1.45]">
          <span className="text-ink">Full facts coming</span>
          <span className="text-ink-2"> · its ingredient list isn’t in Willow yet, so it hasn’t been checked for you.</span>
        </span>
        {state === 'sent' ? (
          <span role="status" className="text-[13px] text-ink-2">
            ✓ Label sent
          </span>
        ) : (
          <label className={`${state === 'reading' ? 'pointer-events-none opacity-55' : 'cursor-pointer'} relative inline-flex min-h-10 shrink-0 items-center gap-2 rounded-pill bg-white px-4 text-[14px] shadow-[inset_0_0_0_1px_var(--line-subtle)]`}>
            <Camera size={16} aria-hidden />
            {state === 'reading' ? 'Reading the label…' : 'Scan the label'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={state === 'reading'}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                void scan(file)
              }}
            />
          </label>
        )}
      </div>
      {state === 'sent' ? <span className="text-[12.5px] leading-[1.45] text-ink-2">We check the label by hand and add its ingredients, then tell you. Until then it shows as Not checked yet.</span> : null}
      {note ? (
        <span role="alert" className="text-[12.5px] leading-[1.45] text-avoid">
          {note}
        </span>
      ) : null}
    </div>
  )
}
