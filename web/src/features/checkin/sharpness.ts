/**
 * "Looks soft · consider retaking": a client-side sharpness hint on phone photos before upload
 * (never for DNG, which a browser can't decode). Advisory only: it never blocks an upload; the
 * engine's own quality check after upload decides what is used.
 *
 * Score: variance of the 4-neighbour Laplacian on a grey copy downscaled to SIDE px (the engine's
 * own sharpness measure, engine/app/quality.py), over the centre of the frame where the skin is.
 * A photo is soft when its score is below ABS_FLOOR, or (2+ photos of one check-in, same scene and
 * camera) below RELATIVE × the set's median: a shaken shot stands out from its siblings.
 */

/** Longest side of the grey copy. */
export const SIDE = 512
/** Very soft on its own (0-255 grey at SIDE px: smooth skin in a sharp frame still scores well above). */
export const ABS_FLOOR = 6
/** Soft next to the other photos of the same check-in. */
export const RELATIVE = 0.45

/** Grey (Rec. 601 luma, 0-255) from RGBA pixels. */
export function toGrey(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]
  return out
}

/** Variance of the 4-neighbour Laplacian over the centre `frac` of the image (both axes). */
export function laplacianVariance(grey: ArrayLike<number>, w: number, h: number, frac = 0.6): number {
  const x0 = Math.max(1, Math.floor((w * (1 - frac)) / 2))
  const y0 = Math.max(1, Math.floor((h * (1 - frac)) / 2))
  const x1 = Math.min(w - 1, w - x0)
  const y1 = Math.min(h - 1, h - y0)
  let n = 0
  let sum = 0
  let sq = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x
      const lap = grey[i - 1] + grey[i + 1] + grey[i - w] + grey[i + w] - 4 * grey[i]
      sum += lap
      sq += lap * lap
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return sq / n - mean * mean
}

/** Which photos look soft, from their scores (null: could not be scored, never flagged). */
export function softFlags(scores: (number | null)[]): boolean[] {
  const known = scores.filter((s): s is number => s !== null).sort((a, b) => a - b)
  const mid = known.length ? (known.length % 2 ? known[(known.length - 1) / 2] : (known[known.length / 2 - 1] + known[known.length / 2]) / 2) : 0
  return scores.map((s) => s !== null && (s < ABS_FLOOR || (known.length >= 2 && s < RELATIVE * mid)))
}

/** Score one photo in the browser: decode, downscale to SIDE, grey, Laplacian variance. Null when the
 * browser can't decode it (HEIC outside Safari) or it is a DNG. */
export async function scoreFile(file: File, contentType: string): Promise<number | null> {
  if (contentType === 'image/x-adobe-dng' || typeof createImageBitmap !== 'function') return null
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, SIDE / Math.max(bmp.width, bmp.height))
    const w = Math.max(3, Math.round(bmp.width * scale))
    const h = Math.max(3, Math.round(bmp.height * scale))
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    return laplacianVariance(toGrey(ctx.getImageData(0, 0, w, h).data, w, h), w, h)
  } catch {
    return null
  }
}
