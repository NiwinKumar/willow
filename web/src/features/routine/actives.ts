/**
 * What a product's key actives mean for using it, read from the catalog's key_actives (pure, no network):
 *  - strong actives (retinoids, exfoliating acids, vitamin C, benzoyl peroxide, azelaic acid) get the
 *    patch-test / start-slow / sunscreen card when added;
 *  - the evidence clock's entry for the product's main active sets "Verdict due <date>";
 *  - basics (cleanser, moisturiser, sunscreen) never get a verdict date or a "stop" verdict: they do their job
 *    every day and show nothing measurable by design.
 */
import type { RoutineEntry } from '../../data/types'
import { parseDate } from '../../lib/format'
import type { EvidenceClock, EvidenceEntry } from '../../lib/safety'

export type { EvidenceClock }
type ClockRow = EvidenceEntry

type Actives = { name: string; pct: number | null }[]

export const BASICS = new Set(['cleanser', 'moisturizer', 'sunscreen'])
export const isBasic = (category: string) => BASICS.has(category)

// Sunscreen filters (ethylhexyl/octyl salicylate, homosalate) are not exfoliating acids.
const STRONG: { id: string; label: string; re: RegExp }[] = [
  { id: 'retinoid', label: 'a retinoid', re: /retin(ol|al|yl|aldehyde)|adapalene|tretinoin|hydroxypinacolone retinoate/ },
  { id: 'aha', label: 'an exfoliating acid (AHA)', re: /glycolic|lactic acid|mandelic|malic acid|\(aha\)/ },
  { id: 'bha', label: 'an exfoliating acid (BHA)', re: /^salicylic acid|betaine salicylate|capryloyl salicylic|\blha\b|silanediol salicylate/ },
  { id: 'pha', label: 'an exfoliating acid (PHA)', re: /gluconolactone|lactobionic/ },
  { id: 'vitamin_c', label: 'vitamin C', re: /ascorb/ },
  { id: 'benzoyl_peroxide', label: 'benzoyl peroxide', re: /benzoyl peroxide/ },
  { id: 'azelaic', label: 'azelaic acid', re: /azelaic/ },
]

/** The strong-active families a product contains, in plain words ("a retinoid", "vitamin C"). */
export function strongActives(actives: Actives): string[] {
  const names = actives.map((a) => a.name.toLowerCase())
  return STRONG.filter((s) => names.some((n) => s.re.test(n))).map((s) => s.label)
}

// Clock keys whose catalog names differ from the key itself.
const ALIAS: Record<string, RegExp> = {
  vitamin_c: /ascorb/,
  retinol: /retinol|retinyl|hydroxypinacolone retinoate/,
  retinal: /retinal/,
  hyaluronic: /hyalur/,
  hyaluronic_acid: /hyalur/,
  centella: /centella|madecass|cica/,
  alpha_arbutin: /arbutin/,
  arbutin: /arbutin/,
  peptides: /peptide/,
  aha: /glycolic|lactic acid|mandelic|malic acid|\(aha\)/,
  kojic_acid: /kojic/,
  azelaic_acid: /azelaic/,
  tranexamic_acid: /tranexamic/,
  ceramides: /ceramide/,
  salicylic: /^salicylic acid|betaine salicylate|capryloyl salicylic|\blha\b/,
  salicylic_acid: /^salicylic acid|betaine salicylate|capryloyl salicylic|\blha\b/,
}
const matcher = (key: string) => ALIAS[key] ?? new RegExp(key.replace(/_/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

/**
 * The product's clocked active: the first key active (catalog order = main first) that the clock has a row
 * for. Unlike lib/safety's clockFor it knows catalog spellings (ascorbic acid → vitamin_c) and skips basics.
 */
export function clockedActive(category: string, actives: Actives, clock: EvidenceClock | null | undefined): { active: string; row: ClockRow } | null {
  if (!clock || isBasic(category)) return null
  const keys = Object.keys(clock.actives)
  for (const a of actives) {
    const n = a.name.toLowerCase()
    const k = keys.find((key) => matcher(key).test(n))
    const row = k ? clock.actives[k] : null
    if (row?.verdict_weeks) return { active: a.name, row }
  }
  return null
}

const addWeeks = (iso: string, w: number) => {
  const d = parseDate(iso.slice(0, 10))
  d.setDate(d.getDate() + w * 7)
  return d
}

/** "Verdict due" for a routine entry with a clocked active: its start date plus the active's verdict weeks. */
export function verdictDue(e: Pick<RoutineEntry, 'category' | 'key_actives' | 'started_at'>, clock: EvidenceClock | null | undefined): { due: Date; firstLook: Date; weeks: number; active: string; row: ClockRow } | null {
  const c = clockedActive(e.category, e.key_actives, clock)
  if (!c || !c.row.verdict_weeks) return null
  return { due: addWeeks(e.started_at, c.row.verdict_weeks), firstLook: addWeeks(e.started_at, c.row.first_look_weeks), weeks: c.row.verdict_weeks, active: c.active, row: c.row }
}

/** A routine entry carries `sample: true` when the guest starter routine made it (api demo.py). */
export { isSample } from './sampleRoutine'
