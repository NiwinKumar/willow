import type { GoalId } from '../../lib/metrics'

/** Each goal drawn with one of the design's goal gradients (decoration only) and its ink colour. Shared by onboarding and the routine builder. */
export const GOAL_LOOK: Record<GoalId, { bg: string; fg: string }> = {
  dark_spots: { bg: 'radial-gradient(90% 80% at 30% 100%, #FF8A3D 0%, #FFB27A 35%, #F6E3D4 75%)', fg: '#2A1206' },
  even_tone: { bg: 'radial-gradient(90% 80% at 70% 100%, #3D7BFF 0%, #9CD3FF 45%, #E6EEF6 85%)', fg: '#0A1840' },
  redness: { bg: 'radial-gradient(90% 80% at 50% 100%, #F25FA8 0%, #F7A6C9 45%, #F4E6EC 85%)', fg: '#3A0A22' },
  blemishes: { bg: 'radial-gradient(90% 80% at 40% 100%, #4FB866 0%, #B8E986 45%, #EAF2E2 85%)', fg: '#0E2A12' },
  pores_texture: { bg: 'radial-gradient(90% 80% at 60% 100%, #7A5CFF 0%, #D8B8FF 45%, #EEE8F6 85%)', fg: '#1C0F4A' },
  lines: { bg: 'radial-gradient(90% 80% at 50% 100%, #9CD3FF 0%, #D8B8FF 45%, #F1ECF8 85%)', fg: '#1C0F4A' },
  under_eye: { bg: 'radial-gradient(90% 80% at 40% 100%, #FF6B4A 0%, #F7A6C9 45%, #F6E8E6 85%)', fg: '#3A0E06' },
  oil_glow: { bg: 'radial-gradient(90% 80% at 50% 100%, #F2B53A 0%, #F6DE5C 40%, #F5F0DA 85%)', fg: '#2A2410' },
}

/** A plain-words line per goal for the builder (what the plan looks for). */
export const GOAL_NOTE: Record<GoalId, string> = {
  dark_spots: 'Fading the look of spots',
  even_tone: 'A more even look overall',
  redness: 'Calmer-looking skin',
  blemishes: 'Fewer breakouts',
  pores_texture: 'Smoother-looking texture',
  lines: 'Softer-looking lines',
  under_eye: 'Brighter-looking under-eyes',
  oil_glow: 'Less shine, more glow',
}
