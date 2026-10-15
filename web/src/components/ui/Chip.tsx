import type { ReactNode } from 'react'

/** Chips: neutral outline, selected black pill, lime tag, glass. Toggle chips are buttons with aria-pressed. */
export function Chip({ children, tone = 'neutral', selected, onToggle, disabled, className = '' }: { children: ReactNode; tone?: 'neutral' | 'tag' | 'glass' | 'ink'; selected?: boolean; onToggle?: () => void; disabled?: boolean; className?: string }) {
  const t = selected
    ? 'bg-selected text-inverse'
    : tone === 'tag'
      ? 'bg-lime text-ink'
      : tone === 'glass'
        ? 'glass-pill text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,.7)]'
        : tone === 'ink'
          ? 'bg-selected text-inverse'
          : 'text-ink shadow-[inset_0_0_0_1px_var(--line-strong)]'
  const cls = `inline-flex items-center gap-1.5 rounded-pill px-3 text-[13px] leading-none whitespace-nowrap ${onToggle ? 'min-h-10 cursor-pointer transition-colors' : 'min-h-7'} ${t} ${className}`
  if (onToggle)
    return (
      <button type="button" aria-pressed={Boolean(selected)} disabled={disabled} onClick={onToggle} className={cls}>
        {children}
      </button>
    )
  return <span className={cls}>{children}</span>
}
