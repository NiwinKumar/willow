import { ExternalLink, Pause, Play, Square, Trash2 } from 'lucide-react'

import type { Campaign, IncrementalityGroup } from '../../../../lib/api'
import { ctrText, dateRange, durationText, goalLabel, HOLDOUT_MIN, skinLabel, timeLeft, type PromoError, wilson } from '../../promote'
import { Badge, Button, int, interval, pct, pts, Sparkbars, type SparkDay } from '../../ui'
import type { useCampaignActions } from './useCampaignActions'

/*
 * One campaign, in detail (the Campaigns page's side panel): status, audience and dates, the randomised-holdout
 * comparison (the answer a buyer wants: the adoption the campaign caused), then delivery as counted with the
 * daily bars. Pause / resume / delete act in place; the api's refusals (422 evidence, 429 cap, 409 ended) show
 * inline. `useCampaignActions` is shared with the table's row menu.
 */

const STATUS: Record<Campaign['status'], { label: string; tone: 'green' | 'gray' | 'outline' }> = {
  active: { label: 'Active', tone: 'green' },
  paused: { label: 'Paused', tone: 'gray' },
  ended: { label: 'Ended', tone: 'outline' },
}

export function StatusBadge({ status }: { status: Campaign['status'] }) {
  const s = STATUS[status]
  return (
    <Badge tone={s.tone}>
      {status === 'active' ? <span aria-hidden className="size-1.5 rounded-full bg-proof-leaf" /> : null}
      {s.label}
    </Badge>
  )
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const count = (v: number, one: string, many = `${one}s`) => `${int(v)} ${v === 1 ? one : many}`

export function CampaignDetail({ c, otherWorkspace, actions }: { c: Campaign; otherWorkspace: string | null; actions: ReturnType<typeof useCampaignActions> }) {
  const s = c.stats
  const days: SparkDay[] = s.daily.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.impressions, detail: `${count(d.impressions, 'impression')} · ${count(d.clicks, 'click')} · ${count(d.adds, 'add')}` }))
  const holdout = c.holdout_pct ?? 0.2
  return (
    <div className="flex flex-col gap-8">
      <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-proof-body">
        <dt className="text-ink-2">Status</dt>
        <dd className="m-0 flex flex-wrap items-center gap-2">
          <StatusBadge status={c.status} />
          <span className="text-ink-2">{timeLeft(c)}</span>
        </dd>
        <dt className="text-ink-2">Dates</dt>
        <dd className="m-0 text-ink tnum">
          {dateRange(c.starts_at, c.ends_at)} · {durationText(c)}
        </dd>
        <dt className="text-ink-2">Goals</dt>
        <dd className="m-0 text-ink">{c.goals.map(goalLabel).join(', ')}</dd>
        <dt className="text-ink-2">Skin types</dt>
        <dd className="m-0 text-ink">{c.skin_types.length ? c.skin_types.map(skinLabel).join(', ') : 'Every skin type the evidence covers'}</dd>
        <dt className="text-ink-2">Holdout</dt>
        <dd className="m-0 text-ink tnum">{Math.round(holdout * 100)}% of matching people, never shown</dd>
        {otherWorkspace ? (
          <>
            <dt className="text-ink-2">Workspace</dt>
            <dd className="m-0 text-ink">{otherWorkspace}</dd>
          </>
        ) : null}
      </dl>

      <Incrementality c={c} holdout={holdout} />

      <section aria-labelledby={`cmp-${c.id}-delivery`} className="flex flex-col gap-4">
        <h3 id={`cmp-${c.id}-delivery`} className="m-0 text-proof-h text-ink">
          Delivery
        </h3>
        <dl className="m-0 grid grid-cols-3 overflow-hidden rounded-card border border-line sm:grid-cols-5">
          {[
            ['Reach', s.reach !== undefined ? int(s.reach) : '—', 'People shown the card at least once (each person counted once)'],
            ['Impressions', int(s.impressions), 'Card at least half on screen; each person once a day'],
            ['Clicks', int(s.clicks), '“View product” taps'],
            ['CTR', ctrText(s.ctr), 'Clicks ÷ impressions'],
            ['Adds', int(s.adds), 'Added to routine from the card'],
          ].map(([label, value, title]) => (
            <div key={label} title={title} className="flex min-w-0 flex-col gap-1 border-line px-3 py-3 max-sm:[&:nth-child(-n+3)]:border-b max-sm:[&:not(:nth-child(3n))]:border-r sm:[&:not(:last-child)]:border-r">
              <dt className="truncate text-proof-small text-ink-2">{label}</dt>
              <dd className="m-0 text-[20px] font-semibold leading-7 tracking-[-0.02em] text-ink tnum">{value}</dd>
            </div>
          ))}
        </dl>
        {days.length && s.impressions > 0 ? <Sparkbars days={days} label={`Impressions per day for ${c.product ?? 'this campaign'}`} height={48} /> : <p className="m-0 text-proof-small text-ink-2">No delivery yet. The first impression lands when a matching shopper opens Routine.</p>}
        <p className="m-0 text-proof-small text-ink-2">Reach counts each person once; impressions, clicks and adds once per person a day. Never split by goal or skin type.</p>
        <a href="/routine" target="_blank" rel="noopener" className="hit44 inline-flex h-8 items-center gap-1.5 self-start rounded-ctl border border-line bg-surface px-2.5 text-proof-small font-medium text-ink no-underline transition-colors hover:border-line-strong hover:bg-pf-hover">
          See the card in the Willow app
          <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </section>

      {actions.error ? <ErrorBox error={actions.error} /> : null}
    </div>
  )
}

export type Confirm = 'delete' | 'end'

/** The panel's footer: pause or resume, end early and delete; ending and deleting ask first in the footer itself. */
export function CampaignDetailFooter({ c, actions, confirm, setConfirm }: { c: Campaign; actions: ReturnType<typeof useCampaignActions>; confirm: Confirm | null; setConfirm: (kind: Confirm | null) => void }) {
  if (confirm === 'end' && c.status !== 'ended')
    return (
      <div role="group" aria-label="Confirm end" className="flex flex-wrap items-center justify-end gap-x-2 gap-y-2">
        <span className="mr-auto text-proof-body text-ink">End it now? It stops for good; its results stay.</span>
        <Button kind="secondary" onClick={() => setConfirm(null)}>
          Keep running
        </Button>
        <Button
          kind="primary"
          onClick={() =>
            void actions.setStatus('ended').then((err) => {
              if (!err) setConfirm(null)
            })
          }
          disabled={actions.busy === 'status'}
        >
          {actions.busy === 'status' ? 'Ending…' : 'End campaign'}
        </Button>
      </div>
    )
  if (confirm === 'delete')
    return (
      <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center justify-end gap-x-2 gap-y-2">
        <span className="mr-auto text-proof-body text-ink">Delete it and its stats? This can’t be undone.</span>
        <Button kind="secondary" onClick={() => setConfirm(null)}>
          Keep it
        </Button>
        <Button kind="primary" onClick={() => void actions.remove()} disabled={actions.busy === 'delete'}>
          {actions.busy === 'delete' ? 'Deleting…' : 'Delete campaign'}
        </Button>
      </div>
    )
  return (
    <div className="flex items-center gap-2">
      {c.status === 'active' ? (
        <Button kind="secondary" onClick={() => void actions.setStatus('paused')} disabled={actions.busy !== null}>
          <Pause size={14} strokeWidth={1.8} aria-hidden />
          {actions.busy === 'status' ? 'Pausing…' : 'Pause'}
        </Button>
      ) : c.status === 'paused' ? (
        <Button kind="secondary" onClick={() => void actions.setStatus('active')} disabled={actions.busy !== null}>
          <Play size={14} strokeWidth={1.8} aria-hidden />
          {actions.busy === 'status' ? 'Resuming…' : 'Resume'}
        </Button>
      ) : null}
      {c.status !== 'ended' ? (
        <Button kind="secondary" onClick={() => setConfirm('end')} disabled={actions.busy !== null}>
          <Square size={13} strokeWidth={1.8} aria-hidden />
          End
        </Button>
      ) : null}
      <span className="ml-auto">
        <Button kind="ghost" onClick={() => setConfirm('delete')} disabled={actions.busy !== null}>
          <Trash2 size={14} strokeWidth={1.8} aria-hidden />
          Delete
        </Button>
      </span>
    </div>
  )
}

export function ErrorBox({ error }: { error: PromoError }) {
  return (
    <div role="alert" className="flex flex-col gap-1.5 rounded-card border border-line bg-pf-red-soft/40 p-4">
      <span className="text-proof-body font-medium text-ink">{error.title}</span>
      <span className="text-proof-small text-ink-2">{error.message}</span>
      {error.reasons.length ? (
        <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-proof-small text-ink">
          {error.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Exposed vs randomised holdout: adoption per group (n, added, rate with its interval on hover) and the lift. */
function Incrementality({ c, holdout }: { c: Campaign; holdout: number }) {
  const inc = c.stats.incrementality
  return (
    <section aria-labelledby={`cmp-${c.id}-lift`} className="flex flex-col gap-4">
      <h3 id={`cmp-${c.id}-lift`} className="m-0 text-proof-h text-ink">
        Incremental lift
      </h3>
      {inc ? (
        <>
          {/* In a side panel the interval is written out: the kit tooltip can't rise above a modal dialog. */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`text-proof-kpi tnum ${Math.round(inc.lift * 100) > 0 ? 'text-proof-leaf' : 'text-ink'}`}>{pts(inc.lift)}</span>
            <span className="flex flex-col">
              <span className="text-proof-body text-ink">
                {pct(inc.exposed.rate)} vs {pct(inc.holdout.rate)} added it to their routine
              </span>
              <span className="text-proof-small text-ink-2 tnum">
                95% interval {pts(inc.lift_lo)} to {pts(inc.lift_hi)}
              </span>
            </span>
          </div>
          <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-card border border-line text-proof-body">
            <caption className="sr-only">Adoption: could see the card vs randomised holdout</caption>
            <colgroup>
              <col />
              <col className="w-[72px]" />
              <col className="w-[72px]" />
              <col className="w-[120px]" />
            </colgroup>
            <thead>
              <tr className="bg-pf-bg2 text-proof-small text-ink-2">
                <th scope="col" className="h-9 border-b border-line px-4 text-left font-medium">
                  Group
                </th>
                <th scope="col" className="h-9 border-b border-line px-2 text-right font-medium">
                  People
                </th>
                <th scope="col" className="h-9 border-b border-line px-2 text-right font-medium">
                  Added
                </th>
                <th scope="col" className="h-9 border-b border-line px-4 text-right font-medium">
                  Adoption
                </th>
              </tr>
            </thead>
            <tbody>
              <GroupRow label="Could see the card" g={inc.exposed} lead />
              <GroupRow label={`Holdout (${Math.round(holdout * 100)}%)`} g={inc.holdout} />
            </tbody>
          </table>
        </>
      ) : (
        <div className="flex flex-col gap-1 rounded-card border border-dashed border-line-strong px-4 py-3.5">
          <span className="text-proof-body text-ink">Collecting</span>
          <span className="text-proof-small text-ink-2">The comparison appears once each group has {HOLDOUT_MIN} people. No rate is shown before then.</span>
        </div>
      )}
      <p className="m-0 text-proof-small text-ink-2">{c.stats.incrementality_note}</p>
    </section>
  )
}

function GroupRow({ label, g, lead = false }: { label: string; g: IncrementalityGroup; lead?: boolean }) {
  const ci = wilson(g.added, g.n)
  return (
    <tr>
      <th scope="row" className="h-12 border-b border-line px-4 text-left font-normal text-ink [tr:last-child>&]:border-b-0">
        <span className="flex items-center gap-2">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${lead ? 'bg-proof-leaf' : 'bg-[var(--pf-base)]'}`} />
          <span className="truncate">{label}</span>
        </span>
      </th>
      <td className="border-b border-line px-2 text-right text-ink-2 tnum [tr:last-child>&]:border-b-0">{int(g.n)}</td>
      <td className="border-b border-line px-2 text-right text-ink-2 tnum [tr:last-child>&]:border-b-0">{int(g.added)}</td>
      <td className="border-b border-line px-4 text-right [tr:last-child>&]:border-b-0">
        <span className="flex items-center justify-end gap-2.5">
          <span aria-hidden className="relative h-1.5 w-12 overflow-hidden rounded-pill bg-sunken">
            <span className={`absolute inset-y-0 left-0 rounded-pill ${lead ? 'bg-proof-leaf' : 'bg-[var(--pf-base)]'}`} style={{ width: `${Math.max(0, Math.min(100, g.rate * 100))}%` }} />
          </span>
          <span className="text-ink tnum">{pct(g.rate)}</span>
          {ci ? <span className="sr-only">, 95% interval {interval(ci[0], ci[1])}</span> : null}
        </span>
      </td>
    </tr>
  )
}
