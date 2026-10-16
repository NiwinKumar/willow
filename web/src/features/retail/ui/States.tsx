import type { ReactNode } from 'react'
import { Link, type To } from 'react-router-dom'

type Action = { label: string; onClick: () => void } | { label: string; to: To }

function ActionButton({ action, primary }: { action: Action; primary?: boolean }) {
  const cls = `hit44 inline-flex h-8 items-center rounded-xs px-3 text-proof-small no-underline transition-colors ${primary ? 'bg-selected text-inverse hover:bg-ink/85' : 'border border-line-strong text-ink hover:bg-glass'}`
  return 'to' in action ? (
    <Link to={action.to} className={cls}>
      {action.label}
    </Link>
  ) : (
    <button type="button" onClick={action.onClick} className={cls}>
      {action.label}
    </button>
  )
}

/**
 * Nothing to show: what is missing and the one thing to do next (never a dead end). `glyph` is a quiet Doto
 * figure ("00", "—"). `compact` fits inside a panel.
 */
export function EmptyState({ title, body, action, secondary, glyph = '—', compact = false, children }: { title: string; body?: ReactNode; action?: Action; secondary?: Action; glyph?: string; compact?: boolean; children?: ReactNode }) {
  return (
    <div className={`flex flex-col items-start gap-2.5 ${compact ? 'px-1 py-4' : 'rounded-sm border border-dashed border-line-strong bg-surface/60 px-6 py-8'}`}>
      <span aria-hidden className={`font-dot leading-none text-ink-2 ${compact ? 'text-[22px]' : 'text-[32px]'}`}>
        {glyph}
      </span>
      <h2 className="m-0 text-proof-h font-medium text-ink">{title}</h2>
      {body ? <div className="max-w-[64ch] text-proof-body text-ink-2">{body}</div> : null}
      {children}
      {action || secondary ? (
        <div className="mt-1 flex flex-wrap gap-2">
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
    <div role="alert" className={`flex flex-col items-start gap-2.5 ${compact ? 'px-1 py-4' : 'rounded-sm border border-line bg-surface px-6 py-8'}`}>
      <span aria-hidden className="font-dot text-[28px] leading-none text-coral">
        —
      </span>
      <h2 className="m-0 text-proof-h font-medium text-ink">{title}</h2>
      {body ? <div className="max-w-[64ch] text-proof-body text-ink-2">{body}</div> : null}
      {onRetry ? <ActionButton action={{ label: 'Retry', onClick: onRetry }} primary /> : null}
    </div>
  )
}
