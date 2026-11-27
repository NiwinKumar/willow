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

export function NeedsYou({ count, loading, cards, empty, updates, updatesTotal, onAllUpdates, actions, className = '' }: { count: number; loading: boolean; cards: ReactNode; empty: boolean; updates: Update[]; updatesTotal: number; onAllUpdates: () => void; actions?: ReactNode; className?: string }) {
  return (
    <aside aria-labelledby="needs-h" className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <div className="flex h-8 items-center justify-between gap-2">
        <h2 id="needs-h" className="m-0 flex items-center gap-2 text-proof-h text-ink">
          Needs you
          {!loading && count ? <span className="rounded-pill bg-sunken px-2 text-proof-label font-medium text-ink-2 tnum">{int(count)}</span> : null}
        </h2>
        {actions ? <div className="-mr-1.5 flex items-center gap-0.5">{actions}</div> : null}
      </div>
      {loading ? (
        <div aria-hidden className="flex flex-col gap-3">
          <div className="retail-shimmer h-[196px] rounded-card" />
          <div className="retail-shimmer h-[196px] rounded-card" />
        </div>
      ) : empty ? (
        <div className="flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-4 animate-[proofPage_.24s_var(--ease-standard)_both]">
          <CheckCircle2 size={18} strokeWidth={1.8} aria-hidden className="mt-px shrink-0 text-proof-leaf" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-proof-body font-medium text-ink">Nothing to decide today</span>
            <span className="text-proof-small text-ink-2 [text-wrap:pretty]">A card appears when the data moves: a product nears Proven, a campaign’s lift comes in, demand shifts.</span>
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] lg:grid-cols-1">{cards}</div>
      )}
      {updates.length ? (
        <section aria-labelledby="latest-h" className="mt-3 flex flex-col">
          <div className="flex items-baseline justify-between gap-3 pb-1">
            <h3 id="latest-h" className="m-0 text-proof-body font-semibold text-ink">
              Latest
            </h3>
            {updatesTotal > updates.length ? (
              <button type="button" onClick={onAllUpdates} className="hit44 rounded-ctl border-0 bg-transparent px-1 text-proof-small text-ink-2 hover:text-ink">
                All results ↓
              </button>
            ) : null}
          </div>
          <ul className="m-0 flex list-none flex-col p-0">
            {updates.map((u) => (
              <UpdateRow key={u.key} u={u} />
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
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
    <li className="border-t border-line first:border-t-0">
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
