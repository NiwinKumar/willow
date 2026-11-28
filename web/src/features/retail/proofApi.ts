import { ApiError, request, retailerGet, type RetailerAnswer } from '../../lib/api'

/*
 * Proof by Willow organisations (api proof_routes.py, prefix /v1/proof; research/finals/build-spec.md "Proof
 * contracts"). An instance is one retailer's Proof deployment (own name, accent, domains); inside it live the
 * retailer organisation and brand organisations; people are members with a role. Every call here is the api's
 * own shape; nothing is computed. Public reads (instance, research, store clicks) need no token.
 */

export type OrgKind = 'retailer' | 'brand'
export type Role = 'admin' | 'analyst' | 'viewer'
export type ProofOrg = { id: string; name: string; kind: OrgKind; brands: string[]; all_brands?: boolean; verified: string | boolean | null; logo_url?: string | null }
/** `label`: a quiet line about the instance ("Demo catalog · every brand"); newer api builds only. */
export type ProofInstance = { id: string; name: string; label?: string | null; accent?: string | null; domains: string[]; demo: boolean }
export type InstanceView = { instance: ProofInstance; orgs: ProofOrg[] }
export type Membership = { org_id: string; role: Role; demo: boolean; instance?: string; joined_at?: string | null }
export type MeView = { memberships: Membership[]; current: { org_id: string; role: Role } | null }

export type Member = { uid_hint: string; role: Role; demo: boolean; joined_at: string | null; you?: boolean }
export type Invite = { email_hint: string; role: Role; status: 'pending' | string }
export type MembersView = { members: Member[]; invites: Invite[] }

export type Policy = { competitor_names: boolean; min_group: number; set_by?: string | null }
export type Plan = { name: string; billed?: boolean; includes?: string[] }
export type OrgSettings = { org?: ProofOrg; policy: Policy; plan: Plan; editable?: boolean }

export type DecisionStatus = 'open' | 'accepted' | 'dismissed' | 'snoozed' | 'done'
export type DecisionSnapshot = { title: string; figure: string; n: number | null }
export type DecisionItem = { status: DecisionStatus; reason?: string | null; updated_at: string | null; by_role?: Role | null }
export type DecisionLogEntry = { key: string; status: DecisionStatus; reason?: string | null; at: string; snapshot?: DecisionSnapshot | null; by_role?: Role | null }
export type DecisionsView = { items: Record<string, DecisionItem>; log: DecisionLogEntry[] }

/** The api forbids extra fields here (title ≤ 200, figure ≤ 120 characters). */
export type RequestSnapshot = { title: string; figure: string; n: number | null }
export type EvidenceRequest = {
  id: string
  from_org: string
  from_name?: string | null
  to_org: string
  to_name?: string | null
  product_id: string
  product?: string | null
  brand?: string | null
  message: string
  snapshot?: RequestSnapshot | null
  status: 'open' | 'answered' | 'declined' | string
  reply?: string | null
  created_at: string
  updated_at?: string | null
}
export type RequestsView = { inbox: EvidenceRequest[]; outbox: EvidenceRequest[] }

export type ClaimCohort = 'simulated' | 'mixed' | 'real'
export type SavedClaim = {
  id: string
  product_id: string
  product?: string | null
  brand?: string | null
  text: string
  statements: string[]
  /** The filter it was saved under, or (newer api) the cohort it rests on. */
  cohort: ClaimCohort | { filter?: string; kind?: string; label?: string; real?: number; simulated?: number }
  channel?: string | null
  n?: number | null
  window?: string | null
  method?: string | null
  caveat?: string | null
  exportable: boolean
  export_note?: string | null
  status: 'draft' | 'approved'
  created_at: string
  updated_at?: string | null
}

/** GET /v1/proof/research: method facts read from the api's code (api proof_research.py). */
export type ResearchTier = { id: string; label: string; rule: string; min_n: number }
export type ResearchMetric = { id: string; name: string; group?: string | null; unit?: string | null; unit_display?: string | null; better: 'higher' | 'lower' | null; lower_means?: string | null; higher_means?: string | null; outcome: boolean }
export type ResearchView = {
  method?: string
  window?: string
  weeks?: number
  caveat?: string
  tiers?: ResearchTier[]
  noise?: { rule: string; band_photos?: number; confidence?: number }
  suppression?: { min_group: number; rule: string }
  holdout?: { share: number; min_group: number; rule: string }
  simulated?: { people: number; weeks: number; seed: number; note: string }
  data_available?: boolean
  cohort?: { real: number; simulated: number; label?: string } | null
  data_from?: string | null
  data_to?: string | null
  metrics?: ResearchMetric[]
  consent?: string
  visibility?: { retailer_sees?: string[]; retailer_never_sees?: string[]; brands_see?: string[]; brands_never_see?: string[] }
}

/** GET /v1/retailer/clicks?days=: store clicks per product and store, groups under 10 as "<10". */
export type ClickCount = number | string
export type ClicksView = {
  days: number
  from?: string
  to?: string
  total: ClickCount
  items: { product_id: string; product?: string | null; brand?: string | null; store: string; clicks: ClickCount }[]
  products: { product_id: string; product?: string | null; brand?: string | null; clicks: ClickCount }[]
}

/** The connected range as the api keeps it (proof_routes.py RangeRow): the item file's rows with their match. */
export type RangeRowApi = { line: number; gtin: string; product_id: string; brand: string; name: string; category: string; price: string; facings: string; match: string | null; status: 'measured' | 'collecting' | 'no_users' | 'not_measured' | 'unrecognised' }
export type RangeApi = { filename: string; source: 'file' | 'catalog'; rows: RangeRowApi[]; uploaded_at: string | null; by_role?: Role | null }
/** `from`: whose item file a brand's range comes from (the retailer's, filtered to the brand). */
export type RangeView = { range: RangeApi | null; from: { org_id: string; name: string } | null }

/** POST /v1/proof/orgs/{org}/ask: the checked Ask, told whose question it is (`scope`), in a thread. */
export type OrgAnswer = RetailerAnswer & { scope?: { brand: string | null; names_hidden: boolean }; thread_id?: string | null }
/** One saved Ask conversation (GET /v1/proof/orgs/{org}/ask/threads[/{id}]). */
/** A saved turn: `q` (older drafts of the contract said `question`), the full answer object as the POST returned it. */
export type AskTurn = { q?: string; question?: string; answer: OrgAnswer | null; at?: string | null }
/** In the list `turns` is a count; in the detail it is the turns. */
export type AskThread = { id: string; title: string; updated_at: string | null; created_at?: string | null; turns?: AskTurn[] | number }

/** GET /v1/proof/orgs/{org}/fit: what opted-in shoppers avoid and react to; counts of people, ≥ min_group. */
export type FitView = {
  min_group: number
  profiled: number | null
  reacting: number | null
  avoid: { id: string; label: string; people: number }[]
  products: { product_id: string; product: string; brand: string; avoided: number | null; reacted: number | null; stopped: number | null }[]
  hidden: number
  basis: string
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })
const enc = encodeURIComponent
const P = '/v1/proof'

export const proofApi = {
  instance: (host: string, slug?: string | null) => retailerGet<InstanceView>(`${P}/instance?${new URLSearchParams({ host, ...(slug ? { slug } : {}) })}`),
  me: (t: string, instance: string) => request<MeView>(t, `${P}/me?instance=${enc(instance)}`),
  join: (t: string, body: { instance: string; org_id: string; role: Role }) => request<{ membership: Membership; current: { org_id: string } }>(t, `${P}/join`, { method: 'POST', ...json(body) }),
  members: (t: string, org: string) => request<MembersView>(t, `${P}/orgs/${enc(org)}/members`),
  invite: (t: string, org: string, body: { email: string; role: Role }) => request<Invite>(t, `${P}/orgs/${enc(org)}/invites`, { method: 'POST', ...json(body) }),
  settings: (t: string, org: string) => request<OrgSettings>(t, `${P}/orgs/${enc(org)}/settings`),
  putSettings: (t: string, org: string, body: Partial<OrgSettings>) => request<OrgSettings>(t, `${P}/orgs/${enc(org)}/settings`, { method: 'PUT', ...json(body) }),
  decisions: (t: string, org: string) => request<DecisionsView>(t, `${P}/orgs/${enc(org)}/decisions`),
  decide: (t: string, org: string, key: string, body: { status: DecisionStatus; reason?: string; snapshot?: DecisionSnapshot }) =>
    request<DecisionItem | DecisionsView>(t, `${P}/orgs/${enc(org)}/decisions/${enc(key)}`, { method: 'PUT', ...json(body) }),
  requests: (t: string, org: string) => request<RequestsView>(t, `${P}/orgs/${enc(org)}/requests`),
  sendRequest: (t: string, org: string, body: { to_org: string; product_id: string; message: string; snapshot: RequestSnapshot }) =>
    request<EvidenceRequest>(t, `${P}/orgs/${enc(org)}/requests`, { method: 'POST', ...json(body) }),
  answerRequest: (t: string, org: string, id: string, body: { status: 'answered' | 'declined'; reply: string }) =>
    request<EvidenceRequest>(t, `${P}/orgs/${enc(org)}/requests/${enc(id)}`, { method: 'PATCH', ...json(body) }),
  claims: (t: string, org: string) => request<{ claims: SavedClaim[] } | SavedClaim[]>(t, `${P}/orgs/${enc(org)}/claims`).then((r) => (Array.isArray(r) ? r : (r.claims ?? []))),
  saveClaim: (t: string, org: string, body: { product_id: string; text: string; statements: string[]; cohort: ClaimCohort; channel?: string }) =>
    request<SavedClaim>(t, `${P}/orgs/${enc(org)}/claims`, { method: 'POST', ...json(body) }),
  setClaim: (t: string, org: string, id: string, status: 'draft' | 'approved') => request<SavedClaim>(t, `${P}/orgs/${enc(org)}/claims/${enc(id)}`, { method: 'PATCH', ...json({ status }) }),
  exportClaim: (t: string, org: string, id: string) => request<{ claim: SavedClaim; exported_at: string }>(t, `${P}/orgs/${enc(org)}/claims/${enc(id)}/export`),
  range: (t: string, org: string) => request<RangeView>(t, `${P}/orgs/${enc(org)}/range`),
  putRange: (t: string, org: string, body: { filename: string; source: 'file' | 'catalog'; rows: RangeRowApi[] }) => request<RangeView>(t, `${P}/orgs/${enc(org)}/range`, { method: 'PUT', ...json(body) }),
  deleteRange: (t: string, org: string) => request<void>(t, `${P}/orgs/${enc(org)}/range`, { method: 'DELETE' }),
  ask: (t: string, org: string, body: { question: string; cohort: string; range: string; brand?: string | null; thread_id?: string | null }) => request<OrgAnswer>(t, `${P}/orgs/${enc(org)}/ask`, { method: 'POST', ...json(body) }),
  askThreads: (t: string, org: string) => request<{ threads: AskThread[] } | AskThread[]>(t, `${P}/orgs/${enc(org)}/ask/threads`).then((r) => (Array.isArray(r) ? r : (r.threads ?? []))),
  askThread: (t: string, org: string, id: string) => request<AskThread | { thread: AskThread }>(t, `${P}/orgs/${enc(org)}/ask/threads/${enc(id)}`).then((r) => ('thread' in r && r.thread ? r.thread : (r as AskThread))),
  deleteAskThread: (t: string, org: string, id: string) => request<void>(t, `${P}/orgs/${enc(org)}/ask/threads/${enc(id)}`, { method: 'DELETE' }),
  askSuggestions: (t: string, org: string, f?: { cohort: string; range: string }) => request<{ suggestions: string[] } | string[]>(t, `${P}/orgs/${enc(org)}/ask/suggestions${f ? `?${new URLSearchParams(f)}` : ''}`).then((r) => (Array.isArray(r) ? r : (r.suggestions ?? []))),
  fit: (t: string, org: string) => request<FitView>(t, `${P}/orgs/${enc(org)}/fit`),
  research: () => retailerGet<ResearchView>(`${P}/research`),
  clicks: (days = 30) => retailerGet<ClicksView>(`/v1/retailer/clicks?days=${days}`),
}

/** members answers either {members, invites} or a bare list (the contract's "[…] + invites"). */
export function membersOf(v: MembersView | Member[] | null | undefined): MembersView {
  if (!v) return { members: [], invites: [] }
  if (Array.isArray(v)) return { members: v, invites: [] }
  return { members: v.members ?? [], invites: v.invites ?? [] }
}

/** A plain sentence for an api failure on a Proof write. */
export function proofError(e: unknown, what: string): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return e.message && e.message !== 'Forbidden' ? e.message : `Your role can’t ${what}.`
    if (e.status === 401) return 'Sign in again to continue.'
    if (e.status === 404) return `This Proof build can’t ${what} yet.`
    if (e.message) return e.message
  }
  return `Couldn’t ${what}. Check the connection and try again.`
}

/** The api's 403 for AutoCampaign writes by someone with no analyst or admin membership (autopilot_routes). */
export const isNotMember = (e: unknown) => e instanceof ApiError && e.status === 403 && e.code === 'not_a_member'

/** Roles that may decide, draft and send (the contract's "analyst+"). */
export const canAct = (role: Role | null | undefined) => role === 'admin' || role === 'analyst'

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', analyst: 'Analyst', viewer: 'Viewer' }
export const ROLE_HINT: Record<Role, string> = {
  admin: 'Team, data-sharing policy and campaigns',
  analyst: 'Decide, draft claims, send requests and export',
  viewer: 'Read only',
}

/** The verified basis as words ("Verified from Northside's supplier list"); null when not verified. */
export function verifiedText(o: Pick<ProofOrg, 'verified'>): string | null {
  if (!o.verified) return null
  return typeof o.verified === 'string' ? o.verified : 'Verified by the retailer'
}

/** A saved claim's cohort in words ("Simulated cohort", "Simulated + real cohort"…): never "Mixed". */
export function claimCohortText(c: SavedClaim['cohort']): string {
  const word = (k: string) => (k === 'mixed' ? 'Simulated + real cohort' : `${k} cohort`)
  if (typeof c === 'string') return word(c)
  return c.label ?? word(c.kind ?? c.filter ?? 'unknown')
}

/** The demo catalog instance (a `label`, e.g. "Demo catalog · every brand"; id `willow`): its name adds nothing to the org's, so it stays out of the bar. */
export const isFallbackInstance = (i: { id: string; label?: string | null } | null) => Boolean(i?.label) || i?.id === 'willow'

/** Starter questions when the api has none for this organisation: answerable from the aggregates. */
export function fallbackSuggestions(kind: 'brand' | 'retailer', brand: string | null): string[] {
  if (kind === 'brand' && brand)
    return [`Which ${brand} products show the most visible change, and for whom?`, `How does ${brand} compare with the market on visible change?`, `Which ${brand} products are closest to Proven?`, `Where is demand growing for the goals ${brand} targets?`]
  return ['Which redness products work in the budget tier?', 'Where is demand growing fastest?', 'How much more often do users change than people with the same goals who don’t use it?', 'Which products do people say are working, and is it measured?']
}
