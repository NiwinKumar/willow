import { Droplet } from 'lucide-react'
import { useState } from 'react'

import type { Product } from '../data/types'

type Props = {
  product: Pick<Product, 'image_url' | 'category'>
  /** Edge length in px; the tile is square. */
  size?: number
  className?: string
}

/** Ask image CDNs that support it for a copy near the tile size (2x for retina), not the 1600 px original. */
function sized(url: string, px: number): string {
  try {
    const u = new URL(url)
    if (u.pathname.includes('/cdn/shop/') || u.hostname === 'cdn.shopify.com') u.searchParams.set('width', String(px))
    else if (u.pathname.includes('/dw/image/')) u.searchParams.set('sw', String(px))
    else if (u.hostname === 'media.ulta.com') {
      u.searchParams.set('w', String(px))
      u.searchParams.set('h', String(px))
    } else return url
    return u.toString()
  } catch {
    return url
  }
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
          src={sized(src, size * 2)}
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
        <Droplet size={Math.round(size * 0.4)} aria-hidden className="text-text-3" strokeWidth={1.5} />
      )}
    </span>
  )
}
