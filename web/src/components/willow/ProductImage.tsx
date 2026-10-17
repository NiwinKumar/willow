import { useState, type ReactNode } from 'react'

import { CategoryOrb } from './CategoryOrb'
import { sizedImage } from './productVisual'

/**
 * A product's packshot, linked from the brand or retailer page it is already published on (never copied),
 * filling a round frame (cropped to the circle, like an avatar); the category orb when there is none (own and label-scan products)
 * or it fails to load. `muted` is the routine's "not ticked yet" look, `rest` the fainter "rests today".
 * No referrer is sent, so the brand's CDN serves it as it would a direct visit.
 */
export function ProductImage({ product, size, muted = false, rest = false, breathe = false, decorative = false, fallback, className = '' }: {
  product: { image_url?: string | null; category: string; name: string }
  size: number
  muted?: boolean
  rest?: boolean
  breathe?: boolean
  /** The product's name is already the text of the same control: empty alt, so it is not read twice. */
  decorative?: boolean
  /** Replaces the category orb as the no-photo look (Home draws its own orbs). */
  fallback?: ReactNode
  className?: string
}) {
  const src = product.image_url || null
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <>{fallback ?? <CategoryOrb category={product.category} size={size} muted={muted} rest={rest} breathe={breathe} />}</>
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-white transition-[opacity,filter,box-shadow] duration-300 ${breathe ? 'animate-breathe' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        opacity: muted ? (rest ? 0.32 : 0.55) : 1,
        filter: muted ? 'saturate(.35)' : 'none',
        boxShadow: `inset 0 0 0 1px rgba(18,18,18,.06)${muted ? '' : `, 0 ${size / 5}px ${size / 3}px -${size / 7}px rgba(18,18,18,.35)`}`,
      }}
    >
      <img
        src={sizedImage(src, size * 2)}
        alt={decorative ? '' : product.name}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className="size-full object-cover"
      />
    </span>
  )
}
