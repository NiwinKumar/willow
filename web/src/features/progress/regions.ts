/** The engine's measured regions (result.rois) in words, and which metrics each one is read on. */
import type { MetricId, Session } from '../../data/types'

/**
 * Region name (face: the whole face in the face map's zones, engine config FACE_ZONES, plus the under-eye
 * patches; older sessions: landmarks.py ROI_POINTS; pipeline_macro REGIONS, forearm "forearm_square") -> the
 * metrics read on that skin (docs/METRICS.md). Face sides are the person's own sides, as the engine names them.
 */
const FACE: Record<string, MetricId[]> = {
  forehead: ['tone_evenness', 'pigment_spots', 'blemishes', 'lines', 'shine'],
  right_cheek: ['tone_ita', 'pigment_spots', 'tone_evenness', 'redness', 'blemishes', 'lines', 'glow'],
  left_cheek: ['tone_ita', 'pigment_spots', 'tone_evenness', 'redness', 'blemishes', 'lines', 'glow'],
  nose: ['tone_evenness', 'redness', 'blemishes', 'shine'],
  chin: ['tone_evenness', 'pigment_spots', 'blemishes', 'lines', 'shine'],
  around_mouth: ['pigment_spots', 'blemishes', 'lines'],
  right_jaw: ['pigment_spots', 'blemishes', 'lines'],
  left_jaw: ['pigment_spots', 'blemishes', 'lines'],
  right_under_eye: ['dark_circles'],
  left_under_eye: ['dark_circles'],
}
const CLOSE_UP: Record<string, MetricId[]> = {
  cheek: ['tone_ita', 'pigment_spots', 'redness', 'blemishes', 'pores', 'texture'],
  nose: ['blemishes', 'pores'],
}
const FOREARM: Record<string, MetricId[]> = { forearm_square: ['tone_ita', 'redness'], square: ['tone_ita', 'redness'] }

export const REGION_NAME: Record<string, string> = {
  forehead: 'Forehead',
  right_cheek: 'Right cheek',
  left_cheek: 'Left cheek',
  nose: 'Nose',
  chin: 'Chin',
  around_mouth: 'Around the mouth',
  right_jaw: 'Right jaw',
  left_jaw: 'Left jaw',
  right_under_eye: 'Right under-eye',
  left_under_eye: 'Left under-eye',
  cheek: 'Cheek',
  forearm_square: 'Measured square',
  square: 'Measured square',
}

export type RegionItem = { key: string; name: string; label: string; points: string; metrics: MetricId[] }

/**
 * The regions of a session's photo, each with the metrics this session actually measured there (in `order`).
 * `only`: the metrics this photo adds (a cheek photo of a check-in with cheek photos: its marks).
 */
export function regionItems(s: Session, order: MetricId[], only?: MetricId[]): RegionItem[] {
  const r = s.result
  if (!r?.rois?.length) return []
  const map = s.site === 'cheek_macro' || s.site === 'nose_macro' ? CLOSE_UP : s.site.startsWith('forearm') ? FOREARM : FACE
  const measured = new Set(r.metrics.filter((m) => m.value !== null).map((m) => m.id))
  const ranked = order.filter((id) => measured.has(id))
  return r.rois
    .filter((roi) => roi.polygon.length >= 3)
    .map((roi, i) => {
      const own = (map[roi.name] ?? []).filter((id) => !only || only.includes(id))
      const name = REGION_NAME[roi.name] ?? roi.name.replace(/_/g, ' ')
      // Close-ups can send several outlines with the same name: number them so each has its own label.
      const twins = r.rois!.filter((x) => x.name === roi.name).length
      const nth = r.rois!.slice(0, i + 1).filter((x) => x.name === roi.name).length
      return {
        // Keyed by position: names repeat on close-ups.
        key: `${i}`,
        name,
        label: twins > 1 ? `${name} ${nth}` : name,
        points: roi.polygon.map((p) => `${p[0]},${p[1]}`).join(' '),
        metrics: ranked.filter((id) => own.includes(id)),
      }
    })
}
