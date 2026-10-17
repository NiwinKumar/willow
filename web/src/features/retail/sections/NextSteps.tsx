import { ArrowRight, Sparkles } from 'lucide-react'

import { actionsProvenance, actionTarget, ANCHOR, type ActionTarget } from '../proofAi'
import type { Actions } from '../types'
import type { ViewState } from '../useView'
import { Bone, Button, Panel } from '../ui'

/*
 * "Next steps" at the top of the product page (GET /v1/retailer/products/{id}/actions): up to three things the
 * data supports doing with this product, each with why (numbers only from the api, checked) and one action
 * that goes where it is done: the campaign sheet prefilled, the claim drafts on a channel, or a panel on this
 * page. Gemini picks and words them; without it, the api's fixed priority. Loading shows skeleton rows (Gemini
 * can take a few seconds the first time); an error or no steps hides the panel, never blocking the page.
 */
export function NextSteps({ view, campaigns, claimable, onScroll }: { view: ViewState<Actions>; campaigns: string; claimable: boolean; onScroll: (t: Extract<ActionTarget, { kind: 'scroll' }>) => void }) {
  if (view.status === 'failed' || (view.status === 'ready' && !view.data.actions.length)) return null
  const d = view.status === 'ready' ? view.data : null
  return (
    <Panel
      title="Next steps"
      id={ANCHOR.next}
      flush
      description={
        d ? (
          <span className="flex items-center gap-1 text-proof-label text-ink-3">
            {d.source === 'gemini' ? <Sparkles size={12} strokeWidth={1.7} aria-hidden /> : null}
            {actionsProvenance(d.source, d.considered)}
          </span>
        ) : (
          <span className="text-proof-label text-ink-3">Working out what the data supports…</span>
        )
      }
    >
      <p role="status" className="sr-only">
        {d ? `${d.actions.length} next ${d.actions.length === 1 ? 'step' : 'steps'} for this product.` : ''}
      </p>
      {d ? (
        <ol className="m-0 flex list-none flex-col p-0">
          {d.actions.map((a) => {
            const t = actionTarget(a.link, campaigns, claimable)
            return (
              <li key={a.id} className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-proof-body font-medium text-ink">{a.title}</span>
                  <span className="text-proof-small text-ink-2 [text-wrap:pretty]">{a.why}</span>
                </div>
                <span className="shrink-0">
                  {t.kind === 'route' ? (
                    <Button to={t.to} size="sm">
                      {t.label} <ArrowRight size={14} strokeWidth={1.6} aria-hidden />
                    </Button>
                  ) : (
                    <Button onClick={() => onScroll(t)} size="sm">
                      {t.label} <ArrowRight size={14} strokeWidth={1.6} aria-hidden />
                    </Button>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      ) : (
        <div role="status" aria-label="Loading next steps" className="flex flex-col">
          {[0, 1, 2].map((i) => (
            <div key={i} aria-hidden className="flex items-center justify-between gap-6 border-t border-line px-5 py-4">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Bone className="h-3.5 w-[min(240px,60%)]" />
                <Bone className="h-3 w-[min(560px,90%)]" />
              </div>
              <Bone className="hidden h-8 w-32 sm:block" />
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
