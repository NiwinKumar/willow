/**
 * Where a point of the canonical face (data/faceMap.ts, mm) falls on one face photo (its pixels): an affine map
 * fitted to the photo's own marks, whose face-map place the engine also gives (features.face_x_mm / face_y_mm). The
 * spot diary draws every followed spot on the latest photo with it, faded ones too.
 */
export type Pt = [number, number]
/** px = a·x + b·y + c, py = d·x + e·y + f */
export type Affine = [number, number, number, number, number, number]

/** Fewer than this many marks cannot place a face reliably (a fit through 3 bends with each one's error). */
export const MIN_FIT_POINTS = 4

function solve3(m: number[][], v: number[]): number[] | null {
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  const d = det(m)
  if (Math.abs(d) < 1e-9) return null
  return [0, 1, 2].map((i) => det(m.map((row, r) => row.map((x, c) => (c === i ? v[r] : x)))) / d)
}

/** Least squares from mm to px; null with too few points, points in a line, or a mirror-free fit that is degenerate. */
export function fitAffine(pairs: { mm: Pt; px: Pt }[]): Affine | null {
  if (pairs.length < MIN_FIT_POINTS) return null
  const s = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const tx = [0, 0, 0]
  const ty = [0, 0, 0]
  for (const { mm, px } of pairs) {
    const row = [mm[0], mm[1], 1]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) s[i][j] += row[i] * row[j]
      tx[i] += row[i] * px[0]
      ty[i] += row[i] * px[1]
    }
  }
  const p = solve3(s, tx)
  const q = solve3(s, ty)
  if (!p || !q) return null
  const out: Affine = [p[0], p[1], p[2], q[0], q[1], q[2]]
  return scaleOf(out) > 0 ? out : null
}

export const apply = (t: Affine, [x, y]: Pt): Pt => [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]]
/** Pixels per mm (area scale). */
export const scaleOf = (t: Affine) => Math.sqrt(Math.abs(t[0] * t[4] - t[1] * t[3]))
