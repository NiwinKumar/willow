import { useId, type InputHTMLAttributes } from 'react'

/** Label above, 48px field on bg-sunken, 16px text (no iOS zoom), hint/error below. */
export function TextField({ label, hint, error, className = '', ...rest }: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] text-ink-2">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-d` : undefined}
        className={`min-h-12 rounded-sm bg-sunken px-4 text-[16px] outline-none transition-shadow ${error ? 'shadow-[inset_0_0_0_1px_var(--state-avoid-fg)]' : 'shadow-[inset_0_0_0_1px_var(--line-subtle)]'}`}
        {...rest}
      />
      {error ? (
        <span id={`${id}-d`} className="text-[13px] text-avoid">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-d`} className="text-[13px] text-ink-2">
          {hint}
        </span>
      ) : null}
    </div>
  )
}
