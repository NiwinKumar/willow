import type { AutopilotActivity, AutopilotKind, RuleBody, RuleLevel } from '../../lib/api'
import { GOALS } from '../../lib/metrics.ts'
import { SKIN_LABEL } from '../routine/sponsored.ts'

/**
 * Willow Proof · AutoCampaign: the pure parts (templates, the rule's sentence, labels), so `npm test` can read
 * them without the app. The sentence mirrors the api's `autopilot.describe` (tests/autopilot.test.ts holds the
 * two to the same words), so the editor can preview it live while the form changes.
 */

const CATEGORIES: { id: string; label: string; noun: string }[] = [
  { id: 'serum', label: 'Serums', noun: 'serums' },
  { id: 'sunscreen', label: 'Sunscreens', noun: 'sunscreens' },
  { id: 'treatment', label: 'Treatments', noun: 'treatments' },
  { id: 'cleanser', label: 'Cleansers', noun: 'cleansers' },
  { id: 'moisturizer', label: 'Moisturisers', noun: 'moisturisers' },
  { id: 'toner', label: 'Toners', noun: 'toners' },
  { id: 'exfoliant', label: 'Exfoliants', noun: 'exfoliants' },
  { id: 'eye_care', label: 'Eye care', noun: 'eye care' },
  { id: 'mask', label: 'Masks', noun: 'masks' },
]

export const LEVELS: { id: RuleLevel; label: string; hint: string }[] = [
  { id: 'suggest', label: 'Suggest', hint: 'Drafts the campaign; you approve it.' },
  { id: 'auto', label: 'Auto-start, notify', hint: 'Starts it and tells you, with Undo.' },
  { id: 'autopilot', label: 'Full autopilot', hint: 'Starts, adjusts and stops on its own; a weekly summary.' },
]

const LEVEL_WORDS: Record<RuleLevel, string> = {
  suggest: 'Suggest it and ask me first.',
  auto: 'Start it automatically and tell me.',
  autopilot: 'Run it on autopilot.',
}

const goalWord = (id: string) => (GOALS.find((g) => g.id === id)?.label ?? id).toLowerCase()
const list = (words: string[]) => (words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`)
export const goalsText = (ids: string[]) => list(ids.map(goalWord))
export const skinsText = (ids: string[]) => list(ids.map((s) => (SKIN_LABEL[s] ?? s).toLowerCase()))

function scopeWords(rule: RuleBody): string {
  const noun = rule.scope.category ? (CATEGORIES.find((c) => c.id === rule.scope.category)?.noun ?? 'products') : 'products'
  return rule.workspace !== 'retailer' ? `any of my ${noun}` : `any of the ${noun}`
}

/** The rule in one sentence, as the template reads (api autopilot.describe). */
export function ruleSentence(rule: RuleBody): string {
  const t = rule.trigger
  const a = rule.action
  const c = rule.conditions
  const forGoal = t.goals.length ? ` for ${goalsText(t.goals)}` : ''
  const scope = scopeWords(rule)
  let when: string
  let who = 'the skin types it works for'
  if (t.kind === 'proven') when = `When ${scope} becomes Proven${forGoal}`
  else if (t.kind === 'new_segment') {
    when = `When ${scope} gains a new goal or skin type with a positive lift${forGoal}`
    who = 'that new group'
  } else if (t.kind === 'rising_demand') when = `When demand rises${forGoal || ' for a goal'} and ${scope} is Proven for it`
  else {
    when = `When ${Math.round((t.unmet_min || 0.5) * 100)}% or more of a skin type${forGoal} see no change yet and ${scope} works for them`
    who = 'that skin type'
  }
  const extras: string[] = []
  if (c.in_store) extras.push('only products sold in a store')
  if (c.start_on) extras.push(`from ${c.start_on}`)
  if (c.stop_after) extras.push(`until ${c.stop_after}`)
  if (c.monthly_cap) extras.push(`at most ${c.monthly_cap} new a month`)
  const tail = extras.length ? ` (${extras.join('; ')})` : ''
  return `${when}, promote it to ${who}, for ${a.days} days, with a ${Math.round(a.holdout_pct * 100)}% holdout, max ${a.max_running} at a time${tail}. ${LEVEL_WORDS[rule.level]}`
}

/** A new rule's defaults: the template rule for this workspace. */
export function emptyRule(workspace: string): RuleBody {
  return {
    name: 'Dark-spot serums',
    workspace,
    enabled: true,
    level: 'suggest',
    scope: { category: 'serum', product_ids: [] },
    trigger: { kind: 'proven', goals: ['dark_spots'], unmet_min: 0.5 },
    conditions: { in_store: false, start_on: null, stop_after: null, monthly_cap: null },
    action: { days: 14, holdout_pct: 0.2, max_running: 2 },
  }
}

/** The fill-in-the-blanks pattern every typed rule follows. */
export const PATTERN = 'When [any of my serums / products] [becomes Proven / gains a new skin type / sees rising demand / works for an under-served group] for [goal], promote it [to the skin types it works for] for [7 / 14 / 30] days, with a [10–50]% holdout, max [1–3] at a time. [Ask me first / Start it automatically / Run it on autopilot].'

/** Ready-made rules, one per trigger: tap one to fill the form, or copy it and change the words. */
export const TEMPLATES: { title: string; text: string; rule: (workspace: string) => RuleBody }[] = [
  {
    title: 'Promote what becomes Proven',
    text: 'When any of my serums becomes Proven for dark spots, promote it to the skin types it works for, for 14 days, with a 20% holdout, max 2 at a time.',
    rule: (w) => emptyRule(w),
  },
  {
    title: 'Reach a newly proven skin type',
    text: 'When any of my products gains a new skin type with a positive lift, suggest a 7-day campaign for that group, with a 20% holdout, max 1 at a time.',
    rule: (w) => ({ ...emptyRule(w), name: 'New skin types', scope: { category: null, product_ids: [] }, trigger: { kind: 'new_segment', goals: [], unmet_min: 0.5 }, action: { days: 7, holdout_pct: 0.2, max_running: 1 } }),
  },
  {
    title: 'Ride rising demand',
    text: 'When demand for redness is rising and one of my products is Proven for it, start it automatically for 14 days, with a 20% holdout, max 2 at a time.',
    rule: (w) => ({ ...emptyRule(w), name: 'Rising redness demand', level: 'auto', scope: { category: null, product_ids: [] }, trigger: { kind: 'rising_demand', goals: ['redness'], unmet_min: 0.5 } }),
  },
  {
    title: 'Help an under-served group',
    text: 'When 50% or more of a skin type see no change yet for blemishes and one of my products works for them, run it on autopilot for 30 days, with a 20% holdout, max 1 at a time.',
    rule: (w) => ({ ...emptyRule(w), name: 'Under-served blemishes', level: 'autopilot', scope: { category: null, product_ids: [] }, trigger: { kind: 'unmet_need', goals: ['blemishes'], unmet_min: 0.5 }, action: { days: 30, holdout_pct: 0.2, max_running: 1 } }),
  },
]

/** Each feed item's word and tone (the word always carries it; colour only repeats it). */
export const KIND: Record<AutopilotKind, { word: string; tone: 'green' | 'amber' | 'gray' | 'red' | 'outline' }> = {
  proposed: { word: 'Proposed', tone: 'amber' },
  started: { word: 'Started', tone: 'green' },
  resumed: { word: 'Resumed', tone: 'green' },
  extended: { word: 'Extended', tone: 'green' },
  narrowed: { word: 'Narrowed', tone: 'gray' },
  paused: { word: 'Paused', tone: 'amber' },
  ended: { word: 'Ended', tone: 'gray' },
  held: { word: 'Held', tone: 'outline' },
  undone: { word: 'Undone', tone: 'gray' },
  summary: { word: 'Weekly summary', tone: 'outline' },
  reviewed: { word: 'Reviewed', tone: 'outline' },
}

/** Open proposals first (they need you), then newest first. */
export function feedOrder(items: AutopilotActivity[]): AutopilotActivity[] {
  const open = (a: AutopilotActivity) => a.kind === 'proposed' && a.status === 'open'
  return [...items].sort((a, b) => Number(open(b)) - Number(open(a)) || b.at.localeCompare(a.at))
}

/** Proposals waiting for the owner. */
export const openProposals = (items: AutopilotActivity[]) => items.filter((a) => a.kind === 'proposed' && a.status === 'open')

/** "3 min ago", "2 h ago", "17 Oct" for the feed. */
export function agoText(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
