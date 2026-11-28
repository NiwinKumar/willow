/**
 * The scale of Home's small trends (cards.tsx FillTrend). TrendChart (components/charts) always stretches what it
 * draws, the readings and the normal range, to its full height: on its own, blemishes going 7, 6, 6, 7, 6 is a
 * full-height wave. Home draws it on a scale that covers at least `scaleFloor`, by giving it a smaller height
 * centred on the readings.
 */

/** Padding TrendChart keeps above and below its line (components/charts/TrendChart.tsx padY). */
const CHART_PAD_Y = 6

/**
 * The least span a trend's scale covers, so a tiny change never draws as a full-height wave: room for the
 * normal range one and a half times over (the band never fills the chart), a quarter of the reading's own size
 * (a few tenths on a reading of 13 stay a ripple), and for whole-number readings (counts, such as blemishes)
 * four steps, so one more or one fewer is a quarter of the height, not all of it.
 */
export function scaleFloor(values: number[], baseline: number | null, band: number | null): number {
  const all = baseline === null ? values : [...values, baseline]
  const size = Math.max(0, ...all.map(Math.abs))
  const whole = all.length > 0 && all.every(Number.isInteger)
  return Math.max(band ? band * 3 : 0, size * 0.25, whole ? 4 : 0)
}

/**
 * Where TrendChart is drawn inside a plot `h` tall so its scale covers at least `scaleFloor`: TrendChart
 * always stretches what it draws (the readings and the normal range) to its full height, so a chart given a
 * smaller height, centred on the readings, shows them on the wider scale.
 */
export function scaledPlot(points: { v: number }[], baseline: number | null, band: number | null, h: number): { top: number; height: number } {
  const vals = [...points.map((p) => p.v), ...(baseline !== null ? [baseline - (band ?? 0), baseline + (band ?? 0)] : [])]
  if (!vals.length || h <= CHART_PAD_Y * 2) return { top: 0, height: h }
  const span = Math.max(...vals) - Math.min(...vals)
  const floor = scaleFloor(points.map((p) => p.v), baseline, band)
  if (span >= floor) return { top: 0, height: h }
  const height = Math.round(CHART_PAD_Y * 2 + ((h - CHART_PAD_Y * 2) * span) / floor)
  return { top: Math.round((h - height) / 2), height }
}
