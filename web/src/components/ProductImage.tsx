import { useState } from 'react'

import type { Product } from '../data/types'

type Props = {
  product: Pick<Product, 'image_url' | 'category'>
  /** Edge length in px; the tile is square. */
  size?: number
  className?: string
}

/**
 * The brand's own packshot on a quiet tile, or the category abbreviation when there is no image
 * or it fails to load. Decorative: the product name always sits next to it, so alt is empty.
 * No referrer is sent, so the brand's CDN serves it the same as a direct visit.
 */
export function ProductImage({ product, size = 48, className = '' }: Props) {
  const src = product.image_url ?? null
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const show = src !== null && failedSrc !== src
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-(--radius-control) bg-surface-2 ${className}`}
    >
      {show ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-contain mix-blend-multiply"
        />
      ) : (
        <span className="text-[11px] font-medium text-text-2">{product.category.slice(0, 3)}</span>
      )}
    </span>
  )
}
