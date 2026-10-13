import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { MetricId, Session, Site } from '../data/types'
import { METRIC_META } from '../lib/metrics'
import { DUR, EASE_OUT } from '../lib/motion'
import { METRIC_ROIS } from '../mock/series'
import { Illustration } from './Illustration'

type Props = {
  site: Site
  session: Session | null
  baseline: Session | null
  metricId: MetricId | null
  layer: boolean
  onSelectMetric?: (id: MetricId | null) => void
  caption?: string
  compact?: boolean
  className?: string
}

/**
 * The canvas of the Lens: the aligned preview (or a drawn stand-in) on a neutral grey stage,
 * faint ROI outlines, a signal-coloured mask for the selected metric's regions, and
 * press-and-hold to flicker to the baseline (the strongest change detector for aligned frames).
 */
export function Stage({ site, session, baseline, metricId, layer, onSelectMetric, caption, compact = false, className = '' }: Props) {
  const reduce = useReducedMotion()
  const [holding, setHolding] = useState(false)
  const [showBaseline, setShowBaseline] = useState(false)
  const holdTimer = useRef<number | null>(null)
  const flickerTimer = useRef<number | null>(null)
  const size = session?.result?.image_size ?? { width: 3024, height: 4032 }
  const rois = session?.result?.rois ?? []
  const activeRoiNames = metricId ? (METRIC_ROIS[metricId] ?? []) : []
  const shown = showBaseline && baseline ? baseline : session
  // A live session without the engine's preview has no picture: never draw the demo
  // illustration (its colour card and arm are not the person's), and nothing to flicker.
  const blank = Boolean(session?.live && !session.preview)
  const canFlicker = !blank && Boolean(baseline && session && baseline.id !== session.id && baseline.preview)

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
        <svg viewBox={`0 0 ${size.width} ${size.height}`} className="h-full w-full" role="img" aria-label={`${metricLabel ? metricLabel + ' regions on ' : ''}aligned photo${showBaseline ? ', showing baseline' : ''}`}>
          {shown?.preview?.url ? (
            <image href={shown.preview.url} width={size.width} height={size.height} preserveAspectRatio="xMidYMid slice" />
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
                      strokeWidth="6"
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
                  strokeWidth={active ? 7 : 4}
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
          <rect width={size.width} height={size.height} fill="none" stroke="var(--color-surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </svg>
        <div className="pointer-events-none absolute left-5 top-5 flex gap-2">
          {caption ? <span className="rounded-(--radius-chip) bg-surface/90 px-1.5 py-0.5 font-mono text-[12px] text-text">{caption}</span> : null}
          {holding ? <span className="rounded-(--radius-chip) bg-surface/90 px-1.5 py-0.5 font-mono text-[12px] text-text">{showBaseline ? 'Baseline' : 'This session'}</span> : null}
          {metricLabel && layer ? <span className="rounded-(--radius-chip) bg-signal-100/95 px-1.5 py-0.5 text-[12px] font-medium text-signal-700">{metricLabel}</span> : null}
        </div>
        {canFlicker && !holding ? (
          <span className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-(--radius-chip) bg-surface/85 px-2 py-1 text-[12px] text-text-2">Hold to see your baseline</span>
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
