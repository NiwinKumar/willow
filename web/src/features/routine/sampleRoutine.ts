/**
 * The guest starter routine (api demo.py JUDGE_ROUTINE): entries Willow added for a new guest carry `sample: true`.
 * Pure, so it is unit-tested (tests/sample-routine.test.ts).
 */
import type { RoutineEntry } from '../../data/types'

/** A routine entry carries `sample: true` when the guest starter routine made it (api demo.py). */
export const isSample = (e: RoutineEntry) => Boolean((e as RoutineEntry & { sample?: boolean }).sample)

/**
 * Saving a built plan replaces the sample instead of adding to it: every sample entry is removed, and each pick is
 * added unless the person's own current routine already has it (a pick the sample had is added again as their own).
 */
export function planSave(entries: RoutineEntry[], pickIds: string[]): { add: string[]; removeSample: string[] } {
  const own = new Set(entries.filter((e) => !isSample(e) && !e.ended_at && e.product_id).map((e) => e.product_id))
  const add: string[] = []
  for (const id of pickIds) {
    if (own.has(id)) continue
    own.add(id)
    add.push(id)
  }
  return { add, removeSample: entries.filter(isSample).map((e) => e.id) }
}
