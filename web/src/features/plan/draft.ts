/**
 * The routine builder's answers, kept in this tab (sessionStorage) so a reload or a step back never loses
 * them, and the last answer from /v1/plan for those answers.
 */
import { createContext, useContext } from 'react'

import { cleanGoals, type GoalId } from '../../lib/metrics'
import { BUDGET_RANGE, type PlanRequest, type PlanResponse, type PlanSkin, type StepCount, type Tier } from './planApi'
import { budgetCurrency, marketFromLocale, type AvoidId, type LifeStage, type Market, type SafetyProfile } from '../../lib/safety'

export type Draft = {
  skin_type: PlanSkin | null
  reactive: boolean
  goals: GoalId[]
  life_stage: LifeStage
  avoid: AvoidId[]
  /** Ingredient names the person reacted to before, and their note (features/you/PastReactions). */
  avoid_ingredients: string[]
  note: string | null
  rx_treatment: boolean
  market: Market
  budget: number
  tier: Tier
  steps: StepCount
}

/** The plan picks one active per goal at most, so three goals is the limit here. */
export const PLAN_MAX_GOALS = 3

export const STEP_IDS = ['skin', 'goals', 'care', 'budget', 'brewing', 'profile', 'routine'] as const
export type StepId = (typeof STEP_IDS)[number]
/** The questions, counted in the progress bar. */
export const QUESTION_COUNT = 4

const KEY = 'willow.planDraft'
const RESULT = 'willow.planResult'

export function defaultDraft(seed: { skin_type?: string | null; goals?: string[]; safety?: SafetyProfile | null }): Draft {
  const market = seed.safety?.market ?? marketFromLocale()
  const skin = seed.skin_type
  return {
    skin_type: skin === 'oily' || skin === 'combination' || skin === 'dry' || skin === 'normal' ? skin : null,
    reactive: seed.safety?.reactive ?? skin === 'sensitive',
    goals: cleanGoals(seed.goals ?? []).slice(0, PLAN_MAX_GOALS),
    life_stage: seed.safety?.life_stage ?? 'none',
    avoid: seed.safety?.avoid ?? [],
    avoid_ingredients: seed.safety?.avoid_ingredients ?? [],
    note: seed.safety?.note ?? null,
    rx_treatment: seed.safety?.rx_treatment ?? false,
    market,
    budget: BUDGET_RANGE[budgetCurrency(market)]?.start ?? 25,
    tier: 'any',
    steps: 4,
  }
}

export function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    // a draft from before the reacted-to questions has neither field
    return raw ? ({ avoid_ingredients: [], note: null, ...JSON.parse(raw) } as Draft) : null
  } catch {
    return null
  }
}
export function writeDraft(d: Draft) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* storage blocked: kept in memory for this visit */
  }
}

export type StoredResult = { key: string; plan: PlanResponse }
export function readResult(): StoredResult | null {
  try {
    const raw = sessionStorage.getItem(RESULT)
    return raw ? (JSON.parse(raw) as StoredResult) : null
  } catch {
    return null
  }
}
export function writeResult(r: StoredResult | null) {
  try {
    if (r) sessionStorage.setItem(RESULT, JSON.stringify(r))
    else sessionStorage.removeItem(RESULT)
  } catch {
    /* storage blocked */
  }
}

/** The request these answers make (safety from the answers, keeping what only the account knows). */
export function requestOf(d: Draft, base: SafetyProfile, adult: boolean | null): PlanRequest | null {
  if (!d.skin_type) return null
  const safety: SafetyProfile = { ...base, adult: adult ?? base.adult, life_stage: d.life_stage, reactive: d.reactive, avoid: d.avoid, avoid_ingredients: d.avoid_ingredients, note: d.note?.trim() || null, rx_treatment: d.rx_treatment, market: d.market }
  return {
    skin_type: d.skin_type,
    reactive: d.reactive,
    goals: d.goals,
    budget: { max_per_product: d.budget, currency: budgetCurrency(d.market) },
    tier: d.tier,
    steps: d.steps,
    market: d.market,
    safety,
  }
}

/** Same answers, same plan: the key a stored result is kept under (only what the questions set, so the
 * account's own fields arriving after a reload never make the plan stale). */
export const keyOf = (r: PlanRequest) => {
  const { life_stage, reactive, avoid, avoid_ingredients, rx_treatment, market } = r.safety
  return JSON.stringify({ ...r, safety: { life_stage, reactive, avoid, avoid_ingredients, rx_treatment, market } })
}

export type PlanState = {
  draft: Draft
  set: (patch: Partial<Draft>) => void
  /** The plan for the current answers, once brewed. */
  result: PlanResponse | null
  setResult: (r: PlanResponse) => void
  request: PlanRequest | null
  go: (step: StepId, opts?: { replace?: boolean }) => void
  /** Where the plan ends: `?next=` (onboarding) or Routine. */
  exit: string
}

export const PlanContext = createContext<PlanState | null>(null)
export function usePlan(): PlanState {
  const ctx = useContext(PlanContext)
  if (!ctx) throw new Error('usePlan outside Plan')
  return ctx
}
