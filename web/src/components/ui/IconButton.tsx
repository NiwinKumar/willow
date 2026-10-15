import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

/** Round icon-only button; `label` is required and becomes the accessible name. */
export function IconButton({ icon: Icon, label, variant = 'soft', size = 40, className = '', ...rest }: { icon: LucideIcon; label: string; variant?: 'soft' | 'glass' | 'ink'; size?: 40 | 44 | 48 } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const v = variant === 'ink' ? 'bg-selected text-inverse' : variant === 'glass' ? 'glass-pill text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,.75)]' : 'bg-ink/5 text-ink hover:bg-ink/10'
  return (
    <button type="button" aria-label={label} title={label} className={`grid shrink-0 place-items-center rounded-full transition-[background,scale] active:scale-95 ${v} ${className}`} style={{ width: size, height: size }} {...rest}>
      <Icon size={size >= 44 ? 20 : 16} strokeWidth={1.8} aria-hidden />
    </button>
  )
}
