import type { Campaign, IncrementalityGroup } from '../../../../lib/api'
import { type PromoError, wilson } from '../../promote'
import { Badge, int, interval, pct } from '../../ui'

/* Shared bits of the campaign page and the Campaigns table: the status badge, the api's refusals in words, one holdout-group row. */

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

export type Confirm = 'delete' | 'end'

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

/** One group's row in the holdout comparison: people, added, and the adoption rate (its 95% interval for screen readers). */
export function GroupRow({ label, g, lead = false }: { label: string; g: IncrementalityGroup; lead?: boolean }) {
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
