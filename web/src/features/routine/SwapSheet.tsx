import { useState } from 'react'

import { Sheet } from '../../components/ui/Sheet'
import { ProductImage } from '../../components/willow/ProductImage'
import { useOwner } from '../../data/hooks'
import type { Product } from '../../data/types'
import { request } from '../../lib/api'
import { categoryLabel } from '../../lib/catalog'
import { fmtPrice } from '../../lib/format'
import { useQuery } from '../../lib/query'
import { useChecks, type ProductCheck } from '../../lib/safety'
import { ProductChecked } from './checked'

/** What "See a swap" was pressed on. */
export type SwapTarget = { product_id: string; name: string }

type Swap = { product: Product; why: string[]; check?: ProductCheck }
type Raw = { product?: Product; why?: string | string[]; score?: number; check?: ProductCheck } & Partial<Product>

/** Tolerant of the list's wrapper ({items}, {swaps} or a bare array) and of items that are the product itself. */
function parse(res: unknown): Swap[] {
  const list = (Array.isArray(res) ? res : ((res as { items?: unknown[]; swaps?: unknown[] } | null)?.items ?? (res as { swaps?: unknown[] } | null)?.swaps ?? [])) as Raw[]
  return list
    .map((x): Swap | null => {
      const product = (x.product ?? (x.product_id ? x : null)) as Product | null
      const why = Array.isArray(x.why) ? x.why : x.why ? [x.why] : []
      return product ? { product, why, check: x.check ?? (product as Product & { check?: ProductCheck }).check } : null
    })
    .filter((x): x is Swap => Boolean(x))
}

/**
 * "See a swap" (GET /v1/catalog/{id}/swaps, and /similar when the api has it): catalog products with the same
 * key active at a similar strength, ordered by price, each with its "checked for you" chip. Same active is
 * not the same result, so the sheet says so.
 */
export function SwapSheet({ target, market, onClose, onView }: { target: SwapTarget | null; market?: string | null; onClose: () => void; onView: (p: Product) => void }) {
  return (
    <Sheet open={target !== null} onClose={onClose} title="See a swap" variant="modal" size="md">
      {target ? <Swaps key={target.product_id} target={target} market={market ?? null} onView={onView} /> : null}
    </Sheet>
  )
}

function Swaps({ target, market, onView }: { target: SwapTarget; market: string | null; onView: (p: Product) => void }) {
  const uid = useOwner()
  const qs = new URLSearchParams({ max: '6', ...(market ? { market } : {}) }).toString()
  const swaps = useQuery(['swaps', target.product_id, market], (t) => request<unknown>(t, `/v1/catalog/${encodeURIComponent(target.product_id)}/swaps?${qs}`).then(parse), { enabled: Boolean(uid), staleMs: 30 * 60_000 })
  // Optional: the embeddings neighbours (absent on older apis; a failure just hides the section).
  const similar = useQuery(['similar', target.product_id], (t) => request<unknown>(t, `/v1/catalog/${encodeURIComponent(target.product_id)}/similar`).then(parse).catch(() => [] as Swap[]), { enabled: Boolean(uid), staleMs: 30 * 60_000 })
  const [more, setMore] = useState(false)
  const shown = new Set((swaps.data ?? []).map((s) => s.product.product_id))
  const near = (similar.data ?? []).filter((s) => s.product.product_id !== target.product_id && !shown.has(s.product.product_id)).slice(0, more ? 6 : 3)
  const checks = useChecks([...(swaps.data ?? []), ...near].map((s) => s.product.product_id))
  const checkOf = (s: Swap) => s.check ?? checks.checks[s.product.product_id]

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[14px] leading-[1.5] text-ink-2">Instead of {target.name}: same active at a similar strength. A different formula, so not identical.</span>
      {swaps.status === 'loading' || swaps.status === 'idle' ? (
        <div aria-busy aria-label="Finding swaps" className="flex flex-col gap-2">
          {[0, 1, 2].map((k) => (
            <span key={k} className="skeleton block h-[68px] rounded-[20px]" />
          ))}
        </div>
      ) : swaps.status === 'error' && !swaps.data ? (
        <p role="alert" className="m-0 rounded-[16px] bg-sunken px-4 py-3 text-[14px]">
          Swaps didn’t load.{' '}
          <button type="button" onClick={() => void swaps.refetch()} className="underline underline-offset-4">
            Try again
          </button>
        </p>
      ) : (swaps.data ?? []).length === 0 ? (
        <p className="m-0 rounded-[16px] bg-sunken px-4 py-3 text-[14px] leading-[1.5]">No product in the catalog has the same active at a similar strength in this category yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(swaps.data ?? []).map((s, i) => (
            <SwapRow key={s.product.product_id} s={s} i={i} check={checkOf(s)} loading={checks.status === 'loading'} onView={onView} />
          ))}
        </ul>
      )}
      {near.length ? (
        <div className="flex flex-col gap-2 pt-1">
          <span className="text-[13px] text-ink-2">Similar formula</span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {near.map((s, i) => (
              <SwapRow key={s.product.product_id} s={{ ...s, why: [] }} i={i} check={checkOf(s)} loading={checks.status === 'loading'} onView={onView} />
            ))}
          </ul>
          {(similar.data ?? []).length > 3 && !more ? (
            <button type="button" onClick={() => setMore(true)} className="min-h-10 self-start text-[13px] text-ink-2 underline underline-offset-4">
              Show more
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SwapRow({ s, i, check, loading, onView }: { s: Swap; i: number; check: ProductCheck | undefined; loading: boolean; onView: (p: Product) => void }) {
  const p = s.product
  return (
    <li className="flex items-center gap-3 rounded-[20px] bg-sunken p-2.5" style={{ animation: `wRise .4s ${Math.min(i, 8) * 60}ms both` }}>
      <ProductImage product={p} size={44} decorative />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12px] text-ink-2">
          {p.brand} · {categoryLabel(p.category)}
        </span>
        <span className="text-[14.5px] leading-snug">{p.name}</span>
        {s.why.length ? <span className="text-[12.5px] leading-[1.4] text-ink-2">{s.why.join(' · ')}</span> : null}
        <ProductChecked check={check} loading={loading} inDialog />
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="tnum text-[14px]">{fmtPrice(p.price)}</span>
        <button type="button" onClick={() => onView(p)} className="hit44 min-h-8 rounded-pill bg-selected px-3 text-[12.5px] text-inverse transition-[scale] duration-200 ease-standard active:scale-[.97]">
          View
        </button>
      </span>
    </li>
  )
}
