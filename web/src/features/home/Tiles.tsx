import { useState } from 'react'

import type { QualityReason, Session } from '../../data/types'
import { fmtDate, plural } from '../../lib/format'
import { qualityCopy } from '../../lib/metrics'
import type { PlanDot } from '../routine/productTests'
import { SITE_SHORT } from './derive'
import type { ForearmRead } from './forearm'

/** One plan dot: filled on a day with a treated photo, ringed today, faint for days gone by, outlined to come. */
export function PlanDotMark({ dot, ring = 'rgba(255,255,255,.85)' }: { dot: PlanDot; ring?: string }) {
  return (
    <span
      className="aspect-square rounded-full"
      style={{
        background: dot === 'photo' ? 'var(--willow-900)' : dot === 'past' ? 'rgba(15,59,58,.22)' : 'transparent',
        boxShadow: dot === 'today' ? `inset 0 0 0 1.5px var(--willow-900), 0 0 0 2px ${ring}` : dot === 'future' ? 'inset 0 0 0 1px rgba(15,59,58,.3)' : 'none',
      }}
    />
  )
}

/** Product test tile, compact: "{product} on your forearm" and where it stands, day N (of M) on the right, the plan's dots below. */
export function ProductTestTile({ read, onOpen, className = '' }: { read: ForearmRead; onOpen: () => void; className?: string }) {
  const { day, of, name, dots, standing } = read
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Product test${name ? `: ${name} on your forearm` : ''}, day ${day}${of ? ` of ${of}` : ''}. ${standing.t}. Open the product test.`}
      className={`flex min-w-0 animate-[wRise_.55s_.2s_both] flex-col justify-between gap-3 rounded-lg squircle p-4 text-left text-willow-900 transition-transform duration-[400ms] ease-standard hover:-translate-y-1 ${className}`}
      style={{ background: 'radial-gradient(100% 90% at 0% 0%, #B8E986 0%, transparent 60%), radial-gradient(100% 100% at 100% 100%, #4FB866 0%, transparent 62%), #CDEFB5', boxShadow: 'inset 0 0 44px 8px rgba(255,255,255,.45), 0 26px 54px -42px rgba(15,59,58,.55)' }}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[.08em]">■ PRODUCT TEST</span>
          <span className="line-clamp-2 text-[14px] leading-[1.3]">{name ? `${name} on your forearm` : 'Arm with product vs arm without'}</span>
          <span className="text-[12px] leading-[1.35]">
            <span aria-hidden>{standing.g} </span>
            {standing.t}
          </span>
        </span>
        <span className="flex flex-none items-center gap-1.5">
          <span className="font-mono text-[12px]">Day</span>
          <span className="font-dot text-[34px] leading-none">{day}</span>
          {of ? <span className="text-[12px]">/ {of}</span> : null}
        </span>
      </span>
      <span aria-hidden className="grid w-full max-w-[280px] grid-cols-[repeat(14,1fr)] gap-[3px]">
        {dots.map((d, i) => (
          <PlanDotMark key={i} dot={d} />
        ))}
      </span>
    </button>
  )
}

/** Your baseline, small: the day every check-in is compared with, how long ago, its photos and how many readings have a normal range. */
export function BaselineTile({ baseline, onOpen, className = '' }: { baseline: Session; onOpen: () => void; className?: string }) {
  const [now] = useState(() => Date.now())
  const days = Math.max(0, Math.round((now - new Date(baseline.created_at).getTime()) / 86_400_000))
  const photos = baseline.result?.quality.passed ? baseline.result.frames_used : 0
  const ranged = (baseline.result?.metrics ?? []).filter((m) => m.value !== null && m.mdc95 !== null).length
  const ago = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Your baseline: ${fmtDate(baseline.created_at, { day: 'numeric', month: 'long' })}, ${ago}. ${photos} photos, a normal range for ${ranged} readings. Open your progress.`}
      className={`card flex min-w-0 animate-[wRise_.55s_.24s_both] flex-col justify-between gap-3 p-4 text-left transition-transform duration-[400ms] ease-standard hover:-translate-y-1 ${className}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ YOUR BASELINE</span>
          <span className="text-[14px] leading-[1.3]">Every check-in is compared with this one</span>
        </span>
        <span className="flex flex-none flex-col items-end">
          <span className="font-dot text-[34px] leading-none tnum">{fmtDate(baseline.created_at)}</span>
          <span className="text-[12px] text-ink-2">{ago}</span>
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5 text-[12px]">
        <span className="rounded-pill bg-ink/5 px-2.5 py-1">{plural(photos, 'photo')}</span>
        <span className="rounded-pill bg-ink/5 px-2.5 py-1">{ranged ? `Normal range for ${plural(ranged, 'reading')}` : 'No normal range yet'}</span>
      </span>
    </button>
  )
}

const PHOTO_CHECKS: { label: string; bad: QualityReason[] }[] = [
  { label: 'Colour card', bad: ['card_not_found', 'card_delta_e_high'] },
  { label: 'Sharp', bad: ['blurry'] },
  { label: 'Even light', bad: ['overexposed', 'underexposed'] },
  { label: 'Steady pose', bad: ['pose_out_of_range', 'face_not_found', 'occlusion_suspected'] },
]

/** Last photos: how the latest check-in's photos came out (photos used, the four capture checks) and one tip for the next one. */
export function PhotosTile({ session, onOpen, className = '' }: { session: Session; onOpen: () => void; className?: string }) {
  const q = session.result?.quality
  const frames = q?.per_frame ?? []
  const total = frames.length || session.result?.frames_used || 0
  const used = session.result?.frames_used ?? 0
  const reasons = new Set<QualityReason>([...(q?.reasons ?? []), ...frames.flatMap((f) => f.reasons)])
  if (q && !q.card_detected) reasons.add('card_not_found')
  const checks = PHOTO_CHECKS.map((c) => ({ label: c.label, ok: !c.bad.some((r) => reasons.has(r)) }))
  const first = PHOTO_CHECKS.flatMap((c) => c.bad).find((r) => reasons.has(r))
  const tip = (first && qualityCopy(first, session.site)?.text) ?? 'All four checks passed. The same spot, light and time next check-in keeps readings comparable.'
  const place = SITE_SHORT[session.site] ?? 'Check-in'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Last photos, ${place.toLowerCase()} on ${fmtDate(session.created_at)}: ${used} of ${total} used. ${checks.map((c) => `${c.label} ${c.ok ? 'passed' : 'needs a look'}`).join(', ')}. ${tip} Open the result.`}
      className={`card flex min-w-0 animate-[wRise_.55s_.16s_both] flex-col gap-3 p-4 text-left transition-transform duration-[400ms] ease-standard hover:-translate-y-1 ${className}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ LAST PHOTOS</span>
          <span className="text-[14px] leading-[1.3]">
            {place} · {fmtDate(session.created_at)}
          </span>
        </span>
        <span className="flex flex-none items-baseline gap-1">
          <span className="font-dot text-[34px] leading-none tnum">{used}</span>
          <span className="text-[12px] text-ink-2">of {total} used</span>
        </span>
      </span>
      <span className="grid grid-cols-2 gap-1.5 text-[12.5px]">
        {checks.map((c) => (
          <span key={c.label} className={`flex items-center gap-1.5 rounded-pill px-2.5 py-1 ${c.ok ? 'bg-ink/5' : 'bg-[#FFE3CF]'}`}>
            <span aria-hidden>{c.ok ? '✓' : '△'}</span>
            {c.label}
          </span>
        ))}
      </span>
      <span className="line-clamp-3 text-[12.5px] leading-[1.4] text-ink-2">{tip}</span>
    </button>
  )
}
