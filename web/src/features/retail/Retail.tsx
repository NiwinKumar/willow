import './retail.css'

import { ChevronDown, Monitor, Moon, Search, Sun } from 'lucide-react'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom'

import { ErrorBoundary } from '../../components/ErrorBoundary'
import { AskAggregates } from './AskAggregates'
import { ProofMark } from './brand'
import { RetailDataProvider, useRetailData } from './context'
import { totalUsers } from './data'
import { COHORTS, LEGACY_PATHS, RANGES, SECTIONS, sectionPath, useRetailState } from './state'
import type { Insights } from './types'
import { cohortKind, Combobox, int, Segmented, SidePanel, SkeletonHeader, SkeletonKpis, SkeletonTable } from './ui'

/*
 * Willow Proof (docs/RETAIL_BRAND.md, docs/RETAILER_INSIGHTS.md "App structure"): the business app at
 * /retail/*, laid out like Vercel's dashboard. A top bar (Proof mark / workspace switcher on the left; data
 * scope, Ask and theme on the right) over a row of section tabs; pages sit in a 1200 px column. All state is in
 * the URL (state.ts); the insights aggregates are fetched once per filter (context.tsx).
 */

const Overview = lazy(() => import('./sections/Overview'))
const Products = lazy(() => import('./sections/Products'))
const ProductDetail = lazy(() => import('./sections/ProductDetail'))
const Compare = lazy(() => import('./sections/Compare'))
const Customers = lazy(() => import('./sections/Customers'))
const Market = lazy(() => import('./sections/Market'))
const Campaigns = lazy(() => import('./sections/Promote'))
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
  return (
    <RetailDataProvider>
      <Shell />
    </RetailDataProvider>
  )
}

/** Which section a path is in ("/retail/products/x" → products; compare belongs to Products). */
function sectionOf(pathname: string): (typeof SECTIONS)[number] {
  const seg = pathname.replace(/^\/retail\/?/, '').split('/')[0]
  const id = seg === 'compare' ? 'products' : LEGACY_PATHS[seg as keyof typeof LEGACY_PATHS]?.section
  return SECTIONS.find((s) => (id ? s.id === id : s.path === seg)) ?? SECTIONS[0]
}

function Shell() {
  const { pathname } = useLocation()
  const section = sectionOf(pathname)
  const { param, setParam } = useRetailState()
  const { insights, filters } = useRetailData()
  const [theme, setTheme] = useProofTheme()
  const head = useRef<HTMLDivElement>(null)
  const askOpen = param('ask') === '1'

  useEffect(() => {
    document.title = `${section.label} · Willow Proof`
  }, [section.label])
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
        setParam({ ask: '1' }, { push: true })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [setParam])

  const d = insights.status === 'ready' || insights.status === 'empty' ? insights.d : null

  return (
    <div className="proof-root relative min-h-dvh bg-canvas font-geist text-proof-body text-ink antialiased">
      <a href="#proof-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-ctl focus:bg-selected focus:px-3 focus:py-2 focus:text-inverse">
        Skip to content
      </a>
      <div ref={head} className="sticky top-0 z-40 border-b border-line bg-canvas/90 [-webkit-backdrop-filter:blur(16px)_saturate(1.4)] [backdrop-filter:blur(16px)_saturate(1.4)]">
        <TopBar d={d} loading={insights.status === 'loading'} theme={theme} onTheme={setTheme} onAsk={() => setParam({ ask: '1' }, { push: true })} />
        <SectionTabs />
      </div>

      <main id="proof-main" tabIndex={-1} className="px-4 pb-24 pt-8 outline-none sm:px-6">
        <div className="mx-auto w-full max-w-[1200px]">
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<SectionFallback />}>
              <div key={section.id} className="animate-[proofPage_.2s_var(--ease-standard)_both]">
                <Routes>
                  <Route index element={<Overview />} />
                  <Route path="products" element={<Products />} />
                  <Route path="products/:productId" element={<ProductDetail />} />
                  <Route path="compare" element={<Compare />} />
                  <Route path="customers" element={<Customers />} />
                  <Route path="market" element={<Market />} />
                  <Route path="campaigns" element={<Campaigns />} />
                  <Route path="explore" element={<Explore />} />
                  <Route path=":legacy/*" element={<Legacy />} />
                </Routes>
              </div>
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      <SidePanel open={askOpen} onClose={() => setParam({ ask: null })} title="Ask" subtitle={`Answers from the same data as the screen · ${RANGES.find((r) => r.value === filters.range)?.label} · ${COHORTS.find((c) => c.value === filters.cohort)?.label}`} width={480} labelledBy="proof-ask-title">
        <AskAggregates d={d} filters={filters} />
      </SidePanel>
    </div>
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

function Avatar({ name, retailer = false }: { name: string; retailer?: boolean }) {
  return (
    <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${retailer ? 'bg-ink text-inverse' : 'bg-gradient-to-br from-proof-leaf to-proof-leaf-hi text-[#0A0A0A]'}`}>
      {retailer ? 'R' : name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function Workspace() {
  const { brands, workspace } = useRetailData()
  const { setWorkspace } = useRetailState()
  const options = [
    { value: 'retailer', label: 'All brands', hint: 'Retailer', group: 'Retailer' },
    ...brands.map((b) => ({ value: `brand:${b.slug}`, label: b.brand, hint: b.products ? `${b.products} products` : undefined, group: 'Brands' })),
  ]
  const value = workspace.kind === 'brand' ? `brand:${workspace.slug}` : 'retailer'
  if (workspace.kind === 'brand' && !options.some((o) => o.value === value)) options.push({ value, label: workspace.slug, hint: undefined, group: 'Brands' })
  const name = workspace.kind === 'brand' ? (workspace.brand ?? workspace.slug) : 'All brands'
  return (
    <Combobox
      label="Workspace"
      value={value}
      options={options}
      prefix={<Avatar name={name} retailer={workspace.kind === 'retailer'} />}
      onChange={(v) => setWorkspace(v.startsWith('brand:') ? { kind: 'brand', slug: v.slice(6) } : { kind: 'retailer' })}
      width={300}
      footer="Demo: every brand workspace is open to everyone. Competitors are named; all brands get the same method and the same small-group rules."
    />
  )
}

/** Data scope (range and cohort) in one control; its label says what is counted, so no banner is needed. */
function DataScope({ d, loading }: { d: Insights | null; loading: boolean }) {
  const { filters, setFilters } = useRetailState()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
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
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} className="hit44 inline-flex h-9 items-center gap-2 rounded-ctl border border-line bg-surface px-3 text-proof-small text-ink hover:border-line-strong hover:bg-pf-hover">
        <span aria-hidden className={`size-1.5 rounded-full ${kind === 'real' ? 'bg-proof-leaf' : 'bg-pf-amber'}`} />
        <span className="hidden sm:inline">{data}</span>
        <span aria-hidden className="hidden text-ink-3 sm:inline">/</span>
        {range}
        <ChevronDown size={14} strokeWidth={1.6} aria-hidden className="text-ink-2" />
      </button>
      {open ? (
        <div role="dialog" aria-label="Data scope" className="absolute right-0 top-[calc(100%+6px)] z-[60] flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-[0_0_0_1px_var(--line-subtle),0_16px_24px_-8px_rgba(0,0,0,.14)] animate-[wFadeIn_.12s_ease_both]">
          <div className="flex flex-col gap-2">
            <span className="text-proof-small font-medium text-ink">Period</span>
            <Segmented label="Period" options={RANGES} value={filters.range} onChange={(range) => setFilters({ range })} />
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
  return (
    <header className="flex h-[var(--proof-topbar)] items-center gap-2 px-4 sm:px-6">
      <Link to={`/retail${carry}`} aria-label="Willow Proof, Overview" className="flex shrink-0 items-center gap-2 rounded-ctl text-ink no-underline">
        <ProofMark size={26} />
        <span className="hidden text-[15px] font-semibold tracking-[-0.01em] md:inline">Proof</span>
      </Link>
      <span aria-hidden className="mx-1 text-[20px] font-light text-line-strong">
        /
      </span>
      <div className="min-w-0">
        <Workspace />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <DataScope d={d} loading={loading} />
        <button type="button" onClick={onAsk} className="hit44 inline-flex h-9 items-center gap-2 rounded-ctl border border-line bg-surface px-3 text-proof-small text-ink-2 hover:border-line-strong hover:text-ink">
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
  const current = sectionOf(pathname)
  return (
    <nav aria-label="Willow Proof sections" className="no-scrollbar flex gap-1 overflow-x-auto px-2 sm:px-4">
      {SECTIONS.map((s) => {
        const on = s.id === current.id
        return (
          <NavLink key={s.id} to={`${sectionPath(s.id)}${carry}`} end={s.id === 'overview'} aria-current={on ? 'page' : undefined} title={s.question} className={`relative flex h-11 shrink-0 items-center px-2 text-proof-small no-underline transition-colors duration-150 ${on ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
            <span className={`rounded-ctl px-2 py-1.5 ${on ? '' : 'hover:bg-pf-hover'}`}>{s.label}</span>
            {on ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-ink" /> : null}
          </NavLink>
        )
      })}
    </nav>
  )
}
