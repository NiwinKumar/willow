/**
 * The check-in's vocabulary: steps, sites as the design draws them, what each site measures, the
 * per-site preparation copy, and how many photos a check-in needs. Copy follows the engine and
 * docs/CAPTURE_PROTOCOL.md, not the design where they disagree (see gaps/checkin.md).
 */
import type { CaptureMode, Session, Site } from '../../data/types'
import { baselineState, photoSteps } from '../../lib/baselineGuide'
import { fmtDate } from '../../lib/format'
import { closeUpPlace, isCloseUp, SITE_LABEL } from '../../lib/metrics'

/** `place` and `sent` belong to a whole check-in (?places=): the card before each place, and the end. */
export type Step = 'site' | 'guide' | 'place' | 'camera' | 'review' | 'files' | 'processing' | 'samples' | 'sent'
export const STEPS: Step[] = ['site', 'guide', 'place', 'camera', 'review', 'files', 'processing', 'samples', 'sent']

export const SITES: Site[] = ['face_full', 'cheek_macro', 'left_cheek_macro', 'right_cheek_macro', 'forehead_macro', 'chin_macro', 'nose_macro', 'forearm_treated', 'forearm_control']

export { siteForMode, sitesFor } from './places'

/** ?mode= accepts the api names and the old/short ones (quick, raw). */
export function parseMode(raw: string | null): CaptureMode {
  if (raw === 'calibrated_raw' || raw === 'raw' || raw === 'RAW') return 'calibrated_raw'
  return 'uncalibrated'
}
export function parseSite(raw: string | null): Site | null {
  return SITES.includes(raw as Site) ? (raw as Site) : null
}

export const isArm = (site: Site) => site.startsWith('forearm')
export type Kind = 'face' | 'close' | 'arm'
export const kindOf = (site: Site): Kind => (isArm(site) ? 'arm' : isCloseUp(site) ? 'close' : 'face')

/** The design's names (APP drawer and CAP site cards). */
export const SITE_NAME = SITE_LABEL

/** Small swatch in the picker rows (APP capVals). Hue is decoration, never data. */
export const SITE_SWATCH: Record<Site, string> = {
  face_full: 'radial-gradient(80% 80% at 50% 90%, #FF8A2A, #F7C6A0 70%)',
  cheek_macro: 'radial-gradient(80% 80% at 50% 90%, #E7A07A, #F4DCCB 70%)',
  left_cheek_macro: 'radial-gradient(80% 80% at 35% 90%, #E7A07A, #F4DCCB 70%)',
  right_cheek_macro: 'radial-gradient(80% 80% at 65% 90%, #E7A07A, #F4DCCB 70%)',
  forehead_macro: 'radial-gradient(80% 80% at 50% 10%, #EDB37E, #F6E0CA 70%)',
  chin_macro: 'radial-gradient(80% 80% at 50% 95%, #DC9A86, #F3D8CF 70%)',
  nose_macro: 'radial-gradient(80% 80% at 50% 90%, #E58FB8, #F6D9E8 70%)',
  forearm_treated: 'radial-gradient(80% 80% at 50% 90%, #9C84FF, #DCCCFF 70%)',
  forearm_control: 'radial-gradient(80% 80% at 50% 90%, #7FB6FF, #CFE4FF 70%)',
}

/** Site cards on the site step (CAP siteDefs): background, ink. Close-ups are measured, so they get colour too. */
export const SITE_CARD: Record<Site, { bg: string; fg: string }> = {
  face_full: { bg: 'radial-gradient(90% 80% at 50% 100%, #FF8A3D 0%, #FFB27A 40%, #F4E5D8 80%)', fg: '#2A1206' },
  cheek_macro: { bg: 'radial-gradient(90% 80% at 50% 100%, #E9A27E 0%, #F6CDB4 45%, #F4EDE6 85%)', fg: '#2A1206' },
  left_cheek_macro: { bg: 'radial-gradient(90% 80% at 30% 100%, #E9A27E 0%, #F6CDB4 45%, #F4EDE6 85%)', fg: '#2A1206' },
  right_cheek_macro: { bg: 'radial-gradient(90% 80% at 70% 100%, #E9A27E 0%, #F6CDB4 45%, #F4EDE6 85%)', fg: '#2A1206' },
  forehead_macro: { bg: 'radial-gradient(90% 80% at 50% 0%, #EDB37E 0%, #F7D9BD 45%, #F5EEE6 85%)', fg: '#2A1606' },
  chin_macro: { bg: 'radial-gradient(90% 80% at 50% 100%, #DC9A86 0%, #F3CFC3 45%, #F4ECE8 85%)', fg: '#2A100A' },
  nose_macro: { bg: 'radial-gradient(90% 80% at 50% 100%, #E27FB0 0%, #F5C7DD 45%, #F4ECF0 85%)', fg: '#3A0A24' },
  forearm_treated: { bg: 'radial-gradient(90% 80% at 50% 100%, #7A5CFF 0%, #D8B8FF 45%, #EEE8F6 85%)', fg: '#1C0F4A' },
  forearm_control: { bg: 'radial-gradient(90% 80% at 50% 100%, #3D7BFF 0%, #9CD3FF 45%, #E6EEF6 85%)', fg: '#0A1840' },
}

/** What the engine measures on each site (engine pipeline_face.py, pipeline_macro.py, pipeline.py). */
export const SITE_MEASURES: Record<Site, string> = {
  face_full: 'Tone, dark spots, evenness, redness, blemishes, lines, dark circles, shine and glow.',
  cheek_macro: 'Tone, dark spots, redness, blemishes, pores and texture, up close.',
  left_cheek_macro: 'Tone, dark spots, redness, blemishes, pores and texture on your left cheek, up close.',
  right_cheek_macro: 'Tone, dark spots, redness, blemishes, pores and texture on your right cheek, up close.',
  forehead_macro: 'Tone, dark spots, redness, blemishes, pores and texture on your forehead, up close.',
  chin_macro: 'Tone, dark spots, redness, blemishes, pores and texture on your chin, up close.',
  nose_macro: 'Blemishes and pores, up close.',
  forearm_treated: 'Skin tone and redness on the marked square, against its own baseline.',
  forearm_control: 'The untreated arm. Shows the drift both arms share.',
}

/** The guide hero's gradient per kind (CAP guideBg). */
export const GUIDE_BG: Record<Kind, string> = {
  face: 'radial-gradient(70% 55% at 50% 0%, #F567B5 0%, #8E3A9E 35%, #3A1248 65%, #1A0B22 100%)',
  close: 'radial-gradient(70% 55% at 50% 0%, #FF9A6B 0%, #A8456A 38%, #3A1430 68%, #170A16 100%)',
  arm: 'radial-gradient(70% 55% at 50% 0%, #8E7BFF 0%, #4B3AA8 35%, #1E1550 65%, #0B0820 100%)',
}

/** Which way the face points in each photo of a check-in. */
export type Pose = 'front' | 'left' | 'right'
export const POSE_NAME: Record<Exclude<Pose, 'front'>, string> = { left: 'Left cheek', right: 'Right cheek' }
/** Said in the camera while a cheek photo is next (the person's own left and right). */
export const POSE_HINT: Record<Exclude<Pose, 'front'>, string> = {
  left: 'Turn your head about 45° to show your left cheek · one eye and the tip of your nose still in view',
  right: 'Turn your head about 45° to show your right cheek · one eye and the tip of your nose still in view',
}

/** A face check-in of 3 or more photos can add a left and a right cheek photo. */
export const canAddCheeks = (site: Site, n: number) => site === 'face_full' && n >= 3

/**
 * Each photo's pose for a check-in planned as `n` front photos: front photos first, then the left and the right cheek.
 * With cheek photos 3 face the camera (enough to confirm a mark in a second photo) and 2 show the cheeks, so the
 * check-in stays within the 5 photos the api takes.
 */
export function shotPoses(site: Site, n: number, cheeks: boolean): Pose[] {
  if (!cheeks || !canAddCheeks(site, n)) return Array.from({ length: n }, () => 'front')
  return ['front', 'front', 'front', 'left', 'right']
}

export const hasCheeks = (s: Session | null | undefined) => (s?.result?.views ?? []).some((v) => v.view !== 'front')

/**
 * Cheek photos the way the last measured face check-in was taken (its counts compare with check-ins taken the same
 * way), and on for a first one.
 */
export function cheeksByDefault(sessions: Session[]): boolean {
  const last = [...sessions].reverse().find((s) => s.status === 'done' && s.result)
  return last ? hasCheeks(last) : true
}

export const modeWord = (mode: CaptureMode) => (mode === 'calibrated_raw' ? 'RAW' : 'quick')

/**
 * Photos this check-in needs: 5 when it will become the baseline for this site and mode (no
 * baseline yet, or one too small to have a normal range), else 3. The api accepts 1 to 5.
 */
export function neededFor(sessions: Session[], mode: CaptureMode): number {
  const st = baselineState(sessions, mode)
  if (st.state === 'none') return 5
  if (st.state === 'set' && thinBaseline(st.session)) return 5
  return 3
}

/** A baseline with fewer than 3 usable photos has no normal range (api baselines.py). */
export function thinBaseline(s: Session): boolean {
  const used = s.result?.quality.passed ? s.result.frames_used : s.n_frames
  return used < 3 || s.baseline_ref?.has_noise_band === false
}

/** One line about a site's baseline in a mode, for the picker and the site cards. */
export function baselineLine(sessions: Session[], mode: CaptureMode): { text: string; set: boolean } {
  const st = baselineState(sessions, mode)
  if (st.state === 'set') return { text: `${mode === 'calibrated_raw' ? 'RAW baseline' : 'Baseline'} · ${fmtDate(st.session.created_at)}`, set: true }
  if (st.state === 'saved') return { text: `${mode === 'calibrated_raw' ? 'RAW photos' : 'Photos'} saved, not measured yet`, set: false }
  return { text: sessions.length ? `No ${modeWord(mode)} baseline yet` : 'No photos yet', set: false }
}

export type Check = { title: string; hint: string }

/**
 * The preparation checklist per site and mode (CAP checklistDefs, corrected to the protocol). `firstTime`:
 * someone's very first session here, with no earlier photos to match, so "Same light as last time" becomes
 * advice on choosing a light they can repeat.
 */
export function checklist(site: Site, mode: CaptureMode, firstTime = false): Check[] {
  const raw = mode === 'calibrated_raw'
  const between = photoSteps(site, mode).between
  switch (kindOf(site)) {
    case 'arm':
      return [
        firstTime
          ? { title: 'Steady light you can repeat', hint: 'A window or lamp you can use every time, arm in a spot on the table you will remember.' }
          : { title: 'Same light as last time', hint: 'Same lamp or window, arm in the same spot on the table.' },
        { title: 'Four pen dots on a 4 cm square', hint: 'Mark the corners once and keep all four dots in the frame. A white marker works on deep skin tones.' },
        { title: 'White paper beside the arm', hint: 'Plain white paper in the same light tells Willow the colour of your lamp.' },
        { title: 'Arm flat, phone straight above', hint: `Inner side up, phone level with the skin, about 30 to 40 cm away${raw ? '. A colour card beside the square helps, if you have one' : ''}.` },
        { title: 'Bare skin on the square', hint: 'Nothing applied for 15 minutes, apart from the product you are testing on the treated arm.' },
        { title: 'Reposition between shots', hint: between },
      ]
    case 'close':
      return [
        { title: 'Phone about 10 cm away', hint: 'A hand’s width from your face, much closer than a selfie: pores need that much detail.' },
        { title: 'One eye still in the photo', hint: 'Willow measures size from your iris, so no spacer or ruler is needed.' },
        site === 'nose_macro' ? { title: 'Nose in the middle', hint: 'Centred in the frame, every time.' } : { title: `Same ${closeUpPlace(site)}, same patch`, hint: site === 'cheek_macro' ? 'The same side in the middle of the frame every time.' : 'The same patch in the middle of the frame every time.' },
        { title: 'Bare skin, facing the light', hint: 'Nothing applied for 15 minutes. Face a window or the same lamp.' },
        { title: 'Reposition between shots', hint: between },
      ]
    default:
      return [
        firstTime
          ? { title: 'Face a window or lamp', hint: 'Light from the front, no overhead spotlights. Use the same light every time after this.' }
          : { title: 'Same light as last time', hint: 'Face a window or the same lamp. No overhead spotlights.' },
        { title: 'Bare skin', hint: 'No makeup, sunscreen or serum for at least 15 minutes.' },
        { title: 'Hair back, glasses off', hint: 'Nothing covering forehead, cheeks or jaw; hands away from your face.' },
        { title: 'Neutral expression', hint: 'Relaxed face, eyes open, looking at the lens. A smile creases the skin into lines that are not there at rest.' },
        raw
          ? { title: 'Colour card beside the cheek', hint: 'Flat, fully visible, not in shadow, in the same place every time.' }
          : { title: 'Phone at eye level, arm’s length', hint: 'Same distance every session; your face fills the oval.' },
        { title: 'Reposition between shots', hint: between },
      ]
  }
}

/** The picker's "Before you start" checks: the three that matter most for each kind. */
export function quickChecks(site: Site): string[] {
  switch (kindOf(site)) {
    case 'arm':
      return ['Four pen dots on the square, all in the frame', 'White paper beside the arm, same light', 'Arm flat in the same spot on the table']
    case 'close':
      return ['Back camera, a hand’s width from your skin', 'One eye near the edge of the photo', 'Bare skin, facing the light']
    default:
      return ['Same room and light, facing the window', 'Clean face, nothing applied', 'Hair back, face the camera straight on']
  }
}

/** Lightroom setup (once per phone), with the values the protocol locks. */
export function lightroomSteps(site: Site): string[] {
  const k = kindOf(site)
  return [
    'Open the camera in Lightroom Mobile, tap “Auto” left of the shutter and choose Professional. File format DNG.',
    'Lock ISO 50 to 200, shutter 1/60 to 1/125, white balance a fixed Kelvin such as 5000 K, and manual focus. Tap the lock so it turns yellow.',
    k === 'close'
      ? '1x lens, phone about 10 cm away with one eye in the photo: Willow measures size from your iris.'
      : k === 'arm'
        ? '1x lens. Four pen dots and the white paper in frame (a colour card too, if you have one).'
        : '1x lens. Hold the colour card beside your cheek, flat and fully in frame.',
    'Take the photos. In Lightroom select them, then Share, Export Original (not Camera Roll: that hands over a JPEG), Save to Files.',
    'iCloud files must finish downloading. Then come back here, choose Upload files and pick the DNGs.',
  ]
}

/** Mode facts on the site step (CAP modeFacts), true for today's engine. */
export function modeFacts(mode: CaptureMode): { g: string; t: string }[] {
  return mode === 'calibrated_raw'
    ? [
        { g: '◆', t: 'DNG files from Lightroom with locked settings, uploaded from Files.' },
        { g: '◆', t: 'Your baseline photos give each reading a personal normal range.' },
        { g: '!', t: 'Face colours are not card-corrected yet; the card keeps your sessions comparable.' },
      ]
    : [
        { g: '◌', t: 'This device’s camera, or phone photos (JPEG, HEIC, HEIF).' },
        { g: '◌', t: 'No colour reference, so readings carry wider uncertainty than RAW.' },
        { g: '■', t: 'Camera photos keep their own baseline, separate from RAW.' },
      ]
}

export { plural } from '../../lib/format'
export const siteLower = (site: Site) => SITE_NAME[site].toLowerCase()
export const pad2 = (n: number) => String(n).padStart(2, '0')

/** "15 OCT · AFTERNOON" (APP capWhen). */
export function whenCaps(d = new Date()): string {
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()
  const h = d.getHours()
  return `${day} · ${h < 12 ? 'MORNING' : h < 18 ? 'AFTERNOON' : 'EVENING'}`
}
