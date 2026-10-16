import { Pause, Play, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { ProductImage } from '../../../../components/willow/ProductImage'
import { api, type Campaign } from '../../../../lib/api'
import { useAuth } from '../../../../lib/useAuth'
import { ctrText, dateRange, goalLabel, HOLDOUT_MIN, promoError, skinText, timeLeft, wilson, type PromoError } from '../../promote'
import { int, interval, pct, pts, Sparkbars, Term, useTooltip, type SparkDay } from '../../ui'

const STATUS: Record<Campaign['status'], { glyph: string; label: string; cls: string }> = {
  active: { glyph: '●', label: 'Active', cls: 'border-proof-leaf-line bg-proof-leaf-soft text-ink [&>span]:text-proof-leaf' },
  paused: { glyph: '❙❙', label: 'Paused', cls: 'border-line-strong text-ink [&>span]:text-ink-2' },
  ended: { glyph: '■', label: 'Ended', cls: 'border-line text-ink-2 [&>span]:text-ink-2' },
}

export function StatusChip({ status }: { status: Campaign['status'] }) {
  const s = STATUS[status]
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 text-proof-small ${s.cls}`}>
      <span aria-hidden className="text-[9px] leading-none tracking-[-.1em]">
        {s.glyph}
      </span>
      {s.label}
    </span>
  )
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const n = (v: number, one: string, many = `${one}s`) => `${int(v)} ${v === 1 ? one : many}`

/**
 * One campaign: status (glyph + word), product, audience, dates, delivery as counted (impressions, clicks, CTR,
 * adds) with a daily sparkline, and the randomised-holdout comparison (or the honest pending state). Pause,
 * resume and delete act in place; the api's refusals (422 evidence, 429 cap, 409 ended) show inside the card.
 */
export function CampaignCard({ c, onChanged, onDeleted, onStale, highlight, otherWorkspace }: { c: Campaign; onChanged: (c: Campaign) => void; onDeleted: (id: string) => void; onStale: () => void; highlight: boolean; otherWorkspace: string | null }) {
  const { getIdToken } = useAuth()
  const [busy, setBusy] = useState<null | 'status' | 'delete'>(null)
  const [error, setError] = useState<PromoError | null>(null)
  const [confirm, setConfirm] = useState(false)
  const s = c.stats

  // A refusal can mean this list is out of date (a campaign started elsewhere, this one ended or was removed).
  const fail = (e: unknown) => {
    const err = promoError(e)
    setError(err)
    if (err.kind === 'too_many' || err.kind === 'ended' || (e as { status?: number }).status === 404) onStale()
  }
  const setStatus = async (status: 'active' | 'paused') => {
    setBusy('status')
    setError(null)
    try {
      onChanged(await api.updateCampaign(await getIdToken(), c.id, { status }))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }
  const remove = async () => {
    setBusy('delete')
    setError(null)
    try {
      await api.deleteCampaign(await getIdToken(), c.id)
      onDeleted(c.id)
    } catch (e) {
      fail(e)
      setBusy(null)
    }
  }

  const days: SparkDay[] = s.daily.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.impressions, detail: `${n(d.impressions, 'impression')} · ${n(d.clicks, 'click')} · ${n(d.adds, 'add')}` }))
  const btn = 'hit44 inline-flex h-8 items-center gap-1.5 rounded-xs border border-line-strong bg-transparent px-2.5 text-proof-small text-ink hover:bg-glass disabled:opacity-45'

  return (
    <article id={`campaign-${c.id}`} tabIndex={-1} aria-labelledby={`campaign-${c.id}-h`} className={`flex min-w-0 flex-col rounded-sm border bg-surface outline-none transition-[border-color,box-shadow] duration-700 ${highlight ? 'border-proof-leaf shadow-[0_0_0_3px_var(--proof-leaf-soft)]' : 'border-line'}`}>
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <ProductImage product={{ image_url: c.image_url, category: c.category ?? '', name: c.product ?? c.product_id }} size={36} decorative />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 id={`campaign-${c.id}-h`} className="m-0 truncate text-proof-h font-medium text-ink" title={c.product ?? c.product_id}>
            {c.product ?? c.product_id}
          </h3>
          <span className="truncate text-proof-small text-ink-2">
            {c.brand}
            {otherWorkspace ? ` · from ${otherWorkspace}` : ''}
          </span>
        </div>
        <StatusChip status={c.status} />
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        <dl className="m-0 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 text-proof-small">
          <dt className="text-ink-2">Audience</dt>
          <dd className="m-0 min-w-0 text-ink">
            {c.goals.map(goalLabel).join(', ')} · {skinText(c.skin_types)}
          </dd>
          <dt className="text-ink-2">Dates</dt>
          <dd className="m-0 font-mono text-[12px] text-ink tnum">
            {dateRange(c.starts_at, c.ends_at)} · <span className={c.status === 'ended' ? 'text-ink-2' : ''}>{timeLeft(c)}</span>
          </dd>
        </dl>

        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-xs border border-line bg-line">
          <Stat label="Impressions" value={int(s.impressions)} />
          <Stat label="Clicks" value={int(s.clicks)} />
          <Stat label={<Term id="ctr">CTR</Term>} value={ctrText(s.ctr)} />
          <Stat label="Adds" value={int(s.adds)} title="Adds to routine from this card" />
        </div>
        {days.length ? <Sparkbars days={days} label={`Impressions per day for ${c.product ?? 'this campaign'}`} /> : null}
        <p className="m-0 text-[11px] text-ink-2">Delivery counts each person once a day per kind, as counted; never split by goal or skin type.</p>

        <Incrementality c={c} />

        {error ? (
          <div role="alert" className="flex flex-col gap-1 rounded-xs border border-line-strong bg-sunken p-3">
            <span className="text-proof-body font-medium text-ink">{error.title}</span>
            <span className="text-proof-small text-ink-2">{error.message}</span>
            {error.reasons.length ? (
              <ul className="m-0 list-disc pl-4 text-proof-small text-ink">
                {error.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        {confirm ? (
          <div role="group" aria-label="Confirm delete" className="flex w-full flex-wrap items-center gap-2">
            <span className="mr-auto text-proof-small text-ink">Delete this campaign and its stats? This can’t be undone.</span>
            <button type="button" autoFocus onClick={() => setConfirm(false)} className={btn}>
              Keep it
            </button>
            <button type="button" onClick={() => void remove()} disabled={busy === 'delete'} className="hit44 inline-flex h-8 items-center gap-1.5 rounded-xs border-0 bg-selected px-3 text-proof-small font-medium text-inverse hover:bg-ink/85 disabled:opacity-45">
              {busy === 'delete' ? 'Deleting…' : 'Delete campaign'}
            </button>
          </div>
        ) : (
          <>
            {c.status === 'active' ? (
              <button type="button" onClick={() => void setStatus('paused')} disabled={busy !== null} className={btn}>
                <Pause size={13} strokeWidth={1.8} aria-hidden />
                {busy === 'status' ? 'Pausing…' : 'Pause'}
              </button>
            ) : c.status === 'paused' ? (
              <button type="button" onClick={() => void setStatus('active')} disabled={busy !== null} className={btn}>
                <Play size={13} strokeWidth={1.8} aria-hidden />
                {busy === 'status' ? 'Resuming…' : 'Resume'}
              </button>
            ) : null}
            <button type="button" onClick={() => setConfirm(true)} disabled={busy !== null} className={`${btn} ml-auto`}>
              <Trash2 size={13} strokeWidth={1.8} aria-hidden />
              Delete
            </button>
          </>
        )}
      </footer>
    </article>
  )
}

function Stat({ label, value, title }: { label: ReactNode; value: string; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-2.5 py-2" title={title}>
      <span className="truncate text-[11px] text-ink-2">{label}</span>
      <span className="font-mono text-[15px] text-ink tnum">{value}</span>
    </div>
  )
}

/** Exposed vs randomised holdout: adoption rate per group with n and its 95% interval, and the lift with its CI. */
function Incrementality({ c }: { c: Campaign }) {
  const inc = c.stats.incrementality
  const liftTip = useTooltip(inc ? `95% interval ${pts(inc.lift_lo)} to ${pts(inc.lift_hi)}. Difference of two proportions.` : '')
  return (
    <section aria-label="Incrementality" className="flex flex-col gap-2 rounded-xs border border-line bg-sunken p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-proof-small font-medium text-ink">
          <Term id="holdout">Lift vs randomised holdout</Term>
        </span>
        {inc ? (
          <>
            <span {...liftTip.trigger} tabIndex={0} className={`cursor-help font-mono text-proof-body tnum ${inc.lift > 0 ? 'text-ink' : 'text-ink-2'}`}>
              {pts(inc.lift)} <span className="text-[11px] text-ink-2">({pts(inc.lift_lo)} to {pts(inc.lift_hi)})</span>
            </span>
            {liftTip.node}
          </>
        ) : null}
      </div>
      {inc ? (
        <div className="flex flex-col gap-1.5">
          <GroupRow label="Could see the card" g={inc.exposed} />
          <GroupRow label="Holdout (never shown)" g={inc.holdout} />
        </div>
      ) : (
        <p className="m-0 text-proof-small text-ink-2">
          Holdout comparison appears once each group has {HOLDOUT_MIN} people. So far at least one group has fewer than {HOLDOUT_MIN} people, so no adoption rate is shown.
        </p>
      )}
      <p className="m-0 text-[11px] text-ink-2">{c.stats.incrementality_note}</p>
    </section>
  )
}

function GroupRow({ label, g }: { label: string; g: { n: number; added: number | null; rate: number } }) {
  const ci = g.added !== null ? wilson(g.added, g.n) : null
  const x = (v: number) => `${Math.max(0, Math.min(100, v * 100))}%`
  const text = `${label}: ${pct(g.rate)} added the product to their routine${ci ? `, 95% interval ${interval(ci[0], ci[1])}` : ''}; ${int(g.n)} people`
  return (
    <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-2.5">
      <span className="truncate text-proof-small text-ink-2">{label}</span>
      <span role="img" aria-label={text} className="relative block h-3">
        <span aria-hidden className="absolute inset-x-0 top-1/2 block h-1 -translate-y-1/2 rounded-pill bg-muted" />
        {ci ? <span aria-hidden className="absolute top-1/2 block h-1 -translate-y-1/2 rounded-pill bg-ink/35" style={{ left: x(ci[0]), width: `calc(${x(ci[1])} - ${x(ci[0])})` }} /> : null}
        <span aria-hidden className="absolute top-1/2 block size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-sunken" style={{ left: x(g.rate) }} />
      </span>
      <span className="whitespace-nowrap font-mono text-[12px] text-ink tnum">
        {pct(g.rate)} <span className="text-[11px] text-ink-2">n={int(g.n)}</span>
      </span>
    </div>
  )
}
