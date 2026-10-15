/** Shimmer placeholder (static under reduced motion). The parent marks itself aria-busy. */
export function Skeleton({ className = '', rounded = 'rounded-sm' }: { className?: string; rounded?: string }) {
  return <span aria-hidden className={`skeleton block ${rounded} ${className}`} />
}
