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

/** How a place in an area is found again on another week: from the area's steadiest edge, in units of its width.
 * The forehead from the brow line (its top is the hairline, which moves with hair and framing), the chin and around
 * the mouth from the lip, the rest from their middle. */
export type AreaFrame = { x: number; y: number; s: number }
const ANCHOR: Record<string, 'top' | 'bottom' | 'middle'> = { forehead: 'bottom', chin: 'top', around_mouth: 'top' }

export function areaFrame(view: SpotWeekView, area: string): AreaFrame | null {
  const roi = view.rois.find((r) => r.name === area)
  if (!roi || roi.polygon.length < 3) return null
  const xs = roi.polygon.map((p) => p[0])
  const ys = roi.polygon.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const at = ANCHOR[area] ?? 'middle'
  return { x: (x0 + x1) / 2, y: at === 'bottom' ? y1 : at === 'top' ? y0 : (y0 + y1) / 2, s: x1 - x0 }
}

/** A place in an area, in its frame (across and down from the anchor, in area widths). */
export type AreaPoint = { u: number; v: number }

export function toAreaPoint(f: AreaFrame, x: number, y: number): AreaPoint {
  return { u: (x - f.x) / f.s, v: (y - f.y) / f.s }
}

export function fromAreaPoint(f: AreaFrame, p: AreaPoint): { x: number; y: number } {
  return { x: f.x + p.u * f.s, y: f.y + p.v * f.s }
}

/** Size of a spot close-up, and how near a counted mark must be to be "here", in area widths. */
export const SPOT_CLOSE_UP = 0.3
export const SPOT_NEAR = 0.06

/** The close-up square around one place of an area, kept inside the photo. */
export function spotBox(view: SpotWeekView, f: AreaFrame, p: AreaPoint): Box {
  const { x, y } = fromAreaPoint(f, p)
  const s = f.s * SPOT_CLOSE_UP
  const W = view.photo.width ?? Infinity
  const H = view.photo.height ?? Infinity
  return { x: Math.min(Math.max(x - s / 2, 0), W - s), y: Math.min(Math.max(y - s / 2, 0), H - s), w: s, h: s }
}

/** The counted mark at a place of an area that week (the nearest within SPOT_NEAR), or null. */
export function markAt(view: SpotWeekView, f: AreaFrame, p: AreaPoint): SpotWeekView['marks'][number] | null {
  const { x, y } = fromAreaPoint(f, p)
  let best: SpotWeekView['marks'][number] | null = null
  let bestD = Infinity
  for (const m of view.marks) {
    const d = Math.hypot(m.x - x, m.y - y)
    if (d <= f.s * SPOT_NEAR + m.r && d < bestD) {
      best = m
      bestD = d
    }
  }
  return best
}

/** Where to start following: the biggest mark in the area that week, else the area's anchor. */
export function startPoint(view: SpotWeekView, area: string, f: AreaFrame): AreaPoint {
  const big = view.marks.filter((m) => m.zone === area).sort((a, b) => b.r - a.r)[0]
  return big ? toAreaPoint(f, big.x, big.y) : { u: 0, v: 0 }
}

/**
 * The same place of the face on another photo: fitted from the face-mesh landmarks nearest to it (a small affine fit,
 * nearer landmarks weighing more), so a spot is carried with the skin around it, whatever the head's angle, distance
 * or framing that week. Null when either photo has no landmarks.
 */
export function carry(from: [number, number][] | null | undefined, to: [number, number][] | null | undefined, x: number, y: number, k = 10): { x: number; y: number } | null {
  if (!from || !to || from.length !== to.length || from.length < 3) return null
  const near = from
    .map((p, i) => ({ i, d: Math.hypot(p[0] - x, p[1] - y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
  // weighted least squares for [x' y'] = [x y 1] M: normal equations (3x3), one solve per output coordinate
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const bx = [0, 0, 0]
  const by = [0, 0, 0]
  for (const { i, d } of near) {
    const w = 1 / (d * d + 1)
    const r = [from[i][0], from[i][1], 1]
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) A[a][b] += w * r[a] * r[b]
      bx[a] += w * r[a] * to[i][0]
      by[a] += w * r[a] * to[i][1]
    }
  }
  const mx = solve3(A, bx)
  const my = solve3(A, by)
  if (!mx || !my) return null
  return { x: mx[0] * x + mx[1] * y + mx[2], y: my[0] * x + my[1] * y + my[2] }
}

function solve3(A: number[][], b: number[]): number[] | null {
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const D = det(A)
  if (Math.abs(D) < 1e-9) return null
  return [0, 1, 2].map((c) => det(A.map((row, r) => row.map((v, j) => (j === c ? b[r] : v)))) / D)
}

/** The counted mark nearest a photo point within `radius` (plus the mark's own size), or null. */
export function markNear(view: SpotWeekView, x: number, y: number, radius: number): SpotWeekView['marks'][number] | null {
  let best: SpotWeekView['marks'][number] | null = null
  let bestD = Infinity
  for (const m of view.marks) {
    const d = Math.hypot(m.x - x, m.y - y)
    if (d <= radius + m.r && d < bestD) {
      best = m
      bestD = d
    }
  }
  return best
}

/** A square of side `size` around a photo point, kept inside the photo. */
export function boxAround(view: SpotWeekView, x: number, y: number, size: number): Box {
  const W = view.photo.width ?? Infinity
  const H = view.photo.height ?? Infinity
  return { x: Math.min(Math.max(x - size / 2, 0), W - size), y: Math.min(Math.max(y - size / 2, 0), H - size), w: size, h: size }
}

/** Areas read from the front photo when following one; cheeks and jawlines are followed on their own photos. */
const FRONT_AREAS = new Set(['forehead', 'nose', 'around_mouth', 'chin'])

/**
 * The photo an area is followed on. For the front's areas: the front photo with the area's whole outline, and the
 * marks the cheek photos counted in that area carried onto it through the face landmarks, so the area shows every
 * mark its count is made of (with cheek photos, the front measures only the middle of the chin and mouth skin).
 */
export function areaPhoto(w: SpotWeek, area: string, prefer: ViewName): SpotWeekView | undefined {
  const front = viewOf(w, 'front')
  const rois = front?.full_rois ?? front?.rois
  if (!front || !FRONT_AREAS.has(area) || !rois?.some((r) => r.name === area)) return viewWithArea(w, area, prefer)
  const carried = w.views
    .filter((v) => v.view !== 'front')
    .flatMap((v) =>
      v.marks
        .filter((m) => m.zone === area)
        .map((m) => {
          const q = carry(v.landmarks, front.landmarks, m.x, m.y)
          return q ? { ...m, x: q.x, y: q.y } : null
        })
        .filter((m): m is NonNullable<typeof m> => m !== null),
    )
  return { ...front, rois, marks: [...front.marks, ...carried] }
}
