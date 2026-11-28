import { useState } from 'react'

import type { QualityReason, Session } from '../../data/types'
import { fmtDate, plural } from '../../lib/format'
import { qualityCopy } from '../../lib/metrics'
import { REASON_SHORT } from '../progress/model'
import type { PlanDot } from '../routine/productTests'
import { SITE_SHORT } from './derive'
import { useHomeFit } from './fit'
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
          <span className="text-[15px] leading-[1.25] font-medium">Product test</span>
          <span className="line-clamp-2 text-[13px] leading-[1.35]">{name ? `${name} on your forearm` : 'Arm with product vs arm without'}</span>
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
export function BaselineTile({ baseline, asOf = null, onOpen, className = '' }: {
  baseline: Session
  /** The demo journey is read as of its last check-in: how long before that day, not before today. */
  asOf?: string | null
  onOpen: () => void
  className?: string
}) {
  const [now] = useState(() => (asOf ? new Date(asOf).getTime() : Date.now()))
  const fit = useHomeFit()
  const days = Math.max(0, Math.round((now - new Date(baseline.created_at).getTime()) / 86_400_000))
  const photos = baseline.result?.quality.passed ? baseline.result.frames_used : 0
  const ranged = (baseline.result?.metrics ?? []).filter((m) => m.value !== null && m.mdc95 !== null).length
  const ago = asOf ? `${days} days before the last check-in` : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Your baseline: ${fmtDate(baseline.created_at, { day: 'numeric', month: 'long' })}, ${ago}. ${photos} photos, a normal range for ${ranged} readings. Open your progress.`}
      className={`card flex min-w-0 animate-[wRise_.55s_.24s_both] flex-col justify-between gap-3 p-4 text-left transition-transform duration-[400ms] ease-standard hover:-translate-y-1 ${className}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[15px] leading-[1.25]">Your baseline</span>
          {/* fitted to the screen, the explainer gives way (the tile's accessible name and Progress say it) */}
          {fit ? null : <span className="text-[13px] leading-[1.35] text-ink-2">Every check-in is compared with this one</span>}
        </span>
        {/* A date, not a measurement: Outfit light, not the dot-matrix numerals (which are for metric values). */}
        <span className="flex flex-none flex-col items-end gap-0.5">
          <span className="text-[24px] leading-none font-light tracking-[-0.02em] whitespace-nowrap tnum">{fmtDate(baseline.created_at)}</span>
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

/** Photos and previews are deleted this long after upload (infra lifecycle; progress/model photoExpired). */
const KEEP_DAYS = 30

/**
 * Last photos: the check-in's photos themselves, each marked used or not, the capture checks with how many
 * photos passed each, one tip for the next check-in, and when the photos are deleted (or when the next
 * check-in is due). The photo strip takes the card's free height, so a tall column shows bigger photos
 * instead of empty space; on a phone it keeps a natural height.
 * Four tests: the photos show what was measured and which ones were set aside (1); a ✓ or △ on each photo and
 * a count per check read at a glance (2); the whole card is one button, nothing covers text (3); the same
 * placeholder stripes, pills and mono numerals as the Result page's photos (4).
 */
export function PhotosTile({ session, frameUrls, next, demo = false, shared = false, onOpen, className = '' }: {
  session: Session
  /** Signed URL of each uploaded photo (GET /v1/sessions/{id}); the list view only signs the reference photo (preview). */
  frameUrls?: (string | null)[] | null
  /** When the next check-in is due ("Next check-in Sat 17 Oct"), when the person has a schedule. */
  next?: string | null
  /** The demo journey keeps its photos: no deletion date. */
  demo?: boolean
  /** Home fitted to the screen, sharing its column with What changed: the tip gives way (it is on the Result page). */
  shared?: boolean
  onOpen: () => void
  className?: string
}) {
  const [now] = useState(() => Date.now())
  // Home fitted to the screen: the photos give up height first (to a small strip), never the words.
  const fit = useHomeFit()
  const q = session.result?.quality
  const used = session.result?.frames_used ?? 0
  const perFrame = q?.per_frame?.length ? q.per_frame : null
  const total = perFrame?.length || session.n_frames || used
  const frames = perFrame ?? Array.from({ length: total }, (_, i) => ({ index: i, passed: i < used, reasons: [] as QualityReason[] }))
  const reasons = new Set<QualityReason>([...(q?.reasons ?? []), ...frames.flatMap((f) => f.reasons)])
  // A colour card belongs to calibrated (RAW) check-ins only: a camera photo never has one, and is never
  // told it is missing.
  const calibrated = session.capture_mode === 'calibrated_raw'
  if (calibrated && q && !q.card_detected) reasons.add('card_not_found')
  const asked = PHOTO_CHECKS.filter((c) => calibrated || c.label !== 'Colour card')
  // Per check: how many photos passed it (the card is one finding for the whole check-in).
  const checks = asked.map((c) => {
    if (c.label === 'Colour card') {
      const ok = !c.bad.some((r) => reasons.has(r))
      return { label: c.label, ok, count: ok ? 'found' : reasons.has('card_delta_e_high') ? 'off' : 'missing' }
    }
    const bad = frames.filter((f) => f.reasons.some((r) => c.bad.includes(r))).length
    const ok = bad === 0 && !c.bad.some((r) => q?.reasons.includes(r))
    return { label: c.label, ok, count: `${frames.length - bad}/${frames.length}` }
  })
  const first = asked.flatMap((c) => c.bad).find((r) => reasons.has(r))
  const tip = (first && qualityCopy(first, session.site)?.text) ?? `All ${checks.length === 4 ? 'four' : 'three'} checks passed. The same spot, light and time next check-in keeps readings comparable.`
  const place = SITE_SHORT[session.site] ?? 'Check-in'
  // The list view signs one photo per check-in (the reference: the first one used); the single view signs
  // every photo. The reference keeps its small preview so it never swaps once the others arrive.
  const ref = frames.find((f) => f.passed)?.index ?? 0
  const urlOf = (i: number) => (i === ref && session.preview?.url ? session.preview.url : (frameUrls?.[i] ?? null))
  // One photo beside the list when the others can't be shown: the demo journey signs only the reference, and
  // a browser can't draw RAW (DNG) photos. Decided up front, so the card never switches layout once loaded.
  const single = Boolean(session.preview?.url) && (demo || calibrated)
  const keptUntil = new Date(new Date(session.created_at).getTime() + KEEP_DAYS * 86_400_000)
  const gone = keptUntil.getTime() < now
  const foot = next ?? (demo ? null : gone ? `Photos deleted after ${KEEP_DAYS} days` : `Photos kept until ${fmtDate(keptUntil.toISOString())}, then deleted`)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Last photos, ${place.toLowerCase()} on ${fmtDate(session.created_at)}: ${used} of ${total} used. ${checks.map((c) => `${c.label} ${c.ok ? 'passed' : 'needs a look'}`).join(', ')}. ${tip}${foot ? ` ${foot}.` : ''} Open the result.`}
      className={`card group flex min-w-0 animate-[wRise_.55s_.16s_both] flex-col gap-3 p-4 text-left transition-transform duration-[400ms] ease-standard hover:-translate-y-1 ${className}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[15px] leading-[1.25]">Last photos</span>
          <span className="text-[13px] leading-[1.35] text-ink-2">
            {place} · {fmtDate(session.created_at)}
          </span>
        </span>
        <span className="flex flex-none items-baseline gap-1">
          <span className="font-dot text-[34px] leading-none tnum">{used}</span>
          <span className="text-[12px] text-ink-2">of {total} used</span>
        </span>
      </span>
      {/* key: a newer check-in's photos rise in fresh instead of swapping in place */}
      {single ? (
        // Only the reference photo can be shown (the demo journey's list, or RAW photos a browser can't draw):
        // that photo across the top, framed on the face and taking the card's free height, then two columns
        // under it: every photo of the check-in by number (used, or set aside and why) and the capture checks.
        <span key={session.id} className={`flex flex-1 flex-col gap-3 ${fit ? 'min-h-0' : 'min-h-[200px]'}`}>
          <FrameTile n={ref + 1} url={session.preview!.url} used delay={220} className={`w-full flex-1 [&_img]:object-[50%_38%] ${fit ? 'min-h-[84px]' : 'min-h-[170px]'}`} />
          <span className="@container grid grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] gap-x-4 @max-[290px]:gap-x-2.5">
            <span className="flex min-w-0 flex-col gap-1.5">
              {frames.map((f, i) => (
                <span key={f.index} className="flex min-w-0 animate-[wRise_.5s_both] items-center gap-2 text-[12.5px]" style={{ animationDelay: `${280 + i * 55}ms` }}>
                  <Mark ok={f.passed} />
                  <span className="flex-none font-mono text-[11px] text-ink-2 tnum">
                    {/* a narrow card keeps the number and drops the word (the list is the card's photos) */}
                    <span className="@max-[290px]:sr-only">PHOTO </span>
                    {f.index + 1}
                  </span>
                  <span className="min-w-0 truncate">{f.passed ? 'used' : (f.reasons.map((r) => REASON_SHORT[r] ?? 'Set aside').join(', ').toLowerCase() || 'set aside')}</span>
                </span>
              ))}
            </span>
            <span className="flex min-w-0 flex-col gap-1.5 border-l border-ink/[.07] pl-4 @max-[290px]:pl-2.5">
              {checks.map((c, i) => (
                <CheckLine key={c.label} c={c} delay={280 + (frames.length + i) * 55} />
              ))}
            </span>
          </span>
        </span>
      ) : (
        <>
          {/* One row of photos; four or five of them wrap into two rows (3 + 2, 2 + 2) once the strip is tall
              enough for two (a size container: the card's free height decides, never the photos), so a tall
              card shows photos near their own shape instead of thin slices. */}
          <span key={session.id} aria-hidden className={`flex flex-1 flex-wrap gap-1.5 [container-type:size] ${fit ? 'min-h-[72px]' : 'min-h-[120px]'}`}>
            {frames.map((f, i) => (
              <FrameTile key={f.index} n={f.index + 1} url={gone && !demo ? null : urlOf(f.index)} used={f.passed} delay={220 + i * 55} className={`min-w-0 flex-1 basis-0 ${frames.length === 4 ? '[@container(min-height:250px)]:basis-[40%]' : frames.length >= 5 ? '[@container(min-height:250px)]:basis-[30%]' : ''}`} />
            ))}
          </span>
          <span className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {checks.map((c) => (
              <CheckLine key={c.label} c={c} />
            ))}
          </span>
        </>
      )}
      {shared ? null : <span className="text-[12.5px] leading-[1.4] text-pretty text-ink-2">{tip}</span>}
      <span className="flex items-center justify-between gap-3 border-t border-ink/[.07] pt-2.5 text-[12px] text-ink-2">
        <span className="min-w-0 text-pretty">{foot}</span>
        <span className="flex flex-none items-center gap-1 text-ink transition-[gap] duration-200 ease-standard group-hover:gap-1.5">
          See result <span aria-hidden>→</span>
        </span>
      </span>
    </button>
  )
}

/** ✓ on a soft disc, or △ on the warm one: the same mark for a photo and for a check. */
function Mark({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden className={`grid size-[18px] flex-none place-items-center rounded-full text-[10px] ${ok ? 'bg-ink/[.07]' : 'bg-[#FFE3CF] text-signal-ink'}`}>
      {ok ? '✓' : '△'}
    </span>
  )
}

/** One capture check: its mark, its name, and how many photos passed it (or what the card check found). */
function CheckLine({ c, delay }: { c: { label: string; ok: boolean; count: string }; delay?: number }) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 text-[12.5px] ${delay === undefined ? '' : 'animate-[wRise_.5s_both]'}`} style={delay === undefined ? undefined : { animationDelay: `${delay}ms` }}>
      <Mark ok={c.ok} />
      <span className="min-w-0 truncate">{c.label}</span>
      <span className={`ml-auto flex-none font-mono text-[11.5px] tnum ${c.ok ? 'text-ink-2' : 'text-signal-ink'}`}>{c.count}</span>
    </span>
  )
}

/** One photo of the check-in: the picture when signed (fades in once loaded), else the photo-slot stripes; a ✓ when it was used, a △ and a dimmed picture when it was set aside. */
function FrameTile({ n, url, used, delay, className = 'min-w-0 flex-1' }: { n: number; url: string | null; used: boolean; delay: number; className?: string }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const show = url && failed !== url
  return (
    <span
      className={`relative animate-[wRise_.5s_both] overflow-hidden rounded-[16px] squircle ${className}`}
      style={{ animationDelay: `${delay}ms`, background: 'repeating-linear-gradient(135deg, #E2DFD9 0 8px, #ECEAE5 8px 16px)' }}
    >
      {show ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(url)}
          onError={() => setFailed(url)}
          className="absolute inset-0 size-full object-cover transition-[opacity,filter] duration-500 ease-standard"
          style={{ opacity: loaded === url ? (used ? 1 : 0.5) : 0, filter: used ? 'none' : 'saturate(.3)' }}
        />
      ) : null}
      <span className="absolute top-1.5 left-1.5 rounded-pill bg-white/80 px-1.5 py-px font-mono text-[10.5px] text-ink-2 tnum">{n}</span>
      <span className={`absolute right-1.5 bottom-1.5 grid size-5 place-items-center rounded-full text-[10px] shadow-[0_0_0_2px_rgba(255,255,255,.7)] ${used ? 'bg-selected text-inverse' : 'bg-[var(--aura-coral)] text-white'}`}>{used ? '✓' : '!'}</span>
    </span>
  )
}
