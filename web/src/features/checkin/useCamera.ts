import { useCallback, useEffect, useRef, useState } from 'react'

import type { Site } from '../../data/types'
import { photoSteps } from '../../lib/baselineGuide'
import { closeUpPlace, isCloseUp } from '../../lib/metrics'
import { say, tone } from './cue'
import { openCloseUp, takeStill, type Lens } from './lens'
import { POSE_HINT, type Pose } from './model'

export type CamPhase = 'ask' | 'starting' | 'live' | 'denied' | 'unavailable' | 'ended' | 'done'
export type Facing = 'user' | 'environment'
type Gates = { light: boolean; even: boolean; still: boolean }

/**
 * A webcam keeps adjusting exposure and white balance: on Oct 14 the first two of five selfies came
 * out yellower and redder than the rest, which tripled the noise band for redness. Wait for the
 * camera to settle, then hold its current settings where the browser and camera allow it.
 */
const SETTLE_MS = 2500

type CameraCaps = { exposureMode?: string[]; whiteBalanceMode?: string[] }
type CameraSettings = { exposureTime?: number; colorTemperature?: number; iso?: number }

async function holdCamera(track: MediaStreamTrack): Promise<void> {
  if (track.readyState !== 'live' || typeof track.getCapabilities !== 'function') return
  const caps = track.getCapabilities() as CameraCaps
  const now = track.getSettings() as CameraSettings
  const hold: Record<string, string | number> = {}
  if (caps.whiteBalanceMode?.includes('manual') && now.colorTemperature) {
    hold.whiteBalanceMode = 'manual'
    hold.colorTemperature = now.colorTemperature
  }
  if (caps.exposureMode?.includes('manual') && now.exposureTime) {
    hold.exposureMode = 'manual'
    hold.exposureTime = now.exposureTime
    if (now.iso) hold.iso = now.iso
  }
  if (!Object.keys(hold).length) return
  try {
    await track.applyConstraints({ advanced: [hold as MediaTrackConstraintSet] })
  } catch {
    // not supported on this camera: the settle wait is still in place
  }
}

/**
 * The live camera from the old QuickCapture: three framing checks on a 160 px frame five times a second
 * (light, even light, hold still), auto-capture with a 1 s countdown once all pass for 600 ms after the
 * camera has settled and has moved since the last photo (one setup per photo), a manual shutter after
 * 4 s live (or 8 s nearly passing) because laptop cameras often never pass, and the design's 3 s timer.
 * The checks only help framing: nothing is measured in the browser.
 */
export function useCamera({ site, n, taken, pose = 'front', onShot }: { site: Site; n: number; taken: number; pose?: Pose; onShot: (file: File, url: string) => void }) {
  const faceSite = !site.startsWith('forearm')
  const closeUp = isCloseUp(site)
  // A cheek photo (head turned about 45°) is lit unevenly by its shape: judged like a close-up.
  const turned = pose !== 'front'
  const [phase, setPhase] = useState<CamPhase>('ask')
  // Close-ups and the forearms use the back camera (sharper, and the macro lens on Pro iPhones); the face the front one.
  const [facing, setFacing] = useState<Facing>(closeUp || !faceSite ? 'environment' : 'user')
  const [lens, setLens] = useState<Lens | null>(null)
  const [gates, setGates] = useState<Gates>({ light: false, even: false, still: false })
  const [hint, setHint] = useState('Starting the camera')
  const [countdown, setCountdown] = useState<{ n: number; by: 'auto' | 'timer' } | null>(null)
  const [manual, setManual] = useState(false)
  const [settled, setSettled] = useState(false)
  const [flash, setFlash] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const prev = useRef<Uint8ClampedArray | null>(null)
  const passSince = useRef<number | null>(null)
  const nearSince = useRef<number | null>(null)
  const liveSince = useRef<number | null>(null)
  const firing = useRef(false)
  const movedSinceShot = useRef(true)
  const facingRef = useRef(facing)
  facingRef.current = facing
  const spoken = useRef({ text: '', at: 0 })
  const takenRef = useRef(taken)
  takenRef.current = taken
  const shotRef = useRef(onShot)
  shotRef.current = onShot

  // Each start() gets a number; a stream that arrives after a newer start, or after the step closed, is stopped at once.
  const generation = useRef(0)
  const mounted = useRef(true)
  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // A counter, not a DOM node: bumping it makes any start() still waiting on the browser stop its stream.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
      stop()
    }
  }, [stop])

  const start = useCallback(
    async (want: Facing = facing) => {
      stop() // a retry never leaves the previous stream (and the camera light) running
      const gen = ++generation.current
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase('unavailable')
        return
      }
      setPhase('starting')
      try {
        // Close-ups need about 20 px per mm for pores: ask for the full 4K frame, on the macro lens where there is one.
        const size = { width: { ideal: closeUp ? 3840 : 1920 }, height: { ideal: closeUp ? 2160 : 1440 } }
        const opened = closeUp && want === 'environment' ? await openCloseUp(size) : { stream: await navigator.mediaDevices.getUserMedia({ video: { ...size, facingMode: want }, audio: false }), lens: (want === 'user' ? 'front' : 'main') as Lens }
        const s = opened.stream
        if (gen !== generation.current || !mounted.current) {
          // Back was pressed (or another start began) while the browser was asking: never leave the camera on.
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = s
        const track = s.getVideoTracks()[0]
        // The tab went to the background or another app took the camera: say so, never a black frame.
        track?.addEventListener('ended', () => {
          stop()
          setPhase('ended')
        })
        liveSince.current = performance.now()
        prev.current = null
        setSettled(false)
        setManual(false)
        window.setTimeout(() => {
          if (gen !== generation.current) return
          setSettled(true)
          if (track) void holdCamera(track)
        }, SETTLE_MS)
        setFacing(want)
        setLens(opened.lens)
        setPhase('live')
      } catch (e) {
        if (gen !== generation.current || !mounted.current) return
        const name = (e as { name?: string })?.name
        setPhase(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
      }
    },
    [closeUp, facing, stop],
  )

  // Asked before on this device: open straight away instead of asking again.
  useEffect(() => {
    let alive = true
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((p) => {
        if (alive && p.state === 'granted' && takenRef.current < n) void start()
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [])

  // The <video> exists once the live view renders: attach the stream. playsInline + muted let iOS Safari autoplay.
  useEffect(() => {
    const v = video.current
    if (phase !== 'live' || !v || !stream.current || v.srcObject === stream.current) return
    v.srcObject = stream.current
    v.play().catch(() => {
      stop()
      setPhase('ended')
    })
  }, [phase, stop])

  const between = photoSteps(site, 'uncalibrated').between

  const capture = useCallback(async () => {
    const v = video.current
    if (!v || firing.current || !v.videoWidth) return
    firing.current = true
    // The back camera's own still keeps its EXIF (the engine reads lens and focus from it); else a video frame.
    const back = facingRef.current === 'environment'
    let blob = back ? await takeStill(stream.current?.getVideoTracks()[0]) : null
    if (!blob) {
      const c = document.createElement('canvas')
      c.width = v.videoWidth
      c.height = v.videoHeight
      c.getContext('2d')!.drawImage(v, 0, 0)
      blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92))
    }
    if (blob) {
      const idx = takenRef.current + 1
      const file = new File([blob], `frame_${idx}.jpg`, { type: blob.type || 'image/jpeg' })
      setFlash((f) => f + 1)
      shotRef.current(file, URL.createObjectURL(blob))
      // The back camera faces away from the screen: a tone for every photo, and the count out loud.
      if (back) {
        tone(idx >= n)
        say(idx >= n ? 'All photos taken. You can look at the screen now.' : `Photo ${idx} of ${n}. Move the phone away a little, then back.`)
      }
      if (idx >= n) {
        stop()
        setPhase('done')
      }
    }
    setCountdown(null)
    passSince.current = null
    movedSinceShot.current = false
    window.setTimeout(() => {
      firing.current = false
    }, 900)
  }, [n, stop])

  // Analysis loop on a 160 px frame, five times a second.
  useEffect(() => {
    if (phase !== 'live') return
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 120
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const id = window.setInterval(() => {
      const v = video.current
      if (!v || v.readyState < 2) return
      ctx.drawImage(v, 0, 0, 160, 120)
      const d = ctx.getImageData(0, 0, 160, 120).data
      let sum = 0
      let left = 0
      let right = 0
      let clipped = 0
      let diff = 0
      const N = d.length / 4
      for (let i = 0; i < N; i++) {
        const l = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255
        sum += l
        if (l > 0.98) clipped++
        if (i % 160 < 80) left += l
        else right += l
        if (prev.current) diff += Math.abs(d[i * 4 + 1] - prev.current[i * 4 + 1])
      }
      const mean = sum / N
      const ratio = left / Math.max(1, right)
      const motion = prev.current ? diff / N : 99
      prev.current = new Uint8ClampedArray(d)
      // A close-up shows one side of the face (often hair or background at an edge): only strong side light fails it.
      const even = closeUp || turned ? ratio > 0.6 && ratio < 1.6 : ratio > 0.8 && ratio < 1.25
      const g: Gates = { light: mean > 0.32 && mean < 0.75 && clipped / N < 0.02, even, still: motion < 6 }
      // Same gates as last tick: keep the old object, so the camera view does not redraw five times a second.
      setGates((p) => (p.light === g.light && p.even === g.even && p.still === g.still ? p : g))
      if (!g.still) movedSinceShot.current = true
      const now = performance.now()
      const settling = liveSince.current !== null && now - liveSince.current <= SETTLE_MS
      if (!g.light) setHint(mean <= 0.32 ? 'Find brighter light' : 'Too bright · turn away from the lamp')
      else if (!g.even) setHint(closeUp || turned ? 'Turn toward the light so it isn’t coming from one side' : 'One side is darker · face the light')
      else if (!g.still) setHint('Hold still')
      else if (settling) setHint('One moment · the camera is adjusting to the light')
      else if (takenRef.current > 0 && !movedSinceShot.current) setHint(between)
      else setHint(turned ? POSE_HINT[pose as Exclude<Pose, 'front'>] : closeUp ? (site === 'nose_macro' ? 'Nose in the middle, one eye still in view' : `${closeUpPlace(site, true)} fills the frame, one eye still in view`) : faceSite ? 'Good light · fill the oval, eyes on the lens' : 'Good light · all four dots and the paper in frame')
      const all = g.light && g.even && g.still
      if (g.light && g.even) nearSince.current ??= now
      else nearSince.current = null
      if ((nearSince.current && now - nearSince.current > 8000) || (liveSince.current && now - liveSince.current > 4000)) setManual(true)
      if (all) {
        passSince.current ??= now
        if (!settling && now - passSince.current > 600 && !firing.current && movedSinceShot.current) setCountdown((c) => c ?? { n: 1, by: 'auto' })
      } else {
        passSince.current = null
        setCountdown((c) => (c?.by === 'auto' && !firing.current ? null : c))
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [phase, faceSite, closeUp, turned, pose, site, between])

  // Countdown: 1 s for auto-capture, 3 s for the design's timer; then the photo.
  useEffect(() => {
    if (!countdown) return
    const t = window.setTimeout(() => {
      if (countdown.n <= 1) void capture()
      else setCountdown({ ...countdown, n: countdown.n - 1 })
    }, 1000)
    return () => window.clearTimeout(t)
  }, [countdown, capture])

  const allPass = gates.light && gates.even && gates.still
  const canShoot = phase === 'live' && settled && (allPass || manual) && taken < n

  // Back camera: say the framing hint out loud when it changes (at most every 4 s), since the screen faces away.
  useEffect(() => {
    if (phase !== 'live' || facing !== 'environment' || !closeUp) return
    const now = performance.now()
    if (hint === spoken.current.text || now - spoken.current.at < 4000) return
    spoken.current = { text: hint, at: now }
    say(hint.replace(' · ', '. '))
  }, [hint, phase, facing, closeUp])

  return {
    phase,
    video,
    facing,
    /** Which lens is live: the macro-capable ultra wide, the main back lens, or the front camera. */
    lens,
    mirrored: facing === 'user',
    gates,
    allPass,
    hint: phase === 'live' && !settled && allPass ? 'One moment · the camera is adjusting to the light' : hint,
    countdown,
    flash,
    canShoot,
    start: () => void start(),
    flip: () => void start(facing === 'user' ? 'environment' : 'user'),
    shoot: () => void capture(),
    timer: () => setCountdown((c) => (c ? null : { n: 3, by: 'timer' })),
    /** After a retake the camera comes back for the missing photo. */
    resume: () => {
      if (phase === 'done' || phase === 'ask') void start()
    },
    stop,
  }
}
