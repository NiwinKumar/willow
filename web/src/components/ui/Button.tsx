import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

/**
 * Pill buttons (docs/DESIGN.md "Button"): primary = yellow CTA (one per view), ink = black, glass = frosted,
 * ghost = text only. md 44px, lg 52px. Loading keeps the width and label, swaps the icon for a spinner.
 */
export type ButtonVariant = 'primary' | 'ink' | 'glass' | 'ghost' | 'outline'
type Common = { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon; trailing?: ReactNode; loading?: boolean; full?: boolean; children: ReactNode }

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'cta-yellow hover:brightness-[1.04]',
  ink: 'bg-selected text-inverse hover:bg-[#2a2a2a] shadow-[0_10px_22px_-12px_rgba(0,0,0,.55)]',
  glass: 'glass-pill text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,.75)] hover:bg-white/80',
  ghost: 'bg-transparent text-ink hover:underline underline-offset-4',
  outline: 'bg-transparent text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-ink/5',
}
const SIZE = { sm: 'min-h-9 px-4 text-[13px]', md: 'min-h-11 px-[22px] text-[15px]', lg: 'min-h-[52px] px-6 text-[15px]' }

export function buttonClass({ variant = 'ink', size = 'md', full }: Pick<Common, 'variant' | 'size' | 'full'>) {
  return `inline-flex items-center justify-center gap-2 rounded-pill font-medium transition-[background,filter,scale,box-shadow] duration-200 active:scale-[.97] disabled:opacity-55 ${VARIANT[variant]} ${SIZE[size]} ${full ? 'w-full' : ''}`
}

export const Button = forwardRef<HTMLButtonElement, Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>>(function Button(
  { variant, size, icon: Icon, trailing, loading, full, children, className = '', disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={`${buttonClass({ variant, size, full })} ${className}`} {...rest}>
      {loading ? <Loader2 size={18} strokeWidth={1.8} className="animate-spin" aria-hidden /> : Icon ? <Icon size={18} strokeWidth={1.6} aria-hidden /> : null}
      <span>{children}</span>
      {trailing}
    </button>
  )
})

/** A router link that looks like a Button. */
export function ButtonLink({ variant, size, icon: Icon, trailing, full, children, className = '', ...rest }: Common & LinkProps) {
  return (
    <Link className={`${buttonClass({ variant, size, full })} no-underline ${className}`} {...rest}>
      {Icon ? <Icon size={18} strokeWidth={1.6} aria-hidden /> : null}
      <span>{children}</span>
      {trailing}
    </Link>
  )
}

/** The black arrow circle that ends glass "Ask" pills and the yellow arrow circle on ink CTAs. */
export function ArrowDot({ tone = 'ink' }: { tone?: 'ink' | 'yellow' }) {
  return (
    <span aria-hidden className={`-mr-3 grid size-8 place-items-center rounded-full ${tone === 'ink' ? 'bg-selected text-inverse' : 'bg-cta text-ink'}`}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </span>
  )
}
