import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { api, type Campaign } from '../../lib/api'
import { useQuery } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import type { ProductRow } from './types'
import { int, pts } from './ui'

/*
 * The Proof pipeline: one product's path from photos to an accountable promotion, read like a deployment's
 * build steps. Measured (people with 8 weeks of readings) → Proven (lift over non-users above zero across its
 * interval) → Claims ready (claim-ready statements) → Promoted (a live campaign in the Willow app) → Lift
 * measured (adoption against a randomised holdout). Every step is a fact from the api, never a projection.
 */

export type StepState = 'done' | 'partial' | 'todo'
export type Step = { id: string; title: string; state: StepState; detail: ReactNode; to?: string; cta?: string }

/** This viewer's campaigns (shares the Campaigns page's cache); empty when there is no session yet. */
export function useCampaigns(): Campaign[] {
  const { user } = useAuth()
  const uid = user?.uid ?? null
  const q = useQuery<{ list: Campaign[]; at: number | null }>(['campaigns', uid], (t) => api.listCampaigns(t).then((r) => ({ list: r.campaigns, at: Date.now() })), { enabled: Boolean(uid), staleMs: 10_000 })
  return q.data?.list ?? []
}

/** The most relevant campaign for a product: running first, then the latest. */
export function campaignFor(list: Campaign[], productId: string): Campaign | null {
  const mine = list.filter((c) => c.product_id === productId)
  return mine.find((c) => c.status === 'active') ?? mine.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}

export function pipelineSteps({ p, weeksN, statements, eligible, campaign, promoteTo }: { p: Pick<ProductRow, 'n' | 'tier' | 'lift' | 'lift_lo' | 'lift_hi' | 'to_proven'>; weeksN: number; statements: number | null; eligible: boolean; campaign: Campaign | null; promoteTo: string }): Step[] {
  const measured = p.n !== null && p.n >= 10
  const inc = campaign?.stats.incrementality ?? null
  const ended = campaign?.status === 'ended'
  // Reach in people; older api builds sent impressions only.
  const reached = campaign ? (campaign.stats.reach ?? campaign.stats.impressions) : 0
  const reachText = `${int(reached)} ${campaign?.stats.reach === undefined ? (reached === 1 ? 'impression' : 'impressions') : reached === 1 ? 'person reached' : 'people reached'}`
  return [
    {
      id: 'measured',
      title: 'Measured',
      state: measured ? 'done' : 'todo',
      detail: measured ? `${int(p.n)} people over ${weeksN} weeks` : 'Needs 10 people at week 8',
    },
    {
      id: 'proven',
      title: p.tier === 'promising' ? 'Promising' : 'Proven',
      state: p.tier === 'proven' ? 'done' : p.tier === 'promising' ? 'partial' : 'todo',
      detail:
        p.tier === 'proven'
          ? `${pts(p.lift)} vs non-users${p.lift_lo !== null ? `, at least ${pts(p.lift_lo)}` : ''}`
          : p.tier === 'promising'
            ? p.to_proven
              ? `About ${int(p.to_proven)} more people to settle it`
              : 'Positive lift; needs more people'
            : p.tier === 'unclear'
              ? 'No lift over non-users yet'
              : 'Not enough data',
    },
    {
      id: 'claims',
      title: 'Claims ready',
      state: statements ? 'done' : 'todo',
      detail: statements ? `${statements} ${statements === 1 ? 'statement' : 'statements'} with n and method` : 'After it is measured',
    },
    {
      id: 'promoted',
      title: 'Promoted',
      // An ended campaign was a promotion (its results stay); the product can be promoted again.
      state: campaign?.status === 'active' || ended ? 'done' : campaign ? 'partial' : 'todo',
      detail: campaign ? `${campaign.status === 'active' ? `Live · ${reachText}` : ended ? `Campaign ended · ${reachText}` : 'Campaign paused'}${campaign.rule ? ` · Auto-promoted by rule “${campaign.rule.name}”` : ''}` : eligible ? 'Ready to promote' : 'Opens once Proven',
      ...(eligible && (!campaign || ended) ? { to: promoteTo, cta: ended ? 'Promote again' : 'Promote' } : campaign?.rule ? { to: `${promoteTo.split('?')[0]}#autocampaign`, cta: 'See the rule' } : {}),
    },
    {
      id: 'lift',
      title: 'Lift measured',
      state: inc ? 'done' : campaign && !ended ? 'partial' : 'todo',
      detail: inc ? `${pts(inc.lift)} adoption vs holdout` : ended ? 'Ended before each group had 10 people' : campaign ? 'Collecting: 10 per group' : 'Randomised holdout after launch',
    },
  ]
}

function Glyph({ state, i }: { state: StepState; i: number }) {
  if (state === 'done')
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-proof-leaf text-[var(--bg-canvas)]">
        <Check size={14} strokeWidth={3} aria-hidden />
      </span>
    )
  if (state === 'partial')
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full border-2 border-pf-amber bg-surface">
        <span className="size-2 rounded-full bg-pf-amber" />
      </span>
    )
  return <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-proof-label text-ink-3 tnum">{i + 1}</span>
}

const WORD: Record<StepState, string> = { done: 'done', partial: 'in progress', todo: 'not yet' }

/**
 * The pipeline as a horizontal stepper (vertical under 768 px, or always with `vertical`). The line between two
 * steps fills when the step before it is done.
 */
export function ProofPipeline({ steps, vertical = false, label = 'Proof pipeline' }: { steps: Step[]; vertical?: boolean; label?: string }) {
  return (
    <ol aria-label={label} className={`m-0 grid list-none p-0 ${vertical ? 'grid-cols-1 gap-0' : 'grid-cols-1 gap-0 md:grid-cols-5'}`}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        return (
          <li key={s.id} className={`relative flex min-w-0 gap-3 ${vertical ? 'pb-4 last:pb-0' : 'pb-4 last:pb-0 md:flex-col md:gap-2.5 md:pb-0 md:pr-4'}`}>
            {!last ? (
              <span
                aria-hidden
                className={`absolute ${vertical ? 'bottom-0 left-3 top-7 w-px' : 'bottom-0 left-3 top-7 w-px md:left-8 md:right-1 md:top-3 md:h-px md:w-auto'} ${s.state === 'done' ? 'bg-proof-leaf' : 'bg-line-strong'}`}
              />
            ) : null}
            <Glyph state={s.state} i={i} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={`text-proof-body font-medium ${s.state === 'todo' ? 'text-ink-2' : 'text-ink'}`}>
                {s.title}
                <span className="sr-only">: {WORD[s.state]}.</span>
              </span>
              <span className="text-proof-small text-ink-2">{s.detail}</span>
              {s.to && s.cta ? (
                <Link to={s.to} className="mt-1 self-start text-proof-small font-medium text-proof-leaf no-underline hover:underline">
                  {s.cta} →
                </Link>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
