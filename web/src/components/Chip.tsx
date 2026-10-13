import type { ReactNode } from 'react'

import type { Confidence, Verdict } from '../data/types'
import { VERDICT_LABEL } from '../lib/metrics'

type Tone = 'signal' | 'noise' | 'willow' | 'info' | 'warn' | 'neutral' | 'danger'

const tones: Record<Tone, string> = {
  signal: 'bg-signal-100 text-signal-700',
  noise: 'bg-noise-band text-noise-700 chip-hatch',
  willow: 'bg-willow-100 text-willow-700',
  info: 'bg-surface-2 text-info ring-1 ring-inset ring-border',
  warn: 'bg-surface-2 text-warn-text',
  neutral: 'bg-surface-2 text-text-2',
  danger: 'bg-surface-2 text-danger',
}

export function Chip({ tone = 'neutral', children, className = '', title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex min-h-6 items-center gap-1 rounded-(--radius-chip) px-1.5 py-0.5 text-[13px] font-medium leading-none ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

const verdictTone: Record<Verdict, Tone> = { real_change: 'signal', within_noise: 'noise', no_baseline: 'willow', low_quality: 'warn' }

export function VerdictChip({ verdict, className = '' }: { verdict: Verdict; className?: string }) {
  return (
    <Chip tone={verdictTone[verdict]} className={className}>
      {verdict === 'real_change' ? <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-signal-500" /> : null}
      {verdict === 'low_quality' ? <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-warn" /> : null}
      {VERDICT_LABEL[verdict]}
    </Chip>
  )
}

export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return confidence === 'measured' ? (
    <Chip tone="willow" title="Computed from calibrated colour under the capture protocol, with a personal noise band.">
      Measured
    </Chip>
  ) : (
    <Chip tone="info" title="A directional estimate. No noise band, never a Real change verdict.">
      Indicative
    </Chip>
  )
}
