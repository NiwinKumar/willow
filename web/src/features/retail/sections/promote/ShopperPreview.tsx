import { useId } from 'react'

import type { PromoEligibility } from '../../../../lib/api'
import { SponsoredCardView, WhySeeing } from '../../../routine/SponsoredCard'
import { exampleWhy, previewItem } from '../../promote'

const noop = () => undefined

/**
 * The campaign as a shopper sees it: the Routine page's own card component (SponsoredCardView), drawn in the
 * shopper app's light theme whatever Proof's theme is, with the evidence line the api serves and the "Why am I
 * seeing this?" words for an example shopper this campaign reaches. Inert: a picture of the card, not a working one.
 */
export function ShopperPreview({ product, extra, goals, skinTypes }: { product: PromoEligibility; extra?: { image_url?: string | null; category?: string | null }; goals: string[]; skinTypes: string[] }) {
  const id = useId()
  const item = previewItem(product, extra)
  const why = exampleWhy(goals.length ? goals : product.goals, skinTypes, product.skin_types)
  return (
    <figure className="m-0 flex w-full flex-col gap-2">
      <div data-theme="light" className="flex flex-col gap-3 rounded-card border border-line bg-canvas p-4 font-ui text-ink">
        <div inert className="pointer-events-none select-none">
          <SponsoredCardView item={item} onWhy={noop} onView={noop} onHide={noop} headingId={`${id}-h`} />
        </div>
        <div className="card flex flex-col gap-2.5 p-4 text-[14px] leading-[1.5]">
          <span className="text-[15px] font-medium">Why am I seeing this?</span>
          <WhySeeing brand={product.brand} lines={why} />
        </div>
      </div>
      <figcaption className="text-proof-small text-ink-2">On the shopper’s Routine page, under their own routine. “Why am I seeing this?” is shown for an example shopper; each shopper sees their own match.</figcaption>
    </figure>
  )
}
