import { ArrowRightLeft, CheckCircle2, CircleDashed, Clock, Layers, Megaphone, Sparkles, TrendingUp, TriangleAlert, Users, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

import type { CardKind, DecisionCard } from '../decisions'

/* Home card helpers (no components, so Cards.tsx keeps fast refresh): the icon per insight type, a card's
   view-transition name, and the question "Ask about this" prefills. */

export const KIND_ICON: Record<CardKind, { icon: LucideIcon; tone: string }> = {
  proven_not_promoted: { icon: Megaphone, tone: 'bg-proof-leaf-soft text-proof-leaf' },
  nearly_proven: { icon: CircleDashed, tone: 'bg-pf-amber-soft text-pf-amber' },
  claim_ready: { icon: CheckCircle2, tone: 'bg-proof-leaf-soft text-proof-leaf' },
  evidence_slipped: { icon: TriangleAlert, tone: 'bg-pf-red-soft text-pf-red' },
  expectation_gap: { icon: Clock, tone: 'bg-sunken text-ink' },
  losing_switchers: { icon: ArrowRightLeft, tone: 'bg-pf-amber-soft text-pf-amber' },
  routine_clash: { icon: Layers, tone: 'bg-sunken text-ink' },
  over_shelved: { icon: TriangleAlert, tone: 'bg-pf-amber-soft text-pf-amber' },
  under_shelved: { icon: TrendingUp, tone: 'bg-proof-leaf-soft text-proof-leaf' },
  unmet_group: { icon: Users, tone: 'bg-sunken text-ink' },
  demand_shift: { icon: TrendingUp, tone: 'bg-sunken text-ink' },
  campaign_result: { icon: Sparkles, tone: 'bg-proof-leaf-soft text-proof-leaf' },
  auto_proposal: { icon: Megaphone, tone: 'bg-sunken text-ink' },
}


/** A view-transition name for a card (lane moves glide where the browser supports it). */
export const vt = (key: string) => ({ viewTransitionName: `dc-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}` }) as CSSProperties


/** The question "Ask about this" prefills for a card (≤ 300 characters, the api's limit). */
export function askAboutCard(c: Pick<DecisionCard, 'kind' | 'title' | 'product'>): string {
  const what = c.product ? `${c.product.name} (${c.product.brand})` : c.title
  const q: Partial<Record<CardKind, string>> = {
    proven_not_promoted: `Who does ${what} work best for, by skin type and goal?`,
    nearly_proven: `How close is ${what} to Proven, and which groups are still short of people?`,
    evidence_slipped: `What changed in the outcomes for ${what}?`,
    expectation_gap: `When do people using ${what} first see a change, and when do they say it works?`,
    routine_clash: `Which products are used together with ${what}, and how often?`,
    over_shelved: `How does ${what} compare with others in its category on visible change?`,
    under_shelved: `How does ${what} compare with others in its category on visible change?`,
    unmet_group: `${c.title}: which products come closest for this group?`,
    demand_shift: `${c.title}: which products serve this goal best?`,
    losing_switchers: `Which brands do people switch to from ${what}, and why might that be?`,
  }
  return (q[c.kind] ?? `Tell me more about this: ${c.title}`).slice(0, 300)
}

