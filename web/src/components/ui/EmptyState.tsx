import type { ReactNode } from 'react'

/** A calm empty or error state: what is missing, and the one thing to do about it. */
export function EmptyState({ title, body, action, className = '' }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`card flex flex-col items-start gap-3 p-6 sm:p-8 ${className}`}>
      <h2 className="text-h2 font-normal">{title}</h2>
      {body ? <div className="max-w-[60ch] text-[15px] text-ink-2">{body}</div> : null}
      {action}
    </div>
  )
}
