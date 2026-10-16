import { CircleAlert, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import type { To } from 'react-router-dom'

import { Button } from './Layout'

type Action = { label: string; onClick: () => void } | { label: string; to: To }

function ActionButton({ action, primary }: { action: Action; primary?: boolean }) {
  return 'to' in action ? (
    <Button to={typeof action.to === 'string' ? action.to : undefined} kind={primary ? 'primary' : 'secondary'}>
      {action.label}
    </Button>
  ) : (
    <Button onClick={action.onClick} kind={primary ? 'primary' : 'secondary'}>
      {action.label}
    </Button>
  )
}

/**
 * Nothing to show (Geist Empty State): an icon tile, a title, one line that adds information, and at most one
 * primary and one secondary action, so it is never a dead end. `compact` fits inside a panel.
 */
export function EmptyState({ title, body, action, secondary, compact = false, icon, children }: { title: string; body?: ReactNode; action?: Action; secondary?: Action; glyph?: string; compact?: boolean; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`flex flex-col items-center gap-3 text-center ${compact ? 'px-4 py-8' : 'rounded-card border border-line bg-surface px-6 py-14'}`}>
      <span aria-hidden className="grid size-10 place-items-center rounded-card border border-line bg-pf-bg2 text-ink-2">
        {icon ?? <Inbox size={18} strokeWidth={1.6} />}
      </span>
      <h2 className="m-0 text-proof-h text-ink">{title}</h2>
      {body ? <div className="max-w-[56ch] text-proof-body text-ink-2">{body}</div> : null}
      {children}
      {action || secondary ? (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {action ? <ActionButton action={action} primary /> : null}
          {secondary ? <ActionButton action={secondary} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Something failed: what happened, that no partial numbers are shown, and Retry (role=alert). */
export function ErrorState({ title, body, onRetry, compact = false }: { title: string; body?: ReactNode; onRetry?: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={`flex flex-col items-center gap-3 text-center ${compact ? 'px-4 py-8' : 'rounded-card border border-line bg-surface px-6 py-14'}`}>
      <span aria-hidden className="grid size-10 place-items-center rounded-card border border-line bg-pf-red-soft text-pf-red">
        <CircleAlert size={18} strokeWidth={1.6} />
      </span>
      <h2 className="m-0 text-proof-h text-ink">{title}</h2>
      {body ? <div className="max-w-[56ch] text-proof-body text-ink-2">{body}</div> : null}
      {onRetry ? <ActionButton action={{ label: 'Retry', onClick: onRetry }} primary /> : null}
    </div>
  )
}
