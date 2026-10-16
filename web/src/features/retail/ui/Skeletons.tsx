import type { CSSProperties } from 'react'
/**
 * Loading placeholders drawn to the final layout's sizes (no layout shift when data lands). Dark shimmer,
 * static under reduced motion. The region that is loading carries role="status" / aria-busy, not these.
 */
export function Bone({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden style={style} className={`retail-shimmer block rounded-ctl ${className}`} />
}

/** Matches KpiStrip: one surface, `n` cells. */
export function SkeletonKpis({ n = 4 }: { n?: number }) {
  return (
    <div aria-hidden className="grid grid-cols-2 overflow-hidden rounded-card border border-line bg-surface xl:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ ['--n' as string]: n }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 border-line px-4 py-3.5 [&:not(:last-child)]:border-b xl:border-b-0 xl:[&:not(:last-child)]:border-r">
          <Bone className="h-3 w-28" />
          <Bone className="h-[30px] w-20" />
          <Bone className="h-2.5 w-36" />
        </div>
      ))}
    </div>
  )
}

/** Matches Panel + DataTable: a header bar, a toolbar and `rows` 36 px rows. */
export function SkeletonTable({ rows = 8, toolbar = true }: { rows?: number; toolbar?: boolean }) {
  return (
    <div aria-hidden className="flex flex-col rounded-card border border-line bg-surface">
      <div className="flex h-12 items-center border-b border-line px-4">
        <Bone className="h-3.5 w-48" />
      </div>
      {toolbar ? (
        <div className="flex h-12 items-center gap-2 border-b border-line px-4">
          <Bone className="h-8 w-40" />
          <Bone className="h-8 w-32" />
        </div>
      ) : null}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-6 border-b border-line px-4 last:border-b-0">
          <Bone className="h-3 w-[30%]" />
          <Bone className="h-3 w-[12%]" />
          <Bone className="ml-auto h-3 w-[18%]" />
          <Bone className="h-3 w-[10%]" />
        </div>
      ))}
    </div>
  )
}

/** Matches a Panel holding a chart of `height` px. */
export function SkeletonPanel({ height = 240, className = '' }: { height?: number; className?: string }) {
  return (
    <div aria-hidden className={`flex flex-col rounded-card border border-line bg-surface ${className}`}>
      <div className="flex h-12 items-center border-b border-line px-4">
        <Bone className="h-3.5 w-40" />
      </div>
      <div className="p-4">
        <span className="retail-shimmer block rounded-xs" style={{ height }} />
      </div>
    </div>
  )
}

/** Matches SectionHeader. */
export function SkeletonHeader() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      <Bone className="h-2.5 w-24" />
      <Bone className="h-7 w-72" />
      <Bone className="h-4 w-[min(560px,90%)]" />
    </div>
  )
}
