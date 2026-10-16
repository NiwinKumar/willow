import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { retailerProduct } from '../../../lib/api'
import { useRetailData } from '../context'
import { outcomes } from '../data'
import { sectionPath, useRetailState } from '../state'
import type { Insights, ProductDetail as Detail } from '../types'
import { CurveChart, EmptyState, EvidenceBar, int, LiftValue, Panel, pct, ProofTierChip, SectionHeader, SimBadge, SkeletonHeader, SkeletonPanel, Term, weeks } from '../ui'
import { InsightsGate, useWorkspaceLabel } from './shared'

/*
 * Product detail (/retail/products/:id). TODO(slice D): build the full page on GET /v1/retailer/products/{id}:
 * segment breakdown, competitor benchmark, co-used products, switching, conflicts, evidence pack and the
 * Promote CTA with eligibility. This scaffold already shows the outcome curve when the endpoint answers, and the
 * insights' figures for the product until then.
 */
export default function ProductDetail() {
  return (
    <InsightsGate
      skeleton={
        <div className="flex flex-col gap-4">
          <SkeletonHeader />
          <SkeletonPanel height={220} />
        </div>
      }
    >
      {(d) => <Body d={d} />}
    </InsightsGate>
  )
}

function Body({ d }: { d: Insights }) {
  const { productId = '' } = useParams()
  const { filters } = useRetailData()
  const { carry } = useRetailState()
  const eyebrow = useWorkspaceLabel()
  const key = `${productId}|${filters.cohort}|${filters.range}`
  const [res, setRes] = useState<{ key: string; detail: Detail | null; status: 'loading' | 'ready' | 'missing' | 'failed' }>({ key: '', detail: null, status: 'loading' })
  useEffect(() => {
    let alive = true
    retailerProduct(productId, filters).then(
      (detail) => alive && setRes({ key, detail, status: 'ready' }),
      (e: { status?: number }) => alive && setRes({ key, detail: null, status: e?.status === 404 ? 'missing' : 'failed' }),
    )
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const state = res.key === key ? res : { status: 'loading' as const, detail: null }
  const o = outcomes(d).find((x) => x.product_id === productId)
  const p = state.detail?.product
  const name = p?.product ?? o?.product ?? 'Product'
  const back = (
    <Link to={`${sectionPath('products')}${carry}`} className="inline-flex h-8 items-center gap-1.5 rounded-xs border border-line-strong px-2.5 text-proof-small text-ink no-underline hover:bg-glass">
      <ArrowLeft size={13} strokeWidth={1.6} aria-hidden /> All products
    </Link>
  )
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow={`${eyebrow} · Product`}
        title={name}
        answer={
          p && p.rate !== null ? (
            <>
              {p.brand} · <strong>{pct(p.rate)}</strong> of {int(p.n)} users had a <Term id="real_change">real change</Term> by week {d.cohort.weeks}
              {p.base_rate !== null ? <> (non-users {pct(p.base_rate)})</> : null}.
            </>
          ) : o ? (
            <>
              {o.brand} · <strong>{pct(o.rate)}</strong> of {int(o.n)} users had a <Term id="real_change">real change</Term> by week {d.cohort.weeks}.
            </>
          ) : (
            'No outcome figures for this product in this filter.'
          )
        }
        actions={back}
      />
      {state.status === 'ready' && state.detail ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel title="When the lasting change began" id="curve-h" meta={<SimBadge cohort={d.cohort} />} className="xl:col-span-8" footnote="Share of each group whose real change (held to week 8) had begun by that week. Cumulative: the week-8 value is the rate.">
            <CurveChart
              title={`${name}: cumulative share with a real change by week`}
              weeks={state.detail.curve.weeks}
              series={[
                { id: 'users', label: 'Users', values: state.detail.curve.users, tone: 'signal', n: state.detail.product.n },
                { id: 'base', label: 'Non-users', values: state.detail.curve.base, tone: 'muted' },
              ]}
            />
          </Panel>
          <Panel title="Evidence" id="ev-h" className="xl:col-span-4">
            <div className="flex flex-col gap-3">
              <ProofTierChip tier={state.detail.product.tier} />
              <EvidenceBar rate={state.detail.product.rate} lo={state.detail.product.rate_lo} hi={state.detail.product.rate_hi} base={state.detail.product.base_rate} n={state.detail.product.n} />
              <span className="flex items-center justify-between text-proof-body">
                <Term id="lift">Lift</Term>
                <LiftValue lift={state.detail.product.lift} lo={state.detail.product.lift_lo} hi={state.detail.product.lift_hi} />
              </span>
              <span className="flex items-center justify-between text-proof-body">
                Median time to change <span className="font-mono tnum">{weeks(state.detail.product.weeks)}</span>
              </span>
            </div>
          </Panel>
        </div>
      ) : state.status === 'loading' ? (
        <SkeletonPanel height={220} />
      ) : state.status === 'missing' && !o ? (
        <EmptyState title="This product isn’t in the catalogue" body="The link may be old. Every product with measured outcomes is listed on the scoreboard." action={{ label: 'Open the scoreboard', to: `${sectionPath('products')}${carry}` }} />
      ) : (
        <EmptyState
          title="The full product page is coming in this release"
          body="Segments, competitor benchmark, co-used products, switching, routine conflicts and the claim-ready evidence pack arrive with the product service. The scoreboard already has this product’s rate, lift and continuation."
          action={{ label: 'Back to the scoreboard', to: `${sectionPath('products')}${carry}${carry ? '&' : '?'}product=${encodeURIComponent(productId)}` }}
        />
      )}
    </div>
  )
}
