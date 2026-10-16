/**
 * A share on a 0–`max` track in neutral ink (never ember: shares of people, routines or conflicts are not a
 * visible change). Decorative: the number beside it carries the value and its n for readers.
 */
export function ShareBar({ value, max = 1, className = '' }: { value: number; max?: number; className?: string }) {
  const w = `${Math.max(0, Math.min(100, (value / (max || 1)) * 100))}%`
  return (
    <span aria-hidden className={`relative block h-1.5 min-w-10 overflow-hidden rounded-pill bg-muted ${className}`}>
      <span className="absolute inset-y-0 left-0 block rounded-pill bg-ink/60" style={{ width: w }} />
    </span>
  )
}
