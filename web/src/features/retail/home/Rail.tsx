import { CheckCircle2, Inbox, Megaphone, Sparkles, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { int } from '../ui'

/*
 * Home's right column, "Needs you" (owner feedback, Nov 28: information on the left, what needs the person on
 * the right). Top to bottom: the top decisions as full cards (one primary action each), then "Latest", one line
 * per thing that changed and wants a look: a request waiting for your answer, a brand's answer, a campaign
 * result, a campaign running. Each line goes where the thing lives; "All N" opens the board below on that lane.
 *
 * Four tests (Latest): (1) what moved since the person last looked, without scrolling to the board; (2) one
 * icon and one sentence per line, the figure in it, a chevron-free row that reads as a link on hover;
 * (3) rows only, nothing animates once arrived, no layout shift when the lanes load; (4) kit rows, hairlines,
 * leaf only for a measured result.
 */

export type Update = { key: string; kind: 'request' | 'answer' | 'result' | 'live'; text: ReactNode; meta: string; to?: string; onClick?: () => void }

const ICON: Record<Update['kind'], { icon: LucideIcon; tone: string }> = {
  request: { icon: Inbox, tone: 'text-pf-amber' },
  answer: { icon: Inbox, tone: 'text-proof-leaf' },
  result: { icon: Sparkles, tone: 'text-proof-leaf' },
  live: { icon: Megaphone, tone: 'text-ink-2' },
}

/** Decision cards Needs you always shows: a fixed frame, so Home's layout never moves with the data. */
export const SLOTS = 2
/** Rows Latest always shows (blank rows keep the panel's shape when fewer things moved). */
export const LATEST_ROWS = 3

export function NeedsYou({ count, loading, cards, empty, actions, className = '' }: { count: number; loading: boolean; cards: ReactNode[]; empty?: ReactNode; actions?: ReactNode; className?: string }) {
  const open = Math.max(0, SLOTS - cards.length)
  return (
    <aside aria-labelledby="needs-h" className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <div className="flex h-8 items-center justify-between gap-2">
        <h2 id="needs-h" className="m-0 flex items-center gap-2 text-proof-h text-ink">
          Needs you
          {!loading && count ? <span className="rounded-pill bg-sunken px-2 text-proof-label font-medium text-ink-2 tnum">{int(count)}</span> : null}
        </h2>
        {actions ? <div className="-mr-1.5 flex items-center gap-0.5">{actions}</div> : null}
      </div>
      {/* Two equal slots that fill the column's height (the left column sets it): cards stretch, actions sit at
          their foot, and a slot with no card holds a quiet line instead of collapsing. */}
      <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-1 lg:grid-rows-2">
        {loading ? (
          <>
            <div aria-hidden className="retail-shimmer min-h-[196px] rounded-card" />
            <div aria-hidden className="retail-shimmer min-h-[196px] rounded-card" />
          </>
        ) : !cards.length && empty ? (
          <div className="md:col-span-2 lg:col-span-1 lg:row-span-2">{empty}</div>
        ) : !cards.length ? (
          <div className="flex min-h-[160px] items-start gap-3 rounded-card border border-line bg-surface px-4 py-4 md:col-span-2 lg:col-span-1 lg:row-span-2 animate-[proofPage_.24s_var(--ease-standard)_both]">
            <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden className="mt-px shrink-0 text-proof-leaf" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-proof-body font-medium text-ink">Nothing to decide today</span>
              <span className="text-proof-small text-ink-2 [text-wrap:pretty]">A card appears when the data moves: a product nears Proven, a campaign’s lift comes in, demand shifts.</span>
            </span>
          </div>
        ) : (
          <>
            {cards}
            {Array.from({ length: open }, (_, k) => (
              <div key={`open-${k}`} className="flex min-h-[120px] items-center justify-center rounded-card border border-dashed border-line px-4 text-center text-proof-small text-ink-2">
                Nothing else waits for you
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}

/** "Latest": one line per thing that moved, always LATEST_ROWS rows tall, beside demand and the funnel. */
export function LatestPanel({ updates, total, onAll, className = '' }: { updates: Update[]; total: number; onAll: () => void; className?: string }) {
  const shown = updates.slice(0, LATEST_ROWS)
  return (
    <section aria-labelledby="latest-h" className={`flex min-w-0 flex-col rounded-card border border-line bg-surface ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-2 pt-4">
        <h2 id="latest-h" className="m-0 text-proof-h text-ink">
          Latest
        </h2>
        {total > shown.length ? (
          <button type="button" onClick={onAll} className="hit44 rounded-ctl border-0 bg-transparent px-0 text-proof-small text-ink-2 hover:text-ink">
            All {int(total)} ↓
          </button>
        ) : null}
      </div>
      <ul className="m-0 flex flex-1 list-none flex-col p-0 px-3 pb-3">
        {shown.map((u) => (
          <UpdateRow key={u.key} u={u} />
        ))}
        {Array.from({ length: LATEST_ROWS - shown.length }, (_, k) => (
          <li key={`blank-${k}`} className="flex flex-1 items-center border-t border-line px-2 py-2.5 text-proof-small text-ink-2 first:border-t-0">
            {k === 0 ? (shown.length ? 'Nothing else new' : 'Nothing new yet: results, requests and live campaigns show here') : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function UpdateRow({ u }: { u: Update }) {
  const { icon: Icon, tone } = ICON[u.kind]
  const body = (
    <>
      <Icon size={14} strokeWidth={1.8} aria-hidden className={`mt-[3px] shrink-0 ${tone}`} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-proof-small text-ink [text-wrap:pretty]">{u.text}</span>
        <span className="text-proof-label text-ink-2">{u.meta}</span>
      </span>
    </>
  )
  const cls = 'flex w-full items-start gap-2.5 rounded-ctl border-0 bg-transparent px-2 py-2.5 text-left no-underline transition-colors hover:bg-pf-hover'
  return (
    <li className="flex flex-1 flex-col border-t border-line first:border-t-0">
      {u.to ? (
        <Link to={u.to} className={cls}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={u.onClick} className={cls}>
          {body}
        </button>
      )}
    </li>
  )
}
