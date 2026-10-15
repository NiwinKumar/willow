import { Cloud, Droplets, Eye, FlaskConical, GlassWater, Layers, Package, Pipette, Sun, Waves, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'

import type { RoutineCheck, RoutineEntry } from '../../data/types'
import { useData } from '../../data/useData'
import { categoryLabel } from '../../lib/catalog'
import { OUTCOME_SITES } from '../../lib/outcome'

/**
 * Product visuals without product photos (docs/DESIGN.md rule 9, "Product category" icon table): the
 * design's colour orb, coloured by category (never by brand, never data), with the category's lucide icon.
 * Ember tones are left out on purpose: ember means "Changed" only.
 */
const CATEGORY: Record<string, { icon: LucideIcon; c: [string, string, string] }> = {
  cleanser: { icon: Droplets, c: ['#9CD3FF', '#3D7BFF', '#1A3E99'] },
  toner: { icon: GlassWater, c: ['#D8B8FF', '#7A5CFF', '#3B2A99'] },
  serum: { icon: Pipette, c: ['#B8E986', '#4FB866', '#1F6B3A'] },
  treatment: { icon: FlaskConical, c: ['#8EE0C0', '#1E8C6C', '#0F3B3A'] },
  exfoliant: { icon: Waves, c: ['#F7C6E4', '#C77DDB', '#5B2A86'] },
  moisturizer: { icon: Cloud, c: ['#FFC2DF', '#F25FA8', '#8E2560'] },
  sunscreen: { icon: Sun, c: ['#FFF4C9', '#F2B53A', '#8F5E08'] },
  eye_care: { icon: Eye, c: ['#DCEBFF', '#8AA9E8', '#33508F'] },
  mask: { icon: Layers, c: ['#E3F2C2', '#9DBF5A', '#4E6B1C'] },
}
const OTHER = { icon: Package, c: ['#F1F0EC', '#B8B5AE', '#5E5B56'] as [string, string, string] }

export const categoryOf = (category: string) => CATEGORY[category] ?? OTHER

export function orbGradient(category: string): string {
  const [a, b, c] = categoryOf(category).c
  return `radial-gradient(circle at 34% 28%, #FFFFFF 0%, ${a} 34%, ${b} 72%, ${c} 100%)`
}

export const entryName = (e: Pick<RoutineEntry, 'custom_name' | 'brand'>) => e.custom_name || e.brand || 'Unnamed product'
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
  const names = (ids: string[]) => ids.map((id) => byId.get(id)).filter((e): e is RoutineEntry => Boolean(e)).map(entryName)
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
      fix: c.suggestion,
      question: c.severity === 'info' ? `What should I know about using ${ns.join(' and ')} together?` : `Why should I keep ${ns.join(' and ')} apart?`,
    }
  })
  const duplicates = check.duplicates.filter((d) => live(d.products)).map<Finding>((d) => {
    const ns = names(d.products)
    return { key: `d:${d.active}`, severity: 'Low', kind: 'Duplicate', ai: false, title: `${cap(d.active)} in ${ns.length} products`, products: ns, fix: d.note, question: `Do I need ${d.active} in both ${ns.join(' and ')}?` }
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
