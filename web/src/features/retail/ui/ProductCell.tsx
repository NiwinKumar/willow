import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { ProductImage } from '../../routine/productUi'
import { BrandLogo } from './BrandLogo'

/**
 * A product as a table or list cell: the catalog packshot on its fixed round plate (the category orb when there
 * is none or it fails), the name truncated with the full name as a tooltip, and the brand under it. `tag` sits
 * after the brand (e.g. "Yours"); `to` makes the name a link (lists outside a clickable row). `logo` puts the
 * brand's logo (14 px) before the brand line; pass the name as shown (an anonymised "Brand A" gets its monogram).
 */
export function ProductCell({ p, size = 32, tag, to, sub, logo = false }: { p: { product: string; brand: string; category: string; image_url?: string | null }; size?: number; tag?: ReactNode; to?: string; sub?: ReactNode; logo?: boolean }) {
  const name = to ? (
    <Link to={to} className="block min-w-0 truncate font-medium text-ink no-underline hover:underline">
      {p.product}
    </Link>
  ) : (
    <span className="block min-w-0 truncate font-medium text-ink">{p.product}</span>
  )
  return (
    <span className="flex min-w-0 items-center gap-3" title={`${p.product} · ${p.brand}`}>
      <ProductImage product={{ image_url: p.image_url, category: p.category, name: p.product }} size={size} decorative />
      <span className="flex min-w-0 flex-col gap-0.5">
        {name}
        <span className="flex min-w-0 items-center text-proof-label text-ink-2">
          {logo ? <BrandLogo brand={p.brand} size={14} className="mr-1.5" /> : null}
          <span className="truncate">{p.brand}</span>
          {tag}
          {sub ? <span className="ml-1.5 shrink-0">{sub}</span> : null}
        </span>
      </span>
    </span>
  )
}
