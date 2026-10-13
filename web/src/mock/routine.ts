import type { RoutineCheck, RoutineEntry } from '../data/types'
import { CATALOG } from './catalog'

const by = (id: string) => CATALOG.find((p) => p.product_id === id)!

export const DEMO_ROUTINE: RoutineEntry[] = [
  { id: 'r1', product_id: 'bioderma-sensibio-h2o', custom_name: '', brand: by('bioderma-sensibio-h2o').brand, category: 'cleanser', key_actives: [], inci: by('bioderma-sensibio-h2o').inci, started_at: '2026-08-20', ended_at: null, slots: ['am', 'pm'], concerns: by('bioderma-sensibio-h2o').concerns, source: 'catalog' },
  { id: 'r2', product_id: 'the-ordinary-azelaic-acid-10', custom_name: '', brand: 'The Ordinary', category: 'treatment', key_actives: by('the-ordinary-azelaic-acid-10').key_actives, inci: by('the-ordinary-azelaic-acid-10').inci, started_at: '2026-09-12', ended_at: null, slots: ['am'], concerns: by('the-ordinary-azelaic-acid-10').concerns, source: 'label_scan' },
  { id: 'r6', product_id: 'the-ordinary-niacinamide-10-zinc-1', custom_name: '', brand: 'The Ordinary', category: 'serum', key_actives: by('the-ordinary-niacinamide-10-zinc-1').key_actives, inci: by('the-ordinary-niacinamide-10-zinc-1').inci, started_at: '2026-08-20', ended_at: null, slots: ['am'], concerns: by('the-ordinary-niacinamide-10-zinc-1').concerns, source: 'catalog' },
  { id: 'r3', product_id: 'dot-key-retinol-serum', custom_name: '', brand: 'Dot & Key', category: 'treatment', key_actives: by('dot-key-retinol-serum').key_actives, inci: by('dot-key-retinol-serum').inci, started_at: '2026-09-05', ended_at: null, slots: ['pm'], concerns: by('dot-key-retinol-serum').concerns, source: 'catalog' },
  { id: 'r4', product_id: 'paulas-choice-2-bha-liquid', custom_name: '', brand: "Paula's Choice", category: 'exfoliant', key_actives: by('paulas-choice-2-bha-liquid').key_actives, inci: by('paulas-choice-2-bha-liquid').inci, started_at: '2026-09-12', ended_at: null, slots: ['pm'], concerns: by('paulas-choice-2-bha-liquid').concerns, source: 'catalog' },
  { id: 'r5', product_id: 'cerave-moisturising-cream', custom_name: '', brand: 'CeraVe', category: 'moisturizer', key_actives: by('cerave-moisturising-cream').key_actives, inci: by('cerave-moisturising-cream').inci, started_at: '2026-08-20', ended_at: null, slots: ['am', 'pm'], concerns: by('cerave-moisturising-cream').concerns, source: 'catalog' },
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
