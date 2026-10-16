import type { ProofTier } from '../types'
import { TIERS } from './tiers'
import { useTooltip } from './Tooltip'

/**
 * The Proof tier of a product: Proven / Promising / No clear effect yet / Not enough data. Hover or focus shows
 * the definition, plus `hint` when given (e.g. the "what would it take" line for a Promising product).
 */
export function ProofTierChip({ tier, hint, size = 'md' }: { tier: ProofTier; hint?: string; size?: 'sm' | 'md' }) {
  const t = TIERS[tier]
  const tip = useTooltip(
    <>
      <strong className="font-medium">{t.label}.</strong> {t.text}
      {hint ? <span className="mt-1 block text-ink-2">{hint}</span> : null}
    </>,
  )
  return (
    <>
      <span
        {...tip.trigger}
        tabIndex={0}
        className={`inline-flex cursor-help items-center gap-1.5 whitespace-nowrap rounded-pill border ${tier === 'proven' ? 'border-proof-leaf-line bg-proof-leaf-soft' : 'border-line'} ${size === 'sm' ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-proof-small'} text-ink`}
      >
        <span aria-hidden className={`${t.tone} leading-none`}>
          {t.glyph}
        </span>
        {t.label}
      </span>
      {tip.node}
    </>
  )
}
