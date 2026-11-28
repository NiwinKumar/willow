import './retail.css'

import { ArrowLeftRight, Check, ChevronDown, ChevronsUpDown, LogOut, Monitor, Moon, MoreHorizontal, Search, ShieldCheck, Sun } from 'lucide-react'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ErrorBoundary } from '../../components/ErrorBoundary'
import { AskPanel } from './AskAggregates'
import { ProofMark } from './brand'
import { useAuth } from '../../lib/useAuth'
import { fetchInsights, RetailDataProvider, useRetailData } from './context'
import { totalUsers } from './data'
import { useDataTo } from './freshness'
import { buildMask, maskText } from './masking'
import { InstanceName, OrgProvider, useOrg } from './org'
import { useCompetitorNames } from './orgData'
import { useProducts } from './productData'
import { isFallbackInstance, ROLE_LABEL, verifiedText } from './proofApi'
import { ADVANCED, COHORTS, LEGACY_PATHS, RANGES, SECTIONS, sectionPath, useRetailState } from './state'
import type { Insights, Range } from './types'
import { setExportFilter } from './ui/format'
import { BrandLogo, cohortKind, Combobox, type ComboOption, int, Menu, MenuDivider, MenuItem, MenuLabel, Segmented, SkeletonHeader, SkeletonKpis, SkeletonTable, useTooltip } from './ui'

/*
 * Willow Proof (docs/RETAIL_BRAND.md, docs/RETAILER_INSIGHTS.md "App structure"): the business app at
 * /retail/*, laid out like Vercel's dashboard. A top bar (Proof mark / workspace switcher on the left; data
 * scope, Ask and theme on the right) over a row of section tabs; pages sit in a 1200 px column. All state is in
 * the URL (state.ts); the insights aggregates are fetched once per filter (context.tsx).
 */

const Home = lazy(() => import('./sections/Home'))
const Overview = lazy(() => import('./sections/Overview'))
const Range = lazy(() => import('./sections/Range'))
const Digest = lazy(() => import('./sections/Digest'))
const Research = lazy(() => import('./sections/Research'))
const Settings = lazy(() => import('./sections/Settings'))
const Products = lazy(() => import('./sections/Products'))
const ProductDetail = lazy(() => import('./sections/ProductDetail'))
const Compare = lazy(() => import('./sections/Compare'))
const Customers = lazy(() => import('./sections/Customers'))
const Market = lazy(() => import('./sections/Market'))
const Campaigns = lazy(() => import('./sections/Promote'))
const CampaignDashboard = lazy(() => import('./sections/CampaignDashboard'))
const Explore = lazy(() => import('./sections/Explore'))

/* ───────────────────────────── theme ───────────────────────────── */

type ThemePref = 'system' | 'light' | 'dark'
const THEME_KEY = 'willow.proof.theme'
function readTheme(): ThemePref {
  try {
    const v = window.localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** The viewer's theme (system unless chosen), applied to <html> while Proof is open and restored after. */
function useProofTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readTheme)
  useLayoutEffect(() => {
    const html = document.documentElement
    const before = html.dataset.theme
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    html.classList.remove('proof-boot-dark') // the pre-app dark paint from index.html; the tokens take over now
    const apply = () => {
      html.dataset.proof = '1'
      html.dataset.theme = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref
    }
    apply()
    mq.addEventListener('change', apply)
    return () => {
      mq.removeEventListener('change', apply)
      delete html.dataset.proof
      if (before === undefined) delete html.dataset.theme
      else html.dataset.theme = before
    }
  }, [pref])
  const set = (t: ThemePref) => {
    setPref(t)
    try {
      window.localStorage.setItem(THEME_KEY, t)
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }
  return [pref, set]
}

export default function Retail() {
  const [theme, setTheme] = useProofTheme()
  return (
    <div className="proof-root relative min-h-dvh bg-canvas font-geist text-proof-body text-ink antialiased">
      <OrgProvider>
        <RetailDataProvider>
          <Shell theme={theme} onTheme={setTheme} />
        </RetailDataProvider>
      </OrgProvider>
    </div>
  )
}

type Section = (typeof SECTIONS)[number]

/** Which section a path is in ("/retail/products/x" → products; Range and Compare belong to Products). */
function sectionOf(pathname: string): { nav: Section; page: Section } {
  const seg = pathname.replace(/^\/retail\/?/, '').split('/')[0]
  const adv = ADVANCED.find((a) => a.path === seg)
  const navId = seg === 'compare' || seg === 'range' ? 'products' : seg === 'digest' ? 'home' : LEGACY_PATHS[seg as keyof typeof LEGACY_PATHS]?.section
  const nav = SECTIONS.find((s) => (navId ? s.id === navId : s.path === seg)) ?? SECTIONS[0]
  if (seg === 'digest') return { nav, page: { ...nav, id: 'digest', label: 'Weekly digest', decision: '' } }
  if (seg === 'range') return { nav, page: { ...nav, id: 'range', label: 'Range', decision: 'Connect your range once: Proof matches your item file to the measured catalog and says what is measured, collecting or new.' } }
  return { nav, page: adv && seg !== 'compare' ? adv : seg === 'compare' ? (ADVANCED.find((a) => a.id === 'compare') ?? nav) : nav }
}

/**
 * While a brand organisation sees competitors anonymised, every file that leaves Proof (CSV, evidence pack,
 * brief, copied text) is filtered through the same names the screens use (masking.ts), so no export path can
 * carry another brand's name. Built from the brand list at once and from the catalog once it loads.
 */
function useExportMask() {
  const names = useCompetitorNames()
  const { filters, brands } = useRetailData()
  const { state } = useProducts(filters)
  const rows = state.status === 'ready' ? state.d.products : null
  const brandNames = brands.map((b) => b.brand).join('|')
  useEffect(() => {
    if (!names.anonymise) return setExportFilter(null)
    const brandList = brandNames ? brandNames.split('|') : []
    const list = rows ? rows.map((r) => ({ brand: r.brand, product: r.product })) : brandList.map((b) => ({ brand: b, product: '' }))
    const m = buildMask(list, names.own, brandList)
    setExportFilter((t) => maskText(t, m))
    return () => setExportFilter(null)
  }, [names.anonymise, names.own, rows, brandNames])
}

function Shell({ theme, onTheme }: { theme: ThemePref; onTheme: (t: ThemePref) => void }) {
  useExportMask()
  const { pathname } = useLocation()
  const { page } = sectionOf(pathname)
  const { param, setParam } = useRetailState()
  const { insights, filters, workspace } = useRetailData()
  const { org } = useOrg()
  const head = useRef<HTMLDivElement>(null)
  const askOpen = param('ask') === '1'

  useEffect(() => {
    document.title = `${page.label} · Proof by Willow`
  }, [page.label])
  // A new page starts at the top (filters and tabs change the query string, not the path, so they keep it).
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    if (!window.location.hash) window.scrollTo(0, 0)
  }, [pathname])
  // Focus never lands under the sticky header.
  useLayoutEffect(() => {
    const el = head.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      document.documentElement.style.scrollPaddingTop = `${el.offsetHeight + 16}px`
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.scrollPaddingTop = ''
    }
  }, [])
  // ⌘K / Ctrl+K opens Ask from anywhere.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        // Already open: don't stack another history entry (Back would seem to do nothing).
        if (new URLSearchParams(window.location.search).get('ask') === '1') return
        setParam({ ask: '1' }, { push: true })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [setParam])

  const d = insights.status === 'ready' || insights.status === 'empty' ? insights.d : null

  return (
    <>
      <a href="#proof-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-ctl focus:bg-selected focus:px-3 focus:py-2 focus:text-inverse">
        Skip to content
      </a>
      <div ref={head} className="sticky top-0 z-40 [view-transition-name:proof-head] border-b border-line bg-canvas/90 [-webkit-backdrop-filter:blur(16px)_saturate(1.4)] [backdrop-filter:blur(16px)_saturate(1.4)]">
        <TopBar d={d} loading={insights.status === 'loading'} theme={theme} onTheme={onTheme} onAsk={() => setParam({ ask: '1' }, { push: true })} />
        <SectionTabs />
      </div>

      <main id="proof-main" tabIndex={-1} className="px-4 pb-24 pt-8 outline-none sm:px-6">
        <div className="mx-auto w-full max-w-[1200px]">
          <SimulatedNotice d={d} real={filters.cohort === 'real'} />
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<SectionFallback />}>
              <div key={`${org?.id ?? ''}|${page.id}`} className="animate-[proofPage_.2s_var(--ease-standard)_both]">
                <Routes>
                  <Route index element={<Home />} />
                  <Route path="board" element={<Overview />} />
                  <Route path="range" element={<Range />} />
                  <Route path="digest" element={<Digest />} />
                  <Route path="research" element={<Research />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="products" element={<Products />} />
                  <Route path="products/:productId" element={<ProductDetail />} />
                  <Route path="compare" element={<Compare />} />
                  <Route path="customers" element={<Customers />} />
                  <Route path="market" element={<Market />} />
                  <Route path="campaigns" element={<Campaigns />} />
                  <Route path="campaigns/:campaignId" element={<CampaignDashboard />} />
                  <Route path="explore" element={<Explore />} />
                  <Route path=":legacy/*" element={<Legacy />} />
                </Routes>
              </div>
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      <AskPanel
        open={askOpen}
        onClose={() => setParam({ ask: null, q: null })}
        d={d}
        filters={filters}
        scope={`${org?.id ?? ''}|${workspace.kind === 'brand' ? workspace.slug : 'retailer'}`}
        focusBrand={workspace.kind === 'brand' ? (workspace.brand ?? null) : null}
        prefill={askOpen ? param('q') : null}
        onPrefillUsed={() => setParam({ q: null })}
      />
    </>
  )
}

/** Round-1 paths (/retail/promote, /retail/categories/serum...) land on their new home with their keys. */
function Legacy() {
  const { legacy = '', '*': rest = '' } = useParams()
  const { params } = useRetailState()
  const to = LEGACY_PATHS[legacy as keyof typeof LEGACY_PATHS]
  if (!to) return <Navigate to={`/retail${params.toString() ? `?${params}` : ''}`} replace />
  const q = new URLSearchParams(params)
  for (const [k, v] of Object.entries(to.params ?? {})) q.set(k, v)
  if (legacy === 'categories' && rest) q.set('category', rest)
  return <Navigate to={`${sectionPath(to.section)}?${q}`} replace />
}

function SectionFallback() {
  return (
    <div role="status" aria-label="Loading section" className="flex flex-col gap-6">
      <SkeletonHeader />
      <SkeletonKpis />
      <SkeletonTable rows={6} />
    </div>
  )
}

/* ───────────────────────────── top bar ───────────────────────────── */

/**
 * Top-left: the organisation you are in, led by its logo (name, kind and your role under it; verified basis on
 * hover). Its menu is the account menu: who is signed in and where, your organisations, "Explore as another
 * organisation" on a demo instance (the Choose screen, with search and logos), sign out.
 */
function OrgSwitcher() {
  const { instance, org, role, orgs, memberships, switchOrg, signOut } = useOrg()
  const { user } = useAuth()
  const { carry } = useRetailState()
  const navigate = useNavigate()
  const basis = org ? verifiedText(org) : null
  const tip = useTooltip(basis ?? '')
  if (!instance || !org) return null
  const who = user?.isAnonymous ? 'Guest account' : (user?.email ?? 'Signed in')
  const go = async (id: string, close: () => void) => {
    close()
    if (id === org.id) return
    try {
      await switchOrg(id)
      toast(`Now in ${orgs.find((o) => o.id === id)?.name ?? id}`)
    } catch {
      toast.error('Couldn’t switch. Try again.')
    }
  }
  // Yours first (memberships), then the retailer of a demo instance; the other 400-odd brands live on the Choose screen.
  const mine = orgs.filter((o) => memberships.some((m) => m.org_id === o.id))
  const house = instance.demo ? orgs.filter((o) => o.kind === 'retailer' && !mine.includes(o)) : []
  const kindWord = (o: { kind: string }) => (o.kind === 'brand' ? 'Brand' : 'Retailer')
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Menu
        label={`Organisation: ${org.name}. Account menu`}
        width={320}
        className="min-w-0"
        triggerClass="hit44 group flex h-10 min-w-0 max-w-full items-center gap-2.5 rounded-ctl border border-transparent bg-transparent pl-1 pr-1.5 text-left transition-colors hover:bg-pf-hover"
        trigger={
          <>
            <span key={org.id} className="inline-flex animate-[proofSwap_.24s_var(--ease-standard)_both]">
              <BrandLogo brand={org.name} src={org.logo_url} kind={org.kind} size={28} />
            </span>
            <span key={`n-${org.id}`} className="flex min-w-0 flex-col leading-[16px] animate-[proofSwap_.24s_var(--ease-standard)_both]">
              <span className="max-w-[200px] truncate text-proof-small font-semibold text-ink">{org.name}</span>
              <span className="hidden truncate text-[11px] text-ink-2 sm:block">
                {kindWord(org)}
                {role ? ` · ${ROLE_LABEL[role]}` : ''}
              </span>
            </span>
            <ChevronsUpDown size={14} strokeWidth={1.6} aria-hidden className="shrink-0 text-ink-2 transition-colors group-hover:text-ink" />
          </>
        }
      >
        {(close) => (
          <>
            <div className="flex items-center gap-3 px-3 pb-2.5 pt-2.5">
              <BrandLogo brand={org.name} src={org.logo_url} kind={org.kind} size={36} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-proof-body font-medium text-ink">{org.name}</span>
                <span className="truncate text-proof-label text-ink-2">
                  {kindWord(org)}
                  {role ? ` · ${ROLE_LABEL[role]}` : ''} · {who}
                </span>
              </span>
            </div>
            {!isFallbackInstance(instance) || instance.label ? (
              <span className="mx-3 mb-2 truncate rounded-ctl bg-pf-bg2 px-2.5 py-1.5 text-proof-label text-ink-2">
                {isFallbackInstance(instance) ? instance.label : <><InstanceName instance={instance} short /> {instance.domains[0] ? `· ${instance.domains[0]}` : instance.label ? `· ${instance.label}` : ''}</>}
              </span>
            ) : null}
            <MenuDivider />
            <MenuLabel>{mine.length > 1 ? 'Your organisations' : 'Your organisation'}</MenuLabel>
            {[...mine, ...house].map((o) => {
              const m = memberships.find((x) => x.org_id === o.id)
              return (
                <MenuItem key={o.id} current={o.id === org.id} onClick={() => void go(o.id, close)} sub={`${kindWord(o)}${m ? ` · ${ROLE_LABEL[m.role]}` : instance.demo ? ' · joins as a demo member' : ''}`}>
                  <BrandLogo brand={o.name} src={o.logo_url} kind={o.kind} size={20} />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {o.id === org.id ? <Check size={14} strokeWidth={1.8} aria-hidden className="text-proof-leaf" /> : null}
                </MenuItem>
              )
            })}
            {instance.demo ? (
              <MenuItem
                onClick={() => {
                  close()
                  navigate(`/retail${carry}${carry ? '&' : '?'}choose=1`)
                }}
                sub={`Any of ${int(orgs.filter((o) => o.kind === 'brand').length)} brands, or the retailer (demo)`}
              >
                <ArrowLeftRight size={14} strokeWidth={1.7} aria-hidden className="text-ink-2" /> Explore as another organisation…
              </MenuItem>
            ) : null}
            <MenuDivider />
            <MenuItem
              onClick={() => {
                close()
                void signOut()
              }}
            >
              <LogOut size={14} strokeWidth={1.7} aria-hidden className="text-ink-2" /> Sign out
            </MenuItem>
          </>
        )}
      </Menu>
      {basis ? (
        <>
          <span {...tip.trigger} tabIndex={0} aria-label={basis} className="hidden cursor-help rounded-pill lg:inline-flex">
            <span className="inline-flex h-6 items-center gap-1 rounded-pill bg-proof-leaf-soft px-2 text-proof-label font-medium text-proof-leaf">
              <ShieldCheck size={12} strokeWidth={1.9} aria-hidden /> Verified
            </span>
          </span>
          {tip.node}
        </>
      ) : null}
    </div>
  )
}

/**
 * "Viewing": which brand's lens the retailer is looking through (?as=brand:<slug>). Retailer organisations (and
 * the legacy single-workspace mode) only: a brand organisation always sees its own brand.
 */
function Workspace() {
  const { brands, workspace } = useRetailData()
  const { setWorkspace } = useRetailState()
  const { org, lockedBrand, instance } = useOrg()
  if (lockedBrand) return null
  const options: ComboOption[] = [
    { value: 'retailer', label: 'Whole range', hint: 'every brand', group: org ? org.name : 'Retailer', icon: <BrandLogo brand={org?.name ?? 'Retailer'} src={org?.logo_url} kind="retailer" size={18} /> },
    ...brands.map((b) => ({ value: `brand:${b.slug}`, label: b.brand, hint: b.products ? `${b.products} products` : undefined, group: 'View as a brand', icon: <BrandLogo brand={b.brand} size={18} /> })),
  ]
  const value = workspace.kind === 'brand' ? `brand:${workspace.slug}` : 'retailer'
  if (workspace.kind === 'brand' && !options.some((o) => o.value === value)) options.push({ value, label: workspace.slug, hint: undefined, group: 'View as a brand' })
  const name = workspace.kind === 'brand' ? (workspace.brand ?? workspace.slug) : (org?.name ?? 'Retailer')
  return (
    <Combobox
      label={org ? 'Viewing' : 'Workspace'}
      value={value}
      options={options}
      prefix={<><span className="hidden text-proof-small text-ink-2 xl:inline">{org ? 'Viewing' : ''}</span><BrandLogo brand={name} src={workspace.kind === 'retailer' ? org?.logo_url : undefined} kind={workspace.kind === 'retailer' ? 'retailer' : 'brand'} size={20} /></>}
      onChange={(v) => setWorkspace(v.startsWith('brand:') ? { kind: 'brand', slug: v.slice(6) } : { kind: 'retailer' })}
      width={300}
      footer={
        instance
          ? 'As the retailer you can see any brand’s view. A brand organisation sees only its own brand, and never another brand’s campaigns, claims or requests.'
          : 'Demo: every brand workspace is open to everyone. Competitors are named; all brands get the same method and the same small-group rules.'
      }
    />
  )
}

/** Which periods hold data for this cohort (an empty "last 30 days" is hidden, not offered). */
function useRangesWithData(open: boolean): Set<Range> | null {
  const { filters } = useRetailState()
  const [res, setRes] = useState<{ key: string; ok: Set<Range> } | null>(null)
  const key = filters.cohort
  useEffect(() => {
    if (!open || res?.key === key) return
    let alive = true
    const probe = (range: Range) =>
      fetchInsights({ cohort: filters.cohort, range }).then(
        (x) => !x.empty && totalUsers(x.cohort) >= 10,
        () => true,
      )
    void Promise.all([probe('30d'), probe('90d')]).then(([a, b]) => {
      if (!alive) return
      const ok = new Set<Range>(['all'])
      if (a) ok.add('30d')
      if (b) ok.add('90d')
      setRes({ key, ok })
    })
    return () => {
      alive = false
    }
  }, [open, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return res?.key === key ? res.ok : null
}

/** Data scope (range and cohort) in one control; its label says what is counted and the date the data runs to. */
function DataScope({ d, loading }: { d: Insights | null; loading: boolean }) {
  const { filters, setFilters } = useRetailState()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const to = useDataTo(d)
  const withData = useRangesWithData(open)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const kind = d ? cohortKind(d.cohort) : null
  const range = RANGES.find((r) => r.value === filters.range)!.label
  const data = filters.cohort === 'real' ? 'Real users' : filters.cohort === 'simulated' ? 'Simulated' : 'Mixed data'
  // A period with no readings is left out (the one picked stays, so the control never hides the current state).
  const ranges = RANGES.filter((r) => !withData || withData.has(r.value) || r.value === filters.range)
  const hidden = withData ? RANGES.filter((r) => !withData.has(r.value) && r.value !== filters.range) : []
  const who = !d
    ? loading
      ? 'Loading…'
      : 'Data unavailable'
    : kind === 'real'
      ? `${int(d.cohort.real)} real consented people.`
      : kind === 'mixed'
        ? `${int(d.cohort.synthetic)} simulated people and ${int(d.cohort.real)} real consented ${d.cohort.real === 1 ? 'person' : 'people'}, counted together.`
        : `${int(d.cohort.synthetic)} simulated people, generated from measured photo noise. Not real customers.`
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} className="hit44 inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-ctl border border-line bg-surface px-2.5 text-proof-small sm:px-3 text-ink hover:border-line-strong hover:bg-pf-hover">
        <span aria-hidden className={`size-1.5 rounded-full ${kind === 'real' ? 'bg-proof-leaf' : 'bg-pf-amber'}`} />
        <span className="hidden sm:inline">{data}</span>
        <span aria-hidden className="hidden text-ink-3 sm:inline">/</span>
        {range}
        {to ? <span className="hidden text-ink-2 xl:inline">· {to.label.replace('Data to', 'to')}</span> : null}
        <ChevronDown size={14} strokeWidth={1.6} aria-hidden className="hidden text-ink-2 sm:block" />
      </button>
      {open ? (
        <div role="dialog" aria-label="Data scope" className="absolute right-0 top-[calc(100%+6px)] z-[60] flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-4 rounded-card border border-line bg-surface p-4 origin-top-right shadow-[0_0_0_1px_var(--line-subtle),0_16px_24px_-8px_rgba(0,0,0,.14)] animate-[proofDrop_.16s_var(--ease-standard)_both]">
          {to ? (
            <p className="m-0 flex items-center justify-between gap-2 text-proof-small">
              <span className="font-medium text-ink">{to.label}</span>
              <span className="text-ink-2">newest readings</span>
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <span className="text-proof-small font-medium text-ink">Period</span>
            <Segmented label="Period" options={ranges} value={filters.range} onChange={(range) => setFilters({ range })} />
            {hidden.length ? <span className="text-proof-label text-ink-2">{hidden.map((r) => r.label).join(' and ')}: no readings in that window, so not offered.</span> : null}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-proof-small font-medium text-ink">People</span>
            <Segmented label="People" options={COHORTS} value={filters.cohort} onChange={(cohort) => setFilters({ cohort })} />
          </div>
          <p className="m-0 border-t border-line pt-3 text-proof-small text-ink-2">
            {who} {d ? `${int(totalUsers(d.cohort))} in total.` : ''} Aggregates only; any group under 10 people is hidden.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function ThemeButton({ theme, onTheme }: { theme: ThemePref; onTheme: (t: ThemePref) => void }) {
  const next: ThemePref = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <button type="button" onClick={() => onTheme(next)} aria-label={`Theme: ${theme}. Switch to ${next}`} title={`Theme: ${theme}`} className="hit44 grid size-9 place-items-center rounded-ctl border border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink">
      <Icon size={16} strokeWidth={1.6} aria-hidden />
    </button>
  )
}

function TopBar({ d, loading, theme, onTheme, onAsk }: { d: Insights | null; loading: boolean; theme: ThemePref; onTheme: (t: ThemePref) => void; onAsk: () => void }) {
  const { carry } = useRetailState()
  const { instance, org } = useOrg()
  return (
    <header className="flex h-[var(--proof-topbar)] items-center gap-1.5 px-4 sm:gap-2 sm:px-6">
      <Link to={`/retail${carry}`} aria-label="Proof by Willow, Home" className="flex shrink-0 items-center gap-2 rounded-ctl text-ink no-underline">
        <ProofMark size={26} />
        <span className="hidden items-baseline gap-1.5 text-[15px] tracking-[-0.01em] md:inline-flex">
          <span className="font-semibold">Proof</span>
          <span className="hidden text-ink-2 xl:inline">by Willow</span>
        </span>
      </Link>
      {instance && org && !isFallbackInstance(instance) ? (
        <>
          <span aria-hidden className="mx-0.5 hidden text-[20px] font-light text-line-strong lg:inline">
            /
          </span>
          <span className="hidden text-ink-2 lg:inline-flex [&_span]:!font-normal [&_span]:!text-ink-2">
            <InstanceName instance={instance} short />
          </span>
        </>
      ) : null}
      <span aria-hidden className="mx-1 hidden text-[20px] font-light text-line-strong sm:inline">
        /
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <OrgSwitcher />
        <Workspace />
      </div>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <DataScope d={d} loading={loading} />
        <button type="button" onClick={onAsk} aria-label="Ask anything" className="hit44 inline-flex h-9 items-center gap-2 rounded-ctl border border-line bg-surface px-3 text-proof-small text-ink-2 hover:border-line-strong hover:text-ink">
          <Search size={15} strokeWidth={1.7} aria-hidden />
          <span className="hidden md:inline">Ask anything</span>
          <kbd className="hidden rounded-[4px] border border-line bg-pf-bg2 px-1.5 font-geist text-[11px] text-ink-2 lg:inline">⌘K</kbd>
        </button>
        <ThemeButton theme={theme} onTheme={onTheme} />
      </div>
    </header>
  )
}

/* ───────────────────────────── section tabs ───────────────────────────── */

function SectionTabs() {
  const { carry } = useRetailState()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { nav: current, page } = sectionOf(pathname)
  const advOn = ADVANCED.some((a) => a.id === page.id) && page.id !== 'compare'
  return (
    <nav aria-label="Proof by Willow sections" className="flex items-center gap-1 px-2 sm:px-4">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {SECTIONS.map((s) => {
        const on = s.id === current.id && !advOn
        return (
          <NavLink key={s.id} to={`${sectionPath(s.id)}${carry}`} end={s.id === 'home'} aria-current={on ? 'page' : undefined} title={s.question} className={`relative flex h-11 shrink-0 items-center px-2 text-proof-small no-underline transition-colors duration-150 ${on ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
            <span className={`rounded-ctl px-2 py-1.5 ${on ? '' : 'hover:bg-pf-hover'}`}>{s.label}</span>
            {on ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-ink [view-transition-name:proof-tab]" /> : null}
          </NavLink>
        )
      })}
      </div>
      <Menu
        label="Advanced"
        align="right"
        width={300}
        className="shrink-0"
        triggerClass={`hit44 relative flex h-11 shrink-0 items-center gap-1 border-0 bg-transparent px-2 text-proof-small transition-colors ${advOn ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
        trigger={
          <>
            <span className="flex items-center gap-1 rounded-ctl px-2 py-1.5 hover:bg-pf-hover">
              <MoreHorizontal size={15} strokeWidth={1.7} aria-hidden /> {advOn ? page.label : 'Advanced'}
            </span>
            {advOn ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-ink" /> : null}
          </>
        }
      >
        {(close) => (
          <>
            {ADVANCED.map((a) => (
              <MenuItem
                key={a.id}
                current={page.id === a.id}
                sub={a.question}
                onClick={() => {
                  close()
                  navigate(`${sectionPath(a.id)}${carry}`)
                }}
              >
                {a.label}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
    </nav>
  )
}

/**
 * On every Proof page while simulated people are in the numbers (finals, Nov 28): the brand and product
 * names are real catalog entries, their outcomes here are simulated. Said once, plainly, above every
 * page, so no figure can be read as a real result for a named brand. Not dismissible.
 */
function SimulatedNotice({ d, real }: { d: Insights | null; real: boolean }) {
  if (!d || real || !d.cohort.synthetic) return null
  return (
    <p role="note" className="mb-6 flex items-start gap-2.5 rounded-card border border-line bg-surface px-4 py-2.5 text-proof-small text-ink-2">
      <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-pf-amber" />
      <span>
        <span className="font-medium text-ink">Simulated cohort.</span> {int(d.cohort.synthetic)} simulated people
        {d.cohort.real ? ` and ${int(d.cohort.real)} real consented ${d.cohort.real === 1 ? 'person' : 'people'}` : ''}. Brand and product names are real catalog entries; the results shown for them are simulated, not measured outcomes of those brands.
      </span>
    </p>
  )
}
