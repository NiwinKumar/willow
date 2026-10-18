/**
 * Routine markers on a metric's timeline: one per start day, so products started together share a single
 * label instead of printing over each other. Pure (the date and axis lookups come in), so `npm test` reads it.
 */
export type RoutineMarker = { at: number; label: string }

export function routineMarkers(entries: { started_at: string; custom_name: string; brand: string }[], place: (day: string) => number | null, fmtDay: (day: string) => string, max = 6): RoutineMarker[] {
  const byDay = new Map<string, string[]>()
  for (const e of entries) {
    const day = e.started_at.slice(0, 10)
    byDay.set(day, [...(byDay.get(day) ?? []), e.custom_name || e.brand])
  }
  return [...byDay]
    .map(([day, names]) => ({ at: place(day), label: `${names.length === 1 ? names[0].toUpperCase().slice(0, 18).trim() : `${names.length} PRODUCTS STARTED`} · ${fmtDay(day).toUpperCase()}` }))
    .filter((m): m is RoutineMarker => m.at !== null)
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
}
