import type { ChangeTag, ChangesPrefill } from './api'

/**
 * "What's been different since your last check-in?" (api app/changes.py): the groups of chips the check-in asks,
 * in order. A chip with `more` opens finer chips once picked (travel → hotter / colder / more humid). Only the tags
 * the api knows; the person's own words go in "Anything else?".
 */
export type ChangeChip = { tag: ChangeTag; label: string; more?: { tag: ChangeTag; label: string }[] }
export type ChangeGroup = { id: string; label: string; chips: ChangeChip[] }

export const CHANGE_GROUPS: ChangeGroup[] = [
  { id: 'period', label: 'Period', chips: [{ tag: 'period', label: 'Had my period' }] },
  {
    id: 'stress',
    label: 'Stress',
    chips: [
      { tag: 'stress_work', label: 'Work stress' },
      { tag: 'stress_study', label: 'Study or exams' },
    ],
  },
  { id: 'sleep', label: 'Sleep', chips: [{ tag: 'sleep_poor', label: 'Slept badly' }] },
  {
    id: 'travel',
    label: 'Travel',
    chips: [
      {
        tag: 'travel',
        label: 'Travelled',
        more: [
          { tag: 'travel_hot', label: 'Hotter' },
          { tag: 'travel_cold', label: 'Colder' },
          { tag: 'travel_humid', label: 'More humid' },
        ],
      },
    ],
  },
  {
    id: 'sport',
    label: 'Sport and sweat',
    chips: [
      { tag: 'sport_gym', label: 'Gym or sport' },
      { tag: 'sport_swim', label: 'Swimming' },
      { tag: 'sport_outdoor', label: 'Outdoor sport' },
    ],
  },
  { id: 'sun', label: 'Sun', chips: [{ tag: 'sun', label: 'Lots of sun' }] },
  {
    id: 'diet',
    label: 'Diet',
    chips: [
      {
        tag: 'diet',
        label: 'Ate differently',
        more: [
          { tag: 'diet_sugar', label: 'More sugar' },
          { tag: 'diet_dairy', label: 'More dairy' },
          { tag: 'diet_spicy', label: 'Spicy food' },
          { tag: 'diet_alcohol', label: 'More alcohol' },
          { tag: 'diet_less_water', label: 'Less water' },
        ],
      },
    ],
  },
  {
    id: 'routine',
    label: 'Skin routine',
    chips: [
      { tag: 'routine_skipped', label: 'Skipped products' },
      { tag: 'routine_new', label: 'Tried something new' },
      { tag: 'makeup_new', label: 'New makeup' },
      { tag: 'clinic', label: 'Facial or clinic visit' },
      { tag: 'picked', label: 'Picked at spots' },
    ],
  },
  {
    id: 'health',
    label: 'Health',
    chips: [
      { tag: 'unwell', label: 'Felt unwell' },
      { tag: 'new_medicine', label: 'New medicine' },
    ],
  },
]

/** Finer tags only count with their parent ("More humid" means travelled). */
const PARENT: Partial<Record<ChangeTag, ChangeTag>> = Object.fromEntries(CHANGE_GROUPS.flatMap((g) => g.chips.flatMap((c) => (c.more ?? []).map((m) => [m.tag, c.tag]))))

/** Toggle a tag: picking a finer tag picks its parent; dropping a parent drops its finer tags. */
export function toggleTag(tags: ChangeTag[], tag: ChangeTag): ChangeTag[] {
  if (tags.includes(tag)) return tags.filter((t) => t !== tag && PARENT[t] !== tag)
  const parent = PARENT[tag]
  return [...tags, ...(parent && !tags.includes(parent) ? [parent] : []), tag]
}

/** Add tags read from the person's words (parents included), keeping what they already picked. */
export function addTags(tags: ChangeTag[], more: ChangeTag[]): ChangeTag[] {
  return more.reduce((acc, t) => (acc.includes(t) ? acc : toggleTag(acc, t)), tags)
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** "What's been different since 20 Nov?"; a first check-in asks about this week. */
export function changesQuestion(since: string | null): string {
  return since ? `What’s been different since ${day(since)}?` : 'Anything going on this week?'
}

/** The routine lines the check-in already knows: "Started Mixi Mandelic 8% Serum on 22 Nov · used 5 of 7 days". */
export function routineLines(routine: ChangesPrefill['routine']): string[] {
  return routine
    .filter((p) => p.started || p.stopped || p.use)
    .map((p) => {
      const name = `${p.brand} ${p.name}`.trim()
      const head = p.started ? `Started ${name} on ${day(p.started)}` : p.stopped ? `Stopped ${name} on ${day(p.stopped)}` : name
      return p.use ? `${head} · used ${p.use.days_used} of ${p.use.of_days} days` : head
    })
}
