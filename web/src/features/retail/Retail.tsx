import './retail.css'

import { ArrowUpRight, Grid3x3, LayoutDashboard, Megaphone, Menu, MessageSquareText, Package, PanelLeftClose, PanelLeftOpen, Scale, Shapes, SlidersHorizontal, TrendingUp, X, type LucideIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'

import { ErrorBoundary } from '../../components/ErrorBoundary'
import { AskAggregates } from './AskAggregates'
import { ProofLockup, ProofMark } from './brand'
import { RetailDataProvider, useRetailData } from './context'
import { totalUsers } from './data'
import { COHORTS, RANGES, SECTIONS, sectionPath, useRetailState } from './state'
import type { Insights, SectionId } from './types'
import { cohortKind, Combobox, int, Segmented, SidePanel, SkeletonHeader, SkeletonKpis, SkeletonTable, type CohortKind } from './ui'

/*
 * Willow Proof (docs/RETAIL_BRAND.md, docs/RETAILER_INSIGHTS.md "App structure"): the business app at
 * /retail/*. One shell: cohort banner, top bar (lockup, "Viewing as", range + cohort filters, Ask), a left nav
 * that collapses to icons (remembered on this browser), and one lazily loaded route per section. All state is
 * in the URL (state.ts); the insights aggregates are fetched once per filter (context.tsx).
 */

const Overview = lazy(() => import('./sections/Overview'))
const Products = lazy(() => import('./sections/Products'))
const ProductDetail = lazy(() => import('./sections/ProductDetail'))
const Compare = lazy(() => import('./sections/Compare'))
const Categories = lazy(() => import('./sections/Categories'))
const SkinProfiles = lazy(() => import('./sections/SkinProfiles'))
const Competitors = lazy(() => import('./sections/Competitors'))
const Demand = lazy(() => import('./sections/Demand'))
const Promote = lazy(() => import('./sections/Promote'))

const ICONS: Record<SectionId, LucideIcon> = {
  overview: LayoutDashboard,
  products: Package,
  categories: Shapes,
  segments: Grid3x3,
  competitors: Scale,
  demand: TrendingUp,
  promote: Megaphone,
}

const NAV_KEY = 'willow.proof.nav.collapsed'
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(NAV_KEY) === '1'
  } catch {
    return false
  }
}
function writeCollapsed(v: boolean) {
  try {
    window.localStorage.setItem(NAV_KEY, v ? '1' : '0')
  } catch {
    /* private mode or blocked storage: the choice lasts for this visit only */
  }
}

/** Which section a path is in ("/retail/categories/serum" → categories). */
function sectionOf(pathname: string): (typeof SECTIONS)[number] {
  const seg = pathname.replace(/^\/retail\/?/, '').split('/')[0]
  // Compare lives under Products (reached from its scoreboard and product pages).
  return SECTIONS.find((s) => s.path === (seg === 'compare' ? 'products' : seg)) ?? SECTIONS[0]
}

export default function Retail() {
  // The whole document goes dark while Proof is open (overscroll, toasts, portals), and back when it closes.
  useEffect(() => {
    const html = document.documentElement
    const before = html.dataset.theme
    html.dataset.theme = 'dark'
    html.style.colorScheme = 'dark'
    return () => {
      if (before === undefined) delete html.dataset.theme
      else html.dataset.theme = before
      html.style.colorScheme = ''
    }
  }, [])
  return (
    <RetailDataProvider>
      <Shell />
    </RetailDataProvider>
  )
}

function Shell() {
  const { pathname } = useLocation()
  const section = sectionOf(pathname)
  const { param, setParam } = useRetailState()
  const { insights, filters } = useRetailData()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [menu, setMenu] = useState(false)
  const head = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const askOpen = param('ask') === '1'

  // "Willow Proof · <Section>" in the tab (App's PageTitle leaves /retail to this shell).
  useEffect(() => {
    document.title = `Willow Proof · ${section.label}`
  }, [section.label])
  // The sticky header's height drives the nav's top and the scroll padding (focus never lands under it).
  useLayoutEffect(() => {
    const el = head.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      root.current?.style.setProperty('--proof-head', `${el.offsetHeight}px`)
      document.documentElement.style.scrollPaddingTop = `${el.offsetHeight + 12}px`
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.scrollPaddingTop = ''
    }
  }, [])

  const toggle = () =>
    setCollapsed((c) => {
      writeCollapsed(!c)
      return !c
    })
  const d = insights.status === 'ready' || insights.status === 'empty' ? insights.d : null

  return (
    <div ref={root} data-theme="dark" className="proof-root relative min-h-dvh bg-canvas font-ui text-proof-body text-ink [--proof-head:80px]">
      <a href="#proof-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-xs focus:bg-selected focus:px-3 focus:py-2 focus:text-inverse">
        Skip to content
      </a>
      <div ref={head} className="sticky top-0 z-40">
        <CohortBanner d={d} loading={insights.status === 'loading'} />
        <TopBar onMenu={() => setMenu((m) => !m)} menuOpen={menu} onAsk={() => setParam({ ask: '1' }, { push: true })} />
        {menu ? <MobileNav onClose={() => setMenu(false)} /> : null}
      </div>

      <div className="flex">
        <SideNav collapsed={collapsed} onToggle={toggle} />
        <main id="proof-main" tabIndex={-1} className="min-w-0 flex-1 px-4 pb-16 pt-5 outline-none sm:px-6 lg:px-7">
          <div className="mx-auto w-full max-w-[1560px]">
            <ErrorBoundary resetKey={pathname}>
              <Suspense fallback={<SectionFallback />}>
                <div key={section.id} className="animate-[proofPage_.24s_var(--ease-standard)_both]">
                  <Routes>
                    <Route index element={<Overview />} />
                    <Route path="products" element={<Products />} />
                    <Route path="products/:productId" element={<ProductDetail />} />
                    <Route path="compare" element={<Compare />} />
                    <Route path="categories" element={<Categories />} />
                    <Route path="categories/:category" element={<Categories />} />
                    <Route path="segments" element={<SkinProfiles />} />
                    <Route path="competitors" element={<Competitors />} />
                    <Route path="demand" element={<Demand />} />
                    <Route path="promote" element={<Promote />} />
                    <Route path="*" element={<Overview />} />
                  </Routes>
                </div>
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <SidePanel open={askOpen} onClose={() => setParam({ ask: null })} title="Ask the aggregates" subtitle={`Same filters as the screen · ${RANGES.find((r) => r.value === filters.range)?.label} · ${COHORTS.find((c) => c.value === filters.cohort)?.label} cohort`} width={460} labelledBy="proof-ask-title">
        <AskAggregates d={d} filters={filters} />
      </SidePanel>
    </div>
  )
}

function SectionFallback() {
  return (
    <div role="status" aria-label="Loading section" className="flex flex-col gap-4">
      <SkeletonHeader />
      <SkeletonKpis />
      <SkeletonTable rows={6} />
    </div>
  )
}

/* ───────────────────────────── banner ───────────────────────────── */

const BANNER: Record<CohortKind, (d: Insights) => string> = {
  simulated: (d) => `■ SIMULATED EVIDENCE · ${int(d.cohort.synthetic)} SYNTHETIC USERS GENERATED FROM MEASURED NOISE · NOT REAL CUSTOMERS`,
  mixed: (d) => `■ MIXED COHORT · ${int(d.cohort.real)} REAL CONSENTED ${d.cohort.real === 1 ? 'USER' : 'USERS'} + ${int(d.cohort.synthetic)} SIMULATED · COUNTED TOGETHER`,
  real: () => '■ REAL CONSENTED USERS ONLY · SMALL COHORT · GROUPS UNDER 10 SUPPRESSED',
}

/** SyntheticBanner (docs/DESIGN.md): yellow hatched while any row is simulated, lime when every row is real. */
function CohortBanner({ d, loading }: { d: Insights | null; loading: boolean }) {
  if (!d) {
    return (
      <div role="note" className="flex h-7 items-center justify-center bg-sunken px-4 font-mono text-[11px] tracking-[.06em] text-ink-2">
        {loading ? '■ LOADING COHORT…' : '■ COHORT UNAVAILABLE · NO NUMBERS SHOWN'}
      </div>
    )
  }
  const kind = cohortKind(d.cohort)
  return (
    <div role="note" className={`flex min-h-7 items-center justify-center px-4 py-1 text-center font-mono text-[11px] tracking-[.06em] ${kind === 'real' ? 'retail-real' : 'retail-synthetic'}`}>
      <span className="hidden md:inline">{BANNER[kind](d)}</span>
      <span className="md:hidden">{kind === 'real' ? '■ REAL CONSENTED USERS ONLY' : `■ ${kind === 'mixed' ? 'MIXED' : 'SIMULATED'} · ${int(d.cohort.synthetic)} SYNTHETIC${d.cohort.real ? ` + ${d.cohort.real} REAL` : ''} USERS`}</span>
    </div>
  )
}

/* ───────────────────────────── top bar ───────────────────────────── */

function Workspace() {
  const { brands, workspace } = useRetailData()
  const { setWorkspace } = useRetailState()
  const options = [
    { value: 'retailer', label: 'Retailer · all brands', group: 'Retailer' },
    ...brands.map((b) => ({ value: `brand:${b.slug}`, label: b.brand, hint: b.products ? `${b.products} ${b.products === 1 ? 'product' : 'products'}` : undefined, group: 'Brand' })),
  ]
  const value = workspace.kind === 'brand' ? `brand:${workspace.slug}` : 'retailer'
  // A brand in the URL that this filter does not know (yet): keep it visible rather than silently switching.
  if (workspace.kind === 'brand' && !options.some((o) => o.value === value)) options.push({ value, label: workspace.slug, group: 'Brand' })
  return (
    <Combobox
      label="Viewing as"
      value={value}
      options={options}
      onChange={(v) => setWorkspace(v.startsWith('brand:') ? { kind: 'brand', slug: v.slice(6) } : { kind: 'retailer' })}
      footer="Demo workspace: any brand view is open to everyone, with no ownership check. Competitors are named; every brand sees the same method and suppression."
    />
  )
}

function Filters({ wrap = false }: { wrap?: boolean }) {
  const { filters, setFilters } = useRetailState()
  return (
    <div className={`flex items-center gap-2 ${wrap ? 'flex-wrap' : ''}`}>
      <Segmented label="Date range" options={RANGES} value={filters.range} onChange={(range) => setFilters({ range })} />
      <Segmented label="Cohort" options={COHORTS} value={filters.cohort} onChange={(cohort) => setFilters({ cohort })} />
    </div>
  )
}

function UsersCount() {
  const { insights, filters } = useRetailData()
  const d = insights.status === 'ready' || insights.status === 'empty' ? insights.d : null
  const caps = RANGES.find((r) => r.value === filters.range)!.caps
  return (
    <span aria-live="polite" className="hidden whitespace-nowrap font-mono text-[11px] text-ink-2 tnum 2xl:inline">
      {d ? `${int(totalUsers(d.cohort))} USERS · ${caps}${d.filters ? ` TO ${d.filters.today}` : ''}` : ''}
    </span>
  )
}

function TopBar({ onMenu, menuOpen, onAsk }: { onMenu: () => void; menuOpen: boolean; onAsk: () => void }) {
  const { carry, filters } = useRetailState()
  return (
    <header className="border-b border-line bg-canvas/85 [-webkit-backdrop-filter:blur(20px)_saturate(1.4)] [backdrop-filter:blur(20px)_saturate(1.4)]">
      <div className="flex h-[var(--proof-topbar)] items-center gap-3 px-3 sm:px-4">
        <button type="button" onClick={onMenu} aria-expanded={menuOpen} aria-controls="proof-mobile-nav" aria-label={menuOpen ? 'Close menu' : 'Open menu'} className="hit44 grid size-8 place-items-center rounded-xs border-0 bg-transparent text-ink hover:bg-glass lg:hidden">
          {menuOpen ? <X size={18} strokeWidth={1.6} aria-hidden /> : <Menu size={18} strokeWidth={1.6} aria-hidden />}
        </button>
        <Link to={`/retail${carry}`} aria-label="Willow Proof, Overview" className="flex shrink-0 items-center rounded-xs no-underline lg:w-[calc(var(--proof-nav-open)-28px)]">
          <ProofLockup size={22} />
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-line lg:block" />
        <div className="hidden min-w-0 sm:block">
          <Workspace />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <UsersCount />
          <div className="hidden lg:block">
            <Filters />
          </div>
          <button type="button" onClick={onAsk} className="hit44 inline-flex h-8 items-center gap-1.5 rounded-xs border-0 bg-selected px-3 text-proof-small font-medium text-inverse transition-[transform,background] duration-150 hover:bg-ink/85 active:scale-[.98]">
            <MessageSquareText size={14} strokeWidth={1.8} aria-hidden />
            Ask
          </button>
        </div>
      </div>
      {/* Below 1040 px the workspace and filters get their own scrollable row. */}
      <div className="flex items-center gap-2 border-t border-line px-3 py-2 sm:px-4 lg:hidden">
        <div className="min-w-0 flex-1 sm:hidden">
          <Workspace />
        </div>
        {/* Phones: the filters live in the menu sheet; this chip says what is applied and opens it. */}
        <button type="button" onClick={onMenu} aria-expanded={menuOpen} aria-controls="proof-mobile-nav" className="hit44 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xs border border-line-strong bg-transparent px-2.5 text-proof-small text-ink hover:bg-glass sm:hidden">
          <SlidersHorizontal size={14} strokeWidth={1.6} aria-hidden />
          <span className="sr-only">Filters: </span>
          {RANGES.find((r) => r.value === filters.range)?.label} · {COHORTS.find((c) => c.value === filters.cohort)?.label}
        </button>
        <div className="no-scrollbar hidden min-w-0 overflow-x-auto sm:block">
          <Filters />
        </div>
      </div>
    </header>
  )
}

/* ───────────────────────────── navigation ───────────────────────────── */

function NavItems({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { carry } = useRetailState()
  const { pathname } = useLocation()
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {SECTIONS.map((s) => {
        const Icon = ICONS[s.id]
        // Compare (/retail/compare) belongs to Products.
        const also = s.id === 'products' && pathname.startsWith('/retail/compare')
        return (
          <li key={s.id}>
            <NavLink
              to={`${sectionPath(s.id)}${carry}`}
              end={s.id === 'overview'}
              onClick={onNavigate}
              title={collapsed ? s.label : undefined}
              aria-label={collapsed ? s.label : undefined}
              aria-current={also ? 'page' : undefined}
              className={({ isActive }) =>
                `group relative flex h-9 items-center gap-2.5 rounded-xs px-2.5 text-proof-body no-underline transition-colors duration-150 ${isActive || also ? 'bg-proof-leaf-soft text-ink' : 'text-ink-2 hover:bg-glass hover:text-ink'} ${collapsed ? 'justify-center px-0' : ''}`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive || also ? <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-pill bg-proof-leaf" /> : null}
                  <Icon size={16} strokeWidth={1.6} aria-hidden className={isActive || also ? 'text-proof-leaf' : ''} />
                  {collapsed ? null : <span className="truncate">{s.label}</span>}
                </>
              )}
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
}

function SideNav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <nav
      aria-label="Willow Proof sections"
      className="sticky top-[var(--proof-head)] hidden h-[calc(100dvh-var(--proof-head))] shrink-0 flex-col border-r border-line bg-canvas px-2 py-3 transition-[width] duration-[360ms] ease-[var(--ease-spring)] lg:flex"
      style={{ width: collapsed ? 'var(--proof-nav-closed)' : 'var(--proof-nav-open)' }}
    >
      <NavItems collapsed={collapsed} />
      <div className="mt-auto flex flex-col gap-1 border-t border-line pt-2">
        {collapsed ? null : (
          <p className="m-0 px-2.5 pb-1 text-[11px] leading-snug text-ink-2">
            Aggregates only. Groups under 10 people are suppressed in the api.
          </p>
        )}
        <Link to="/" title={collapsed ? 'Willow website' : undefined} className={`flex h-9 items-center gap-2.5 rounded-xs px-2.5 text-proof-small text-ink-2 no-underline hover:bg-glass hover:text-ink ${collapsed ? 'justify-center px-0' : ''}`}>
          <ArrowUpRight size={15} strokeWidth={1.6} aria-hidden />
          {collapsed ? <span className="sr-only">Willow website</span> : 'Willow website'}
        </Link>
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} className={`flex h-9 items-center gap-2.5 rounded-xs border-0 bg-transparent px-2.5 text-proof-small text-ink-2 hover:bg-glass hover:text-ink ${collapsed ? 'justify-center px-0' : ''}`}>
          {collapsed ? <PanelLeftOpen size={16} strokeWidth={1.6} aria-hidden /> : <PanelLeftClose size={16} strokeWidth={1.6} aria-hidden />}
          {collapsed ? null : 'Collapse'}
        </button>
      </div>
    </nav>
  )
}

/** Phone and tablet: the sections drop down from the top bar as a sheet; Esc or a choice closes it. */
function MobileNav({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('a[aria-current="page"], a')?.focus()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <>
      <button type="button" aria-label="Close menu" tabIndex={-1} onClick={onClose} className="fixed inset-0 top-[var(--proof-head)] z-[-1] border-0 bg-black/50 lg:hidden" />
      <div id="proof-mobile-nav" ref={ref} className="absolute inset-x-0 top-full border-b border-line bg-surface px-3 pb-3 pt-2 shadow-modal animate-[proofDrop_.22s_var(--ease-standard)_both] lg:hidden">
        <nav aria-label="Willow Proof sections">
          <NavItems onNavigate={onClose} />
        </nav>
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3 sm:hidden">
          <span className="text-proof-label uppercase text-ink-2">Filters</span>
          <Filters wrap />
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
          <ProofMark size={20} />
          <Link to="/" className="text-proof-small text-ink-2">
            Willow website
          </Link>
        </div>
      </div>
    </>
  )
}
