import { useId } from 'react'

/**
 * Willow Proof, the retail sub-brand (docs/RETAIL_BRAND.md).
 *
 * The mark: on the willow-900 squircle, a tick whose long arm is a willow leaf rising out of a pale horizontal
 * band. The band is the noise band every Willow measurement is judged against; the tick starts inside it and
 * the leaf clears it: "measured, and beyond the noise". Drawn as flat vector shapes (no blur, unlike the
 * consumer mark) so it stays crisp from 16 px; at 24 px and up the band gets its dashed edges and the leaf
 * its midrib (optical sizing, like type).
 */
export function ProofMark({ size = 24, className = '', title }: { size?: number; className?: string; title?: string }) {
  const uid = useId().replace(/:/g, '')
  const detail = size >= 24
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`block shrink-0 ${className}`}
    >
      <defs>
        <clipPath id={`pm-clip-${uid}`}>
          <rect width="32" height="32" rx="9" />
        </clipPath>
        <linearGradient id={`pm-leaf-${uid}`} x1="13" y1="23" x2="25" y2="7" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--proof-leaf, #86C5B0)" />
          <stop offset="1" stopColor="var(--proof-leaf-hi, #B8E986)" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#pm-clip-${uid})`}>
        <rect width="32" height="32" fill="var(--proof-ground, #0F3B3A)" />
        {/* The noise band. */}
        <rect x="0" y="17" width="32" height="6" fill="var(--proof-band, rgba(255,255,255,.13))" />
        {detail ? (
          <g stroke="var(--proof-band-edge, rgba(255,255,255,.3))" strokeWidth=".6" strokeDasharray="1.4 1.4">
            <line x1="0" y1="17.3" x2="32" y2="17.3" />
            <line x1="0" y1="22.7" x2="32" y2="22.7" />
          </g>
        ) : null}
        {/* Short arm, inside the band. */}
        <path d="M8.3 18.4 L12.9 22.6" stroke="var(--proof-leaf, #86C5B0)" strokeWidth="2.7" strokeLinecap="round" fill="none" />
        {/* Long arm: a lanceolate willow leaf leaving the band. */}
        <path d="M12.2 23.2 C13.5 17.2 18.4 10.4 25.6 6.6 C23.7 13.2 19 19.4 13.6 23.6 C13.1 23.9 12.4 23.8 12.2 23.2 Z" fill={`url(#pm-leaf-${uid})`} />
        {detail ? <path d="M13.2 22.6 C16.4 17.4 20.2 12.2 24.6 7.8" stroke="var(--proof-ground, #0F3B3A)" strokeOpacity=".45" strokeWidth=".55" fill="none" strokeLinecap="round" /> : null}
        {/* Inner hairline: the material edge, as on every Willow surface. */}
        <rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="#fff" strokeOpacity=".1" />
      </g>
    </svg>
  )
}

/**
 * The wordmark: the parent's lowercase "willow" (Outfit 300, as on the consumer logo) endorsing "Proof" in
 * Instrument Serif, the sub-brand's editorial voice. Sizes are set from the mark so the lockup scales as one.
 */
export function ProofWordmark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-baseline whitespace-nowrap leading-none text-ink ${className}`} style={{ gap: Math.round(size * 0.18) }}>
      <span className="font-ui font-light tracking-[-0.03em]" style={{ fontSize: Math.round(size * 0.72) }}>
        willow
      </span>
      <span className="font-serif tracking-[-0.005em]" style={{ fontSize: Math.round(size * 0.86) }}>
        Proof
      </span>
    </span>
  )
}

/**
 * Lockups. `horizontal`: mark + wordmark (top bar, footer). `descriptor`: adds "Retail intelligence by Willow"
 * under the wordmark (landing, about panels). Clear space around any lockup is a quarter of the mark size;
 * minimum mark 16 px alone, 20 px in a lockup.
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
            Retail intelligence by Willow
          </span>
        ) : null}
      </span>
      <span className="sr-only">Willow Proof{descriptor ? ', retail intelligence by Willow' : ''}</span>
    </span>
  )
}
