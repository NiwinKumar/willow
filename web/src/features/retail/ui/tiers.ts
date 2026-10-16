import type { ProofTier } from '../types'

/** Glyph + word, never colour alone (docs/DESIGN.md "Verdicts & confidence"). One hue (Proof leaf) for evidence. */
export const TIERS: Record<ProofTier, { label: string; glyph: string; text: string; tone: string }> = {
  proven: {
    label: 'Proven',
    glyph: '●',
    text: '30+ people, and the lift over non-users stays above zero across its 95% interval.',
    tone: 'text-proof-leaf',
  },
  promising: {
    label: 'Promising',
    glyph: '◐',
    text: '10+ people and a positive lift, but the interval still includes zero. More people would settle it.',
    tone: 'text-proof-leaf',
  },
  unclear: {
    label: 'No clear effect yet',
    glyph: '○',
    text: '10+ people, but no lift over non-users (or fewer than 10 non-users to compare with).',
    tone: 'text-ink-2',
  },
  too_few: {
    label: 'Not enough data',
    glyph: '—',
    text: 'Fewer than 10 people with 8 weeks of readings used it, so no number is shown.',
    tone: 'text-ink-2',
  },
}
