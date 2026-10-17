import { DARK, RIM } from './catArt'

/**
 * The avatar's static art as SVG documents built once from code (no raster files), in the pack's 1024-unit
 * space, and handed to <img> as data URLs: the browser rasterises each once at the drawn size (sharp on any
 * screen) and the per-frame motion only moves those layers, never repaints the blurs.
 */

type Layer = readonly [d: string, fill: string, opacity: number, blur: number]

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${body}</svg>`
const url = (doc: string) => `data:image/svg+xml,${encodeURIComponent(doc)}`

// One blur filter per distinct radius; generous filter regions so soft edges never get cut square.
function blurs(layers: readonly Layer[], extra = 0) {
  const radii = [...new Set(layers.map((l) => l[3] + extra))]
  return radii.map((r) => `<filter id="b${String(r).replace('.', '_')}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${r}"/></filter>`).join('')
}
const paths = (layers: readonly Layer[], extra = 0, gain = 1) =>
  layers.map(([d, fill, o, r]) => `<path d="${d}" fill="${fill}" fill-opacity="${Math.min(1, o * gain).toFixed(3)}" fill-rule="evenodd" filter="url(#b${String(r + extra).replace('.', '_')})"/>`).join('')

// The airbrushed grain of the original: a fine fractal noise that nudges the body's opacity up and down by a
// few percent. It is finer than a pixel at button sizes (it averages out) and shows as texture when large.
const GRAIN =
  '<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' +
  '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="n"/>' +
  '<feColorMatrix in="n" type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  1 0 0 0 0" result="g"/>' +
  '<feComposite in="SourceGraphic" in2="g" operator="arithmetic" k1="0.14" k2="0.93" k3="0" k4="0"/></filter>'

/**
 * The cat is cut into three parts so they can move a little on their own, like a real head: the two ears
 * (behind) and the head (in front, with the rim light, which traces its top edge). CUT runs just outside that
 * edge, from the left cheek over the crown to the right cheek. The head reaches HEAD_UP above it and keeps the
 * ears' bases; each ear keeps what is above it on its side, from EAR_DOWN below it. The two meet in a wide,
 * feathered band, so only the upper ear moves visibly and its base never shows a seam or a double edge.
 */
const CUT: [number, number][] = [[120, 390], [232, 378], [292, 338], [356, 294], [418, 262], [480, 254], [530, 254], [584, 284], [636, 314], [690, 338], [760, 352], [900, 360]]
const HEAD_UP = 36
const EAR_DOWN = 10
const SPLIT_X = 470 // between the ears
const shift = (dy: number) => CUT.map(([x, y]) => [x, y + dy] as [number, number])
const pts = (p: [number, number][]) => p.map(([x, y]) => `${x} ${y}`).join(' L')
const HEAD_REGION = `M${pts([...shift(-HEAD_UP), [900, 1024], [120, 1024]])}Z`
const below = shift(EAR_DOWN)
const EAR_REGION_L = `M${pts([[120, 0], [SPLIT_X, 0], [SPLIT_X, 400], ...below.filter(([x]) => x < SPLIT_X).reverse()])}Z`
const EAR_REGION_R = `M${pts([[SPLIT_X, 0], [900, 0], ...below.filter(([x]) => x > SPLIT_X).reverse(), [SPLIT_X, 400]])}Z`

/** where each ear turns: the middle of its base (pack units) */
export const EAR_PIVOTS: [[number, number], [number, number]] = [
  [335, 330],
  [625, 315],
]

const ALL = [...DARK, ...RIM]
const part = (region: string, feather: number) =>
  url(
    svg(
      `<defs>${blurs(ALL)}${GRAIN}<filter id="mf" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${feather}"/></filter>` +
        `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><path d="${region}" fill="#fff" filter="url(#mf)"/></mask></defs>` +
        `<g mask="url(#m)"><g filter="url(#grain)">${paths(DARK)}${paths(RIM)}</g></g>`,
    ),
  )

/** the head and body (with the rim light) and the two ears, each a full-canvas layer */
export const CAT_HEAD = part(HEAD_REGION, 10)
export const CAT_EAR_L = part(EAR_REGION_L, 10)
export const CAT_EAR_R = part(EAR_REGION_R, 10)

/** an extra, softer bloom of the rim light alone: its opacity breathes with the state (listening glows more) */
export const CAT_GLOW = url(svg(`<defs>${blurs(RIM, 14)}</defs>${paths(RIM, 14, 1.4)}`))

/** the pack's minimal button (vector/button_minimal.svg), unchanged */
export const BUTTON_MINIMAL = url(
  svg(
    '<defs><radialGradient id="fill" cx="48%" cy="45%" r="67%"><stop offset="0" stop-color="#f5f5f8"/><stop offset="0.78" stop-color="#e6e5f0"/><stop offset="1" stop-color="#c8c8e3"/></radialGradient>' +
      '<linearGradient id="border" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a5dfee"/><stop offset="0.48" stop-color="#ddd5f4"/><stop offset="1" stop-color="#d4b6eb"/></linearGradient></defs>' +
      '<circle cx="512" cy="512" r="469" fill="url(#fill)" stroke="url(#border)" stroke-width="5"/>' +
      '<circle cx="512" cy="512" r="462" fill="none" stroke="#ffffff" stroke-opacity=".38" stroke-width="3"/>',
  ),
)
