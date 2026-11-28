/**
 * The safety profile (users/{uid}.profile.safety) and the per-product check computed from it by the api
 * (api app/safety.py, app/regulatory.py: fixed rules from sourced tables, never Gemini). Words for each
 * status live here so every screen says the same thing, and never "safe".
 *
 *   const { checks, profileComplete } = useChecks(products.map((p) => p.product_id))
 *   <CheckedChip check={checks[id]} profileComplete={profileComplete} />
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { ApiError, request, retailerGet } from './api'
import type { CheckStatus } from './checkWords'
import type { Market } from './market'
import { useQuery } from './query'
import { useAuth } from './useAuth'

// ---------------------------------------------------------------- profile

export type LifeStage = 'none' | 'pregnant' | 'breastfeeding' | 'trying'
export type AvoidId = 'fragrance' | 'essential_oils' | 'drying_alcohol' | 'lanolin' | 'nut_oils' | 'mi_preservatives'

export type SafetyProfile = {
  /** Confirmed 18 or older; null = never asked (consent from before the age question). */
  adult: boolean | null
  life_stage: LifeStage | null
  /** Skin reacts easily (stings, flushes or itches with new products). */
  reactive: boolean | null
  avoid: AvoidId[]
  /** Products set aside by a reaction or by hand. */
  avoid_products: string[]
  /** Uses a prescription skin treatment. */
  rx_treatment: boolean | null
  market: Market | null
  /** "Anything you've reacted to before?": ingredient names, matched against labels (case aside) as "Not advised for you". */
  avoid_ingredients: string[]
  /** "Tell us about past reactions or breakouts" (≤500 chars): read by Willow only when asked, and by Wisp; never a flag by itself. */
  note: string | null
}

export const EMPTY_SAFETY: SafetyProfile = { adult: null, life_stage: null, reactive: null, avoid: [], avoid_products: [], rx_treatment: null, market: null, avoid_ingredients: [], note: null }
export const NOTE_MAX = 500

export const LIFE_STAGES: { id: LifeStage; label: string }[] = [
  { id: 'none', label: 'None of these' },
  { id: 'pregnant', label: 'Pregnant' },
  { id: 'breastfeeding', label: 'Breastfeeding' },
  { id: 'trying', label: 'Trying to conceive' },
]

export const AVOID_OPTIONS: { id: AvoidId; label: string; hint: string }[] = [
  { id: 'fragrance', label: 'Fragrance', hint: 'Parfum and the labelled fragrance allergens' },
  { id: 'essential_oils', label: 'Essential oils', hint: 'Lavender, tea tree, citrus oils and similar' },
  { id: 'drying_alcohol', label: 'Drying alcohol', hint: 'Alcohol denat., SD alcohol' },
  { id: 'lanolin', label: 'Lanolin', hint: 'Wool wax and its derivatives' },
  { id: 'nut_oils', label: 'Nut oils', hint: 'Almond, macadamia, shea and other nut oils' },
  { id: 'mi_preservatives', label: 'MI preservatives', hint: 'Methylisothiazolinone and its relatives' },
]

// Markets live in ./market (no imports, so node tests can load them).
export { MARKETS, budgetCurrency, loadPricedCurrencies, marketFromLocale, marketOf, marketWords, type Market } from './market'

/** Read the safety profile from GET /v1/me (null when none is saved yet, or the api predates it). */
export async function fetchSafety(token: string): Promise<SafetyProfile | null> {
  const me = await request<{ profile: { safety?: Partial<SafetyProfile> | null } | null }>(token, '/v1/me')
  const s = me.profile?.safety
  return s ? { ...EMPTY_SAFETY, ...s, avoid: s.avoid ?? [], avoid_products: s.avoid_products ?? [], avoid_ingredients: s.avoid_ingredients ?? [], note: s.note ?? null } : null
}

/** Save the whole safety object (a partial `safety` replaces it, so send everything); clears cached checks. */
export async function putSafety(token: string, safety: SafetyProfile, extra: Record<string, unknown> = {}): Promise<void> {
  await request(token, '/v1/me/profile', { method: 'PUT', body: JSON.stringify({ ...extra, safety }) })
  invalidateChecks()
}

/** The signed-in person's safety profile (null before one is saved). */
export function useSafety() {
  const { user } = useAuth()
  const uid = user?.uid ?? null
  return useQuery(['safety', uid], (t) => fetchSafety(t), { enabled: Boolean(uid), staleMs: 5 * 60_000 })
}

// ---------------------------------------------------------------- checks

export { CHECK_WORDS, noFlagsText, type CheckStatus } from './checkWords'
export type Grade = 'A' | 'B' | 'C'
export type SourceRef = { label: string; url: string | null }
export type SafetyFlag = { rule: string; level: 'check' | 'avoid'; title: string; detail: string; source: SourceRef | null; grade: Grade | null }
export type RegulatoryClass = 'cosmetic' | 'otc_drug' | 'pharmacy' | 'rx'
/** `unknown`: no ingredient list in Willow (an index product); `explanation` then says so, and `regulatory` is
 * null unless its name or actives show it is not a plain cosmetic. */
export type ProductCheck = { status: CheckStatus; flags: SafetyFlag[]; regulatory: { class: RegulatoryClass; market: string | null } | null; explanation?: string | null }
export type SafetyCheckResponse = { profile_complete: boolean; checks: Record<string, ProductCheck> }

export const REGULATORY_WORDS: Record<RegulatoryClass, string> = {
  cosmetic: 'Sold as a cosmetic',
  otc_drug: 'Sold as an over-the-counter drug',
  pharmacy: 'Sold through pharmacies',
  rx: 'Prescription only',
}

export const LABELS_NOTE = 'Labels can be incomplete.'

/** POST /v1/safety/check for up to 80 products. */
export const safetyCheck = (token: string, productIds: string[]) =>
  request<SafetyCheckResponse>(token, '/v1/safety/check', { method: 'POST', body: JSON.stringify({ product_ids: productIds.slice(0, 80) }) })

/**
 * One cache of checks, shared by every screen and keyed by person (uid|product), so one person's answers
 * never show for another: a product is asked about once, a list asks only for what it has not seen (in
 * batches of 80), and a safety profile change clears it all.
 */
const checks = new Map<string, ProductCheck>()
const pending = new Set<string>()
const failed = new Set<string>()
const complete = new Map<string, boolean>()
let version = 0
const listeners = new Set<() => void>()
const emit = () => {
  version++
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
const snapshot = () => version
const k = (uid: string, id: string) => `${uid}|${id}`

/** Forget every cached check (after the safety profile, or a reaction, changes); readers ask again. */
export function invalidateChecks() {
  checks.clear()
  failed.clear()
  complete.clear()
  emit()
}

async function load(uid: string, ids: string[], getIdToken: () => Promise<string>) {
  ids.forEach((id) => pending.add(k(uid, id)))
  emit()
  try {
    const token = await getIdToken()
    for (let i = 0; i < ids.length; i += 80) {
      const part = ids.slice(i, i + 80)
      try {
        const res = await safetyCheck(token, part)
        for (const [id, c] of Object.entries(res.checks ?? {})) checks.set(k(uid, id), c)
        // An id the api did not answer for (unknown product) is not asked about again.
        part.filter((id) => !res.checks?.[id]).forEach((id) => failed.add(k(uid, id)))
        complete.set(uid, res.profile_complete)
      } catch (e) {
        part.forEach((id) => failed.add(k(uid, id)))
        if (!(e instanceof ApiError)) throw e
      }
    }
  } catch {
    /* no token or offline: the chips stay hidden */
  } finally {
    ids.forEach((id) => pending.delete(k(uid, id)))
    emit()
  }
}

/**
 * Every list on a page asks at once (three Wisp answers, the routine, a suggestion: each its own hook). Their
 * ids are gathered for a moment and asked in ONE request per person, instead of one request per list
 * (Nov 28: Home made three /v1/safety/check calls on load).
 */
const BATCH_MS = 40
const queued = new Map<string, { ids: Set<string>; getIdToken: () => Promise<string> }>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function ask(uid: string, ids: string[], getIdToken: () => Promise<string>) {
  // pending at once, so a second hook asking for the same product does not queue it again
  ids.forEach((id) => pending.add(k(uid, id)))
  const q = queued.get(uid) ?? { ids: new Set<string>(), getIdToken }
  ids.forEach((id) => q.ids.add(id))
  q.getIdToken = getIdToken
  queued.set(uid, q)
  emit()
  flushTimer ??= setTimeout(() => {
    flushTimer = null
    const batches = [...queued.entries()]
    queued.clear()
    for (const [who, b] of batches) void load(who, [...b.ids], b.getIdToken)
  }, BATCH_MS)
}

export type ChecksState = {
  /** product id → check, for the ids asked that have an answer. */
  checks: Record<string, ProductCheck>
  /** false: the person has not told Willow enough for a full check (the chips say so); null: unknown yet. */
  profileComplete: boolean | null
  /** loading while any asked id is in flight. */
  status: 'idle' | 'loading' | 'ready'
  /** Ask again for the ids that failed. */
  retry: () => void
}

/** The checks for these products, for the signed-in person (guest accounts included). */
export function useChecks(productIds: readonly string[]): ChecksState {
  const { user, getIdToken } = useAuth()
  const uid = user?.uid ?? null
  const v = useSyncExternalStore(subscribe, snapshot, snapshot)
  const key = [...new Set(productIds.filter(Boolean))].sort().join('|')
  const ids = useMemo(() => (key ? key.split('|') : []), [key])

  useEffect(() => {
    if (!uid || !ids.length) return
    const missing = ids.filter((id) => !checks.has(k(uid, id)) && !pending.has(k(uid, id)) && !failed.has(k(uid, id)))
    if (missing.length) ask(uid, missing, getIdToken)
    // v: a cleared cache (profile change, retry) asks again.
  }, [uid, ids, getIdToken, v])

  const retry = useCallback(() => {
    if (uid) ids.forEach((id) => failed.delete(k(uid, id)))
    emit()
  }, [ids, uid])

  return useMemo(() => {
    const out: Record<string, ProductCheck> = {}
    if (!uid) return { checks: out, profileComplete: null, status: 'idle' as const, retry }
    for (const id of ids) {
      const c = checks.get(k(uid, id))
      if (c) out[id] = c
    }
    const loading = ids.some((id) => pending.has(k(uid, id)))
    return { checks: out, profileComplete: complete.get(uid) ?? null, status: !ids.length ? ('idle' as const) : loading ? ('loading' as const) : ('ready' as const), retry }
    // v: the cache changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, ids, retry, v])
}

// ---------------------------------------------------------------- evidence clock

export type EvidenceEntry = { first_look_weeks: number; verdict_weeks: number; source?: SourceRef | null; grade?: Grade | null }
export type EvidenceClock = { actives: Record<string, EvidenceEntry | null>; default: EvidenceEntry }

/** GET /v1/evidence-clock: per active, when a first look and a verdict are due (weeks), with its source. */
export const evidenceClock = (token: string) => request<EvidenceClock>(token, '/v1/evidence-clock')

export function useEvidenceClock() {
  const { user } = useAuth()
  return useQuery(['evidence-clock'], (t) => evidenceClock(t), { enabled: Boolean(user), staleMs: 60 * 60_000 })
}

/** The clock entry for a product's actives: the slowest named active wins; null for basics with no active. */
export function clockFor(clock: EvidenceClock | undefined, actives: { name: string }[]): EvidenceEntry | null {
  if (!clock) return null
  let best: EvidenceEntry | null = null
  for (const a of actives) {
    const name = a.name.toLowerCase()
    const hit = Object.entries(clock.actives).find(([k]) => name.includes(k.replace(/_/g, ' ')) || name.includes(k))
    const e = hit?.[1]
    if (e && (!best || e.verdict_weeks > best.verdict_weeks)) best = e
  }
  return best
}

// ---------------------------------------------------------------- past reactions

/** GET /v1/safety/ingredients (public): every name on a catalog label or in the rule file, for the typeahead. */
export function useIngredientNames(enabled = true) {
  return useQuery(['safety-ingredients'], () => retailerGet<{ names: string[] }>('/v1/safety/ingredients').then((r) => r.names), { enabled, public: true, staleMs: 24 * 60 * 60_000 })
}

/** Up to `n` names for what was typed: names that start with it first, then names with a word that does. */
export function matchIngredients(names: readonly string[], typed: string, exclude: readonly string[] = [], n = 6): string[] {
  const q = typed.trim().toLowerCase()
  if (q.length < 2) return []
  const out = new Set(exclude.map((x) => x.toLowerCase()))
  const starts: string[] = []
  const words: string[] = []
  for (const name of names) {
    const low = name.toLowerCase()
    if (out.has(low)) continue
    if (low.startsWith(q)) starts.push(name)
    else if (low.split(/[\s(/,-]+/).some((w) => w.startsWith(q))) words.push(name)
  }
  const byLength = (a: string, b: string) => a.length - b.length
  return [...starts.sort(byLength), ...words.sort(byLength)].slice(0, n)
}

export type NoteSuggest = { avoid: AvoidId[]; avoid_ingredients: string[]; reactive: boolean | null; life_stage: Exclude<LifeStage, 'none'> | null }
export type NoteRead = { suggest: NoteSuggest; summary: string; source: 'model' | 'rules' }

/** POST /v1/safety/note/read: suggestions from the note (nothing saved; the person taps what to add). */
export const readNote = (token: string, note: string) => request<NoteRead>(token, '/v1/safety/note/read', { method: 'POST', body: JSON.stringify({ note }) })

// ---------------------------------------------------------------- rule families (/checks)

export type RuleFamily = {
  id: string
  label: string
  applies: string
  levels: ('check' | 'avoid')[]
  grades: Grade[]
  sources: SourceRef[]
  rules: { id: string; title: string; level: 'check' | 'avoid'; grade: Grade }[]
}
export type SafetyRules = { families: RuleFamily[]; rules: number; personal: { id: string; label: string; applies: string; level: 'avoid' }[]; note: string }

/** GET /v1/safety/rules (public): the rule file by family, with sources and grades. */
export function useSafetyRules() {
  return useQuery(['safety-rules'], () => retailerGet<SafetyRules>('/v1/safety/rules'), { public: true, staleMs: 60 * 60_000 })
}

// ---------------------------------------------------------------- in-aisle preview

export type RoutinePreview = {
  product_id: string
  in_routine: boolean
  routine_size: number
  clashes: { issue: string; suggestion: string; severity: 'info' | 'caution' | 'avoid_same_routine'; with: string[] }[]
  gaps: { need: string; why: string; suggestion: string }[]
  already_use: { active: string; products: string[] }[]
  note: string
  /** false: the product's ingredient list is not in Willow yet, so finding no clash means nothing (older builds omit it). */
  checked?: boolean
}

/** POST /v1/routine/check/preview: what adding this product would newly bring to the routine (rules only, nothing saved). */
export const routinePreview = (token: string, productId: string, slots?: ('am' | 'pm')[]) =>
  request<RoutinePreview>(token, '/v1/routine/check/preview', { method: 'POST', body: JSON.stringify({ product_id: productId, ...(slots ? { slots } : {}) }) })
