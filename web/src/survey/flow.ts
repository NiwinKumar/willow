/**
 * The validation survey's logic (docs/SURVEY.md), kept apart from the screens so it can be tested: which
 * screens show for the answers so far, where the survey ends early, the option order each person sees,
 * and the saved progress that lets a refresh carry on where it stopped.
 */
import definition from '../../../api/seed/survey_v1.json' with { type: 'json' }

export type Kind = 'single' | 'scale' | 'multi' | 'text' | 'info' | 'email' | 'country'
export type Option = { id: string; label: string; fixed?: boolean; exclusive?: boolean }
type Rule = { q: string; in?: string[]; not_in?: string[] }
export type Question = {
  id: string
  part: string
  kind: Kind
  title: string
  help?: string
  body?: string[]
  placeholder?: string
  required?: boolean
  shuffle?: boolean
  max?: number
  max_length?: number
  consent?: string
  options?: Option[]
  show_if?: Rule
  show_if_any?: Rule[]
  end_if?: { in: string[]; screen: Ending }
}
export type Ending = 'minor' | 'no_routine'
export type Answer = string | string[]
export type Answers = Record<string, Answer>

export const SURVEY = definition as unknown as { version: 'v1'; pilot_date: string; parts: { id: string; label: string }[]; questions: Question[] }
export const QUESTIONS = SURVEY.questions

const matches = (answers: Answers, r: Rule) => {
  const a = answers[r.q]
  const picked = Array.isArray(a) ? a : a == null ? [] : [a]
  if (r.in) return picked.some((v) => r.in!.includes(v))
  if (r.not_in) return picked.length > 0 && !picked.some((v) => r.not_in!.includes(v))
  return true
}

/** Whether a screen shows for the answers given so far. */
export function visible(q: Question, answers: Answers): boolean {
  if (q.show_if && !matches(answers, q.show_if)) return false
  if (q.show_if_any && !q.show_if_any.some((r) => matches(answers, r))) return false
  return true
}

/** The screens this person sees, in order, for the answers so far. */
export function screens(answers: Answers): Question[] {
  return QUESTIONS.filter((q) => visible(q, answers))
}

/** The early ending an answer leads to, if any (under 18, or no skincare routine). */
export function endingFor(q: Question, value: Answer | undefined): Ending | null {
  if (!q.end_if || typeof value !== 'string') return null
  return q.end_if.in.includes(value) ? q.end_if.screen : null
}

/** Answers for screens that are no longer shown (an earlier answer changed) are dropped. */
export function prune(answers: Answers): Answers {
  const shown = new Set(screens(answers).map((q) => q.id))
  return Object.fromEntries(Object.entries(answers).filter(([id]) => shown.has(id)))
}

export function answered(value: Answer | undefined): boolean {
  if (value == null) return false
  return Array.isArray(value) ? value.length > 0 : value.trim() !== ''
}

/** A multi-choice tap: exclusive options ("Nothing in particular") clear the rest, and the reverse; a full set refuses more. */
export function toggle(q: Question, current: string[], id: string): { next: string[]; full: boolean } {
  if (current.includes(id)) return { next: current.filter((v) => v !== id), full: false }
  const exclusive = new Set(q.options?.filter((o) => o.exclusive).map((o) => o.id))
  if (exclusive.has(id)) return { next: [id], full: false }
  const rest = current.filter((v) => !exclusive.has(v))
  if (q.max && rest.length >= q.max) return { next: current, full: true }
  return { next: [...rest, id], full: false }
}

/** A stable shuffle per person (seeded), so options don't jump around when someone goes back. "Fixed" options stay last. */
export function ordered(q: Question, seed: number): Option[] {
  const opts = q.options ?? []
  if (!q.shuffle) return opts
  const moving = opts.filter((o) => !o.fixed)
  let s = (seed ^ hash(q.id)) >>> 0 || 1
  const rand = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
  for (let i = moving.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[moving[i], moving[j]] = [moving[j], moving[i]]
  }
  return [...moving, ...opts.filter((o) => o.fixed)]
}

function hash(text: string): number {
  let h = 2166136261
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

/** Where the link was shared, from ?src= (each channel gets its own link): lowercase letters, digits, - and _. */
export function sourceOf(search: string): string {
  const raw = new URLSearchParams(search).get('src') ?? ''
  const clean = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32)
  return clean || 'direct'
}

export type Progress = { v: 1; answers: Answers; at: string | null; started: number; seed: number; email: string; consent: boolean }

const KEY = 'willow.survey.v1'

/** Saved progress on this device, if any (storage can be blocked: then there is none). */
export function loadProgress(): Progress | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Progress
    return p?.v === 1 && p.answers && typeof p.started === 'number' ? p : null
  } catch {
    return null
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // private mode or blocked storage: the survey still works, it just won't resume after a refresh
  }
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing saved
  }
}

/** Where the "I've already answered" note lives, so a finished survey says thank you instead of starting again. */
const DONE = 'willow.survey.v1.done'
export function markDone(): void {
  try {
    localStorage.setItem(DONE, new Date().toISOString())
  } catch {
    // fine
  }
}
export function wasDone(): boolean {
  try {
    return !!localStorage.getItem(DONE)
  } catch {
    return false
  }
}

export const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/
