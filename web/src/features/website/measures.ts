import type { MetricId, Site } from '../../data/types'
import { CLOSE_UPS, METRIC_META } from '../../lib/metrics'

/** "a, b and c" */
function list(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : (items[0] ?? '')
}

const ALL = Object.keys(METRIC_META) as MetricId[]
/** Readable metric names for prose: "Skin tone (ITA°)" reads as "skin tone". */
const name = (id: MetricId) => (id === 'dark_circles' ? 'under-eye darkness' : METRIC_META[id].label.replace(/\s*\(.*\)$/, '').toLowerCase())
const measuredAt = (sites: Site[]) => ALL.filter((id) => METRIC_META[id].sites.some((s) => sites.includes(s)))

const FACE = measuredAt(['face_full'])
const CLOSE_UP = measuredAt(CLOSE_UPS)
const CLOSE_ONLY = CLOSE_UP.filter((id) => !FACE.includes(id))

/** What each kind of photo measures, derived from the metric table (never a hand-written list). */
export const MEASURES = { count: ALL.length, face: list(FACE.map(name)), closeUp: list(CLOSE_ONLY.map(name)) }
