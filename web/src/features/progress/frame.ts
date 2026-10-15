/** Framing a photo for the 4:5 stage, in the engine's pixel coordinates. */
import type { AnalysisResult, Session, Site } from '../../data/types'

export type Box = { x: number; y: number; w: number; h: number }

/**
 * The part of a photo to show in a 4:5 frame. A face fills only part of an arm's-length selfie, so a face
 * photo is framed around its regions and spots (with room for hair and jaw); other sites keep the whole
 * photo, cropped to the frame's shape around its centre.
 */
export function frameFor(site: Site, result: AnalysisResult | null | undefined, size: { width: number; height: number }, aspect = 4 / 5): Box {
  let box: Box = { x: 0, y: 0, w: size.width, h: size.height }
  if (site === 'face_full' && result?.rois?.length) {
    const pts = [...result.rois.flatMap((r) => r.polygon), ...(result.candidates ?? []).map((c) => [c.bbox[0] + c.bbox[2] / 2, c.bbox[1] + c.bbox[3] / 2])]
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    // Regions run from the forehead band to the chin; 1.8x leaves the hairline and jaw in view.
    const side = Math.max(x1 - x0, y1 - y0) * 1.8
    box = { x: (x0 + x1) / 2 - side / 2, y: (y0 + y1) / 2 - side / 2, w: side, h: side }
  }
  // Grow to the frame's shape, never past the largest such box inside the photo, then keep it inside.
  const maxW = Math.min(size.width, size.height * aspect)
  let w = Math.max(box.w, box.h * aspect)
  if (w > maxW) w = maxW
  const h = w / aspect
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const x = Math.min(Math.max(cx - w / 2, 0), size.width - w)
  const y = Math.min(Math.max(cy - h / 2, 0), size.height - h)
  return { x, y, w, h }
}

/** Size of the photo the engine's pixel coordinates refer to. */
export function photoSize(s: Session): { width: number; height: number } {
  return s.result?.image_size ?? (s.preview ? { width: s.preview.width, height: s.preview.height } : { width: 3024, height: 4032 })
}

/** A point of the photo as a percentage of the frame (for HTML rings over it). */
export const toPct = (box: Box, x: number, y: number) => ({ left: ((x - box.x) / box.w) * 100, top: ((y - box.y) / box.h) * 100 })
