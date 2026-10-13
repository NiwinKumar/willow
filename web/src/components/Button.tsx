import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet'
  children: ReactNode
}

const styles: Record<NonNullable<Props['variant']>, string> = {
  primary: 'bg-text text-surface hover:opacity-90',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-2',
  quiet: 'bg-transparent text-text-2 hover:text-text',
}

export function Button({ variant = 'primary', className = '', children, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-(--radius-control) px-4 py-2 text-[15px] font-medium transition-[transform,opacity,background-color] duration-150 ease-(--ease-out) active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}
