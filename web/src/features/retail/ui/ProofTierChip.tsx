import type { ProofTier } from '../types'
import { TIERS } from './tiers'
import { useTooltip } from './Tooltip'

const TONE: Record<ProofTier, { chip: string; dot: string }> = {
  proven: { chip: 'bg-proof-leaf-soft text-proof-leaf', dot: 'bg-proof-leaf' },
  promising: { chip: 'bg-pf-amber-soft text-pf-amber', dot: 'bg-pf-amber' },
  unclear: { chip: 'bg-sunken text-ink-2', dot: 'bg-ink-3' },
  too_few: { chip: 'border border-line text-ink-2', dot: 'border border-ink-3 bg-transparent' },
}

/**
 * A product's Proof status, read like a deployment status: Proven (green), Promising (amber), No clear effect
 * yet (gray), Not enough data (hollow). Dot plus word, never colour alone; hover or focus gives the definition,
 * plus `hint` (e.g. how many more people would settle a Promising product).
 */
export function ProofTierChip({ tier, hint, size = 'md' }: { tier: ProofTier; hint?: string; size?: 'sm' | 'md' }) {
  const t = TIERS[tier]
  const tone = TONE[tier]
  const tip = useTooltip(
    <>
      <strong className="font-medium">{t.label}.</strong> {t.text}
      {hint ? <span className="mt-1 block text-ink-2">{hint}</span> : null}
    </>,
  )
  return (
    <>
      <span {...tip.trigger} tabIndex={0} className={`inline-flex cursor-help items-center gap-1.5 whitespace-nowrap rounded-pill font-medium ${tone.chip} ${size === 'sm' ? 'h-[22px] px-2 text-proof-label' : 'h-6 px-2.5 text-proof-label'}`}>
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} />
        {t.label}
      </span>
      {tip.node}
    </>
  )
}

/** Just the status dot (dense lists where the word is in a column header or beside it). */
export function TierDot({ tier }: { tier: ProofTier }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${TONE[tier].dot}`} />
}
