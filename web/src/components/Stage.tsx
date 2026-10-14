import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { AnalysisResult, MetricId, Session, Site } from '../data/types'
import { METRIC_META } from '../lib/metrics'
import { DUR, EASE_OUT } from '../lib/motion'
import { METRIC_ROIS } from '../mock/series'
import { HIDDEN_RINGS, MOLE_NOTE, SPOT_NAME, type SpotLabel } from '../lib/spotLabels'
import { Illustration } from './Illustration'

type Props = {
  site: Site
  session: Session | null
  baseline: Session | null
  metricId: MetricId | null
  layer: boolean
  onSelectMetric?: (id: MetricId | null) => void
  caption?: string
  /** Spots list selection: show only the rings of this label; null hides hair and artefacts. */
  spotFocus?: SpotLabel | null
  compact?: boolean
  className?: string
}

/**
 * The canvas of the Lens: the aligned preview (or a drawn stand-in) on a neutral grey stage,
 * faint ROI outlines, a signal-coloured mask for the selected metric's regions, and
 * press-and-hold to flicker to the baseline (the strongest change detector for aligned frames).
 */
export function Stage({ site, session, baseline, metricId, layer, onSelectMetric, caption, spotFocus = null, compact = false, className = '' }: Props) {
  const reduce = useReducedMotion()
  const [holding, setHolding] = useState(false)
  const [showBaseline, setShowBaseline] = useState(false)
  const holdTimer = useRef<number | null>(null)
  const flickerTimer = useRef<number | null>(null)
  const activeRoiNames = metricId ? (METRIC_ROIS[metricId] ?? []) : []
  const shown = showBaseline && baseline ? baseline : session
  // Geometry follows the photo on screen: while flickering, the baseline photo has its own size,
  // regions and face position (selfies are never pixel-aligned).
  const size = shown?.result?.image_size ?? session?.result?.image_size ?? { width: 3024, height: 4032 }
  const rois = shown?.result?.rois ?? session?.result?.rois ?? []
  // A live session without the engine's preview has no picture: never draw the demo
  // illustration (its colour card and arm are not the person's), and nothing to flicker.
  const blank = Boolean(session?.live && !session.preview)
  const canFlicker = !blank && Boolean(baseline && session && baseline.id !== session.id && baseline.preview)
  // A face fills only part of a laptop or arm's-length selfie: frame the face (its regions plus
  // room for hair and jaw) so its skin and spot rings are visible. Other sites show the whole photo.
  const result = shown?.result ?? session?.result
  const clipId = useId()
  // Photos are a few hundred KB: say so while one loads instead of showing an empty frame.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const photoFailed = Boolean(shown?.preview?.url && failedUrl === shown.preview.url)
  const photoReady = !shown?.preview?.url || loadedUrl === shown.preview.url || photoFailed
  const framed = Boolean(shown?.preview) // a real photo; the demo illustration keeps its full view
  const vb = useMemo(() => faceFrame(site, framed ? result : null), [site, framed, result])

  const stopHold = useCallback(() => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current)
    if (flickerTimer.current) window.clearInterval(flickerTimer.current)
    holdTimer.current = null
    flickerTimer.current = null
    setHolding(false)
    setShowBaseline(false)
  }, [])

  const startHold = useCallback(() => {
    if (!canFlicker) return
    holdTimer.current = window.setTimeout(() => {
      setHolding(true)
      setShowBaseline(true)
      if (!reduce) flickerTimer.current = window.setInterval(() => setShowBaseline((b) => !b), 600)
    }, 250)
  }, [canFlicker, reduce])

  useEffect(() => stopHold, [stopHold])

  // Keyboard equivalent: hold B.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b' && !e.repeat && canFlicker && !(e.target instanceof HTMLInputElement)) {
        setHolding(true)
        setShowBaseline(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b') stopHold()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [canFlicker, stopHold])

  const metricLabel = metricId ? METRIC_META[metricId].label : null
  return (
    <div className={`relative select-none overflow-hidden bg-stage ${compact ? 'rounded-(--radius-tile)' : ''} ${className}`} style={{ touchAction: 'pan-y' }}>
      <div
        // The svg letterboxes the photo in its own shape (phone RAW frames are often landscape).
        className="relative mx-auto h-full w-full p-3"
        onPointerDown={startHold}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onPointerLeave={stopHold}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="h-full w-full" role="img" aria-label={`${metricLabel ? metricLabel + ' regions on ' : ''}aligned photo${showBaseline ? ', showing baseline' : ''}`}>
          {/* Letterboxing shows the svg outside its viewBox: keep the photo inside the frame. */}
          <clipPath id={clipId}>
            <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            {shown?.preview?.url ? (
              <image
                href={shown.preview.url}
                width={size.width}
                height={size.height}
                preserveAspectRatio="xMidYMid slice"
                onLoad={() => setLoadedUrl(shown.preview!.url)}
                onError={() => setFailedUrl(shown.preview!.url)}
                style={{ opacity: photoReady ? 1 : 0, transition: reduce ? undefined : 'opacity 200ms ease-out' }}
              />
            ) : blank ? (
              <rect width={size.width} height={size.height} fill="var(--color-surface-2)" />
            ) : (
              <Illustration site={site} session={shown} />
            )}
            {(blank ? [] : rois).map((r) => {
              const active = activeRoiNames.includes(r.name)
              const points = r.polygon.map((p) => p.join(',')).join(' ')
              return (
                <g key={r.name}>
                  <AnimatePresence>
                    {layer && active ? (
                      <motion.polygon
                        key={`mask-${r.name}`}
                        points={points}
                        fill="var(--color-signal-500)"
                        stroke="var(--color-signal-700)"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.45 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduce ? 0 : DUR.base, ease: EASE_OUT }}
                      />
                    ) : null}
                  </AnimatePresence>
                  <polygon
                    points={points}
                    fill="transparent"
                    stroke={active ? 'var(--color-text)' : 'var(--color-noise-500)'}
                    strokeOpacity={active ? 0.6 : 0.45}
                    strokeWidth={active ? 2.5 : 1.5}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      const id = (Object.keys(METRIC_ROIS) as MetricId[]).find((k) => METRIC_ROIS[k]?.includes(r.name) && session?.result?.metrics.some((m) => m.id === k))
                      onSelectMetric?.(id ?? null)
                    }}
                  />
                </g>
              )
            })}
            {/* Spots the engine found, labelled by Gemini (AI-suggested): small rings, the label on hover.
                By default everything but hair and artefacts; picking a name in the spots list shows just those. */}
            {!blank && shown === session
              ? (session?.result?.candidates ?? [])
                  .filter((c) => {
                    const d = session?.label_details?.[c.id]
                    return d && (spotFocus ? d.label === spotFocus : !HIDDEN_RINGS.includes(d.label))
                  })
                  .map((c) => {
                    const [x, y, w, h] = c.bbox
                    const d = session!.label_details![c.id]
                    // Snug around the spot, at least ~0.8% of the framed area (a few screen pixels at any
                    // photo size), so neighbouring spots on one cheek stay separate rings.
                    const r = Math.max(Math.max(w, h) * 0.6, Math.max(vb.w, vb.h) * 0.008)
                    const focused = spotFocus !== null
                    return (
                      <g key={c.id} pointerEvents="visiblePainted">
                        <title>{`AI-suggested: ${SPOT_NAME[d.label][0]}${seenText(c.features?.seen_in_fraction, session?.result?.frames_used)}${d.label === 'mole' ? `. ${MOLE_NOTE}` : ''}`}</title>
                        <circle cx={x + w / 2} cy={y + h / 2} r={r} fill="none" stroke="var(--color-text)" strokeOpacity={0.55} strokeWidth={focused ? 3.5 : 3} vectorEffect="non-scaling-stroke" />
                        <circle cx={x + w / 2} cy={y + h / 2} r={r} fill="none" stroke={focused ? 'var(--color-signal-500)' : d.label === 'uncertain' ? 'var(--color-noise-band)' : 'var(--color-surface)'} strokeWidth={focused ? 2 : 1.5} strokeDasharray={d.label === 'uncertain' ? '3 2' : undefined} vectorEffect="non-scaling-stroke" />
                      </g>
                    )
                  })
              : null}
          </g>
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="none" stroke="var(--color-surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </svg>
        <div className="pointer-events-none absolute left-5 top-5 flex gap-2">
          {caption ? <span className="rounded-(--radius-chip) bg-surface/90 px-1.5 py-0.5 font-mono text-[12px] text-text">{caption}</span> : null}
          {holding ? <span className="rounded-(--radius-chip) bg-surface/90 px-1.5 py-0.5 font-mono text-[12px] text-text">{showBaseline ? 'Baseline' : 'This session'}</span> : null}
          {metricLabel && layer ? <span className="rounded-(--radius-chip) bg-signal-100/95 px-1.5 py-0.5 text-[12px] font-medium text-signal-700">{metricLabel}</span> : null}
        </div>
        {canFlicker && !holding ? (
          <span className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-(--radius-chip) bg-surface/85 px-2 py-1 text-[12px] text-text-2">Hold to see your baseline</span>
        ) : null}
        {!photoReady ? (
          <span role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-text-3">
            Loading the photo…
          </span>
        ) : photoFailed ? (
          <span role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-[13px] text-text-3">
            The photo could not be loaded. Reload the page to try again.
          </span>
        ) : null}
        {blank ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-[13px] text-text-3">{session?.measured === false ? 'No photo preview yet.' : 'No photo preview yet. The numbers below are measured from your photos.'}</span>
        ) : !session?.preview ? (
          <span className="pointer-events-none absolute right-5 top-5 rounded-(--radius-chip) bg-surface/85 px-1.5 py-0.5 text-[11px] text-text-3">illustration</span>
        ) : null}
      </div>
    </div>
  )
}

/** "seen in 2 of 3 photos" from the engine's alignment (face sessions with more than one photo). */
function seenText(fraction: number | undefined, frames: number | undefined): string {
  if (fraction === undefined || !frames || frames < 2) return ''
  return ` (seen in ${Math.round(fraction * frames)} of ${frames} photos)`
}

/**
 * The part of the photo to show: for a face, a square around its regions and spots (a side view's
 * regions cover one cheek, its spots can be anywhere on the face); else the whole photo.
 */
function faceFrame(site: Site, result: AnalysisResult | null | undefined) {
  const size = result?.image_size ?? { width: 3024, height: 4032 }
  const all = { x: 0, y: 0, w: size.width, h: size.height }
  if (site !== 'face_full' || !result?.rois?.length) return all
  const pts = [...result.rois.flatMap((r) => r.polygon), ...(result.candidates ?? []).map((c) => [c.bbox[0] + c.bbox[2] / 2, c.bbox[1] + c.bbox[3] / 2])]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  // The regions run from the forehead band to the chin; 1.8x leaves the hairline and jaw in view.
  const side = Math.min(Math.max(x1 - x0, y1 - y0) * 1.8, size.width, size.height)
  if (side >= Math.min(size.width, size.height) * 0.9) return all
  const clampTo = (c: number, max: number) => Math.min(Math.max(c - side / 2, 0), max - side)
  return { x: clampTo((x0 + x1) / 2, size.width), y: clampTo((y0 + y1) / 2, size.height), w: side, h: side }
}
