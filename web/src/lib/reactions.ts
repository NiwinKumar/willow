/**
 * Reaction log (POST/GET /v1/me/reactions). The outcome is fixed text chosen by a rule in code (api
 * app/reactions.py), never by Gemini: any sign of an allergic-type reaction → urgent; strong, or lasting 3+ days,
 * redness / itch / stinging → stop; anything else → mild. Every non-mild outcome puts the product on the
 * person's avoid list (safety.avoid_products) on the server.
 *
 * `localOutcome` is the same rule and the same words, so the advice still shows if saving fails: what to do
 * about a reaction must never depend on the network.
 */
import { useCallback } from 'react'

import { useOwner } from '../data/hooks'
import { ApiError, request } from './api'
import { invalidate, useQuery } from './query'
import { invalidateChecks } from './safety'
import { useAuth } from './useAuth'

export type ReactionSign = 'stinging' | 'redness' | 'itch' | 'dryness' | 'breakouts' | 'swelling' | 'blisters' | 'hives' | 'eyes_lips' | 'breathing'
export type ReactionLevel = 'urgent' | 'stop' | 'mild'
export type Reaction = { id: string; product_id: string; entry_id?: string | null; signs: ReactionSign[]; strength: 'mild' | 'strong'; since_days?: number; level: ReactionLevel; created_at: string }
export type ReactionOutcome = { level: ReactionLevel; title: string; steps: string[]; report?: string }
export type NewReaction = { product_id: string; entry_id?: string | null; signs: ReactionSign[]; strength: 'mild' | 'strong'; since_days: number }

/** Signs in the order the sheet asks them; the last five are the urgent ones. */
export const SIGNS: { id: ReactionSign; label: string }[] = [
  { id: 'stinging', label: 'Stinging or burning' },
  { id: 'redness', label: 'Redness' },
  { id: 'itch', label: 'Itch' },
  { id: 'dryness', label: 'Dryness or flaking' },
  { id: 'breakouts', label: 'New breakouts' },
  { id: 'swelling', label: 'Swelling' },
  { id: 'blisters', label: 'Blisters' },
  { id: 'hives', label: 'Hives or raised welts' },
  { id: 'eyes_lips', label: 'Eyes or lips affected' },
  { id: 'breathing', label: 'Trouble breathing' },
]
export const SIGN_LABEL = Object.fromEntries(SIGNS.map((s) => [s.id, s.label])) as Record<ReactionSign, string>

const URGENT: ReactionSign[] = ['swelling', 'blisters', 'hives', 'eyes_lips', 'breathing']
const IRRITATION: ReactionSign[] = ['redness', 'itch', 'stinging']

/** Calm containers per level: the state tokens, never a red fill, never "danger". */
export const LEVEL_LOOK: Record<ReactionLevel, { bg: string; fg: string; tag: string }> = {
  urgent: { bg: 'bg-avoid-bg', fg: 'text-avoid', tag: 'GET HELP NOW' },
  stop: { bg: 'bg-caution-bg', fg: 'text-caution', tag: 'STOP THIS PRODUCT' },
  mild: { bg: 'bg-info-bg', fg: 'text-info', tag: 'GO GENTLY' },
}

// "Redness" alone is a measured metric, so it is not a reaction word by itself.
const REACTION_WORDS = /\b(react(ion|ions|ed|ing|s)?|sting(s|ing|y)?|burn(s|ing|ed|t)?|rash(es)?|hives|swell(ing|ed|s|en)?|blister(s|ed|ing)?|itch(y|es|ing)?|allerg(y|ic|ies)|irritat(ed|ion|ing)|broke(n)? out|breaking out)\b/i

/** Does this text talk about a reaction to a product (Wisp shows the fixed escalation words under its answer)? */
export const mentionsReaction = (text: string | undefined) => REACTION_WORDS.test(text ?? '')

export const REPORT_LINE = 'You can report a reaction to the brand or to your national regulator.'

/** The fixed words per level (the same as the api's). */
export const OUTCOME_COPY: Record<ReactionLevel, { title: string; steps: string[] }> = {
  urgent: { title: 'Stop using it and get medical help now.', steps: ['Rinse it off with plenty of water.', 'If your breathing, eyes or lips are affected, call emergency services.', 'Take the product or its label with you.'] },
  stop: { title: "Stop this product, rinse with water, and see a doctor or pharmacist if it doesn't settle in a few days.", steps: ['Rinse it off with cool water; no scrubbing.', 'Keep the rest of your routine simple: a gentle cleanser and moisturiser.'] },
  mild: { title: 'Mild stinging or dryness can settle. Use it less often for a week; stop if it gets worse.', steps: ['Try every other night, or a smaller amount.', 'Stop if it spreads, gets stronger, or you see swelling.'] },
}

export function levelOf(r: Pick<NewReaction, 'signs' | 'strength' | 'since_days'>): ReactionLevel {
  if (r.signs.some((s) => URGENT.includes(s))) return 'urgent'
  if (r.signs.some((s) => IRRITATION.includes(s)) && (r.strength === 'strong' || r.since_days >= 3)) return 'stop'
  return 'mild'
}

export function localOutcome(r: Pick<NewReaction, 'signs' | 'strength' | 'since_days'>): ReactionOutcome {
  const level = levelOf(r)
  return { level, ...OUTCOME_COPY[level], report: level === 'mild' ? undefined : REPORT_LINE }
}

const key = (uid: string | null) => ['reactions', uid]

export function useReactions() {
  const uid = useOwner()
  return useQuery(key(uid), (t) => request<{ reactions: Reaction[] } | Reaction[]>(t, '/v1/me/reactions')
        .then((r) => (Array.isArray(r) ? r : (r.reactions ?? [])))
        // an api without the reaction log yet: nothing logged
        .catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? [] : Promise.reject(e))), { enabled: Boolean(uid), staleMs: 5 * 60_000 })
}

/** Log a reaction. Resolves with the server's outcome; the avoid list and checks are refetched. */
export function useLogReaction() {
  const uid = useOwner()
  const { getIdToken } = useAuth()
  return useCallback(
    async (body: NewReaction) => {
      const res = await request<{ reaction: Reaction; outcome: ReactionOutcome }>(await getIdToken(), '/v1/me/reactions', { method: 'POST', body: JSON.stringify(body) })
      invalidate(key(uid))
      invalidate(['me', uid])
      invalidate(['safety'])
      // the product is now on the avoid list: every chip asks again
      invalidateChecks()
      return res
    },
    [getIdToken, uid],
  )
}
