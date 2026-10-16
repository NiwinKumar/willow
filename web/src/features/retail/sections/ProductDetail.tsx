import { ChevronDown, Columns3, Copy, Download, Megaphone } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useRetailData } from '../context'
import { csvMeta } from '../data'
import { KIND_LABEL, packCsv, packHtml, packMarkdown, packName, statementLine } from '../evidencePack'
import { campaignFor, pipelineSteps, ProofPipeline, useCampaigns } from '../pipeline'
import { ProductImage } from '../../routine/productUi'
import { useProductDetail } from '../productData'
import { hintOf, money, segInterval } from '../productModel'
import { sectionPath, useRetailState } from '../state'
import type { BrandFlow, Insights, ProductDetail as Detail, Seg } from '../types'
import { Badge, Bone, Button, copyText, CurveChart, downloadCsv, downloadText, EmptyState, ErrorState, EvidenceBar, int, interval, MIN_GROUP, PageHeader, Panel, pct, ProductCell, ProofTierChip, pts, ShareBar, SkeletonPanel, Stat, Tabs, ToolButton, useTooltip, weeks } from '../ui'
import { InsightsGate, YoursTag } from './shared'

/*
 * Product proof page (/retail/products/:id) on GET /v1/retailer/products/{id}. Read top to bottom it is the
 * demo's story: the Proof pipeline (measured → proven → claims → promoted → lift), the outcome against
 * non-users with the same goals, where it works, the claim-ready statements, how it ranks, and the routine
 * context (used alongside, switching, conflicts). Promote opens the campaign sheet prefilled
 * (/retail/campaigns?new=<id>). Deep links: ?seg=skin|goal|tone, ?ctx=co|switch|conflicts.
 */

export default function ProductDetail() {
  return (
    <InsightsGate skeleton={<DetailSkeleton />}>
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading product" className="flex flex-col gap-8">
      <div aria-hidden className="flex gap-4">
        <Bone className="size-14 shrink-0 rounded-card" />
        <div className="flex flex-1 flex-col gap-2">
          <Bone className="h-7 w-[min(520px,80%)]" />
          <Bone className="h-4 w-[min(420px,60%)]" />
        </div>
      </div>
      <SkeletonPanel height={110} />
      <div aria-hidden className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <SkeletonPanel height={420} className="lg:col-span-7" />
        <SkeletonPanel height={420} className="lg:col-span-5" />
      </div>
    </div>
  )
}

const SEG_TABS = [
  { id: 'skin', label: 'Skin type' },
  { id: 'goal', label: 'Goal' },
  { id: 'tone', label: 'Tone band' },
] as const
type SegTab = (typeof SEG_TABS)[number]['id']

const CTX_TABS = [
  { id: 'co', label: 'Used alongside' },
  { id: 'switch', label: 'Where users go' },
  { id: 'conflicts', label: 'Routine conflicts' },
] as const
type CtxTab = (typeof CTX_TABS)[number]['id']

const tierWord = (t: string) => `${t[0].toUpperCase()}${t.slice(1)}`

function Body({ d }: { d: Insights }) {
  const { productId = '' } = useParams()
  const { filters, workspace } = useRetailData()
  const { carry } = useRetailState()
  const state = useProductDetail(productId, filters)
  if (state.status === 'loading') return <DetailSkeleton />
  if (state.status === 'missing') return <EmptyState title="This product isn’t in the catalog" body="The link may be old or mistyped. Every catalog product is on the Products list, with its status." action={{ label: 'Open products', to: `${sectionPath('products')}${carry}` }} />
  if (state.status === 'failed') return <ErrorState title="The product couldn’t load" body="The products service didn’t answer. No partial numbers are shown." onRetry={() => window.location.reload()} />
  return <Page x={state.d} weeksN={d.cohort.weeks} brandView={workspace.kind === 'brand' ? workspace.brand : null} />
}

function Page({ x, weeksN, brandView }: { x: Detail; weeksN: number; brandView: string | null }) {
  const { param, setParam, carry } = useRetailState()
  const p = x.product
  const measured = p.rate !== null
  const seg: SegTab = SEG_TABS.find((t) => t.id === param('seg'))?.id ?? 'skin'
  const ctx: CtxTab = CTX_TABS.find((t) => t.id === param('ctx'))?.id ?? 'co'
  const comp = x.competitors
  const rival = comp.rows.find((r) => !r.is_self)
  const compareTo = `/retail/compare${carry}${carry ? '&' : '?'}ids=${[p.product_id, ...(rival ? [rival.product_id] : [])].map(encodeURIComponent).join(',')}`
  const promoteTo = `${sectionPath('campaigns')}${carry}${carry ? '&' : '?'}new=${encodeURIComponent(p.product_id)}`
  const facts = [p.category_label, `${tierWord(p.price_tier)} price`, p.size, money(p.price)].filter(Boolean).join(' · ')
  const campaign = campaignFor(useCampaigns(), p.product_id)
  const steps = pipelineSteps({ p, weeksN, statements: x.evidence.length, eligible: x.eligibility.eligible, campaign, promoteTo })

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-proof-small text-ink-2">
          <Link to={`${sectionPath('products')}${carry}`} className="rounded-ctl text-ink-2 no-underline hover:text-ink">
            Products
          </Link>
          <span aria-hidden className="text-ink-3">
            /
          </span>
          <Link to={`${sectionPath('products')}${carry}${carry ? '&' : '?'}category=${encodeURIComponent(p.category)}`} className="rounded-ctl text-ink-2 no-underline hover:text-ink">
            {p.category_label}
          </Link>
        </nav>
        <PageHeader
          leading={
            <span className="hidden shrink-0 overflow-hidden rounded-card border border-line bg-pf-bg2 p-1 sm:block">
              <ProductImage product={{ image_url: p.image_url, category: p.category, name: p.product }} size={56} />
            </span>
          }
          title={p.product}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-ink">{p.brand}</span>
              {brandView === p.brand ? <YoursTag /> : null}
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              <span>{facts}</span>
            </span>
          }
          actions={
            <>
              <Button to={compareTo} label={rival ? `Compare with ${rival.product}` : 'Compare'}>
                <Columns3 size={15} strokeWidth={1.6} aria-hidden /> Compare
              </Button>
              <ExportMenu x={x} />
              {x.eligibility.eligible ? (
                <Button to={promoteTo} kind="primary">
                  <Megaphone size={15} strokeWidth={1.7} aria-hidden /> Promote
                </Button>
              ) : (
                <Button kind="primary" disabled title={x.eligibility.reasons[0]}>
                  <Megaphone size={15} strokeWidth={1.7} aria-hidden /> Promote
                </Button>
              )}
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-3 text-proof-small text-ink-2">
          <ProofTierChip tier={p.tier} hint={hintOf(p)} />
          {comp.rank && comp.of >= 3 ? (
            <span className="tnum">
              #{comp.rank} of {comp.of} {p.category_label.toLowerCase()} on visible change
            </span>
          ) : null}
          {!x.eligibility.eligible && x.eligibility.reasons[0] ? <span>{x.eligibility.reasons[0]}</span> : null}
        </div>
      </div>

      <section aria-labelledby="pipe-h" className="rounded-card border border-line bg-surface px-5 py-5">
        <h2 id="pipe-h" className="sr-only">
          Proof pipeline
        </h2>
        <ProofPipeline steps={steps} />
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <Panel title="Outcome" id="outcome-h" className="lg:col-span-7" description={`People using it against non-users with the same goals, by week of the ${weeksN}-week window.`}>
          {measured ? <Outcome x={x} weeksN={weeksN} /> : <EmptyState compact title="No outcome yet" body={reasonText(p)} />}
        </Panel>
        <Panel title="Where it works" id="seg-h" className="lg:col-span-5" description="Visible change by group. Dot: rate; bar: 95% interval; tick: non-users.">
          <div className="flex flex-col gap-3">
            <Tabs label="Group by" tabs={SEG_TABS.map((t) => ({ id: t.id, label: t.label }))} value={seg} onChange={(v) => setParam({ seg: v === 'skin' ? null : v })} panelId="seg-panel" />
            <div id="seg-panel" role="tabpanel" aria-labelledby="seg-h">
              {measured ? <SegList segs={x.segments[seg]} /> : <EmptyState compact title="No groups yet" body={reasonText(p)} />}
            </div>
            {seg === 'goal' ? <p className="m-0 text-proof-small text-ink-2">People can hold several goals, so goal groups overlap.</p> : seg === 'tone' ? <p className="m-0 text-proof-small text-ink-2">Tone bands are buckets for “works for whom”, never an order.</p> : null}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <Panel
          title="Claim-ready statements"
          id="ev-h"
          className="lg:col-span-7"
          meta={x.evidence.length ? <Badge>{x.evidence.length}</Badge> : null}
          actions={
            x.evidence.length ? (
              <ToolButton onClick={() => copyText(x.evidence.map(statementLine).join('\n'), `Copied ${x.evidence.length} statements`)} label="Copy every statement">
                <Copy size={14} strokeWidth={1.6} aria-hidden /> Copy all
              </ToolButton>
            ) : null
          }
          footnote={x.evidence.length ? <EvidenceMethod x={x} /> : undefined}
        >
          <EvidenceList x={x} />
        </Panel>
        <Panel title={`Against other ${p.category_label.toLowerCase()}`} id="comp-h" className="lg:col-span-5" flush description="Same category, sharing a goal, 10+ people. Ranked by visible change.">
          <Competitors x={x} brandView={brandView} carry={carry} />
        </Panel>
      </div>

      <Panel title="In people’s routines" id="ctx-h" description={p.users ? `Among its ${int(p.users)} users. Groups under ${MIN_GROUP} people are left out.` : undefined}>
        <div className="flex flex-col gap-4">
          <Tabs label="Routine context" tabs={CTX_TABS.map((t) => ({ id: t.id, label: t.label }))} value={ctx} onChange={(v) => setParam({ ctx: v === 'co' ? null : v })} panelId="ctx-panel" />
          <div id="ctx-panel" role="tabpanel" aria-labelledby="ctx-h">
            {ctx === 'co' ? <CoUsed x={x} carry={carry} /> : ctx === 'switch' ? <Switching x={x} carry={carry} /> : <Conflicts x={x} />}
          </div>
        </div>
      </Panel>
    </div>
  )
}

function reasonText(p: Detail['product']): string {
  if (p.reason === 'not_measured') return 'Its concerns have no Willow measure, so no outcome is measured.'
  if (p.reason === 'unused') return 'No Willow users have it in their routine yet.'
  return `Fewer than ${MIN_GROUP} people have reached week 8 with it.`
}

/** The hero figure (share of users with a visible change), the comparison, the curve and four supporting facts. */
function Outcome({ x, weeksN }: { x: Detail; weeksN: number }) {
  const p = x.product
  const liftTip = useTooltip(p.lift_lo !== null && p.lift_hi !== null ? `95% interval ${pts(p.lift_lo)} to ${pts(p.lift_hi)}` : '')
  const rateTip = useTooltip(p.rate_lo !== null && p.rate_hi !== null ? `95% interval ${interval(p.rate_lo, p.rate_hi)}` : '')
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1">
          <span {...rateTip.trigger} tabIndex={0} className="cursor-help text-proof-hero text-ink tnum">
            {pct(p.rate)}
          </span>
          {rateTip.node}
          <span className="text-proof-body text-ink-2">
            of {int(p.n)} users saw a visible change by week {weeksN}
          </span>
        </div>
        {p.base_rate !== null ? (
          <div className="flex flex-col gap-1 pb-0.5">
            <span className="flex items-baseline gap-2">
              <span className="text-proof-kpi text-ink-2 tnum">{pct(p.base_rate)}</span>
              {p.lift !== null ? (
                <>
                  <span {...liftTip.trigger} tabIndex={0} className={`cursor-help rounded-pill px-2 py-0.5 text-proof-small font-semibold tnum ${p.lift > 0 ? 'bg-proof-leaf-soft text-proof-leaf' : 'bg-sunken text-ink-2'}`}>
                    {pts(p.lift)}
                  </span>
                  {liftTip.node}
                </>
              ) : null}
            </span>
            <span className="text-proof-body text-ink-2">of non-users with the same goals</span>
          </div>
        ) : (
          <span className="pb-1 text-proof-body text-ink-2">Fewer than {MIN_GROUP} non-users to compare with.</span>
        )}
      </div>
      {x.curve.users.some((v) => v !== null) ? (
        <CurveChart
          title={`${p.product}: share with a visible change by week, users and non-users`}
          weeks={x.curve.weeks}
          height={220}
          series={[{ id: 'users', label: 'Users', values: x.curve.users, tone: 'signal', n: p.n }, ...(x.curve.base.some((v) => v !== null) ? [{ id: 'base', label: 'Non-users', values: x.curve.base, tone: 'muted' as const }] : [])]}
        />
      ) : null}
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
        <Stat label="Time to change" value={weeks(p.weeks)} sub="median, of those who changed" />
        <Stat label={`Still using at week ${weeksN}`} value={pct(p.cont8)} sub={p.n ? `of ${int(p.n)}` : undefined} />
        <Stat label="Share of routines" value={pct(p.routine_share)} sub={`${int(p.users)} users`} />
        <Stat label="Rank in category" value={x.competitors.rank ? `${x.competitors.rank} of ${x.competitors.of}` : '—'} sub={x.competitors.rank ? 'by visible change' : 'not ranked'} />
      </dl>
    </div>
  )
}

/** Small multiples on one 0–100% scale: rate dot, 95% interval, non-users tick, n. */
function SegList({ segs }: { segs: Seg[] }) {
  if (!segs.length) return <EmptyState compact title="No groups" body="No measured users in these groups." />
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {segs.map((s) => {
        const ci = segInterval(s)
        return (
          <li key={s.id} className="grid min-h-11 grid-cols-[104px_minmax(0,1fr)_44px] items-center gap-3 border-b border-line last:border-b-0">
            <span className="truncate text-proof-body text-ink" title={s.label}>
              {s.label}
            </span>
            <EvidenceBar rate={s.suppressed ? null : s.rate} lo={ci?.lo} hi={ci?.hi} base={s.base_rate} n={s.n} />
            <span className="text-right text-proof-body font-medium tnum">{s.suppressed ? '' : pct(s.rate)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Competitors({ x, brandView, carry }: { x: Detail; brandView: string | null; carry: string }) {
  const rows = x.competitors.rows
  if (!rows.length) return <EmptyState compact title="No benchmark yet" body={`No product in ${x.product.category_label.toLowerCase()} sharing a goal with it has ${MIN_GROUP} or more people at week 8.`} />
  const self = rows.findIndex((r) => r.is_self)
  // The top 5, plus this product where it sits when it is lower.
  const shown = rows.map((r, i) => ({ r, i })).filter(({ i }) => i < 5 || i === self)
  return (
    <ol className="m-0 flex list-none flex-col p-0" aria-label={`${x.product.category_label} ranked by visible change`}>
      {shown.map(({ r, i }) => (
        <li key={r.product_id} aria-current={r.is_self || undefined} className={`grid min-h-14 grid-cols-[24px_minmax(0,1fr)_52px] items-center gap-3 border-t border-line px-5 ${r.is_self ? 'bg-pf-hover' : ''}`}>
          <span className="text-right text-proof-small text-ink-2 tnum">{i + 1}</span>
          <ProductCell p={r} to={r.is_self ? undefined : `${sectionPath('products', r.product_id)}${carry}`} tag={r.is_self ? <span className="ml-1.5 shrink-0 text-ink">· This product</span> : brandView === r.brand ? <YoursTag /> : null} />
          <span className="text-right text-proof-body font-medium tnum">{pct(r.rate)}</span>
        </li>
      ))}
    </ol>
  )
}

function EvidenceMethod({ x }: { x: Detail }) {
  const caveat = x.evidence_caveat ?? x.evidence[0]?.caveat
  const method = x.evidence.find((e) => e.method)?.method
  return (
    <span className="flex flex-col gap-1">
      {method ? <span>{method}</span> : null}
      {caveat ? <span>{caveat}</span> : null}
    </span>
  )
}

function EvidenceList({ x }: { x: Detail }) {
  if (!x.evidence.length) return <EmptyState compact title="No statements yet" body={`Claim-ready statements appear once ${MIN_GROUP} or more people reach week 8 with it. ${reasonText(x.product)}`} />
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {x.evidence.map((e) => (
        <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-line py-3.5 first:pt-0 last:border-b-0 last:pb-0">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="m-0 text-proof-body text-ink">{e.text}</p>
            <span className="flex flex-wrap items-center gap-2 text-proof-label text-ink-2 tnum">
              <Badge>{KIND_LABEL[e.kind]}</Badge>
              n={int(e.n)}
              {e.window ? ` · ${e.window}` : ''}
            </span>
          </div>
          <button type="button" onClick={() => copyText(statementLine(e), 'Statement copied')} aria-label="Copy statement" title="Copy with n, window and cohort" className="hit44 grid size-8 place-items-center rounded-ctl border border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink">
            <Copy size={14} strokeWidth={1.6} aria-hidden />
          </button>
        </li>
      ))}
    </ol>
  )
}

/** Evidence pack downloads in one menu (HTML for print or PDF, Markdown, CSV). */
function ExportMenu({ x }: { x: Detail }) {
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
  const p = x.product
  const items: { label: string; sub: string; run: () => void }[] = [
    { label: 'Evidence pack', sub: 'Print-ready page (HTML)', run: () => downloadText(packName(x, 'html'), packHtml(x), 'text/html') },
    { label: 'Markdown', sub: 'For briefs and docs', run: () => downloadText(packName(x, 'md'), packMarkdown(x), 'text/markdown') },
    {
      label: 'CSV',
      sub: 'Statements with n and window',
      run: () => {
        const c = packCsv(x)
        downloadCsv(packName(x, 'csv'), csvMeta(x, p.product), c.header, c.rows)
      },
    },
  ]
  return (
    <div ref={box} className="relative">
      <Button onClick={() => setOpen((o) => !o)} disabled={!x.evidence.length} title={x.evidence.length ? undefined : 'No statements yet'}>
        <Download size={15} strokeWidth={1.6} aria-hidden /> Export <ChevronDown size={14} strokeWidth={1.6} aria-hidden className="text-ink-2" />
      </Button>
      {open ? (
        <div role="menu" aria-label="Export" className="absolute right-0 top-[calc(100%+6px)] z-[60] flex w-60 flex-col rounded-card border border-line bg-surface p-1 shadow-[0_0_0_1px_var(--line-subtle),0_16px_24px_-8px_rgba(0,0,0,.14)] animate-[wFadeIn_.12s_ease_both]">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                it.run()
                setOpen(false)
              }}
              className="flex flex-col items-start gap-0.5 rounded-ctl border-0 bg-transparent px-3 py-2 text-left hover:bg-pf-hover"
            >
              <span className="text-proof-body text-ink">{it.label}</span>
              <span className="text-proof-label text-ink-2">{it.sub}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CoUsed({ x, carry }: { x: Detail; carry: string }) {
  if (!x.co_used.length) return <EmptyState compact title="No pairing reaches 10 people yet" body="Products used together by fewer than 10 people are not shown." />
  const max = Math.max(...x.co_used.map((c) => c.share))
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-x-8 p-0 md:grid-cols-2">
      {x.co_used.map((c) => (
        <li key={c.product_id} className="grid min-h-14 grid-cols-[minmax(0,1fr)_88px_56px] items-center gap-3 border-b border-line">
          <ProductCell p={c} to={`${sectionPath('products', c.product_id)}${carry}`} />
          <ShareBar value={c.share} max={max} />
          <span className="text-right text-proof-body font-medium tnum" title={`${int(c.n)} people`}>
            {pct(c.share)}
          </span>
        </li>
      ))}
    </ul>
  )
}

type FlowItem = { key: string; label: string; sub?: string; n: number; to?: string }

function Switching({ x, carry }: { x: Detail; carry: string }) {
  const s = x.switching
  const brands = (b: BrandFlow[] | undefined): FlowItem[] => (b ?? []).map((f) => ({ key: `b:${f.brand}`, label: f.label, n: f.n }))
  const products = (ps: Detail['switching']['to']): FlowItem[] => ps.map((f) => ({ key: f.product_id, label: f.product, sub: f.brand, n: f.n, to: `${sectionPath('products', f.product_id)}${carry}` }))
  const from = { products: products(s.from), brands: brands(s.from_brands) }
  const to = { products: products(s.to), brands: brands(s.to_brands) }
  const any = (g: typeof from) => g.products.length + g.brands.length > 0
  const max = Math.max(1, ...[from, to].flatMap((g) => [...g.products, ...g.brands].map((f) => f.n)))
  if (s.stopped === null && !any(from) && !any(to)) return <EmptyState compact title="No switching yet" body={`Fewer than ${MIN_GROUP} people stopped it.`} />
  return (
    <div className="flex flex-col gap-4">
      {s.stopped !== null ? (
        <p className="m-0 text-proof-body text-ink-2">
          <span className="font-medium text-ink tnum">{int(s.stopped)}</span> of {int(x.product.users)} users stopped it.
          {!any(from) && !any(to) ? ' No destination reaches 10 people yet.' : ''}
        </p>
      ) : null}
      {any(from) || any(to) ? (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <FlowList title="Came from" group={from} max={max} empty="No source reaches 10 people yet" />
          <FlowList title="Went to" group={to} max={max} empty="No destination reaches 10 people yet" />
        </div>
      ) : null}
    </div>
  )
}

function FlowList({ title, group, max, empty }: { title: string; group: { products: FlowItem[]; brands: FlowItem[] }; max: number; empty: string }) {
  const items = (list: FlowItem[]) => (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {list.map((f) => (
        <li key={f.key} className="flex flex-col gap-1.5">
          <span className="flex min-w-0 items-baseline justify-between gap-2 text-proof-body">
            {f.to ? (
              <Link to={f.to} className="min-w-0 truncate text-ink no-underline hover:underline" title={f.sub ? `${f.label} · ${f.sub}` : f.label}>
                {f.label}
              </Link>
            ) : (
              <span className="min-w-0 truncate text-ink">{f.label}</span>
            )}
            <span className="shrink-0 text-proof-small text-ink-2 tnum">{int(f.n)} people</span>
          </span>
          <ShareBar value={f.n} max={max} />
        </li>
      ))}
    </ul>
  )
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="m-0 text-proof-body font-medium text-ink">{title}</h3>
      {group.products.length ? items(group.products) : null}
      {group.brands.length ? (
        <>
          <span className="text-proof-small text-ink-2">By brand</span>
          {items(group.brands)}
        </>
      ) : null}
      {!group.products.length && !group.brands.length ? <p className="m-0 text-proof-small text-ink-2">{empty}</p> : null}
    </div>
  )
}

function Conflicts({ x }: { x: Detail }): ReactNode {
  if (!x.conflicts.length) return <EmptyState compact title="No conflict reaches 10 people" body="Routine checks with this product found no conflict shared by 10 or more people." />
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {x.conflicts.map((c) => (
        <li key={c.kind} className="grid min-h-14 grid-cols-[minmax(0,1fr)_88px_56px] items-center gap-3 border-b border-line last:border-b-0">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-proof-body text-ink" title={c.label}>
              {c.label}
            </span>
            <span className="truncate text-proof-small text-ink-2">Fix: {c.fix}</span>
          </span>
          <ShareBar value={c.share} />
          <span className="text-right text-proof-body font-medium tnum" title={`${int(c.n)} people`}>
            {pct(c.share)}
          </span>
        </li>
      ))}
    </ul>
  )
}
