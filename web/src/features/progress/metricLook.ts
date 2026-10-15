/**
 * How each metric looks and reads on its card and detail sheet. Card hues are decoration only (DESIGN.md:
 * never data); the five the design drew keep its gradients, the rest come from the same aura palette.
 * Words come from docs/UX_SPEC.md per-metric wording and the old MetricDetail copy.
 */
import type { MetricId } from '../../data/types'

type Look = { bg: string; fg: string; unitLabel: string; explain: string; confounders: string; direction: string }

const card = (a: string, b: string, c: string, d: string) => `radial-gradient(90% 75% at 50% 100%, ${a} 0%, ${b} 35%, ${c} 70%, ${d} 95%)`

export const METRIC_LOOK: Record<MetricId, Look> = {
  pigment_spots: {
    bg: card('#FF6A1F', '#FF9A4D', '#F8D7B8', '#F2ECE6'),
    fg: '#2A1206',
    unitLabel: 'Area of measured skin',
    explain: 'The share of your skin covered by spots that are clearly darker than your own skin around them. With several face photos, only spots seen in at least two of them count.',
    confounders: 'Side light, hair across the cheek, shadows, makeup residue, or a recent tan.',
    direction: 'Lower means less skin covered by dark spots. This describes appearance; it is not a grade.',
  },
  tone_evenness: {
    bg: card('#3D7BFF', '#7FB6FF', '#CFE2F6', '#EEF0F2'),
    fg: '#0A1840',
    unitLabel: 'Spread of lightness across regions',
    explain: 'How much lightness varies across your face regions (forehead, cheeks, nose, chin) and within them.',
    confounders: 'Uneven light across the face, a lamp on one side, hair, or a slight head turn.',
    direction: 'A smaller spread means more even-looking tone across the face.',
  },
  redness: {
    bg: card('#F25FA8', '#F590C2', '#F6D3E3', '#F2EDEF'),
    fg: '#3A0A22',
    unitLabel: 'Redness compared with your own skin',
    explain: 'How red your cheeks and nose are, compared with your own skin. It is reported only as change from you, because redness shows differently across skin tones.',
    confounders: 'Exercise, heat, a hot shower, cleansing minutes before the photo, or emotion.',
    direction: 'Higher means more red than your baseline. Compared with you only.',
  },
  tone_ita: {
    bg: 'radial-gradient(90% 75% at 50% 100%, #A98A78 0%, #C9B2A4 40%, #E6DDD6 75%, #EFECE9 95%)',
    fg: '#2A1A12',
    unitLabel: 'ITA°, descriptive only',
    explain: 'The individual typology angle describes your skin colour from how light and how yellow-brown the skin is. It is never a score, and no value is better than another.',
    confounders: 'A different lamp, sun exposure, a tan or self-tanner, white balance, and time of day.',
    direction: 'Lower means darker, higher means lighter. Neither direction is better.',
  },
  blemishes: {
    bg: card('#4FB866', '#8FD07A', '#D5EBC6', '#EEF1EA'),
    fg: '#0E2A12',
    unitLabel: 'Detected candidates',
    explain: 'Candidate blemishes found by image measurement, from local redness and shading. With several face photos, only those seen in at least two count. Names are AI-suggested; the count is indicative.',
    confounders: 'Hair, pores, shadows and freckles can be picked up as candidates.',
    direction: 'A count of candidates, not a diagnosis.',
  },
  pores: {
    bg: card('#C9A8FF', '#DCC6FF', '#EFE6FF', '#F2F0F4'),
    fg: '#2A1640',
    unitLabel: 'Visible pores per cm²',
    explain: 'Small dark openings 0.05 to 0.3 mm across on the close-up, counted per cm² of skin. Size comes from the iris, so one eye needs to be in the photo.',
    confounders: 'Distance from the face, focus, makeup, and sweat.',
    direction: 'Higher means more visible pores per cm². It describes appearance only.',
  },
  texture: {
    bg: card('#6FAE9C', '#9FD0C0', '#DCEFE8', '#EEF1EF'),
    fg: '#0F3B3A',
    unitLabel: 'Surface roughness on the close-up',
    explain: 'How bumpy the skin surface looks at about half a millimetre on the close-up, adjusted for lightness so it reads the same on every tone.',
    confounders: 'Distance and angle of the phone, dryness after cleansing, and light falling from one side.',
    direction: 'Lower means smoother-looking skin.',
  },
  lines: {
    bg: card('#7A5CFF', '#A58BFF', '#E2D8FF', '#F0EEF4'),
    fg: '#1A0E44',
    unitLabel: 'Line length per cm² of skin',
    explain: 'How much visible line there is in the areas where lines form, in millimetres of line per cm² of skin; the score is the average of your two most lined areas. An area is skipped when your expression creases it.',
    confounders: 'Expression, lamp angle and height, head tilt, and how close the camera is.',
    direction: 'Higher means more visible line. Light changes it a lot, so read it as a trend.',
  },
  dark_circles: {
    bg: card('#5FB3F0', '#9CD3FF', '#DDEFFC', '#EEF2F4'),
    fg: '#0A2A40',
    unitLabel: 'Under-eye lightness vs your cheek',
    explain: 'How much lighter or darker the skin under your eyes is than your cheek. Relative to your own skin, so it works across tones.',
    confounders: 'Sleep, allergies, brow shadow, and head tilt.',
    direction: 'Below zero means the under-eye is darker than your cheek; higher means brighter.',
  },
  shine: {
    bg: card('#FFB27A', '#FFCFA6', '#F8E6D6', '#F3EFEA'),
    fg: '#3A1E08',
    unitLabel: 'Share of the T-zone with shine',
    explain: 'The share of your forehead, nose and chin that shows bright, colourless highlights (oil and sweat reflect the light’s colour, not the skin’s).',
    confounders: 'Time since washing, room temperature, and products applied.',
    direction: 'Higher means more of the T-zone shows shine.',
  },
  glow: {
    bg: card('#C8E62E', '#DCF24B', '#EEF7B8', '#F1F2EA'),
    fg: '#20280A',
    unitLabel: 'Compared with your own photos',
    explain: 'Brightness, colour richness and smoothness of your cheeks combined, compared only with your own earlier photos (shine is left out).',
    confounders: 'Lighting, hydration from a shower, and makeup.',
    direction: 'Higher means more glow than in your own earlier photos.',
  },
}

/** The grey card for a metric with no value this time (design: value null). */
export const EMPTY_CARD = { bg: 'linear-gradient(180deg, #F4F3F0, #E3E2DD)', fg: 'var(--text-secondary)' }
