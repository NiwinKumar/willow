import { LogoMark } from '../../../components/willow/Logo'

/**
 * Proof by Willow, the retail product (docs/RETAIL_BRAND.md). It wears Willow's own logo (the frosted tulip bud),
 * so the two always read as one company; only the name beside it differs. `ProofMark` is that logo.
 */
export function ProofMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 ${className}`}>
      <LogoMark size={size} />
    </span>
  )
}

/** The name: "Proof" in the app's own weight, "by Willow" quieter beside it. */
export function ProofWordmark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-baseline whitespace-nowrap leading-none text-ink ${className}`} style={{ gap: Math.round(size * 0.22), fontSize: Math.round(size * 0.66) }}>
      <span className="font-semibold tracking-[-0.02em]">Proof</span>
      <span className="font-normal tracking-[-0.01em] text-ink-2">by Willow</span>
    </span>
  )
}

/**
 * Lockups. Default: logo + name (top bar, footer). `descriptor` adds "Retail intelligence" under the name
 * (landing, about panels). Clear space is a quarter of the logo size; minimum logo size 20 px.
 */
export function ProofLockup({ size = 24, descriptor = false, className = '' }: { size?: number; descriptor?: boolean; className?: string }) {
  const mark = Math.max(20, size)
  return (
    <span className={`inline-flex items-center ${className}`} style={{ gap: Math.round(mark * 0.38) }}>
      <ProofMark size={descriptor ? Math.round(mark * 1.25) : mark} />
      <span aria-hidden className="flex flex-col" style={{ gap: descriptor ? Math.round(mark * 0.16) : 0 }}>
        <ProofWordmark size={mark} />
        {descriptor ? (
          <span className="whitespace-nowrap font-ui text-ink-2" style={{ fontSize: Math.max(11, Math.round(mark * 0.46)) }}>
            Retail intelligence
          </span>
        ) : null}
      </span>
      <span className="sr-only">Proof by Willow{descriptor ? ', retail intelligence' : ''}</span>
    </span>
  )
}
