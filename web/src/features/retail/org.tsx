import { Building2, LogIn, ShieldCheck, Store } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ApiError } from '../../lib/api'
import { setQueryData, useQuery } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import { ProofMark } from './brand'
import { proofApi, proofError, ROLE_HINT, ROLE_LABEL, verifiedText, type InstanceView, type Membership, type MeView, type ProofInstance, type ProofOrg, type Role } from './proofApi'
import { Badge, Bone, Button, Combobox, ErrorState, Select } from './ui'
import { slugOf } from './ui/format'

/*
 * Who is looking (research/finals/06 §6.2): the Proof instance (one retailer's deployment, resolved from the
 * hostname, e.g. proof.northside.beauty; `?instance=` overrides it for the demo), then the signed-in person's
 * membership in one of its organisations, with a role. A brand organisation maps to the brand workspace of its
 * own brand (?as= is ignored for it), so every section keeps working unchanged; the retailer organisation keeps
 * today's retailer view, including "view as" any brand.
 *
 * When this api build has no organisation endpoints (or the instance call fails) Proof runs as before: one
 * retailer view, open brand switcher, labelled demo. That keeps every route working while the api catches up.
 */

export type OrgState = {
  /** null: organisations unavailable on this api build (legacy single-workspace mode). */
  instance: ProofInstance | null
  orgs: ProofOrg[]
  org: ProofOrg | null
  role: Role | null
  memberships: Membership[]
  /** The brand an organisation is limited to (brand orgs); null for the retailer or legacy mode. */
  lockedBrand: string | null
  switchOrg: (orgId: string, opts?: { rejoin?: boolean }) => Promise<void>
  signOut: () => Promise<void>
  orgName: (id: string) => string
}

const OrgCtx = createContext<OrgState | null>(null)

export function useOrg(): OrgState {
  const c = useContext(OrgCtx)
  if (!c) throw new Error('useOrg outside OrgProvider')
  return c
}

/** Outside the provider (tests, legacy screens): no org. */
export function useOrgMaybe(): OrgState | null {
  return useContext(OrgCtx)
}

const pickKey = (instance: string) => `willow.proof.org.${instance}`
function readPick(instance: string): string | null {
  try {
    return window.localStorage.getItem(pickKey(instance))
  } catch {
    return null
  }
}
function savePick(instance: string, org: string) {
  try {
    window.localStorage.setItem(pickKey(instance), org)
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
}

type InstanceLoad = { status: 'loading' } | { status: 'ready'; v: InstanceView } | { status: 'legacy' }

const instanceCache = new Map<string, Promise<InstanceView>>()

function useInstance(): InstanceLoad {
  const [params] = useSearchParams()
  const slug = params.get('instance')
  const host = typeof window === 'undefined' ? '' : window.location.hostname
  const key = `${host}|${slug ?? ''}`
  const [res, setRes] = useState<{ key: string; load: InstanceLoad }>({ key: '', load: { status: 'loading' } })
  useEffect(() => {
    let alive = true
    let p = instanceCache.get(key)
    if (!p) {
      p = proofApi.instance(host, slug)
      p.catch(() => instanceCache.delete(key))
      instanceCache.set(key, p)
    }
    p.then(
      (v) => alive && setRes({ key, load: v?.instance ? { status: 'ready', v } : { status: 'legacy' } }),
      () => alive && setRes({ key, load: { status: 'legacy' } }),
    )
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return res.key === key ? res.load : { status: 'loading' }
}

/**
 * The org gate: resolves the instance, asks for sign-in, reads the membership, and either shows "Choose how to
 * explore" (a demo instance with no membership yet) or renders the app inside the organisation.
 */
export function OrgProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const inst = useInstance()
  const uid = auth.user?.uid ?? null
  const instanceId = inst.status === 'ready' ? inst.v.instance.id : null
  const me = useQuery<MeView>(['proof-me', uid, instanceId], (t) => proofApi.me(t, instanceId!), { enabled: Boolean(uid && instanceId), staleMs: 5 * 60_000 })
  const [pick, setPick] = useState<string | null>(null)
  useEffect(() => {
    if (instanceId) setPick(readPick(instanceId))
  }, [instanceId])

  const orgs = useMemo(() => (inst.status === 'ready' ? inst.v.orgs : []), [inst])
  const memberships = useMemo(() => me.data?.memberships ?? [], [me.data])
  const currentId = (() => {
    if (pick && memberships.some((m) => m.org_id === pick)) return pick
    if (me.data?.current && memberships.some((m) => m.org_id === me.data!.current!.org_id)) return me.data.current.org_id
    return memberships[0]?.org_id ?? null
  })()
  const org = orgs.find((o) => o.id === currentId) ?? null
  const role = memberships.find((m) => m.org_id === currentId)?.role ?? null

  const switchOrg = useCallback(
    async (orgId: string, opts: { rejoin?: boolean } = {}) => {
      if (!instanceId) return
      const have = memberships.find((m) => m.org_id === orgId)
      // Joining again (from "Choose how to explore") gives the demo role that can act: analyst or admin.
      if (!have || (opts.rejoin && have.role === 'viewer')) {
        const target = orgs.find((o) => o.id === orgId)
        const t = await auth.getIdToken()
        const joined = await proofApi.join(t, { instance: instanceId, org_id: orgId, role: target?.kind === 'brand' ? 'analyst' : 'admin' })
        setQueryData<MeView>(['proof-me', uid, instanceId], (prev) => ({ memberships: [...(prev?.memberships ?? []).filter((m) => m.org_id !== orgId), { org_id: orgId, role: joined?.membership?.role ?? 'analyst', demo: true }], current: prev?.current ?? null }))
      }
      savePick(instanceId, orgId)
      setPick(orgId)
    },
    [instanceId, memberships, orgs, auth, uid],
  )

  // A demo deep link into a brand's view (?as=brand:<slug>, e.g. the brand journey): sign in as a guest and join
  // the matching organisation (else the retailer's), so the link opens where it points instead of on a gate.
  const [params, setParams] = useSearchParams()
  const asParam = params.get('as')
  // `?choose=1` (AutoCampaign's "Choose how to explore"): the demo gate again, to join with a role that can act.
  const choosing = params.get('choose') === '1'
  const doneChoosing = useCallback(() => setParams((p) => { const n = new URLSearchParams(p); n.delete('choose'); return n }, { replace: true }), [setParams])
  const [guestTried, setGuestTried] = useState(false)
  const [joinTried, setJoinTried] = useState(false)
  const demo = inst.status === 'ready' && inst.v.instance.demo
  useEffect(() => {
    if (!demo || !asParam || auth.loading) return
    if (!auth.user) {
      if (guestTried) return
      setGuestTried(true)
      auth.continueAsGuest().catch(() => undefined)
      return
    }
    if (joinTried || !me.data || memberships.length) return
    setJoinTried(true)
    const slug = asParam.startsWith('brand:') ? asParam.slice(6) : null
    const target = orgs.find((o) => o.kind === 'brand' && o.brands.some((b) => slugOf(b) === slug)) ?? orgs.find((o) => o.kind === 'retailer')
    if (target) switchOrg(target.id).catch(() => undefined)
  }, [demo, asParam, guestTried, joinTried, auth.loading, auth.user, me.data, memberships.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = useCallback(async () => {
    await auth.signOutUser()
    setPick(null)
  }, [auth])

  const value = useMemo<OrgState>(
    () => ({
      instance: inst.status === 'ready' ? inst.v.instance : null,
      orgs,
      org,
      role,
      memberships,
      lockedBrand: org?.kind === 'brand' ? (org.brands[0] ?? null) : null,
      switchOrg,
      signOut,
      orgName: (id: string) => orgs.find((o) => o.id === id)?.name ?? id,
    }),
    [inst, orgs, org, role, memberships, switchOrg, signOut],
  )

  if (inst.status === 'loading' || auth.loading) return <GateLoading />
  if (!auth.user) return <SignIn instance={inst.status === 'ready' ? inst.v.instance : null} />
  // Legacy mode: no organisation endpoints on this api build.
  if (inst.status === 'legacy') return <OrgCtx.Provider value={value}>{children}</OrgCtx.Provider>
  if (me.status === 'error' && !me.data) {
    const missing = me.error instanceof ApiError && me.error.status === 404
    if (missing) return <OrgCtx.Provider value={{ ...value, instance: null }}>{children}</OrgCtx.Provider>
    return (
      <GateFrame>
        <ErrorState title="Your organisation didn’t load" body="Proof couldn’t read your membership. Nothing is shown rather than another organisation’s view." onRetry={() => void me.refetch()} />
      </GateFrame>
    )
  }
  if (!me.data) return <GateLoading />
  if (choosing && inst.v.instance.demo)
    return (
      <ChooseOrg
        view={inst.v}
        onPick={async (id) => {
          await switchOrg(id, { rejoin: true })
          doneChoosing()
        }}
        onSignOut={signOut}
        onCancel={org ? doneChoosing : undefined}
      />
    )
  if (!org) {
    if (inst.v.instance.demo) return <ChooseOrg view={inst.v} onPick={switchOrg} onSignOut={signOut} />
    return (
      <GateFrame>
        <ErrorState title={`You’re not a member of ${inst.v.instance.name} yet`} body="Ask an admin of your organisation to invite you. Invites are sent from Settings → Team." />
        <div className="flex justify-center">
          <Button onClick={() => void signOut()}>Sign out</Button>
        </div>
      </GateFrame>
    )
  }
  return <OrgCtx.Provider value={value}>{children}</OrgCtx.Provider>
}

/** The brand slug an organisation maps to (?as=brand:<slug>). */
export const brandSlugOf = (org: ProofOrg | null) => (org?.kind === 'brand' && org.brands[0] ? slugOf(org.brands[0]) : null)

/* ───────────────────────────── gate screens ───────────────────────────── */

function GateFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 pb-16 pt-[12vh] sm:px-6">
      <div className="flex w-full max-w-[720px] flex-col gap-6 animate-[proofPage_.24s_var(--ease-standard)_both]">{children}</div>
    </main>
  )
}

function GateLoading() {
  return (
    <GateFrame>
      <div role="status" aria-label="Opening Proof" className="flex flex-col gap-3">
        <Bone className="h-8 w-56" />
        <Bone className="h-4 w-80" />
        <Bone className="mt-4 h-40 w-full" />
      </div>
    </GateFrame>
  )
}

function Lockup({ instance }: { instance: ProofInstance | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <ProofMark size={28} />
      <span className="flex items-baseline gap-1.5 text-[16px] tracking-[-0.01em] text-ink">
        <span className="font-semibold">Proof</span>
        <span className="text-ink-2">by Willow</span>
      </span>
      {instance ? (
        <>
          <span aria-hidden className="text-[20px] font-light text-line-strong">
            /
          </span>
          <InstanceName instance={instance} />
        </>
      ) : null}
    </div>
  )
}

/** The instance's name with its accent as a small swatch (the accent never recolours data). */
export function InstanceName({ instance, short = false }: { instance: ProofInstance; short?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-proof-small font-medium text-ink" title={instance.domains[0] ? `${instance.name} · ${instance.domains[0]}` : instance.name}>
      {instance.accent ? <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: instance.accent }} /> : null}
      <span className={`truncate ${short ? 'max-w-[140px]' : ''}`}>{instance.name}</span>
    </span>
  )
}

function SignIn({ instance }: { instance: ProofInstance | null }) {
  const { continueAsGuest, signInWithGoogle } = useAuth()
  const [busy, setBusy] = useState<'guest' | 'google' | null>(null)
  const go = async (kind: 'guest' | 'google') => {
    setBusy(kind)
    try {
      await (kind === 'guest' ? continueAsGuest() : signInWithGoogle())
    } catch {
      toast.error('Sign-in didn’t work. Try again.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <GateFrame>
      <Lockup instance={instance} />
      <section className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-proof-title text-ink">Sign in to {instance?.name ?? 'Proof'}</h1>
          <p className="m-0 max-w-[60ch] text-proof-body text-ink-2">
            Proof shows which products are linked to a measured, held change for real people, and helps a retailer and its brands decide what to stock, promote and claim. Each organisation sees its own workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" size="lg" onClick={() => void go('google')} disabled={busy !== null}>
            <LogIn size={16} strokeWidth={1.7} aria-hidden /> {busy === 'google' ? 'Signing in…' : 'Sign in with Google'}
          </Button>
          <Button size="lg" onClick={() => void go('guest')} disabled={busy !== null}>
            {busy === 'guest' ? 'Starting…' : 'Explore as a guest'}
          </Button>
        </div>
        <p className="m-0 border-t border-line pt-4 text-proof-small text-ink-2">A guest account is enough for the demo. Proof shows aggregates only: no person, photo or group under 10 people is ever visible to a business.</p>
      </section>
    </GateFrame>
  )
}

function ChooseOrg({ view, onPick, onSignOut, onCancel }: { view: InstanceView; onPick: (id: string) => Promise<void>; onSignOut: () => Promise<void>; onCancel?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const pick = async (id: string) => {
    setBusy(id)
    try {
      await onPick(id)
    } catch (e) {
      toast.error(proofError(e, 'join that organisation'))
      setBusy(null)
    }
  }
  const retailer = view.orgs.filter((o) => o.kind === 'retailer')
  const brands = view.orgs.filter((o) => o.kind === 'brand')
  return (
    <GateFrame>
      <Lockup instance={view.instance} />
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="m-0 text-proof-title text-ink">Choose how to explore</h1>
          <Badge tone="amber">Demo</Badge>
        </div>
        <p className="m-0 max-w-[62ch] text-proof-body text-ink">
          Proof shows which skincare products are linked to a measured, held change in people’s own photos, against people with the same goals who don’t use them. A retailer uses it to run its range; a brand uses it to prove and promote its products.
        </p>
        <p className="m-0 max-w-[62ch] text-proof-small text-ink-2">
          {view.instance.name} is a demo: pick a seat to join with a demo role. You land on Home, where each card is one decision with its evidence and one action. In a real deployment the retailer’s admin invites you and brands are verified from its supplier list. Switch any time from the account menu (“Try as”).
        </p>
      </div>
      <ul className={`m-0 grid list-none grid-cols-1 gap-3 p-0 ${brands.length > 5 ? '' : 'sm:grid-cols-2'}`}>
        {[...retailer, ...(brands.length > 5 ? [] : brands)].map((o, i) => (
          <li key={o.id} className="animate-[proofPage_.28s_var(--ease-standard)_both]" style={{ animationDelay: `${i * 40}ms` }}>
            <OrgChoice org={o} busy={busy === o.id} disabled={busy !== null} onPick={() => void pick(o.id)} />
          </li>
        ))}
      </ul>
      {brands.length > 5 ? (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5">
          <span className="text-proof-body font-medium text-ink">Or explore as one of {brands.length} brands</span>
          <span className="text-proof-small text-ink-2">A brand sees its own products’ evidence, answers the retailer’s requests and promotes what is Proven.</span>
          <div>
            <Combobox label="Brand" value="" emptyText="Choose a brand" options={brands.map((o) => ({ value: o.id, label: o.name, hint: 'Analyst' }))} onChange={(id) => void pick(id)} width={320} disabled={busy !== null} />
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 text-proof-small text-ink-2">
        <span>Memberships made here are marked demo; campaigns they launch are shown to guest accounts only.</span>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="hit44 shrink-0 border-0 bg-transparent text-proof-small text-ink-2 underline-offset-2 hover:text-ink hover:underline">
            Back
          </button>
        ) : null}
        <button type="button" onClick={() => void onSignOut()} className="hit44 shrink-0 border-0 bg-transparent text-proof-small text-ink-2 underline-offset-2 hover:text-ink hover:underline">
          Sign out
        </button>
      </div>
    </GateFrame>
  )
}

function OrgChoice({ org, busy, disabled, onPick }: { org: ProofOrg; busy: boolean; disabled: boolean; onPick: () => void }) {
  const role: Role = org.kind === 'brand' ? 'analyst' : 'admin'
  const Icon = org.kind === 'brand' ? Building2 : Store
  const basis = verifiedText(org)
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="group flex h-full w-full flex-col gap-3 rounded-card border border-line bg-surface p-5 text-left transition-[border-color,background,transform] duration-150 hover:border-line-strong hover:bg-pf-hover active:scale-[.99] disabled:cursor-wait disabled:opacity-70"
    >
      <span className="flex items-center gap-3">
        <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-ctl ${org.kind === 'brand' ? 'bg-proof-leaf-soft text-proof-leaf' : 'bg-ink text-inverse'}`}>
          <Icon size={17} strokeWidth={1.7} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-proof-body font-medium text-ink">
            {ROLE_LABEL[role]} at {org.name}
          </span>
          <span className="text-proof-small text-ink-2">{org.kind === 'brand' ? `Brand · ${org.brands.join(', ')}` : 'Retailer · every brand in the range'}</span>
        </span>
      </span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-proof-small text-ink-2">
        {(org.kind === 'brand'
          ? [
              ['Prove', 'which of your products show a measured change, for whom'],
              ['Claim', 'listing lines that quote only measured statements'],
              ['Promote', 'Proven products, with a holdout that measures the lift'],
            ]
          : [
              ['Stock', 'what earns its shelf, from outcomes across your range'],
              ['Question', 'ask a brand for evidence before a range review'],
              ['Promote', 'Proven products to the people they work for'],
            ]
        ).map(([k, v]) => (
          <li key={k}>
            <span className="font-medium text-ink">{k}:</span> {v}
          </li>
        ))}
      </ul>
      <span className="mt-auto flex flex-wrap items-center gap-2 text-proof-label text-ink-2">
        {basis ? (
          <span className="inline-flex items-center gap-1 text-proof-leaf">
            <ShieldCheck size={13} strokeWidth={1.8} aria-hidden /> {basis}
          </span>
        ) : null}
        <span>{ROLE_HINT[role]}</span>
        <span className="ml-auto font-medium text-ink group-hover:underline">{busy ? 'Joining…' : 'Open →'}</span>
      </span>
    </button>
  )
}

/** A role picker for invites (Settings). */
export function RoleSelect({ value, onChange, label = 'Role' }: { value: Role; onChange: (r: Role) => void; label?: string }) {
  return <Select label={label} hideLabel value={value} onChange={onChange} options={(['admin', 'analyst', 'viewer'] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
}
