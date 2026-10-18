import { useSyncExternalStore } from 'react'

import type { TourSegment } from './types'

/**
 * The walkthrough that is playing, if any. A journey page starts a segment; the overlay (TourOverlay, mounted once
 * in App) plays it on the real pages and then goes to `returnTo`. Kept in memory only: a reload ends it.
 */
export type TourRun = { seg: TourSegment; returnTo: string; i: number; paused: boolean; v: number }

let run: TourRun | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function startSegment(seg: TourSegment, returnTo: string) {
  run = { seg, returnTo, i: 0, paused: false, v: (run?.v ?? 0) + 1 }
  emit()
}

/** Move to step i (the overlay calls this as steps finish; Next skips ahead). */
export function goStep(i: number) {
  if (!run) return
  run = { ...run, i, v: run.v + 1 }
  emit()
}

export function setPaused(paused: boolean) {
  if (!run) return
  run = { ...run, paused }
  emit()
}

/** Ends the walkthrough; the overlay then returns to the journey. */
export function endSegment(): string | null {
  const back = run?.returnTo ?? null
  run = null
  emit()
  return back
}

export function useTourRun(): TourRun | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => run,
  )
}

/** Journeys can be watched without the app walkthroughs (kept for this tab). */
const SKIP = 'willow.tour.skip'
export function walkthroughsOn(): boolean {
  try {
    return sessionStorage.getItem(SKIP) !== '1'
  } catch {
    return true
  }
}
export function setWalkthroughs(on: boolean) {
  try {
    if (on) sessionStorage.removeItem(SKIP)
    else sessionStorage.setItem(SKIP, '1')
  } catch {
    /* private mode: on for this page only */
  }
}
