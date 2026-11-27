/**
 * The safety profile (users/{uid}.profile.safety) and the per-product check computed from it by the api
 * (api app/safety.py, app/regulatory.py: fixed rules from sourced tables, never Gemini). Words for each
 * status live here so every screen says the same thing, and never "safe".
 *
 *   const { checks, profileComplete } = useChecks(products.map((p) => p.product_id))
 *   <CheckedChip check={checks[id]} profileComplete={profileComplete} />
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { ApiError, request } from './api'
import { useQuery } from './query'
import { useAuth } from './useAuth'

// ---------------------------------------------------------------- profile

export type LifeStage = 'none' | 'pregnant' | 'breastfeeding' | 'trying'
export type AvoidId = 'fragrance' | 'essential_oils' | 'drying_alcohol' | 'lanolin' | 'nut_oils' | 'mi_preservatives'
export type Market = 'US' | 'IN' | 'SG' | 'UK' | 'EU'

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
}

export const EMPTY_SAFETY: SafetyProfile = { adult: null, life_stage: null, reactive: null, avoid: [], avoid_products: [], rx_treatment: null, market: null }

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

export const MARKETS: { id: Market; label: string; currency: string; symbol: string }[] = [
  { id: 'US', label: 'United States', currency: 'USD', symbol: '$' },
  { id: 'IN', label: 'India', currency: 'INR', symbol: '₹' },
  { id: 'SG', label: 'Singapore', currency: 'SGD', symbol: 'S$' },
  { id: 'UK', label: 'United Kingdom', currency: 'GBP', symbol: '£' },
  { id: 'EU', label: 'European Union', currency: 'EUR', symbol: '€' },
]
export const marketOf = (id: Market) => MARKETS.find((m) => m.id === id) ?? MARKETS[0]

const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'])

/** The market this browser most likely shops in: its language region, else its time zone; the US when neither says. */
export function marketFromLocale(): Market {
  const fromRegion = (r: string | undefined): Market | null => {
    if (!r) return null
    const R = r.toUpperCase()
    if (R === 'US' || R === 'IN' || R === 'SG') return R
    if (R === 'GB' || R === 'UK') return 'UK'
    return EU.has(R) ? 'EU' : null
  }
  try {
    for (const lang of navigator.languages ?? [navigator.language]) {
      const m = fromRegion(lang.split(/[-_]/)[1])
      if (m) return m
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 'IN'
    if (tz === 'Asia/Singapore') return 'SG'
    if (tz === 'Europe/London') return 'UK'
    if (tz.startsWith('Europe/')) return 'EU'
  } catch {
    /* no locale information */
  }
  return 'US'
}

/** Read the safety profile from GET /v1/me (null when none is saved yet, or the api predates it). */
export async function fetchSafety(token: string): Promise<SafetyProfile | null> {
  const me = await request<{ profile: { safety?: Partial<SafetyProfile> | null } | null }>(token, '/v1/me')
  const s = me.profile?.safety
  return s ? { ...EMPTY_SAFETY, ...s, avoid: s.avoid ?? [], avoid_products: s.avoid_products ?? [] } : null
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

export type CheckStatus = 'clear' | 'check' | 'avoid' | 'not_sold'
export type Grade = 'A' | 'B' | 'C'
export type SourceRef = { label: string; url: string }
export type SafetyFlag = { rule: string; level: 'check' | 'avoid'; title: string; detail: string; source: SourceRef | null; grade: Grade | null }
export type RegulatoryClass = 'cosmetic' | 'otc_drug' | 'pharmacy' | 'rx'
export type ProductCheck = { status: CheckStatus; flags: SafetyFlag[]; regulatory: { class: RegulatoryClass; market: string } | null }
export type SafetyCheckResponse = { profile_complete: boolean; checks: Record<string, ProductCheck> }

/** The words for each status (build spec): never "safe". Glyph and words always travel together. */
export const CHECK_WORDS: Record<CheckStatus, { label: string; short: string; glyph: string }> = {
  clear: { label: 'No flags for you', short: 'No flags', glyph: '✓' },
  check: { label: 'Check this', short: 'Check this', glyph: '!' },
  avoid: { label: 'Not advised for you', short: 'Not advised', glyph: '⊘' },
  not_sold: { label: 'Not sold as a cosmetic in your market', short: 'Not a cosmetic here', glyph: '—' },
}

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
    if (missing.length) void load(uid, missing, getIdToken)
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
