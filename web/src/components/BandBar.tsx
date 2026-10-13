import { motion, useReducedMotion } from 'motion/react'

import type { Verdict } from '../data/types'
import { SPRING_SETTLE } from '../lib/motion'

type Props = {
  value: number | null
  baseline: number | null
  mdc95: number | null
  verdict: Verdict
  /** Extra half-range to show, e.g. the largest |delta| in the series so dots never clip. */
  reach?: number
  label: string
  height?: number
  className?: string
}

/**
 * The signature primitive: a horizontal track, the person's noise band centred on their baseline,
 * and one dot for the current reading. Every band renders at the same pixel height so "how far
 * outside" is comparable across metrics by eye (docs/DESIGN.md 3.1).
 */
export function BandBar({ value, baseline, mdc95, verdict, reach = 0, label, height = 28, className = '' }: Props) {
  const reduce = useReducedMotion()
  const W = 1000
  const bandH = 12
  const cy = height / 2
  const hasBand = baseline !== null && mdc95 !== null && mdc95 > 0
  const half = hasBand ? Math.max(mdc95 * 3, reach * 1.15, mdc95 * 1.2) : Math.max(reach, 1)
  const center = baseline ?? value ?? 0
  const x = (v: number) => ((v - center) / half) * (W / 2) + W / 2
  const bandX1 = hasBand ? x(center - mdc95) : 0
  const bandX2 = hasBand ? x(center + mdc95) : 0
  const dotX = value === null ? W / 2 : Math.min(W - 10, Math.max(10, x(value)))
  const outside = verdict === 'real_change'
  const low = verdict === 'low_quality'
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={`block h-7 w-full ${className}`}
    >
      <line x1="0" x2={W} y1={cy} y2={cy} stroke="var(--color-border)" strokeWidth="1" />
      {hasBand ? (
        <>
          <rect x={bandX1} y={cy - bandH / 2} width={bandX2 - bandX1} height={bandH} fill="var(--color-noise-band)" />
          <rect x={bandX1} y={cy - bandH / 2} width={bandX2 - bandX1} height={bandH} fill="url(#hatch)" opacity="0.5" />
          <line x1={x(center)} x2={x(center)} y1={cy - bandH / 2 - 3} y2={cy + bandH / 2 + 3} stroke="var(--color-noise-500)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
      {value !== null ? (
        <motion.g
          initial={false}
          animate={{ x: dotX }}
          transition={reduce ? { duration: 0 } : SPRING_SETTLE}
          style={{ x: dotX }}
        >
          {low ? (
            <g stroke="var(--color-warn-text)" strokeWidth="2" vectorEffect="non-scaling-stroke">
              <line x1="-6" y1={cy - 6} x2="6" y2={cy + 6} vectorEffect="non-scaling-stroke" />
              <line x1="-6" y1={cy + 6} x2="6" y2={cy - 6} vectorEffect="non-scaling-stroke" />
            </g>
          ) : outside ? (
            <circle cx="0" cy={cy} r="7" fill="var(--color-signal-500)" stroke="var(--color-surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          ) : (
            <circle cx="0" cy={cy} r="6" fill="var(--color-surface)" stroke={verdict === 'no_baseline' ? 'var(--color-willow-500)' : 'var(--color-noise-700)'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          )}
        </motion.g>
      ) : null}
    </svg>
  )
}

/** Mount once near the root so every BandBar can reference the hatch pattern. */
export function BandBarDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-noise-500)" strokeWidth="1" opacity="0.35" />
        </pattern>
      </defs>
    </svg>
  )
}
