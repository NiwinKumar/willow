import type { ReactNode } from 'react'

/** A calm empty or error state: what is missing, and the one thing to do about it. */
export function EmptyState({ title, body, action, art, className = '' }: { title: string; body?: ReactNode; action?: ReactNode; art?: ReactNode; className?: string }) {
  return (
    <div className={`card flex flex-wrap items-center gap-x-10 gap-y-4 p-6 sm:p-8 ${className}`}>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col items-start gap-3">
        <h2 className="text-h2 font-normal">{title}</h2>
        {body ? <div className="max-w-[60ch] text-[15px] text-ink-2">{body}</div> : null}
        {action}
      </div>
      {art ? <div className="shrink-0 text-ink/80">{art}</div> : null}
    </div>
  )
}
