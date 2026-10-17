/** Which places each capture mode offers (no app imports, so `npm test` can load it). */
import type { CaptureMode, Site } from '../../data/types'

/**
 * The places offered per mode. RAW (Lightroom DNG) is for close-ups of one place and the forearm squares; a
 * whole face is quick photos (the api refuses a RAW face).
 */
const QUICK_SITES: Site[] = ['face_full', 'cheek_macro', 'nose_macro', 'forearm_treated', 'forearm_control']
const RAW_SITES: Site[] = ['left_cheek_macro', 'right_cheek_macro', 'forehead_macro', 'chin_macro', 'nose_macro', 'forearm_treated', 'forearm_control']
export const sitesFor = (mode: CaptureMode): Site[] => (mode === 'calibrated_raw' ? RAW_SITES : QUICK_SITES)
/** A place this mode offers: the same one, else the nearest (a cheek stays a cheek), else the first. */
export function siteForMode(site: Site, mode: CaptureMode): Site {
  const list = sitesFor(mode)
  if (list.includes(site)) return site
  if (mode === 'calibrated_raw') return 'left_cheek_macro'
  return site.endsWith('cheek_macro') ? 'cheek_macro' : 'face_full'
}
