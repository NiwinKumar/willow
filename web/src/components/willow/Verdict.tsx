import type { Metric, Session } from '../../data/types'
import { CHANGE_WORDS, VERDICT_WORDS, changeWay, confidenceOf, verdictKind, type ChangeWay, type VerdictKind } from '../../lib/verdict'

/**
 * Verdict glyph as SVG so it is identical in every font (docs/DESIGN.md): ◆ filled diamond (ember) for an
 * improvement or a tone shift, ◇ outlined diamond for a change the other way, ○ ring, ◌ dotted ring, — bar,
 * · dot. Always next to words; aria-hidden itself.
 */
export function VerdictGlyph({ kind, way, size = 12, onDark }: { kind: VerdictKind; way?: ChangeWay; size?: number; onDark?: boolean }) {
  const ink = onDark ? '#fff' : 'var(--text-secondary)'
  return (
    <svg aria-hidden viewBox="0 0 12 12" width={size} height={size} className="shrink-0">
      {kind === 'changed' && way === 'otherWay' ? <path d="M6 1.6 10.4 6 6 10.4 1.6 6z" fill="none" stroke={onDark ? '#fff' : 'var(--text-primary)'} strokeWidth="1.4" /> : null}
      {kind === 'changed' && way !== 'otherWay' ? <path d="M6 .8 11.2 6 6 11.2.8 6z" fill="var(--signal-change)" /> : null}
      {kind === 'normal' ? <circle cx="6" cy="6" r="4.5" fill="none" stroke={ink} strokeWidth="1.5" /> : null}
      {kind === 'notEnough' ? <circle cx="6" cy="6" r="4.5" fill="none" stroke={ink} strokeWidth="1.5" strokeDasharray="1.5 1.5" /> : null}
      {kind === 'notCompared' ? <rect x="2" y="5.25" width="8" height="1.5" rx=".75" fill={ink} /> : null}
      {kind === 'baseline' ? <circle cx="6" cy="6" r="2" fill={onDark ? '#fff' : 'var(--text-primary)'} /> : null}
    </svg>
  )
}

/** Verdict pill: Improved / Shifted = black pill with ember ◆, Moved the other way = quiet with ◇; others quiet. Text always present. */
export function VerdictBadge({ kind, way, short, size = 'sm', className = '' }: { kind: VerdictKind; way?: ChangeWay; short?: boolean; size?: 'sm' | 'md'; className?: string }) {
  const w = kind === 'changed' && way ? CHANGE_WORDS[way] : VERDICT_WORDS[kind]
  const dark = kind === 'changed' && way !== 'otherWay'
  const tone = dark ? 'bg-selected text-inverse' : kind === 'changed' ? 'bg-white/70 text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]' : kind === 'baseline' ? 'bg-lime text-ink' : kind === 'normal' ? 'glass-pill text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,.7)]' : 'bg-muted text-ink-2'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill whitespace-nowrap ${size === 'md' ? 'min-h-8 px-3 text-[13px]' : 'min-h-6 px-2.5 text-[12px]'} ${tone} ${className}`}>
      <VerdictGlyph kind={kind} way={way} onDark={dark} />
      {short ? w.short : w.label}
    </span>
  )
}

/** The verdict of one metric in a session, as a badge. */
export function MetricVerdict({ metric, session, short, size }: { metric: Metric; session: Session | null | undefined; short?: boolean; size?: 'sm' | 'md' }) {
  return <VerdictBadge kind={verdictKind(metric, session)} way={changeWay(metric)} short={short} size={size} />
}

/** ● Measured / ◐ Indicative / ◌ Trend only, mono caps on an outline. */
export function ConfidenceChip({ metric, session }: { metric: Pick<Metric, 'confidence'>; session?: Session | null }) {
  const c = confidenceOf(metric, session)
  return (
    <span className="inline-flex min-h-6 items-center gap-1.5 rounded-pill px-2.5 font-mono text-[11px] tracking-[.08em] uppercase shadow-[inset_0_0_0_1px_var(--line-strong)]">
      <span aria-hidden>{c.glyph}</span>
      {c.label}
    </span>
  )
}
