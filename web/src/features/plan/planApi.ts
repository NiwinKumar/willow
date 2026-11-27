/**
 * The routine builder's api (POST /v1/plan, api app/plan.py): deterministic picks from the catalog by fixed
 * rules, no Gemini. Types follow research/finals/build-spec.md "POST /v1/plan".
 */
import type { Product } from '../../data/types'
import { ApiError, request } from '../../lib/api'
import type { GoalId } from '../../lib/metrics'
import type { EvidenceEntry, Market, ProductCheck, SafetyProfile } from '../../lib/safety'

export type PlanSkin = 'oily' | 'combination' | 'dry' | 'normal'
export type Tier = 'budget' | 'mid' | 'premium' | 'any'
export type StepCount = 3 | 4 | 5

export type PlanRequest = {
  skin_type: PlanSkin
  reactive: boolean
  goals: GoalId[]
  budget: { max_per_product: number; currency: string }
  tier: Tier
  steps: StepCount
  market: Market
  safety: SafetyProfile
}

export type PlanSlot = 'cleanser' | 'moisturizer' | 'sunscreen' | 'active'
export type PlanWhen = 'am' | 'pm' | 'both'
export type FunnelStep = { id: string; label: string; n: number }
export type SkinProfile = {
  title: string
  traits: { id: string; label: string; detail: string }[]
  focus: string[]
  avoid: string[]
  cautions: string[]
}
export type PlanPick = {
  slot: PlanSlot
  when: PlanWhen
  product: Product
  why: string[]
  check: ProductCheck | null
  start_week: number
  verdict_week: number | null
  evidence: EvidenceEntry | null
  proof: { tier: 'proven' | 'promising'; n: number } | null
  alternatives: Product[]
}
export type PlanResponse = {
  profile: SkinProfile
  funnel: FunnelStep[]
  picks: PlanPick[]
  schedule: { week: number; text: string }[]
  notes: string[]
  total: { amount: number; currency: string }
}

export const postPlan = (token: string, body: PlanRequest) => request<PlanResponse>(token, '/v1/plan', { method: 'POST', body: JSON.stringify(body) }, 45_000)

/**
 * The plain sentence inside an api error: `detail.message`, a string `detail`, or a validation list's first
 * message. Falls back to `fallback` (never shows raw JSON).
 */
export function errorText(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback
  const msg = e.message
  if (msg && !msg.trim().startsWith('{') && !msg.trim().startsWith('[')) return msg
  try {
    const detail = (JSON.parse(msg) as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && typeof detail[0]?.msg === 'string') return fallback
  } catch {
    /* not JSON */
  }
  return fallback
}

/** Per market currency: the budget slider's range, step and starting point (per product). */
export const BUDGET_RANGE: Record<string, { min: number; max: number; step: number; start: number }> = {
  USD: { min: 5, max: 90, step: 1, start: 25 },
  INR: { min: 200, max: 3000, step: 50, start: 800 },
  SGD: { min: 8, max: 120, step: 1, start: 35 },
  GBP: { min: 5, max: 80, step: 1, start: 20 },
  EUR: { min: 5, max: 90, step: 1, start: 25 },
}

export const SLOT_WORDS: Record<PlanSlot, string> = { cleanser: 'Cleanser', moisturizer: 'Moisturiser', sunscreen: 'Sunscreen', active: 'Active' }
export const WHEN_WORDS: Record<PlanWhen, string> = { am: 'AM', pm: 'PM', both: 'AM + PM' }

const SYMBOL: Record<string, string> = { USD: '$', INR: '₹', SGD: 'S$', GBP: '£', EUR: '€' }

/** Money as the plan's currency writes it ("$25", "₹800", "S$12.50"); other currencies by the browser. */
export function money(amount: number, currency: string): string {
  const digits = amount % 1 ? 2 : 0
  const sym = SYMBOL[currency]
  if (sym) return `${sym}${amount.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: digits }).format(amount)
  } catch {
    return `${currency} ${amount}`
  }
}

/** The last plan made on this device (so Routine can show "next from your plan" later). */
const LAST = 'willow.plan.last'
export function saveLastPlan(plan: PlanResponse, req: PlanRequest) {
  try {
    localStorage.setItem(LAST, JSON.stringify({ at: new Date().toISOString(), request: req, plan }))
  } catch {
    /* storage blocked */
  }
}
export function lastPlan(): { at: string; request: PlanRequest; plan: PlanResponse } | null {
  try {
    const raw = localStorage.getItem(LAST)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
