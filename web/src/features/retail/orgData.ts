import { flushSync } from 'react-dom'
import { toast } from 'sonner'

import { getQueryData, setQueryData, useQuery } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import { useRetailData } from './context'
import { brandAlias, brandOrder } from './masking'
import { useOrg } from './org'
import { proofApi, proofError, type DecisionItem, type DecisionsView, type DecisionSnapshot, type DecisionStatus, type OrgSettings, type RequestsView, type SavedClaim } from './proofApi'

/*
 * The organisation's shared state (decisions, evidence requests, saved claims), read through the app's query
 * cache so Home, the product page and the pipeline see one answer. Off (no requests) in legacy mode.
 */

const decisionsKey = (org: string) => ['proof-decisions', org] as const
const requestsKey = (org: string) => ['proof-requests', org] as const
const claimsKey = (org: string) => ['proof-claims', org] as const

export function useDecisions() {
  const { org } = useOrg()
  const id = org?.id ?? ''
  return useQuery<DecisionsView>(decisionsKey(id), (t) => proofApi.decisions(t, id), { enabled: Boolean(org), staleMs: 30_000 })
}

export function useRequests() {
  const { org } = useOrg()
  const id = org?.id ?? ''
  return useQuery<RequestsView>(requestsKey(id), (t) => proofApi.requests(t, id), { enabled: Boolean(org), staleMs: 20_000 })
}

export function useSavedClaims() {
  const { org } = useOrg()
  const id = org?.id ?? ''
  return useQuery<SavedClaim[]>(claimsKey(id), (t) => proofApi.claims(t, id), { enabled: Boolean(org), staleMs: 30_000 })
}

/** Run a state change inside a view transition when the browser has one (lane moves glide), else at once. */
export function withTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || still) return update()
  doc.startViewTransition(() => flushSync(update))
}

/**
 * Change a decision's state: shown at once (the card moves lanes), written to the organisation, undone with a
 * message if the api refuses. Every change also lands in the log with the numbers as they were.
 */
export function useDecide() {
  const { org, role } = useOrg()
  const { getIdToken } = useAuth()
  return async (key: string, status: DecisionStatus, opts: { reason?: string; snapshot?: DecisionSnapshot; quiet?: boolean } = {}) => {
    if (!org) return false
    const k = decisionsKey(org.id)
    const before = getQueryData<DecisionsView>(k)
    const at = new Date().toISOString()
    withTransition(() =>
      setQueryData<DecisionsView>(k, (prev) => ({
        items: { ...(prev?.items ?? {}), [key]: { status, reason: opts.reason ?? null, updated_at: at, by_role: role } satisfies DecisionItem },
        log: [{ key, status, reason: opts.reason ?? null, at, snapshot: opts.snapshot ?? null, by_role: role }, ...(prev?.log ?? [])],
      })),
    )
    try {
      const t = await getIdToken()
      const res = await proofApi.decide(t, org.id, key, { status, ...(opts.reason ? { reason: opts.reason } : {}), ...(opts.snapshot ? { snapshot: opts.snapshot } : {}) })
      // the api may answer the whole view; take it when it does
      if (res && typeof res === 'object' && 'items' in res) setQueryData<DecisionsView>(k, res)
      return true
    } catch (e) {
      withTransition(() => setQueryData<DecisionsView>(k, before ?? { items: {}, log: [] }))
      if (!opts.quiet) toast.error(proofError(e, 'record that decision'))
      return false
    }
  }
}

export const setRequests = (org: string, f: (v: RequestsView | undefined) => RequestsView) => setQueryData<RequestsView>(requestsKey(org), f)
export const setClaims = (org: string, f: (v: SavedClaim[] | undefined) => SavedClaim[]) => setQueryData<SavedClaim[]>(claimsKey(org), f)

const settingsKey = (org: string) => ['proof-settings', org] as const

export function useOrgSettings() {
  const { org } = useOrg()
  const id = org?.id ?? ''
  return useQuery<OrgSettings>(settingsKey(id), (t) => proofApi.settings(t, id), { enabled: Boolean(org), staleMs: 60_000 })
}
export const setSettings = (org: string, v: OrgSettings) => setQueryData<OrgSettings>(settingsKey(org), v)

/**
 * The retailer's competitor-naming policy, applied in the browser for brand organisations (research 06 §4.2; the
 * api stores the policy but its retailer views have no organisation context). Off by default and while the
 * settings load (fail closed): other brands read "Brand A", "Brand B"… (stable letters from the catalog's brand
 * order); the viewer's own brand keeps its name. The retailer always sees names.
 */
export function useCompetitorNames(): { anonymise: boolean; name: (brand: string) => string; own: string | null } {
  const { org, lockedBrand } = useOrg()
  const allBrands = useRetailData().brands.map((b) => b.brand)
  const settings = useOrgSettings()
  const anonymise = org?.kind === 'brand' && !(settings.data?.policy.competitor_names ?? false)
  const order = brandOrder(allBrands)
  const name = (brand: string) => (anonymise ? brandAlias(brand, order, lockedBrand) : brand)
  return { anonymise, name, own: lockedBrand }
}

/** This organisation's saved claims for one product, counted (null in legacy mode). */
export function useClaimCounts(productId: string): { total: number; approved: number } | null {
  const { org } = useOrg()
  const q = useSavedClaims()
  if (!org) return null
  const list = (q.data ?? []).filter((c) => c.product_id === productId)
  return { total: list.length, approved: list.filter((c) => c.status === 'approved').length }
}
