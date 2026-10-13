import type { RoutineCheck, RoutineEntry } from '../data/types'
import { CATALOG } from './catalog'

const by = (id: string) => CATALOG.find((p) => p.product_id === id)!
const entry = (id: string, productId: string, startedAt: string, slots: ('am' | 'pm')[], source: RoutineEntry['source']): RoutineEntry => {
  const p = by(productId)
  return { id, product_id: p.product_id, custom_name: '', brand: p.brand, category: p.category, key_actives: p.key_actives, inci: p.inci, started_at: startedAt, ended_at: null, slots, concerns: p.concerns, source }
}

export const DEMO_ROUTINE: RoutineEntry[] = [
  entry('r1', 'bioderma-sensibio-h2o-micellar-water', '2026-08-20', ['am', 'pm'], 'catalog'),
  entry('r2', 'the-ordinary-azelaic-acid-suspension-10', '2026-09-12', ['am'], 'label_scan'),
  entry('r6', 'the-ordinary-niacinamide-10-zinc-1', '2026-08-20', ['am'], 'catalog'),
  entry('r3', 'minimalist-retinol-0-3-face-serum', '2026-09-05', ['pm'], 'catalog'),
  entry('r4', 'paulas-choice-skin-perfecting-2-bha-liquid-exfoliant', '2026-09-12', ['pm'], 'catalog'),
  entry('r5', 'cerave-pm-facial-moisturizing-lotion', '2026-08-20', ['am', 'pm'], 'catalog'),
]

/** Rule-table result for the demo routine (docs/GEMINI_SPEC.md section 4). */
export const DEMO_CHECK: RoutineCheck = {
  conflicts: [
    { products: ['r3', 'r4'], issue: 'A retinoid and a BHA exfoliant in the same evening routine can irritate.', severity: 'caution', suggestion: 'Alternate nights: retinol one night, the BHA the next.', source: 'rule' },
  ],
  duplicates: [],
  gaps: [{ need: 'Daily sunscreen in the morning', why: 'Retinoids and exfoliating acids make skin more sun-sensitive.', suggestion: 'Add an SPF 50 to the AM routine.' }],
  notes: ['Niacinamide and vitamin C are fine together; that pairing is not flagged.'],
}
