/**
 * Which back lens takes a close-up. Pro iPhones expose their ultra wide lens to the browser with close focus
 * (focusDistance.min 0.02 m on an iPhone 17 Pro Max; camera test Oct 18), so it shoots true close-ups; other
 * phones keep the main back lens at 1x (iPhone 14: min 0.15 m). Never a zoomed lens: digital zoom is a crop
 * that fakes detail and fools the size check, and the telephoto can't focus closer than about a metre.
 * The choice is remembered on this device so later check-ins open the right lens at once.
 */
export type Lens = 'macro' | 'main' | 'front'

/** A lens that focuses this close (metres) shoots true close-ups. */
export const MACRO_MIN_FOCUS = 0.05
const KEY = 'willow.macroLens'

/** "Back Ultra Wide Camera" (iOS); Android names lenses by number, so it keeps the main back camera. */
export const isMacroLabel = (label: string) => /back/i.test(label) && /ultra ?wide/i.test(label)

/** Whether a lens's reported focus range reaches close-up distance. */
export const focusesClose = (min: number | undefined) => min !== undefined && min > 0 && min <= MACRO_MIN_FOCUS

function remembered(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
function remember(v: string) {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* blocked storage: probe again next time */
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const stopAll = (s: MediaStream) => s.getTracks().forEach((t) => t.stop())

/**
 * Open the back camera for a close-up: the macro-capable lens when this phone has one, else the main lens.
 * iOS needs a moment between closing one camera and opening the next (the camera test crashed without it).
 */
export async function openCloseUp(size: MediaTrackConstraints): Promise<{ stream: MediaStream; lens: Lens }> {
  const known = remembered()
  if (known && known !== 'none') {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { ...size, deviceId: { exact: known } }, audio: false })
      return { stream: s, lens: 'macro' }
    } catch {
      /* the id changed (browser data cleared): find it again below */
    }
  }
  const main = await navigator.mediaDevices.getUserMedia({ video: { ...size, facingMode: 'environment' }, audio: false })
  if (known === 'none') return { stream: main, lens: 'main' }
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
  const wide = devices.find((d) => d.kind === 'videoinput' && isMacroLabel(d.label))
  if (!wide) {
    remember('none')
    return { stream: main, lens: 'main' }
  }
  stopAll(main)
  await pause(400)
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { ...size, deviceId: { exact: wide.deviceId } }, audio: false })
    const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { focusDistance?: { min?: number } }
    if (focusesClose(caps.focusDistance?.min)) {
      remember(wide.deviceId)
      return { stream: s, lens: 'macro' }
    }
    stopAll(s)
    await pause(400)
  } catch {
    await pause(400)
  }
  remember('none')
  return { stream: await navigator.mediaDevices.getUserMedia({ video: { ...size, facingMode: 'environment' }, audio: false }), lens: 'main' }
}

type ImageCaptureLike = { takePhoto: () => Promise<Blob> }
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike

/**
 * A still photo from the camera itself (ImageCapture.takePhoto, default size): unlike a frame grabbed from
 * the video it keeps the camera's EXIF (model, lens, focal length, focus position), which the engine reads.
 * Null where the browser has no ImageCapture or the camera refuses (laptops): the caller grabs a frame.
 */
export async function takeStill(track: MediaStreamTrack | undefined): Promise<Blob | null> {
  const Ctor = (globalThis as { ImageCapture?: ImageCaptureCtor }).ImageCapture
  if (!track || !Ctor || track.readyState !== 'live') return null
  try {
    const blob = await new Ctor(track).takePhoto()
    return blob.size ? blob : null
  } catch {
    return null
  }
}
