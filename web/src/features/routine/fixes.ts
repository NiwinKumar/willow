import { useRoutineReader } from '../../data/hooks'
import type { RoutineCheck, RoutineEntry, RoutineFix } from '../../data/types'
import { api, localDay } from '../../lib/api'
import { useQuery } from '../../lib/query'
import type { Finding } from './routineModel'

/**
 * Routine fixes (api/app/routine_fix.py): when the check flags two products used together, Gemini proposes a
 * concrete schedule change and the api checks it against the rule table (clears the conflict, adds no new
 * one). Asked for without the person asking, only when the check has a two-product conflict; an empty list
 * (Gemini down, nothing fixable) leaves the card as it was.
 */
export function useRoutineFixes(entries: RoutineEntry[] | undefined, check: RoutineCheck | undefined) {
  const { key: uid, demo } = useRoutineReader()
  const pairs = (check?.conflicts ?? []).filter((c) => c.products.length === 2 && c.source === 'rule')
  const version = pairs.map((c) => `${c.products.join('+')}`).join(',') + '|' + (entries ?? []).filter((e) => !e.ended_at).map((e) => `${e.id}:${e.slots.join('')}:${e.schedule?.kind ?? 'daily'}:${e.schedule?.anchor ?? ''}`).sort().join(',')
  const today = localDay()
  return useQuery(['routine-fixes', uid, today, version], (t) => (demo ? api.demoRoutineFixes(today) : api.routineFixes(t, today)).then((r) => r.fixes).catch(() => [] as RoutineFix[]), {
    enabled: Boolean(uid) && pairs.length > 0,
    staleMs: Infinity,
    public: demo,
  })
}

/** The fix for a finding of the check card, matched on the same products and issue the finding was built from. */
export const fixFor = (f: Finding, fixes: RoutineFix[] | undefined) => (fixes ?? []).find((x) => `c:${x.products.join('+')}:${x.issue}` === f.key) ?? null

/** The PATCH bodies a fix applies, and the ones that put each product back as it was. */
export function fixPatches(fix: RoutineFix, entries: RoutineEntry[]) {
  const byId = new Map(entries.map((e) => [e.id, e]))
  return fix.changes
    .filter((c) => byId.has(c.id))
    .map((c) => {
      const e = byId.get(c.id)!
      const apply: { slots?: ('am' | 'pm')[]; schedule?: RoutineEntry['schedule'] } = {}
      const undo: typeof apply = {}
      if (c.slots) {
        apply.slots = c.slots
        undo.slots = e.slots
      }
      if ('schedule' in c) {
        apply.schedule = c.schedule ?? null
        undo.schedule = e.schedule ?? null
      }
      return { entry: e, apply, undo }
    })
}
