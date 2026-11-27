import { ArrowRight, Building2, ShieldCheck, Store, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { setQueryData, useQuery } from '../../../lib/query'
import { useAuth } from '../../../lib/useAuth'
import { InstanceName, RoleSelect, useOrg } from '../org'
import { setSettings, useOrgSettings } from '../orgData'
import { membersOf, proofApi, proofError, ROLE_HINT, ROLE_LABEL, verifiedText, type MembersView, type Role } from '../proofApi'
import { useResearch } from '../freshness'
import { purposeOf, useRetailState } from '../state'
import { Badge, Bone, Button, EmptyState, ErrorState, PageHeader, Panel, Tabs } from '../ui'

/*
 * Settings (/retail/settings), for the organisation you are in: its profile (name, kind, verified basis, the
 * instance and its domains), the team (members with roles, invites as pending rows: no email is sent in this
 * version), the data-sharing policy (minimum group, competitor names: the retailer's switch) and the plan (the
 * business model made visible: the retailer hosts, brands pay for evidence and Sponsored placements, the retailer
 * keeps a share). ?tab= keeps the view.
 */

const TABS = [
  { id: 'org', label: 'Organisation' },
  { id: 'team', label: 'Team' },
  { id: 'sharing', label: 'Data sharing' },
  { id: 'plan', label: 'Plan' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function Settings() {
  const { org, instance, role } = useOrg()
  const { param, setParam } = useRetailState()
  const tab: TabId = TABS.find((t) => t.id === param('tab'))?.id ?? 'org'
  if (!org || !instance)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Settings" purpose={purposeOf('settings')} />
        <EmptyState title="Organisations aren’t on this Proof build yet" body="Settings belong to an organisation (team, data sharing, plan). This api build runs Proof as one shared workspace." />
      </div>
    )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description={
          <>
            <strong>{org.name}</strong> · {org.kind === 'brand' ? 'brand' : 'retailer'}
            {instance.name !== org.name ? (
              <>
                {' '}
                on <InstanceName instance={instance} short />
              </>
            ) : null}{' '}
            · you are {role ? ROLE_LABEL[role].toLowerCase() : 'a member'}
          </>
        }
        purpose={purposeOf('settings')}
      />
      <Tabs label="Settings" panelId="settings-panel" value={tab} onChange={(t) => setParam({ tab: t === 'org' ? null : t })} tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} />
      <div id="settings-panel" role="tabpanel" key={tab} className="flex flex-col gap-4 animate-[proofPage_.2s_var(--ease-standard)_both]">
        {tab === 'org' ? (
          <>
            <AtAGlance onTab={(t) => setParam({ tab: t })} />
            <Profile />
          </>
        ) : tab === 'team' ? (
          <Team />
        ) : tab === 'sharing' ? (
          <Sharing />
        ) : (
          <Plan />
        )}
      </div>
    </div>
  )
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-t border-line px-5 py-3.5 first:border-t-0 sm:grid-cols-[220px_minmax(0,1fr)]">
      <dt className="text-proof-small font-medium text-ink">{k}</dt>
      <dd className="m-0 text-proof-small text-ink-2">{children}</dd>
    </div>
  )
}

/*
 * At a glance (Q2, finals polish): the three settings that change what people see and do, each with its state and
 * the tab that changes it. The Organisation tab was a read-only list with no next step.
 * Four tests: (1) team size, the naming rule brands live under and the plan, which the profile list doesn't say;
 * (2) a label, a value, a link that says where it goes; (3) one compact row above the profile, no motion beyond
 * the kit's hover; (4) the KpiStrip/ProductsLead look (hairline cells on a card).
 */
function AtAGlance({ onTab }: { onTab: (t: TabId) => void }) {
  const { org, role } = useOrg()
  const settings = useOrgSettings()
  const id = org?.id ?? ''
  const team = useQuery<MembersView>(['proof-members', id], (t) => proofApi.members(t, id).then(membersOf), { enabled: Boolean(org), staleMs: 30_000 })
  const policy = settings.data?.policy
  const people = team.data ? team.data.members.length : null
  const invites = team.data ? team.data.invites.length : 0
  const cells: { id: TabId; label: string; value: string; sub: string; cta: string }[] = [
    {
      id: 'team',
      label: 'Team',
      value: people === null ? '…' : `${people} ${people === 1 ? 'member' : 'members'}`,
      sub: invites ? `${invites} invite${invites === 1 ? '' : 's'} pending` : role === 'admin' ? 'You can invite analysts and viewers' : 'Admins invite new members',
      cta: role === 'admin' ? 'Invite' : 'See team',
    },
    {
      id: 'sharing',
      label: 'Data sharing',
      value: policy ? (policy.competitor_names ? 'Competitor names shown' : 'Competitors anonymised') : '…',
      sub: policy ? `Groups under ${policy.min_group} people are always hidden` : 'Groups under 10 people are always hidden',
      cta: org?.kind === 'retailer' && role === 'admin' ? 'Change' : 'See rules',
    },
    {
      id: 'plan',
      label: 'Plan',
      value: settings.data?.plan.name ?? 'Pilot',
      sub: settings.data?.plan.billed === false || !settings.data ? 'Not billed during the pilot' : 'Billed',
      cta: 'See plan',
    },
  ]
  return (
    <section aria-label="Settings at a glance" className="grid grid-cols-1 overflow-hidden rounded-card border border-line bg-surface md:grid-cols-3">
      {cells.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onTab(c.id)}
          className="group flex min-w-0 items-end justify-between gap-3 border-0 border-line bg-transparent px-5 py-4 text-left transition-colors hover:bg-pf-hover active:bg-pf-hover [&:not(:last-child)]:border-b md:[&:not(:last-child)]:border-b-0 md:[&:not(:last-child)]:border-r"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-proof-small text-ink-2">{c.label}</span>
            <span className="truncate text-proof-h text-ink">{c.value}</span>
            <span className="truncate text-proof-small text-ink-2">{c.sub}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-proof-small font-medium text-ink">
            {c.cta}
            <ArrowRight size={13} strokeWidth={1.7} aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </span>
        </button>
      ))}
    </section>
  )
}

function Profile() {
  const { org, instance, role, memberships } = useOrg()
  if (!org || !instance) return null
  const basis = verifiedText(org)
  const m = memberships.find((x) => x.org_id === org.id)
  return (
    <Panel title="Organisation profile" id="s-org-h" description="Organisations are set up with the retailer when it signs; brands are verified from its supplier list." flush>
      <dl className="m-0 flex flex-col">
        <Row k="Name">
          <span className="inline-flex items-center gap-2 text-ink">
            {org.kind === 'brand' ? <Building2 size={14} strokeWidth={1.7} aria-hidden /> : <Store size={14} strokeWidth={1.7} aria-hidden />} {org.name}
          </span>
        </Row>
        <Row k="Kind">{org.kind === 'brand' ? `Brand · owns ${org.brands.join(', ')}` : `Retailer · ${org.all_brands ? 'every brand in the catalog' : `${org.brands.length} brands`}`}</Row>
        <Row k="Verified">
          {basis ? (
            <span className="inline-flex items-center gap-1.5 text-proof-leaf">
              <ShieldCheck size={14} strokeWidth={1.8} aria-hidden /> {basis}
            </span>
          ) : (
            'Not verified: no supplier list or registry confirmed this organisation.'
          )}
        </Row>
        <Row k="Instance">
          <span className="flex flex-col gap-0.5">
            <InstanceName instance={instance} />
            <span>{instance.domains.length ? instance.domains.join(' · ') : 'No custom domain'}</span>
            {instance.demo ? <span>Demo instance: anyone signed in can try any organisation; their memberships and campaigns are marked demo.</span> : null}
          </span>
        </Row>
        <Row k="Your role">
          {role ? `${ROLE_LABEL[role]} · ${ROLE_HINT[role]}` : '—'}
          {m?.demo ? ' · demo membership' : ''}
        </Row>
      </dl>
    </Panel>
  )
}

function Team() {
  const { org, role } = useOrg()
  const { getIdToken } = useAuth()
  const id = org?.id ?? ''
  const q = useQuery<MembersView>(['proof-members', id], (t) => proofApi.members(t, id).then(membersOf), { enabled: Boolean(org), staleMs: 30_000 })
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<Role>('analyst')
  const [busy, setBusy] = useState(false)
  const admin = role === 'admin'
  const invite = async () => {
    if (!org) return
    setBusy(true)
    try {
      const row = await proofApi.invite(await getIdToken(), org.id, { email: email.trim(), role: newRole })
      setQueryData<MembersView>(['proof-members', id], (v) => ({ members: v?.members ?? [], invites: [row, ...(v?.invites ?? [])] }))
      setEmail('')
      toast(`Invite recorded for ${row.email_hint} · pending`)
    } catch (e) {
      toast.error(proofError(e, 'invite people'))
    } finally {
      setBusy(false)
    }
  }
  if (q.status === 'error' && !q.data) return <ErrorState title="The team didn’t load" onRetry={() => void q.refetch()} />
  if (!q.data) return <Bone className="h-48 w-full" />
  const { members, invites } = q.data
  return (
    <>
      <Panel title="Members" id="s-team-h" meta={<Badge>{members.length}</Badge>} description="Admin: team, policy and campaigns · Analyst: decide, draft claims, send requests, export · Viewer: read." flush>
        <ul className="m-0 flex list-none flex-col p-0">
          {members.map((m, i) => (
            <li key={`${m.uid_hint}-${i}`} className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 animate-[proofPage_.24s_var(--ease-standard)_both]" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
              <span aria-hidden className="grid size-7 place-items-center rounded-full bg-sunken font-mono text-[11px] text-ink-2">
                {m.uid_hint.slice(0, 2)}
              </span>
              <span className="font-mono text-proof-small text-ink">{m.uid_hint}</span>
              {m.you ? <Badge tone="green">You</Badge> : null}
              {m.demo ? <Badge tone="outline">Demo</Badge> : null}
              <span className="ml-auto flex items-center gap-3 text-proof-small text-ink-2">
                <span>{ROLE_LABEL[m.role]}</span>
                {m.joined_at ? <span className="tnum">joined {new Date(m.joined_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span> : null}
              </span>
            </li>
          ))}
          {invites.map((inv, i) => (
            <li key={`inv-${inv.email_hint}-${i}`} className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 animate-[proofPage_.24s_var(--ease-standard)_both]">
              <span aria-hidden className="grid size-7 place-items-center rounded-full border border-dashed border-line-strong text-ink-2">
                <UserPlus size={13} strokeWidth={1.7} />
              </span>
              <span className="text-proof-small text-ink">{inv.email_hint}</span>
              <Badge tone="amber">Pending</Badge>
              <span className="ml-auto text-proof-small text-ink-2">{ROLE_LABEL[inv.role] ?? inv.role}</span>
            </li>
          ))}
        </ul>
        <p className="m-0 border-t border-line bg-pf-bg2 px-5 py-3 text-proof-small text-ink-2">People are shown by a short id only. Single sign-on (SAML) and SCIM provisioning are planned.</p>
      </Panel>
      <Panel title="Invite a colleague" id="s-inv-h" description={admin ? 'The invite is recorded as pending; no email is sent in this version (the address is kept as a hash and a hint).' : 'Only an admin can invite.'}>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (/^\S+@\S+\.\S+$/.test(email.trim())) void invite()
          }}
        >
          <label className="sr-only" htmlFor="invite-email">
            Work email
          </label>
          <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!admin || busy} placeholder="name@company.com" className="h-9 w-[min(320px,100%)] rounded-ctl border border-line bg-surface px-3 text-proof-small text-ink placeholder:text-ink-2 hover:border-line-strong disabled:opacity-50" />
          <RoleSelect value={newRole} onChange={setNewRole} />
          <Button type="submit" kind="primary" disabled={!admin || busy || !/^\S+@\S+\.\S+$/.test(email.trim())}>
            <UserPlus size={15} strokeWidth={1.7} aria-hidden /> {busy ? 'Inviting…' : 'Invite'}
          </Button>
        </form>
      </Panel>
    </>
  )
}

function Sharing() {
  const { org } = useOrg()
  const { getIdToken } = useAuth()
  const s = useOrgSettings()
  const r = useResearch()
  const [busy, setBusy] = useState(false)
  if (s.status === 'error' && !s.data) return <ErrorState title="The policy didn’t load" onRetry={() => void s.refetch()} />
  if (!s.data || !org) return <Bone className="h-48 w-full" />
  const policy = s.data.policy
  const editable = Boolean(s.data.editable)
  const toggle = async () => {
    setBusy(true)
    try {
      const next = await proofApi.putSettings(await getIdToken(), org.id, { policy: { competitor_names: !policy.competitor_names, min_group: policy.min_group } })
      setSettings(org.id, next)
      toast(next.policy.competitor_names ? 'Brands now see competitors by name' : 'Brands now see competitors as Brand A, Brand B')
    } catch (e) {
      toast.error(proofError(e, 'change the policy'))
    } finally {
      setBusy(false)
    }
  }
  const v = r.d?.visibility
  return (
    <>
      <Panel title="Data-sharing policy" id="s-pol-h" description={org.kind === 'brand' ? 'Set by the retailer; every brand in this instance gets the same rules.' : 'Your rules for every brand in this instance.'} flush>
        <dl className="m-0 flex flex-col">
          <Row k="Minimum group">
            <span className="text-ink tnum">{policy.min_group} people</span> · any group smaller is hidden before any view, export or answer sees it. Fixed at 10 in this version; a stricter floor for brand-facing views is planned.
          </Row>
          <Row k="Competitor names for brands">
            <span className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={policy.competitor_names}
                aria-label="Show competitor names to brands"
                disabled={!editable || busy}
                onClick={() => void toggle()}
                className={`relative h-6 w-10 shrink-0 rounded-pill border-0 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${policy.competitor_names ? 'bg-proof-leaf' : 'bg-line-strong'}`}
              >
                <span aria-hidden className={`absolute top-0.5 size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[left] duration-200 ${policy.competitor_names ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
              <span>{policy.competitor_names ? 'On: brands see other brands by name.' : 'Off: brands see other brands as “Brand A”, “Brand B”, and the category median.'}</span>
              {!editable ? <span className="text-ink-2">{org.kind === 'brand' ? 'Set by the retailer.' : 'Only an admin can change it.'}</span> : null}
            </span>
          </Row>
        </dl>
      </Panel>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Brands see" id="s-see-h">
          <List items={v?.brands_see} />
        </Panel>
        <Panel title="Brands never see" id="s-never-h">
          <List items={v?.brands_never_see} />
        </Panel>
      </div>
    </>
  )
}

function List({ items }: { items: string[] | undefined }) {
  if (!items?.length) return <p className="m-0 text-proof-small text-ink-2">—</p>
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((x) => (
        <li key={x} className="text-proof-small text-ink-2">
          {x}
        </li>
      ))}
    </ul>
  )
}

const PLANS = [
  { id: 'retailer', title: 'Retailer pilot', who: 'The retailer hosts Proof', body: 'Outcomes for every product in the range, the decisions home, campaigns with a randomised holdout and evidence requests to brands. The retailer’s range and shoppers make the data, so the platform fee is low.' },
  { id: 'brand', title: 'Brand evidence', who: 'Brands pay per product band', body: 'Outcomes, evidence packs and claim drafts for a brand’s own products, priced by how many products are covered, like evidence badges at retail. A fraction of one clinical study, across the whole range, continuously.' },
  { id: 'sponsored', title: 'Sponsored share', who: 'Brands pay for reach; the retailer keeps a share', body: 'Sponsored placements in the Willow app, only for Proven products and only to the people the evidence covers. Money buys reach, never eligibility or rank; every campaign reports its lift against a holdout.' },
] as const

function Plan() {
  const { org } = useOrg()
  const s = useOrgSettings()
  const current = org?.kind === 'brand' ? 'brand' : 'retailer'
  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {PLANS.map((p, i) => {
          const on = p.id === current
          return (
            <section key={p.id} aria-label={p.title} className={`flex flex-col gap-2 rounded-card border bg-surface p-5 animate-[proofPage_.28s_var(--ease-standard)_both] ${on ? 'border-proof-leaf-line' : 'border-line'}`} style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center gap-2">
                <h2 className="m-0 text-proof-h text-ink">{p.title}</h2>
                {on ? <Badge tone="green">Your plan</Badge> : null}
              </div>
              <span className="text-proof-small font-medium text-ink">{p.who}</span>
              <p className="m-0 text-proof-small text-ink-2">{p.body}</p>
              {on && s.data?.plan.includes?.length ? (
                <ul className="m-0 mt-1 flex list-none flex-col gap-1 border-t border-line p-0 pt-3">
                  {s.data.plan.includes.map((x) => (
                    <li key={x} className="text-proof-small text-ink-2">
                      ✓ {x}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )
        })}
      </div>
      <p className="m-0 text-proof-small text-ink-2">{s.data ? `${s.data.plan.name}${s.data.plan.billed === false ? ': not billed during the pilot.' : '.'}` : 'Pilot: not billed.'} Proof measures adds to a routine, continuation and skin outcomes; it does not see sales, returns or stock levels.</p>
    </>
  )
}
