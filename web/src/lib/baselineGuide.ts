import type { CaptureMode, Session, Site } from '../data/types'

/**
 * The baseline (the person's "before") is the first measured session per site and capture mode (docs/DECISIONS.md, Oct 13).
 * Its 5 photos give the noise band, so they must differ the way any two sessions do: set up from
 * scratch each time, same pose. A burst makes the band too narrow; deliberate angle changes make it too wide.
 */

/** The sites a person should set a baseline for: the face, and both forearm squares for a product test. */
export const BASELINE_SITES: Site[] = ['face_full', 'forearm_treated', 'forearm_control']

export type BaselineState = { state: 'set'; session: Session } | { state: 'saved' } | { state: 'none' }

/** Whether a site has its baseline in this mode: set, saved but not measured yet (becomes the baseline once measured), or none. */
export function baselineState(sessions: Session[], mode: CaptureMode): BaselineState {
  const inMode = sessions.filter((s) => s.capture_mode === mode && s.status === 'done')
  const set = inMode.find((s) => s.is_baseline)
  if (set) return { state: 'set', session: set }
  if (inMode.some((s) => s.measured === false)) return { state: 'saved' }
  return { state: 'none' }
}

type Kind = 'face' | 'forearm' | 'macro'

function kind(site: Site): Kind {
  if (site.startsWith('forearm')) return 'forearm'
  return site === 'face_full' ? 'face' : 'macro'
}

/** How to take the photos of one session: what stays the same, and what to undo between shots. */
export function photoSteps(site: Site, mode: CaptureMode): { same: string; between: string } {
  switch (kind(site)) {
    case 'face':
      return {
        same:
          mode === 'uncalibrated'
            ? 'Face the light, phone at eye level and an arm’s length away, looking straight at the camera with a neutral face.'
            : 'Face the lamp, phone at eye level about 35 to 40 cm away, looking straight at the camera with a neutral face. Colour card beside the cheek.',
        between: 'Lower the phone and look away, then line your face up in the oval again.',
      }
    case 'forearm':
      return {
        same: `Arm flat on the table, inner side up, same spot under the light. Phone straight above the square, level with the skin, about 30 to 40 cm away, with all four dots, the white paper${mode === 'calibrated_raw' ? ' and the colour card' : ''} in the frame.`,
        between: 'Lift your arm off the table and put it back, and lift the phone away, then line it up again.',
      }
    case 'macro':
      return {
        same: 'Cone touching the skin on the same spot every time. A freckle or a pen dot helps you find it.',
        between: 'Lift the cone off and set it back on the same spot.',
      }
  }
}

export const DONT_VARY = 'Keep the angle, distance and light the same on purpose. No burst mode: each photo needs its own setup.'
export const WHY_FIVE = 'Willow compares the 5 photos to learn how much your photos differ on their own. Later, only a change bigger than that is called real.'

/** Places still without a baseline in this mode, for a short nudge on the report. */
export function missingBaselines(series: (site: Site) => { sessions: Session[] } | null, mode: CaptureMode): Site[] {
  return BASELINE_SITES.filter((site) => baselineState(series(site)?.sessions ?? [], mode).state === 'none')
}
