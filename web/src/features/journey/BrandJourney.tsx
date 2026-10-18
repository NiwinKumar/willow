import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { ProductImage } from '../../components/willow/ProductImage'
import { enterDemo } from '../../data/useData'
import { retailerBrand, retailerBrands, retailerProduct, retailerSegments, type RetailerBrandDetail, type RetailerBrandSummary, type RetailerProductDetail, type RetailerProductRow, type RetailerSegments } from '../../lib/api'
import { useAuth } from '../../lib/useAuth'
import { goalLabel, skinLabel } from '../retail/promote'
import { DEFAULT_FILTERS } from '../retail/state'
import { int, MIN_GROUP, pct, pts } from '../retail/ui/format'
import { setWalkthroughs, startSegment, walkthroughsOn } from '../tour/runner'
import { BRAND, BRAND_SLUG, brandSegments, type BrandChapter } from './brandSegments'

/**
 * /journey/brand: how a skincare brand uses Proof by Willow, as a story that plays itself (the companion of Mei's
 * /journey, same look and controls). The brand is real (The Derma Co, a catalog brand); the people are Willow's
 * synthetic cohort, and every number on a slide is read from the same public retailer api the retail app uses
 * (GET /v1/retailer/brands, /brands/{brand}, /products/{id}, /segments; mixed cohort, all time, its default).
 * After each chapter a short walkthrough plays the real retail app (brandSegments.ts, the tour runner), then
 * comes back here at the next slide (?at=). "Skip the app walkthroughs" plays the slides only.
 */

const SLIDE_MS = 6500
const FILTERS = DEFAULT_FILTERS
const PLAYED_KEY = 'willow.brandJourney.played'

type Data = {
  brand: RetailerBrandDetail
  summary: RetailerBrandSummary | null
  hero: RetailerProductDetail
  cmp: RetailerProductDetail | null
  segs: RetailerSegments | null
}
type Kind = 'intro' | BrandChapter | 'end'

/** The product Proof's Overview puts in its spotlight: the Proven one with the highest lower lift bound. */
function spotlightOf(rows: RetailerProductRow[]): RetailerProductRow | null {
  const proven = rows.filter((r) => r.tier === 'proven' && r.lift_lo !== null).sort((a, b) => (b.lift_lo ?? 0) - (a.lift_lo ?? 0))
  if (proven[0]) return proven[0]
  return rows.filter((r) => r.tier === 'promising').sort((a, b) => (a.to_proven ?? 1e9) - (b.to_proven ?? 1e9) || (b.lift ?? 0) - (a.lift ?? 0))[0] ?? null
}

// One load per visit: coming back from a walkthrough remounts this page, which then reads the cached answer.
let cache: Promise<Data> | null = null
function load(): Promise<Data> {
  cache ??= (async () => {
    const [brand, list, segs] = await Promise.all([retailerBrand(BRAND, FILTERS), retailerBrands(FILTERS).catch(() => null), retailerSegments(FILTERS).catch(() => null)])
    const top = spotlightOf(brand.products)
    if (!top) throw new Error('no measured product')
    const others = brand.products.filter((p) => p.tier === 'proven' && p.product_id !== top.product_id).sort((a, b) => (b.lift_lo ?? 0) - (a.lift_lo ?? 0))
    const details = await Promise.all([top, ...others].map((p) => retailerProduct(p.product_id, FILTERS).catch(() => null)))
    const hero = details[0]
    if (!hero) throw new Error('no product detail')
    const cmp = details.find((x) => x && x.competitors.rows.some((r) => !r.is_self)) ?? null
    return { brand, summary: list?.brands.find((b) => b.brand === BRAND) ?? null, hero, cmp, segs }
  })()
  cache.catch(() => (cache = null))
  return cache
}

function readPlayed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(PLAYED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
function writePlayed(ids: string[]) {
  try {
    sessionStorage.setItem(PLAYED_KEY, JSON.stringify(ids))
  } catch {
    /* private mode: walkthroughs may play again after Back */
  }
}

export default function BrandJourney() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const [start] = useState(() => {
    const at = Number(params.get('at'))
    // A fresh start plays every walkthrough again; a return (?at=) keeps the ones already seen.
    if (!params.get('at')) writePlayed([])
    return Number.isInteger(at) && at > 0 ? at : 0
  })
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [data, setData] = useState<Data | null>(null)
  const [i, setI] = useState(start)
  const [paused, setPaused] = useState(false)
  const [walk, setWalk] = useState(walkthroughsOn)
  const touch = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    load().then(
      (d) => {
        if (!alive) return
        setData(d)
        setState('ready')
      },
      () => alive && setState('error'),
    )
    return () => {
      alive = false
    }
  }, [])

  const slides: Kind[] = useMemo(() => ['intro', 'proof', ...(data?.cmp ? (['compare'] as const) : []), 'customers', 'claims', 'campaign', 'end'], [data])
  const segments = useMemo(() => (data ? brandSegments({ hero: data.hero.product.product_id, compare: data.cmp?.product.product_id ?? null }) : null), [data])
  const last = slides.length - 1
  const at = Math.min(i, last)
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)))

  /** Forward: after a chapter slide, its walkthrough plays (once) and returns to the next slide. */
  const next = useCallback(() => {
    if (at >= last) return
    const kind = slides[at]
    const seg = kind !== 'intro' && kind !== 'end' ? segments?.[kind] : null
    if (walk && seg && !readPlayed().includes(seg.id)) {
      writePlayed([...readPlayed(), seg.id])
      startSegment(seg, `/journey/brand?at=${at + 1}`)
      return
    }
    setI(at + 1)
  }, [at, last, slides, segments, walk])

  useEffect(() => {
    if (state !== 'ready' || paused || at >= last) return
    const t = window.setTimeout(next, SLIDE_MS)
    return () => window.clearTimeout(t)
  }, [at, paused, state, last, next])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, Math.min(last, x) - 1))
      else if (e.key === ' ') {
        if ((e.target as HTMLElement | null)?.closest('button, input')) return
        e.preventDefault()
        setPaused((p) => !p)
      } else if (e.key === 'Escape') navigate('/')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [last, navigate, next])

  const toggleWalk = () => {
    setWalkthroughs(!walk)
    setWalk(!walk)
  }
  const openApp = () => {
    // A guest made by Proof's own sign-in has no app of its own yet: show Mei's instead.
    if (user && !user.isAnonymous) navigate('/home')
    else {
      enterDemo()
      navigate('/home?demo=1')
    }
  }

  const kind = slides[at]
  const hasWalk = walk && kind !== 'intro' && kind !== 'end' && Boolean(segments?.[kind])

  return (
    <main
      className="flex min-h-dvh flex-col bg-[#F3F1EC] text-ink"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return
        const dx = e.changedTouches[0].clientX - touch.current
        touch.current = null
        if (Math.abs(dx) > 50) {
          if (dx < 0) next()
          else go(at - 1)
        }
      }}
    >
      <header className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 px-[clamp(16px,3vw,32px)] pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="font-serif text-[22px]">willow</span>
            <span className="hidden rounded-pill bg-ink/[.06] px-3 py-1 text-[12.5px] text-ink-2 sm:inline">Proof by Willow · a real brand, a synthetic cohort</span>
          </span>
          <span className="flex items-center gap-1.5">
            <button type="button" role="switch" aria-checked={!walk} onClick={toggleWalk} className="flex min-h-11 items-center gap-2 rounded-pill px-3 text-[13px] text-ink-2 hover:bg-ink/5">
              <span aria-hidden className={`relative h-5 w-8 rounded-full transition-colors ${walk ? 'bg-ink/15' : 'bg-ink'}`}>
                <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] ${walk ? 'left-0.5' : 'left-3.5'}`} />
              </span>
              Skip the app walkthroughs
            </button>
            <button type="button" onClick={() => navigate('/')} aria-label="Close the journey" className="grid size-11 place-items-center rounded-full hover:bg-ink/5">
              <X size={20} strokeWidth={1.6} />
            </button>
          </span>
        </div>
        {state === 'ready' ? (
          <div className="flex gap-1" aria-hidden>
            {slides.map((_, k) => (
              <button key={k} type="button" tabIndex={-1} onClick={() => go(k)} className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
                <span
                  key={`${k}-${at}`}
                  className="block h-full origin-left rounded-full bg-ink"
                  style={k < at ? undefined : k === at && at < last ? { animation: `wFill ${SLIDE_MS}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' } : { transform: k === at ? undefined : 'scaleX(0)' }}
                />
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <section aria-live="polite" className="mx-auto flex w-full max-w-[1180px] flex-1 items-center px-[clamp(16px,3vw,32px)] py-5">
        {state === 'loading' ? <p className="m-auto text-ink-2">Loading {BRAND}’s proof…</p> : null}
        {state === 'error' ? (
          <div className="m-auto flex flex-col items-center gap-3 text-center">
            <p className="m-0 text-[17px]">The brand journey can’t be read right now.</p>
            <button type="button" onClick={() => navigate('/retail')} className="min-h-11 rounded-pill bg-selected px-5 text-inverse">
              Open Proof by Willow
            </button>
          </div>
        ) : null}
        {state === 'ready' && data ? (
          <div key={kind} className="flex w-full flex-col gap-5" style={{ animation: 'wRise .45s both' }}>
            {kind === 'intro' ? <Intro d={data} /> : null}
            {kind === 'proof' ? <ProofSlide d={data} /> : null}
            {kind === 'compare' && data.cmp ? <CompareSlide x={data.cmp} d={data} /> : null}
            {kind === 'customers' ? <CustomersSlide d={data} /> : null}
            {kind === 'claims' ? <ClaimsSlide d={data} /> : null}
            {kind === 'campaign' ? <CampaignSlide d={data} /> : null}
            {kind === 'end' ? <End onProof={() => navigate(`/retail?as=brand:${BRAND_SLUG}`)} onMei={() => navigate('/journey')} onApp={openApp} /> : null}
            {hasWalk ? <p className="m-0 text-[13px] text-ink-2">Up next: this step, played live in Proof by Willow.</p> : null}
          </div>
        ) : null}
      </section>

      {state === 'ready' ? (
        <footer className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-3 px-[clamp(16px,3vw,32px)] pb-5">
          <button type="button" onClick={() => go(at - 1)} disabled={at === 0} className="flex min-h-11 items-center gap-1 rounded-pill bg-white px-4 shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)] disabled:opacity-40">
            <ChevronLeft size={18} /> Back
          </button>
          <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'} className="grid size-11 place-items-center rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]">
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          {at < last ? (
            <button type="button" onClick={next} className="flex min-h-11 items-center gap-1 rounded-pill bg-selected px-5 text-inverse">
              {hasWalk ? 'Show me' : 'Next'} <ChevronRight size={18} />
            </button>
          ) : (
            <button type="button" onClick={() => navigate(`/retail?as=brand:${BRAND_SLUG}`)} className="min-h-11 rounded-pill bg-selected px-5 text-inverse">
              Open Proof by Willow
            </button>
          )}
        </footer>
      ) : null}
    </main>
  )
}

/* ───────────────────────────── pieces ───────────────────────────── */

function Title({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-ink-2">{kicker}</span>
      <h2 className="m-0 font-serif text-[clamp(32px,3.6vw,52px)] leading-none font-normal">{children}</h2>
    </div>
  )
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-[540px] text-[clamp(15px,1.3vw,18px)] leading-[1.5] text-pretty">{children}</p>
}

/** Where the numbers come from, on every slide that shows any. */
function CohortNote({ d }: { d: Data }) {
  const c = d.brand.cohort
  return (
    <p className="m-0 max-w-[560px] text-[12.5px] leading-[1.5] text-ink-2">
      Synthetic cohort: {int(c.synthetic)} simulated people{c.real ? ` and ${int(c.real)} real, consented ${c.real === 1 ? 'person' : 'people'}, counted together` : ''}. Observational, not a clinical trial; groups under {MIN_GROUP} people are hidden.
    </p>
  )
}

function Packshot({ p, size = 120 }: { p: RetailerProductRow; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-[24px] bg-white p-2 shadow-[0_18px_40px_-24px_rgba(0,0,0,.35)] squircle">
      <ProductImage product={{ image_url: p.image_url, category: p.category, name: p.product }} size={size} />
    </span>
  )
}

function Figure({ value, label, strong = false }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-[18px] px-4 py-3 ${strong ? 'bg-[#DDF3C9]' : 'bg-white/70'}`}>
      <span className="text-[clamp(24px,2.4vw,34px)] leading-none tracking-[-0.02em] tnum">{value}</span>
      <span className="text-[13px] leading-[1.35] text-ink-2">{label}</span>
    </div>
  )
}

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {items.map((t) => (
        <li key={t} className="rounded-pill bg-white/80 px-3 py-1.5 text-[13.5px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.08)]">
          {t}
        </li>
      ))}
    </ul>
  )
}

/** Users and non-users with the same goals: the share whose lasting change had begun, week by week. */
function Curve({ x }: { x: RetailerProductDetail }) {
  const W = 320
  const H = 120
  const { weeks, users, base } = x.curve
  const n = weeks.length
  if (n < 2) return null
  const px = (k: number) => 8 + (k / (n - 1)) * (W - 70)
  const py = (v: number) => H - 10 - v * (H - 20)
  const line = (vs: (number | null)[]) =>
    vs
      .map((v, k) => (v === null ? null : `${px(k)},${py(v)}`))
      .filter(Boolean)
      .join(' ')
  const lastU = users.at(-1) ?? null
  const lastB = base.at(-1) ?? null
  return (
    <figure className="m-0 flex flex-col gap-1.5 rounded-[18px] bg-white/70 p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[420px]" role="img" aria-label={`By week ${weeks[n - 1]}: ${pct(lastU)} of users and ${pct(lastB)} of non-users with the same goals had a lasting visible change.`}>
        <line x1={8} x2={W - 62} y1={H - 10} y2={H - 10} stroke="rgba(18,18,18,.12)" />
        <polyline points={line(base)} fill="none" stroke="#9A9A9A" strokeWidth={2} strokeDasharray="5 4" />
        <polyline points={line(users)} fill="none" stroke="#1F7F45" strokeWidth={2.5} />
        {lastU !== null ? (
          <text x={px(n - 1) + 6} y={py(lastU) + 4} fontSize={12} fill="#1F7F45">
            {pct(lastU)}
          </text>
        ) : null}
        {lastB !== null ? (
          <text x={px(n - 1) + 6} y={py(lastB) + 4} fontSize={12} fill="#6B6B6B">
            {pct(lastB)}
          </text>
        ) : null}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
        <span>
          <span aria-hidden className="mr-1.5 inline-block h-0.5 w-4 bg-[#1F7F45] align-middle" />
          Users, week 1 to {weeks[n - 1]}
        </span>
        <span>
          <span aria-hidden className="mr-1.5 inline-block w-4 border-t-2 border-dashed border-[#9A9A9A] align-middle" />
          Non-users with the same goals
        </span>
      </figcaption>
    </figure>
  )
}

/* ───────────────────────────── slides ───────────────────────────── */

function Intro({ d }: { d: Data }) {
  // The products this story is about (its Proven ones), not the whole catalog.
  const proven = d.brand.products.filter((p) => p.image_url && p.tier === 'proven')
  const shots = (proven.length ? proven : [d.hero.product]).slice(0, 4)
  return (
    <div className="grid w-full items-center gap-[clamp(20px,4vw,56px)] md:grid-cols-[minmax(0,.8fr)_minmax(0,1fr)]">
      <div className="grid grid-cols-2 gap-3 justify-self-center">
        {shots.map((p) => (
          <Packshot key={p.product_id} p={p} size={128} />
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <h1 className="m-0 font-serif text-[clamp(40px,5vw,72px)] leading-[.95] font-normal">{BRAND}, with proof</h1>
        <Lead>
          A skincare brand can say what a product is for. It can’t easily show how often it visibly works, for whom, or how it compares on the shelf. Claims without evidence are hard to trust, and a product bought for the wrong skin often comes back.
        </Lead>
        <Lead>Proof by Willow reads the check-ins people take in the Willow app, each against their own baseline, and shows the brand what changed.</Lead>
        <p className="m-0 max-w-[540px] text-[14px] leading-[1.5] text-ink-2">
          {BRAND} is a real catalog brand{d.summary ? ` with ${d.summary.products} products in Willow` : ''}. The people are Willow’s synthetic cohort, generated from measured photo noise, not its customers. It plays by itself; tap or use the arrow keys to move faster.
        </p>
      </div>
    </div>
  )
}

function ProofSlide({ d }: { d: Data }) {
  const p = d.hero.product
  const wk = d.brand.cohort.weeks
  return (
    <div className="grid w-full items-start gap-[clamp(20px,3.4vw,48px)] md:grid-cols-[minmax(0,.9fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Title kicker="1 · Overview and product page">See what it does</Title>
        <div className="flex items-center gap-4">
          <Packshot p={p} size={88} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[15px] leading-[1.35]">{p.product}</span>
            <span className="text-[13px] text-ink-2">
              {p.category_label} · {p.tier_label ?? p.tier}
            </span>
          </div>
        </div>
        <Lead>
          Proof measures the people who use it against people with the same goals who don’t. The difference is what Proof calls lift; a product is Proven when that lift stays above zero across its interval.
        </Lead>
        <CohortNote d={d} />
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Figure strong value={pct(p.rate)} label={`of ${int(p.n)} users saw a visible change by week ${wk}`} />
          <Figure value={pct(p.base_rate)} label="of non-users with the same goals did" />
          <Figure value={pts(p.lift)} label="lift over non-users" />
          <Figure value={pct(p.cont8)} label={`still using it at week ${wk}`} />
        </div>
        <Curve x={d.hero} />
      </div>
    </div>
  )
}

function CompareSlide({ x, d }: { x: RetailerProductDetail; d: Data }) {
  const self = x.competitors.rows.find((r) => r.is_self) ?? x.product
  const rival = x.competitors.rows.find((r) => !r.is_self)
  const rows = rival ? [self, rival] : [self]
  return (
    <div className="grid w-full items-start gap-[clamp(20px,3.4vw,48px)] md:grid-cols-[minmax(0,.9fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Title kicker="2 · Compare">Compare it fairly</Title>
        <Lead>
          {x.competitors.rank ? `${x.product.product} is #${x.competitors.rank} of ${x.competitors.of} ${x.product.category_label.toLowerCase()} on visible change. ` : ''}
          Lift sets each product apart from people who would have changed anyway, so a brand sees where it stands on the same method as everyone else.
        </Lead>
        {x.competitors.note ? <p className="m-0 max-w-[540px] text-[13.5px] leading-[1.5] text-ink-2">{x.competitors.note}</p> : null}
        <CohortNote d={d} />
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {rows.map((r) => (
          <li key={r.product_id} className={`flex flex-col gap-3 rounded-[20px] p-4 ${r.product_id === x.product.product_id ? 'bg-white shadow-[inset_0_0_0_1.5px_#1F7F45]' : 'bg-white/70'}`}>
            <div className="flex items-center gap-3">
              <ProductImage product={{ image_url: r.image_url, category: r.category, name: r.product }} size={44} />
              <span className="flex min-w-0 flex-col">
                <span className="line-clamp-2 text-[14.5px] leading-[1.3]">{r.product}</span>
                <span className="text-[12.5px] text-ink-2">
                  {r.brand}
                  {` · #${x.competitors.rows.findIndex((c) => c.product_id === r.product_id) + 1} of ${x.competitors.of}`}
                </span>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[13px] text-ink-2">
              <span className="flex flex-col">
                <span className="text-[20px] text-ink tnum">{pct(r.rate)}</span>visible change (n={int(r.n)})
              </span>
              <span className="flex flex-col">
                <span className="text-[20px] text-ink tnum">{pts(r.lift)}</span>lift over non-users
              </span>
              <span className="flex flex-col">
                <span className="text-[20px] text-ink tnum">{pct(r.cont8)}</span>still using
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CustomersSlide({ d }: { d: Data }) {
  const p = d.hero.product
  const skin = d.hero.segments.skin
  const s = d.segs
  const leads = s
    ? s.cells
        .filter((c) => c.best?.brand === BRAND)
        .slice(0, 4)
        .map((c) => `${s.skin_types.find((t) => t.id === c.skin)?.label ?? c.skin} skin · ${s.goals.find((g) => g.id === c.goal)?.label ?? c.goal}`)
    : []
  return (
    <div className="grid w-full items-start gap-[clamp(20px,3.4vw,48px)] md:grid-cols-[minmax(0,.9fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Title kicker="3 · Customers">Who it works for</Title>
        <Lead>
          The same product doesn’t work the same for everyone. Proof splits the outcome by skin type and goal, so {BRAND} knows whose routine each product belongs in.
        </Lead>
        {leads.length ? (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-ink-2">Groups where a product from {BRAND} is the best pick</span>
            <Chips items={leads} />
          </div>
        ) : null}
        <CohortNote d={d} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-ink-2">
          {p.product}: visible change by week {d.brand.cohort.weeks}, by skin type (non-users with the same skin type in brackets)
        </span>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {skin.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 rounded-[16px] bg-white/70 px-3.5 py-2.5">
              <span className="text-[14.5px]">{g.label}</span>
              {g.suppressed || g.rate === null ? (
                <span className="text-[13px] text-ink-2">Fewer than {MIN_GROUP} people</span>
              ) : (
                <span className="flex items-baseline gap-2 tnum">
                  <span className="text-[20px]">{pct(g.rate)}</span>
                  <span className="text-[12.5px] text-ink-2">
                    ({pct(g.base_rate)}) · n={int(g.n)}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ClaimsSlide({ d }: { d: Data }) {
  const ev = d.hero.evidence
  const pick = [ev.find((e) => e.id === 'efficacy'), ev.find((e) => e.kind === 'segment'), ev.find((e) => e.kind === 'speed')].filter((e): e is NonNullable<typeof e> => Boolean(e))
  const shown = (pick.length ? pick : ev).slice(0, 3)
  const caveat = ev[0]?.caveat ?? d.hero.evidence_caveat ?? null
  return (
    <div className="grid w-full items-start gap-[clamp(20px,3.4vw,48px)] md:grid-cols-[minmax(0,.9fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Title kicker="4 · Claim drafts">Claims it can stand behind</Title>
        <Lead>Proof turns the measurements into claim-ready statements, each with its number of people, window and cohort. Gemini drafts copy for a pack, a product page or social only from those statements, and every number is checked before it shows.</Lead>
        {caveat ? <p className="m-0 max-w-[540px] text-[13.5px] leading-[1.5] text-ink-2">{caveat}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-ink-2">Claim-ready statements for {d.hero.product.product}</span>
        <ul className="m-0 grid list-none gap-2 p-0">
          {shown.map((e) => (
            <li key={e.id} className="rounded-[18px] bg-white/80 px-4 py-3 text-[14.5px] leading-[1.45]">
              {e.text}
            </li>
          ))}
        </ul>
        <CohortNote d={d} />
      </div>
    </div>
  )
}

function CampaignSlide({ d }: { d: Data }) {
  const e = d.hero.eligibility
  return (
    <div className="grid w-full items-start gap-[clamp(20px,3.4vw,48px)] md:grid-cols-[minmax(0,.9fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Title kicker="5 · Campaigns">Promote it where it’s proven</Title>
        <Lead>
          Only a Proven product can be promoted in the Willow app, and only to people whose goals and skin type its evidence covers. A randomised holdout never sees the card, so the lift the campaign causes is measured, not assumed.
        </Lead>
        {e.reasons[0] ? <p className="m-0 max-w-[540px] text-[13.5px] leading-[1.5] text-ink-2">{e.reasons[0]}</p> : null}
        <CohortNote d={d} />
      </div>
      <div className="flex flex-col gap-4 rounded-[20px] bg-white/70 p-4">
        <div className="flex items-center gap-3">
          <ProductImage product={{ image_url: d.hero.product.image_url, category: d.hero.product.category, name: d.hero.product.product }} size={44} />
          <span className="text-[14.5px] leading-[1.3]">{d.hero.product.product}</span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-ink-2">Goals its evidence covers</span>
          <Chips items={e.goals.map(goalLabel)} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-ink-2">Skin types its evidence covers</span>
          <Chips items={e.skin_types.map(skinLabel)} />
        </div>
      </div>
    </div>
  )
}

function End({ onProof, onMei, onApp }: { onProof: () => void; onMei: () => void; onApp: () => void }) {
  const steps = ['Measured', 'Proven', 'Claims ready', 'Promoted', 'Lift measured']
  return (
    <div className="grid w-full items-center gap-[clamp(20px,3.4vw,48px)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {steps.map((s, k) => (
          <li key={s} className="flex items-center gap-3 rounded-[16px] bg-white/70 px-4 py-3 text-[15px]">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-[#DDF3C9] text-[13px] tnum">
              {k + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-4">
        <h2 className="m-0 font-serif text-[clamp(32px,3.6vw,52px)] leading-none font-normal">From measured to promoted</h2>
        <p className="m-0 max-w-[520px] text-[15px] leading-[1.5] text-ink-2">
          One path for every product: measured in people’s routines, proven against people who don’t use it, claimed in words the evidence supports, and promoted only where it works.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={onProof} className="min-h-12 rounded-pill bg-selected px-6 text-[15px] text-inverse">
            Open Proof by Willow
          </button>
          <button type="button" onClick={onMei} className="min-h-12 rounded-pill bg-white px-6 text-[15px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.15)]">
            Explore Mei’s journey
          </button>
          <button type="button" onClick={onApp} className="min-h-12 rounded-pill bg-white px-6 text-[15px] shadow-[inset_0_0_0_1px_rgba(18,18,18,.15)]">
            Open the Willow app
          </button>
        </div>
        <p className="m-0 text-[12.5px] text-ink-2">Cosmetic appearance only, not a medical assessment. Outcomes are observational, not a clinical trial.</p>
      </div>
    </div>
  )
}
