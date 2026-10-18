import type { RoutineEntry, Session } from '../../data/types'
import { outcomeFor } from '../../lib/outcome'
import type { Finding } from './routineModel'
import { alternatesWith, restsOn } from './schedule'

/** What "Suggested today" would show; Routine uses it to decide whether the card exists (and what sits in its place). */
export function suggestionsOf(findings: Finding[], entries: RoutineEntry[], sessions: Session[], usedLastNight: (id: string) => boolean) {
  const tonight = tonightOf(findings, entries, usedLastNight)
  const gaps = findings.filter((f) => f.kind === 'Gap').slice(0, tonight ? 1 : 2)
  const changes = entries
    .map((e) => ({ e, o: outcomeFor(e, sessions) }))
    .flatMap(({ e, o }) => {
      if (o.kind !== 'real') return []
      // The session the outcome judged (not simply the newest photo, which may be within range again).
      const latest = o.session
      const m = latest.result?.metrics.find((x) => x.id === o.metric)
      return m && m.delta !== null ? [{ e, o, latest, m }] : []
    })
    .slice(0, 3 - gaps.length - (tonight ? 1 : 0))
  return { tonight, gaps, changes, any: gaps.length + changes.length > 0 || Boolean(tonight) }
}

/**
 * Tonight's pair: two evening products already alternating (done), else the first conflict the check says to
 * alternate. In a new pair the product not used last night goes tonight.
 */
function tonightOf(findings: Finding[], entries: RoutineEntry[], usedLastNight: (id: string) => boolean): { on: RoutineEntry; off: RoutineEntry; done: boolean; finding?: Finding } | null {
  const pm = entries.filter((e) => e.slots.includes('pm') && !e.ended_at)
  for (const a of pm)
    for (const b of pm)
      if (a.id < b.id && alternatesWith(a, b)) {
        const [on, off] = restsOn(a) ? [b, a] : [a, b]
        return { on, off, done: true }
      }
  const f = findings.find((x) => x.kind === 'Conflict' && x.alternate && x.entries.length === 2 && x.entries.every((e) => e.slots.includes('pm')))
  if (!f) return null
  const [a, b] = f.entries
  const [on, off] = usedLastNight(b.id) && !usedLastNight(a.id) ? [a, b] : [b, a]
  return { on, off, done: false, finding: f }
}
