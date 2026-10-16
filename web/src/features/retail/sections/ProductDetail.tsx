import { ArrowLeft, ArrowRight, Columns3, Copy, Download, FileText, Megaphone } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { GOALS } from '../../../lib/metrics'
import { useRetailData } from '../context'
import { csvMeta } from '../data'
import { KIND_LABEL, packCsv, packHtml, packMarkdown, packName, statementLine } from '../evidencePack'
import { ProductImage } from '../../routine/productUi'
import { useProductDetail } from '../productData'
import { hintOf, money, segInterval } from '../productModel'
import { sectionPath, useRetailState } from '../state'
import type { BrandFlow, Insights, ProductDetail as Detail, Seg } from '../types'
import { Bone, copyText, CurveChart, downloadCsv, downloadText, EmptyState, ErrorState, EvidenceBar, int, interval, MIN_GROUP, Panel, pct, ProductCell, ProofTierChip, pts, ShareBar, SimBadge, SkeletonPanel, Stat, Tabs, Term, ToolButton, weeks } from '../ui'
import { InsightsGate, useWorkspaceLabel, YoursTag } from './shared'

/*
 * Product page (/retail/products/:id) on GET /v1/retailer/products/{id}: what the product does for the people
 * who use it, measured against non-users with the same goals, and everything a buyer or brand needs next:
 * who it works for (segments), where it ranks in its category, what it is used with (bundles), where people
 * go when they stop, routine conflicts around it, claim-ready statements with an export, and whether it can
 * be promoted. Deep links: ?seg=skin|tone|goal. Every number is the api's; groups under 10 are suppressed.
 */

export default function ProductDetail() {
  return (
    <InsightsGate skeleton={<DetailSkeleton />}>
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

/** Drawn to the page's final layout: back link, header with image, stat strip, the grid of panels. */
function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading product" className="flex flex-col gap-4">
      <Bone className="h-8 w-40" />
      <div aria-hidden className="flex gap-4">
        <Bone className="size-16 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Bone className="h-2.5 w-40" />
          <Bone className="h-7 w-[min(520px,80%)]" />
          <Bone className="h-4 w-[min(680px,95%)]" />
        </div>
      </div>
      <Bone className="h-[76px] w-full rounded-sm" />
      <div aria-hidden className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SkeletonPanel height={230} className="xl:col-span-7" />
        <SkeletonPanel height={230} className="xl:col-span-5" />
        <SkeletonPanel height={300} className="xl:col-span-7" />
        <SkeletonPanel height={300} className="xl:col-span-5" />
      </div>
    </div>
  )
}

const SEG_TABS = [
  { id: 'skin', label: 'Skin type' },
  { id: 'tone', label: 'Tone band' },
  { id: 'goal', label: 'Goal' },
] as const
type SegTab = (typeof SEG_TABS)[number]['id']

const goalLabel = (g: string) => GOALS.find((x) => x.id === g)?.label ?? g
const tierWord = (t: string) => `${t[0].toUpperCase()}${t.slice(1)}`
function Body({ d }: { d: Insights }) {
  const { productId = '' } = useParams()
  const { filters, workspace } = useRetailData()
  const { carry } = useRetailState()
  const state = useProductDetail(productId, filters)
  const back = (
    <Link to={`${sectionPath('products')}${carry}`} className="hit44 inline-flex h-8 items-center gap-1.5 self-start rounded-xs px-1 text-proof-small text-ink-2 no-underline hover:text-ink">
      <ArrowLeft size={13} strokeWidth={1.6} aria-hidden /> All products
    </Link>
  )
  if (state.status === 'loading') return <DetailSkeleton />
  if (state.status === 'missing')
    return (
      <div className="flex flex-col gap-4">
        {back}
        <EmptyState title="This product isn’t in the catalog" body="The link may be old or mistyped. Every catalog product is on the scoreboard, with its Proof tier." action={{ label: 'Open the scoreboard', to: `${sectionPath('products')}${carry}` }} />
      </div>
    )
  if (state.status === 'failed') return <ErrorState title="The product couldn’t load" body="The products service didn’t answer. No partial numbers are shown." onRetry={() => window.location.reload()} />
  return <Page x={state.d} d={d} back={back} brandView={workspace.kind === 'brand' ? workspace.brand : null} />
}

function Page({ x, d, back, brandView }: { x: Detail; d: Insights; back: ReactNode; brandView: string | null }) {
  const { param, setParam, carry } = useRetailState()
  const navigate = useNavigate()
  const eyebrow = useWorkspaceLabel()
  const p = x.product
  const measured = p.rate !== null
  const seg: SegTab = SEG_TABS.find((t) => t.id === param('seg'))?.id ?? 'skin'
  const comp = x.competitors
  const rival = comp.rows.find((r) => !r.is_self)
  const compareIds = [p.product_id, ...(rival ? [rival.product_id] : [])]
  const compareTo = `/retail/compare${carry}${carry ? '&' : '?'}ids=${compareIds.map(encodeURIComponent).join(',')}`
  const promoteTo = `/retail/promote${carry}${carry ? '&' : '?'}product=${encodeURIComponent(p.product_id)}`
  const facts = [p.category_label, `${tierWord(p.price_tier)} price tier`, p.size, money(p.price), p.stores ? `${p.stores} ${p.stores === 1 ? 'store' : 'stores'}` : null].filter(Boolean).join(' · ')
  const skinLabel = (id: string) => x.segments.skin.find((s) => s.id === id)?.label ?? id
  const exportPack = () => downloadText(packName(x, 'html'), packHtml(x), 'text/html')

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="-mb-2 flex items-center gap-1 text-proof-small text-ink-2">
        {back}
        <span aria-hidden>/</span>
        <Link to={`${sectionPath('categories', p.category)}${carry}`} className="rounded-xs px-1 text-ink-2 no-underline hover:text-ink">
          {p.category_label}
        </Link>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 max-w-[800px] gap-4">
          <ProductImageLarge p={p} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="eyebrow">■ {eyebrow} · Product</span>
            <h1 className="m-0 font-serif text-proof-title font-normal text-ink">{p.product}</h1>
            <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-proof-body text-ink-2">
              <span className="text-ink">{p.brand}</span>
              {brandView === p.brand ? <YoursTag /> : null}
              <span aria-hidden>·</span>
              <span>{facts}</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <ProofTierChip tier={p.tier} hint={hintOf(p)} />
              <SimBadge cohort={x.cohort} />
              {comp.rank ? (
                <span className="font-mono text-[11px] text-ink-2 tnum">
                  RANK {comp.rank} OF {comp.of} IN {p.category_label.toUpperCase()}
                </span>
              ) : null}
            </div>
            <p className="m-0 mt-1 max-w-[86ch] text-proof-answer text-ink-2 [&_strong]:font-normal [&_strong]:text-ink">
              <Summary x={x} weeksN={d.cohort.weeks} />
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToolButton onClick={() => navigate(compareTo)} label={rival ? `Compare with ${rival.product}` : 'Compare'}>
            <Columns3 size={14} strokeWidth={1.6} aria-hidden /> Compare
          </ToolButton>
          <ToolButton onClick={exportPack} disabled={!x.evidence.length} label="Export the evidence pack as a print-friendly page">
            <Download size={14} strokeWidth={1.6} aria-hidden /> Evidence pack
          </ToolButton>
          {x.eligibility.eligible ? (
            <Link to={promoteTo} className="hit44 inline-flex h-8 items-center gap-1.5 rounded-xs bg-selected px-3 text-proof-small font-medium text-inverse no-underline hover:bg-ink/85">
              <Megaphone size={14} strokeWidth={1.8} aria-hidden /> Promote
            </Link>
          ) : (
            <span aria-disabled title={x.eligibility.reasons[0]} className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-xs border border-line px-3 text-proof-small text-ink-2">
              <Megaphone size={14} strokeWidth={1.8} aria-hidden /> Promote
            </span>
          )}
        </div>
      </header>

      <StatStrip x={x} weeksN={d.cohort.weeks} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
          <Panel
            title="When the lasting change began"
            id="curve-h"
            meta={<SimBadge cohort={x.cohort} />}
            footnote={<>Cumulative share of each group whose real change (held to week {d.cohort.weeks}) had begun by that week; the week-{d.cohort.weeks} value is the rate. Non-users: people with an overlapping goal who don’t use it.</>}
          >
            {measured && x.curve.users.some((v) => v !== null) ? (
              <CurveChart
                title={`${p.product}: cumulative share with a real change by week, users and non-users`}
                weeks={x.curve.weeks}
                height={210}
                series={[
                  { id: 'users', label: 'Users', values: x.curve.users, tone: 'signal', n: p.n },
                  ...(x.curve.base.some((v) => v !== null) ? [{ id: 'base', label: 'Non-users', values: x.curve.base, tone: 'muted' as const }] : []),
                ]}
              />
            ) : (
              <EmptyState compact glyph="00" title="No curve yet" body={reasonText(p)} />
            )}
          </Panel>
          <Panel
            title="Against its category"
            id="comp-h"
            meta={
              comp.rank ? (
                <span className="font-mono text-[11px] text-ink-2 tnum">
                  {comp.rank} of {comp.of}
                </span>
              ) : null
            }
            flush
            footnote={
              <>
                {p.category_label} that share a goal with it, with 10+ people, by real-change rate. {comp.note ?? 'Differences inside the intervals are not meaningful.'}
              </>
            }
          >
            <Competitors x={x} brandView={brandView} carry={carry} />
          </Panel>
          <Panel
            title="Claim-evidence pack"
            id="ev-h"
            actions={
              x.evidence.length ? (
                <>
                  <ToolButton onClick={() => copyText(x.evidence.map(statementLine).join('\n'), `Copied ${x.evidence.length} statements`)} label="Copy every statement">
                    <Copy size={13} strokeWidth={1.6} aria-hidden /> Copy all
                  </ToolButton>
                  <ToolButton onClick={exportPack} label="Export the pack as a print-friendly HTML page">
                    <Download size={13} strokeWidth={1.6} aria-hidden /> Export pack
                  </ToolButton>
                  <ToolButton onClick={() => downloadText(packName(x, 'md'), packMarkdown(x), 'text/markdown')} label="Export the pack as Markdown">
                    <FileText size={13} strokeWidth={1.6} aria-hidden /> .md
                  </ToolButton>
                  <ToolButton
                    onClick={() => {
                      const c = packCsv(x)
                      downloadCsv(packName(x, 'csv'), csvMeta(x, p.product), c.header, c.rows)
                    }}
                    label="Export the pack as CSV"
                  >
                    CSV
                  </ToolButton>
                </>
              ) : null
            }
          >
            <EvidencePack x={x} />
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
          <Panel
            title="Who it works for"
            id="seg-h"
            meta={<SimBadge cohort={x.cohort} />}
            footnote={
              seg === 'goal' ? (
                'People can hold several goals, so goal groups overlap and don’t add up to the product’s n.'
              ) : seg === 'tone' ? (
                'Tone bands are buckets for “works for whom”, never an order.'
              ) : (
                <>
                  Dot: rate; bar: <Term id="interval">95% interval</Term>; tick: non-users in the same group.
                </>
              )
            }
          >
            <div className="flex flex-col gap-3">
              <Tabs label="Segment" tabs={SEG_TABS.map((t) => ({ id: t.id, label: t.label }))} value={seg} onChange={(v) => setParam({ seg: v === 'skin' ? null : v })} panelId="seg-panel" />
              <div id="seg-panel" role="tabpanel" aria-labelledby="seg-h">
                {measured ? <SegList segs={x.segments[seg]} /> : <EmptyState compact title="No groups yet" body={reasonText(p)} />}
              </div>
            </div>
          </Panel>
          <Panel title="Promotion" id="elig-h">
            <Eligibility x={x} promoteTo={promoteTo} skinLabel={skinLabel} />
          </Panel>
          <Panel title="Used alongside it" id="co-h" meta={p.users ? <span className="font-mono text-[11px] text-ink-2 tnum">of {int(p.users)} users</span> : null} flush footnote="Share of this product’s users who also use each product (any week): bundle and cross-sell candidates. Pairs under 10 people are left out.">
            <CoUsed x={x} carry={carry} />
          </Panel>
          <Panel title="Where people go when they stop" id="sw-h" meta={x.switching.stopped !== null ? <span className="font-mono text-[11px] text-ink-2 tnum">{int(x.switching.stopped)} stopped</span> : null} footnote="A switch: stopped this product and started another in the same category within a week before to two weeks after. Flows under 10 people are left out.">
            <Switching x={x} carry={carry} />
          </Panel>
          <Panel title="Routine conflicts around it" id="cf-h" flush footnote="Among this product’s users with a routine check. Cosmetic routine advice, not a medical assessment.">
            <Conflicts x={x} />
          </Panel>
        </div>
      </div>
    </div>
  )
}

function reasonText(p: Detail['product']): string {
  if (p.reason === 'not_measured') return 'Its concerns have no Willow metric, so no outcome is measured.'
  if (p.reason === 'unused') return 'No Willow users have it in their routine yet.'
  return `Fewer than ${MIN_GROUP} people have reached week 8 with it.`
}

function Summary({ x, weeksN }: { x: Detail; weeksN: number }) {
  const p = x.product
  if (p.rate === null) return <>{reasonText(p)}</>
  return (
    <>
      <strong>{pct(p.rate)}</strong> of {int(p.n)} users had a <Term id="real_change">real change</Term> by week {weeksN} (95% {interval(p.rate_lo, p.rate_hi)})
      {p.base_rate !== null ? (
        <>
          , against {pct(p.base_rate)} of <Term id="base_rate">non-users</Term> with the same goals: <strong>{pts(p.lift)}</strong>
          {p.lift_lo !== null && p.lift_hi !== null ? ` (${pts(p.lift_lo)} to ${pts(p.lift_hi)})` : ''}
        </>
      ) : (
        ', with fewer than 10 non-users to compare'
      )}
      .{p.weeks !== null ? ` Half of those who changed saw it begin by week ${p.weeks}.` : ''}
    </>
  )
}

function ProductImageLarge({ p }: { p: Detail['product'] }) {
  return (
    <span className="hidden shrink-0 sm:block">
      <ProductImage product={{ image_url: p.image_url, category: p.category, name: p.product }} size={64} />
    </span>
  )
}

function StatStrip({ x, weeksN }: { x: Detail; weeksN: number }) {
  const p = x.product
  const why = p.reason === 'not_measured' ? 'not measured' : p.reason === 'unused' ? 'not used yet' : 'Fewer than 10 people'
  return (
    <dl aria-label="Key figures" className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-4 xl:grid-cols-7">
      {[
        <Stat key="rate" label={<Term id="real_change">Real change</Term>} value={pct(p.rate)} sub={p.n ? `n=${int(p.n)} · ${interval(p.rate_lo, p.rate_hi)}` : why} />,
        <Stat key="base" label={<Term id="base_rate">Non-users</Term>} value={pct(p.base_rate)} sub={p.base_rate !== null ? 'same goals' : p.rate === null ? why : 'Fewer than 10 people'} />,
        <Stat key="lift" label={<Term id="lift">Lift</Term>} value={pts(p.lift)} sub={p.lift_lo !== null && p.lift_hi !== null ? `${pts(p.lift_lo)} to ${pts(p.lift_hi)}` : undefined} />,
        <Stat key="weeks" label="Time to change" value={weeks(p.weeks)} sub="median" />,
        <Stat key="cont" label={<Term id="continuation">Still using wk {weeksN}</Term>} value={pct(p.cont8)} sub={p.n ? `of ${int(p.n)}` : undefined} />,
        <Stat key="share" label={<Term id="routine_share">Share of routines</Term>} value={pct(p.routine_share)} sub={`${int(p.users)} users`} />,
        <Stat key="rank" label="Rank in category" value={x.competitors.rank ? `${x.competitors.rank}/${x.competitors.of}` : '—'} sub={x.competitors.rank ? 'by rate' : 'not ranked'} />,
      ].map((s, i) => (
        <div key={i} className="bg-surface px-3.5 py-3">
          {s}
        </div>
      ))}
    </dl>
  )
}

/** Small multiples: one row per group, the same 0–100% scale, rate dot, 95% interval, non-users tick, n. */
function SegList({ segs }: { segs: Seg[] }) {
  if (!segs.length) return <EmptyState compact title="No groups" body="This product has no measured users in these groups." />
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      <li aria-hidden className="grid grid-cols-[96px_minmax(0,1fr)_40px] gap-3 pb-1 font-mono text-[10.5px] text-ink-2">
        <span />
        <span className="flex">
          <span className="relative h-3 flex-1">
            <span className="absolute left-0">0</span>
            <span className="absolute left-1/2 -translate-x-1/2">50%</span>
            <span className="absolute right-0">100%</span>
          </span>
          <span className="w-[62px] shrink-0" />
        </span>
        <span />
      </li>
      {segs.map((s) => {
        const ci = segInterval(s)
        return (
          <li key={s.id} className="grid min-h-9 grid-cols-[96px_minmax(0,1fr)_40px] items-center gap-3 border-b border-line last:border-b-0">
            <span className="truncate text-proof-body text-ink" title={s.label}>
              {s.label}
            </span>
            <EvidenceBar rate={s.suppressed ? null : s.rate} lo={ci?.lo} hi={ci?.hi} base={s.base_rate} n={s.n} />
            <span className="text-right font-mono text-proof-body tnum">{s.suppressed ? '' : pct(s.rate)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Competitors({ x, brandView, carry }: { x: Detail; brandView: string | null; carry: string }) {
  const rows = x.competitors.rows
  if (!rows.length)
    return (
      <div className="px-4">
        <EmptyState compact title="No benchmark yet" body={`No product in ${x.product.category_label.toLowerCase()} sharing a goal with it has ${MIN_GROUP} or more people at week 8.`} />
      </div>
    )
  const max = Math.min(1, Math.max(0.5, ...rows.map((r) => r.rate_hi ?? r.rate ?? 0)) + 0.05)
  return (
    <ol className="m-0 flex list-none flex-col p-0" aria-label={`${x.product.category_label} ranked by real-change rate`}>
      {rows.map((r, i) => (
        <li
          key={r.product_id}
          aria-current={r.is_self || undefined}
          className={`grid min-h-10 grid-cols-[22px_minmax(0,1fr)_minmax(90px,150px)_36px] items-center gap-3 border-b border-line px-4 py-1 last:border-b-0 md:grid-cols-[22px_minmax(0,1fr)_128px_minmax(90px,150px)_36px] ${r.is_self ? 'bg-proof-leaf-soft' : ''}`}
        >
          <span className="text-right font-mono text-[11px] text-ink-2 tnum">{i + 1}</span>
          <ProductCell
            p={r}
            size={24}
            to={r.is_self ? undefined : `${sectionPath('products', r.product_id)}${carry}`}
            tag={r.is_self ? <span className="ml-1.5 inline-flex h-[18px] shrink-0 items-center rounded-[4px] border border-line-strong px-1.5 text-[10.5px] text-ink">This product</span> : brandView === r.brand ? <YoursTag /> : null}
          />
          <span className="hidden md:block">
            <ProofTierChip tier={r.tier} size="sm" />
          </span>
          <EvidenceBar rate={r.rate} lo={r.rate_lo} hi={r.rate_hi} base={r.base_rate} n={r.n} max={max} />
          <span className="text-right font-mono text-proof-body tnum">{pct(r.rate)}</span>
        </li>
      ))}
    </ol>
  )
}

function Eligibility({ x, promoteTo, skinLabel }: { x: Detail; promoteTo: string; skinLabel: (id: string) => string }) {
  const e = x.eligibility
  const hint = hintOf(x.product)
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 flex items-center gap-2 text-proof-body text-ink">
        <span aria-hidden className={e.eligible ? 'text-proof-leaf' : 'text-ink-2'}>
          {e.eligible ? '●' : '○'}
        </span>
        <span className="font-medium">{e.eligible ? 'Eligible to promote in the Willow app' : 'Not eligible to promote yet'}</span>
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-proof-small text-ink-2">
        {e.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {hint && !e.reasons.some((r) => r.includes('more people')) ? <p className="m-0 text-proof-small text-ink">{hint}</p> : null}
      {e.goals.length || e.skin_types.length ? (
        <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-proof-small">
          {e.goals.length ? (
            <>
              <dt className="text-ink-2">Goals</dt>
              <dd className="m-0 flex flex-wrap gap-1">{e.goals.map((g) => <Chip key={g}>{goalLabel(g)}</Chip>)}</dd>
            </>
          ) : null}
          {e.skin_types.length ? (
            <>
              <dt className="text-ink-2">Skin types</dt>
              <dd className="m-0 flex flex-wrap gap-1">{e.skin_types.map((s) => <Chip key={s}>{skinLabel(s)}</Chip>)}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        {e.eligible ? (
          <Link to={promoteTo} className="hit44 inline-flex h-8 items-center gap-1.5 rounded-xs bg-selected px-3 text-proof-small font-medium text-inverse no-underline hover:bg-ink/85">
            Create a campaign <ArrowRight size={13} strokeWidth={1.8} aria-hidden />
          </Link>
        ) : null}
        <span className="text-[11.5px] text-ink-2">Only goals and skin types with their own positive lift (10+ people) can be targeted. Payment buys reach, never rank or eligibility.</span>
      </div>
    </div>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-6 items-center rounded-pill border border-proof-leaf-line bg-proof-leaf-soft px-2 text-[11.5px] text-ink">{children}</span>
}

function CoUsed({ x, carry }: { x: Detail; carry: string }) {
  if (!x.co_used.length)
    return (
      <div className="px-4">
        <EmptyState compact title="No pairing reaches 10 people yet" body="Products used together by fewer than 10 people are not shown." />
      </div>
    )
  const max = Math.max(...x.co_used.map((c) => c.share))
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {x.co_used.map((c) => (
        <li key={c.product_id} className="grid min-h-10 grid-cols-[minmax(0,1fr)_72px_76px] items-center gap-3 border-b border-line px-4 py-1 last:border-b-0">
          <ProductCell p={c} size={24} to={`${sectionPath('products', c.product_id)}${carry}`} />
          <ShareBar value={c.share} max={max} />
          <span className="whitespace-nowrap text-right font-mono text-proof-body tnum">
            {pct(c.share)} <span className="text-[11px] text-ink-2">n={int(c.n)}</span>
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
    <div className="flex flex-col gap-3">
      <p className="m-0 text-proof-body text-ink-2">
        {s.stopped !== null ? (
          <>
            <span className="font-mono text-ink tnum">{int(s.stopped)}</span> of {int(x.product.users)} users stopped it.{' '}
          </>
        ) : null}
        {!any(from) && !any(to) ? 'No destination reaches 10 people yet: switches spread over many products.' : null}
      </p>
      {any(from) || any(to) ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FlowList title="Came from" group={from} max={max} empty="No source reaches 10 people yet" />
          <FlowList title="Went to" group={to} max={max} empty="No destination reaches 10 people yet" />
        </div>
      ) : null}
    </div>
  )
}

/** One side of the switching flow: products first, then the same flows by brand (they overlap, so no totals). */
function FlowList({ title, group, max, empty }: { title: string; group: { products: FlowItem[]; brands: FlowItem[] }; max: number; empty: string }) {
  const items = (list: FlowItem[]) => (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {list.map((f) => (
        <li key={f.key} className="flex flex-col gap-1">
          <span className="flex min-w-0 items-baseline justify-between gap-2 text-proof-body">
            {f.to ? (
              <Link to={f.to} className="min-w-0 truncate text-ink no-underline hover:underline" title={f.sub ? `${f.label} · ${f.sub}` : f.label}>
                {f.label}
              </Link>
            ) : (
              <span className="min-w-0 truncate text-ink">{f.label}</span>
            )}
            <span className="shrink-0 font-mono text-[11px] text-ink-2 tnum">n={int(f.n)}</span>
          </span>
          <ShareBar value={f.n} max={max} />
        </li>
      ))}
    </ul>
  )
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h3 className="m-0 text-proof-small font-normal text-ink-2">{title}</h3>
      {group.products.length ? items(group.products) : null}
      {group.brands.length ? (
        <>
          <span className="mt-1 text-[11px] text-ink-2">By brand</span>
          {items(group.brands)}
        </>
      ) : null}
      {!group.products.length && !group.brands.length ? <p className="m-0 text-proof-small text-ink-2">{empty}</p> : null}
    </div>
  )
}

function Conflicts({ x }: { x: Detail }) {
  if (!x.conflicts.length)
    return (
      <div className="px-4">
        <EmptyState compact title="No conflict reaches 10 people" body="Routine checks with this product found no conflict shared by 10 or more people." />
      </div>
    )
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {x.conflicts.map((c) => (
        <li key={c.kind} className="grid min-h-11 grid-cols-[minmax(0,1fr)_64px_76px] items-center gap-3 border-b border-line px-4 py-1.5 last:border-b-0">
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-proof-body text-ink" title={c.label}>
              {c.label}
            </span>
            <span className="truncate text-[11.5px] text-ink-2">Fix: {c.fix}</span>
          </span>
          <ShareBar value={c.share} />
          <span className="whitespace-nowrap text-right font-mono text-proof-body tnum">
            {pct(c.share)} <span className="text-[11px] text-ink-2">n={int(c.n)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function EvidencePack({ x }: { x: Detail }) {
  const caveat = x.evidence_caveat ?? x.evidence[0]?.caveat
  const method = x.evidence.find((e) => e.method)?.method
  if (!x.evidence.length) return <EmptyState compact title="No statements yet" body={`Claim-ready statements appear once ${MIN_GROUP} or more people reach week 8 with it. ${reasonText(x.product)}`} />
  return (
    <div className="flex flex-col gap-3">
      {caveat ? (
        <p role="note" className="m-0 rounded-xs border border-line-strong bg-sunken px-3 py-2 text-proof-small text-ink">
          <strong className="font-medium">Caveat.</strong> {caveat}
        </p>
      ) : null}
      {method ? (
        <p className="m-0 text-proof-small text-ink-2">
          <span className="text-ink">Method.</span> {method}
        </p>
      ) : null}
      <ol className="m-0 flex list-none flex-col p-0">
        {x.evidence.map((e) => (
          <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-t border-line py-2.5">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[.06em] text-ink-2">{KIND_LABEL[e.kind]}</span>
              <p className="m-0 text-proof-body text-ink">{e.text}</p>
              <span className="font-mono text-[11px] text-ink-2 tnum">
                n={int(e.n)}
                {e.window ? ` · ${e.window}` : ''}
                {e.cohort_label ? ` · ${e.cohort_label}` : ''}
              </span>
            </div>
            <CopyButton text={statementLine(e)} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  return (
    <button type="button" onClick={() => copyText(text, 'Statement copied')} aria-label="Copy statement" title="Copy statement with n, window and cohort" className="hit44 grid size-8 place-items-center rounded-xs border border-line bg-transparent text-ink-2 hover:bg-glass hover:text-ink">
      <Copy size={13} strokeWidth={1.6} aria-hidden />
    </button>
  )
}
