import { useMemo } from 'react'

import type { RoutineCheck, RoutineEntry } from '../../data/types'
import { useData } from '../../data/useData'
import { categoryLabel } from '../../lib/catalog'
import { OUTCOME_SITES } from '../../lib/outcome'

// Product visuals: the packshot where the catalog has one, else the category orb (components/willow).
export { categoryOf, orbGradient } from '../../components/willow/productVisual'

/** What ProductImage needs to draw a routine entry. */
export const imageOf = (e: Pick<RoutineEntry, 'image_url' | 'category' | 'custom_name' | 'brand'>) => ({ image_url: e.image_url ?? null, category: e.category, name: entryName(e) })

export const entryName = (e: Pick<RoutineEntry, 'custom_name' | 'brand'>) => e.custom_name || e.brand || 'Unnamed product'
export { compactName } from './names'
export const activeLabel = (a: { name: string; pct: number | null }) => {
  const n = a.name.charAt(0).toUpperCase() + a.name.slice(1)
  return a.pct !== null ? `${n} ${a.pct}%` : n
}
export const metaLine = (brand: string, category: string, size?: string) => [brand, categoryLabel(category), size].filter(Boolean).join(' · ')

/** "Morning", "Evening", "Morning and evening" for a set of slots. */
export const slotWords = (slots: ('am' | 'pm')[]) => (slots.length === 2 ? 'Morning and evening' : slots[0] === 'am' ? 'Morning' : 'Evening')

/**
 * One finding of the routine check in the design's shape. Severity uses the design's Low / Moderate / High
 * words and glyphs (never colour alone): api conflicts carry info | caution | avoid_same_routine;
 * duplicates have no severity (Low); gaps are drawn as the design draws its gap (High).
 */
export type Finding = {
  key: string
  severity: 'Low' | 'Moderate' | 'High'
  kind: 'Conflict' | 'Duplicate' | 'Gap'
  ai: boolean
  title: string
  products: string[]
  /** The routine entries it is about (their photos are drawn with the names). */
  entries: RoutineEntry[]
  /** A two-product conflict whose fix is to alternate nights: "Alternate these" sets both schedules. */
  alternate?: boolean
  fix: string
  question: string
  /** Gap: what to search the catalog for. */
  find?: { category?: string; q?: string }
}

export const SEVERITY_STYLE: Record<Finding['severity'], { glyph: string; bg: string }> = {
  Low: { glyph: '●', bg: 'var(--action-tag)' },
  Moderate: { glyph: '▲', bg: 'var(--aura-apricot)' },
  High: { glyph: '■', bg: 'var(--aura-coral)' },
}

const CONFLICT_SEVERITY = { info: 'Low', caution: 'Moderate', avoid_same_routine: 'High' } as const

export function findingsOf(check: RoutineCheck, entries: RoutineEntry[]): Finding[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const found = (ids: string[]) => ids.map((id) => byId.get(id)).filter((e): e is RoutineEntry => Boolean(e))
  const names = (ids: string[]) => found(ids).map(entryName)
  const live = (ids: string[]) => ids.filter((id) => byId.has(id) && !byId.get(id)!.ended_at).length >= 2
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const conflicts = check.conflicts.filter((c) => live(c.products)).map<Finding>((c) => {
    const ns = names(c.products)
    return {
      key: `c:${c.products.join('+')}:${c.issue}`,
      severity: CONFLICT_SEVERITY[c.severity],
      kind: 'Conflict',
      ai: c.source === 'model',
      title: c.issue,
      products: ns,
      entries: found(c.products),
      alternate: c.products.length === 2 && /alternat/i.test(c.suggestion),
      fix: c.suggestion,
      question: c.severity === 'info' ? `What should I know about using ${ns.join(' and ')} together?` : `Why should I keep ${ns.join(' and ')} apart?`,
    }
  })
  const duplicates = check.duplicates.filter((d) => live(d.products)).map<Finding>((d) => {
    const ns = names(d.products)
    return { key: `d:${d.active}`, severity: 'Low', kind: 'Duplicate', ai: false, title: `${cap(d.active)} in ${ns.length} products`, products: ns, entries: found(d.products), fix: d.note, question: `Do I need ${d.active} in both ${ns.join(' and ')}?` }
  })
  const gaps = check.gaps.map<Finding>((g) => {
    const sun = /sunscreen|spf/i.test(`${g.need} ${g.suggestion}`)
    return {
      key: `g:${g.need}`,
      severity: 'High',
      kind: 'Gap',
      ai: false,
      title: g.need,
      products: sun ? ['Morning routine'] : [],
      entries: [],
      fix: `${g.why} ${g.suggestion}`.trim(),
      question: sun ? 'What sunscreen from the catalog fits my routine?' : `How do I fill this gap in my routine: ${g.need.toLowerCase()}?`,
      find: sun ? { category: 'sunscreen' } : { q: '' },
    }
  })
  return [...conflicts, ...gaps, ...duplicates]
}

/** Outcome kind -> the verdict glyph it reads as (docs/DESIGN.md: ◆ real change, ○ inside the band, ◌ too early, — not measured). */
export const OUTCOME_GLYPH = { real: 'changed', none: 'normal', early: 'notEnough', unmeasured: 'notCompared' } as const

/** Face and close-up sessions, for outcomeFor (pores and texture are read on the close-ups). */
export function useOutcomeSessions() {
  const data = useData()
  return useMemo(() => OUTCOME_SITES.flatMap((site) => data.series(site)?.sessions ?? []), [data])
}
