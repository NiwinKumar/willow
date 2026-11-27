/** The spot diary, week by week (api GET /v1/spots/weeks): which weeks show, areas, crops and counts. */
import type { SpotWeek, SpotWeekView } from './api'
import type { ViewName } from '../data/types'

/** How many of the latest check-ins the picker shows before "Earlier". */
export const RECENT_WEEKS = 5

export const VIEW_ORDER: ViewName[] = ['front', 'left', 'right']
export const VIEW_LABEL: Record<ViewName, string> = { front: 'Front face', left: 'Left cheek', right: 'Right cheek' }

/** Area words (the engine's zones; left and right are the person's own). Under-eye patches are not spot areas. */
export const AREA_LABEL: Record<string, string> = {
  forehead: 'Forehead',
  nose: 'Nose',
  right_cheek: 'Right cheek',
  left_cheek: 'Left cheek',
  around_mouth: 'Around the mouth',
  chin: 'Chin',
  right_jaw: 'Right jawline',
  left_jaw: 'Left jawline',
}

export const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  new Date(iso).toLocaleDateString('en-GB', opts)

/** The weeks the picker shows: the latest RECENT_WEEKS, or all of them. Oldest first. */
export function shownWeeks(weeks: SpotWeek[], all: boolean): SpotWeek[] {
  return all ? weeks : weeks.slice(-RECENT_WEEKS)
}

/** The views a check-in has, in toggle order. */
export function viewsOf(w: SpotWeek | undefined): ViewName[] {
  return VIEW_ORDER.filter((v) => w?.views.some((x) => x.view === v))
}

export function viewOf(w: SpotWeek | undefined, v: ViewName): SpotWeekView | undefined {
  return w?.views.find((x) => x.view === v)
}

/** The areas a photo shows (its outlines), in face order; never the under-eye patches. */
export function areasOf(view: SpotWeekView | undefined): string[] {
  const have = new Set(view?.rois.map((r) => r.name) ?? [])
  return Object.keys(AREA_LABEL).filter((a) => have.has(a))
}

/** "13 blemishes · 2 dark spots": the words for two counts, nothing for a missing one. */
export function countLine(blemishes: number | null | undefined, darkSpots: number | null | undefined): string {
  const one = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`
  return [blemishes != null ? one(blemishes, 'blemish', 'blemishes') : null, darkSpots != null ? one(darkSpots, 'dark spot', 'dark spots') : null].filter(Boolean).join(' · ')
}

export type Box = { x: number; y: number; w: number; h: number }

/** The square around an area's outline on one photo (with a margin), kept inside the photo: the same patch of skin
 * every week, since the outline follows the face. Null when the photo has no such area. */
export function areaBox(view: SpotWeekView | undefined, area: string, margin = 0.18): Box | null {
  const roi = view?.rois.find((r) => r.name === area)
  if (!view || !roi || roi.polygon.length < 3) return null
  const xs = roi.polygon.map((p) => p[0])
  const ys = roi.polygon.map((p) => p[1])
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const side = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) * (1 + 2 * margin)
  const cx = (x0 + Math.max(...xs)) / 2
  const cy = (y0 + Math.max(...ys)) / 2
  const W = view.photo.width ?? Infinity
  const H = view.photo.height ?? Infinity
  const s = Math.min(side, W, H)
  return { x: Math.min(Math.max(cx - s / 2, 0), W - s), y: Math.min(Math.max(cy - s / 2, 0), H - s), w: s, h: s }
}

/** The photo of a check-in that shows an area: the preferred view's, else any view that has it. */
export function viewWithArea(w: SpotWeek, area: string, prefer: ViewName): SpotWeekView | undefined {
  const pref = viewOf(w, prefer)
  if (pref && areaBox(pref, area)) return pref
  return w.views.find((v) => areaBox(v, area))
}

/** One area's counts per check-in, as Progress has them (by area): blemishes and the dark spots placed there. */
export function areaCounts(w: SpotWeek, area: string): { blemishes: number | null; darkSpots: number | null } {
  const z = w.by_zone[area]
  return { blemishes: z?.blemishes ?? null, darkSpots: w.complete ? (z?.dark_spots ?? 0) : null }
}
