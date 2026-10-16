import { useId } from 'react'

import type { PromoEligibility } from '../../../../lib/api'
import { SponsoredCardView, WhySeeing } from '../../../routine/SponsoredCard'
import { exampleWhy, goalLabel, listText, previewItem, skinText } from '../../promote'

const noop = () => undefined

/**
 * The campaign as a shopper sees it: the Routine page's own card component (SponsoredCardView), drawn in the
 * shopper app's light theme, with the evidence line the api serves and the "Why am I seeing this?" words for an
 * example shopper this campaign reaches. The card is inert here (a picture of the card, not a working one).
 */
export function ShopperPreview({ product, extra, goals, skinTypes, showWhy = true }: { product: PromoEligibility; extra?: { image_url?: string | null; category?: string | null }; goals: string[]; skinTypes: string[]; showWhy?: boolean }) {
  const id = useId()
  const item = previewItem(product, extra)
  const why = exampleWhy(goals.length ? goals : product.goals, skinTypes, product.skin_types)
  return (
    <figure className="m-0 flex w-full max-w-[400px] flex-col gap-2">
      <div data-theme="light" className="flex flex-col gap-3 rounded-sm bg-canvas p-3 font-ui text-ink">
        <span className="font-mono text-[11px] text-ink-2">Willow app · Routine, under the shopper’s own routine</span>
        <div inert className="pointer-events-none select-none">
          <SponsoredCardView item={item} onWhy={noop} onView={noop} onHide={noop} headingId={`${id}-h`} />
        </div>
        {showWhy ? (
          <div className="card flex flex-col gap-2.5 p-4 text-[14px] leading-[1.5]">
            <span className="text-[15px] font-medium">Why am I seeing this?</span>
            <WhySeeing brand={product.brand} lines={why} />
          </div>
        ) : null}
      </div>
      <figcaption className="text-proof-small text-ink-2">
        Shown to people whose goals include {goals.length ? listText(goals.map(goalLabel)).toLowerCase() : 'any goal the evidence covers'}, with {skinTypes.length ? `${skinText(skinTypes).toLowerCase()} skin` : `a skin type the evidence covers (${product.skin_types.join(', ')})`}. “Why am I seeing this?” shows an example shopper; each shopper sees their own match.
      </figcaption>
    </figure>
  )
}
