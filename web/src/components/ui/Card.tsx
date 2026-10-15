import type { ElementType, ReactNode } from 'react'

/**
 * Card surfaces (docs/DESIGN.md "Card"): surface = #FAFAF8 radius 30 with the long soft shadow; aura = a vivid
 * squircle (hue is decoration, never data); muted = "not measured" fill; glass = frosted.
 */
export type AuraName = 'coral' | 'violet' | 'sky' | 'leaf' | 'pink' | 'ember' | 'lime' | 'grey'

export function Card({ variant = 'surface', aura, as: Tag = 'section', className = '', children, ...rest }: { variant?: 'surface' | 'aura' | 'muted' | 'glass'; aura?: AuraName; as?: ElementType; className?: string; children: ReactNode } & Record<string, unknown>) {
  const base =
    variant === 'aura' ? `aura aura-${aura ?? 'violet'} relative overflow-hidden` : variant === 'muted' ? 'rounded-lg squircle bg-muted' : variant === 'glass' ? 'glass rounded-lg squircle' : 'card'
  return (
    <Tag className={`${base} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

/** "■ LABEL" eyebrow in Geist Mono caps. */
export function Eyebrow({ children, className = '', as: Tag = 'span' }: { children: ReactNode; className?: string; as?: ElementType }) {
  return <Tag className={`eyebrow ${className}`}>■ {children}</Tag>
}
