import { LogIn } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ApiError } from '../../lib/api'
import { setQueryData, useQuery } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import { ProofMark } from './brand'
import { ChooseOrg } from './ChooseOrg'
import { proofApi, ROLE_LABEL, type InstanceView, type Membership, type MeView, type ProofInstance, type ProofOrg, type Role } from './proofApi'
import { Bone, Button, ErrorState, primeBrandLogos, Select } from './ui'
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
  // Orgs carry their logo (newer api): every BrandLogo of that org's brand uses it too.
  useEffect(() => {
    primeBrandLogos(Object.fromEntries(orgs.flatMap((o) => (o.logo_url ? [[o.name, o.logo_url], ...(o.kind === 'brand' ? o.brands.map((b) => [b, o.logo_url]) : [])] : []))))
  }, [orgs])
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
      <GateFrame wide>
      <ChooseOrg
        view={inst.v}
        memberships={memberships}
        lockup={<Lockup instance={inst.v.instance} />}
        onPick={async (id) => {
          await switchOrg(id, { rejoin: true })
          doneChoosing()
        }}
        onSignOut={signOut}
        onCancel={org ? doneChoosing : undefined}
      />
      </GateFrame>
    )
  if (!org) {
    if (inst.v.instance.demo)
      return (
        <GateFrame wide>
          <ChooseOrg view={inst.v} memberships={memberships} lockup={<Lockup instance={inst.v.instance} />} onPick={switchOrg} onSignOut={signOut} />
        </GateFrame>
      )
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

function GateFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className={`flex min-h-dvh items-start justify-center px-4 pb-16 sm:px-6 ${wide ? 'pt-[8vh]' : 'pt-[12vh]'}`}>
      <div className={`flex w-full flex-col gap-6 animate-[proofPage_.24s_var(--ease-standard)_both] ${wide ? 'max-w-[760px]' : 'max-w-[720px]'}`}>{children}</div>
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
      {instance && !instance.label && instance.id !== 'willow' ? (
        <>
          <span aria-hidden className="text-[20px] font-light text-line-strong">
            /
          </span>
          <InstanceName instance={instance} />
        </>
      ) : instance?.label ? (
        <span className="ml-1 text-proof-small text-ink-2">{instance.label}</span>
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

/** A role picker for invites (Settings). */
export function RoleSelect({ value, onChange, label = 'Role' }: { value: Role; onChange: (r: Role) => void; label?: string }) {
  return <Select label={label} hideLabel value={value} onChange={onChange} options={(['admin', 'analyst', 'viewer'] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
}
