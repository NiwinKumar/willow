import { Camera, RotateCcw, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '../components/Button'
import { FirstSessionGuide } from '../components/BaselineGuide'
import { UploadList } from '../components/UploadList'
import { leaveDemo, useData } from '../data/useData'
import { baselineState, photoSteps } from '../lib/baselineGuide'
import type { CaptureMode, Site } from '../data/types'
import { DUR, EASE_OUT } from '../lib/motion'
import { validateFiles, type Row } from '../lib/upload'
import { authErrorText } from '../lib/authErrors'
import { prefs } from '../lib/prefs'
import { useAuth } from '../lib/useAuth'

type Gates = { light: boolean; even: boolean; still: boolean }
type Phase = 'ask' | 'denied' | 'live' | 'review' | 'upload'

/**
 * Quick selfie: browser camera with three live checks (light, even light, hold still) drawn as
 * three arcs of one ring; the shutter enables when all pass and fires after a one-second countdown,
 * with a manual shutter after eight seconds. The previous shot ghosts at 30% so the next one lines up.
 * These checks only help framing: no number is ever computed in the browser.
 */
export function QuickCapture() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const { user, continueAsGuest } = useAuth()
  const data = useData()
  const site = (params.get('site') as Site) ?? 'face_full'
  const firstSession = baselineState(data.series(site)?.sessions ?? [], 'uncalibrated').state === 'none'
  // Fixed once the person's sessions are known (a deep link may arrive before they load), then kept
  // for the whole capture even if the list refreshes while the camera is open.
  const known = data.mode === 'demo' || data.status === 'ready' || data.status === 'error' || data.status === 'idle'
  const [fixedN, setFixedN] = useState<number | null>(() => (params.get('n') ? Number(params.get('n')) : null))
  if (fixedN === null && known) setFixedN(firstSession ? 5 : 3)
  const n = Math.min(5, Math.max(1, fixedN ?? 5))
  const steps = photoSteps(site, 'uncalibrated')
  const faceSite = site === 'face_full' || site === 'cheek_macro' || site === 'nose_macro'
  const [phase, setPhase] = useState<Phase>('ask')
  const [gates, setGates] = useState<Gates>({ light: false, even: false, still: false })
  const [hint, setHint] = useState('Find brighter, even light')
  const [shots, setShots] = useState<{ url: string; file: File }[]>([])
  const [countdown, setCountdown] = useState<number | null>(null)
  const [manual, setManual] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [uploadMode, setUploadMode] = useState<CaptureMode>('uncalibrated')
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const prev = useRef<Uint8ClampedArray | null>(null)
  const passSince = useRef<number | null>(null)
  const nearSince = useRef<number | null>(null)
  const firing = useRef(false)
  const liveSince = useRef<number | null>(null)
  // Each photo needs its own setup: after a shot, auto-capture waits until the camera has moved.
  const movedSinceShot = useRef(true)

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])
  useEffect(() => stop, [stop])

  async function start() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: faceSite ? 'user' : 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      stream.current = s
      liveSince.current = performance.now()
      // The <video> only exists once the live view renders; the effect below attaches the stream.
      setPhase('live')
    } catch {
      setPhase('denied')
    }
  }

  useEffect(() => {
    const v = video.current
    if (phase !== 'live' || !v || !stream.current || v.srcObject === stream.current) return
    v.srcObject = stream.current
    v.play().catch(() => setPhase('denied'))
  }, [phase])

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
        if ((i % 160) < 80) left += l
        else right += l
        if (prev.current) diff += Math.abs(d[i * 4 + 1] - prev.current[i * 4 + 1])
      }
      const mean = sum / N
      const ratio = left / Math.max(1, right)
      const motion = prev.current ? diff / N : 99
      prev.current = new Uint8ClampedArray(d)
      const g: Gates = { light: mean > 0.32 && mean < 0.75 && clipped / N < 0.02, even: ratio > 0.8 && ratio < 1.25, still: motion < 6 }
      setGates(g)
      if (!g.still) movedSinceShot.current = true
      if (!g.light) setHint(mean <= 0.32 ? 'Find brighter light' : 'Too bright. Turn away from the lamp')
      else if (!g.even) setHint('Face the window or lamp so both sides are lit evenly')
      else if (!g.still) setHint('Hold still')
      else setHint(faceSite ? 'Fit your face in the oval' : 'Fit the square in the frame')
      const now = performance.now()
      const all = g.light && g.even && g.still
      if (g.light && g.even) nearSince.current ??= now
      else nearSince.current = null
      // The checks only help framing. Laptop cameras often never pass them, so the shutter is
      // always available after a few seconds.
      if ((nearSince.current && now - nearSince.current > 8000) || (liveSince.current && now - liveSince.current > 4000)) setManual(true)
      if (all) {
        passSince.current ??= now
        if (now - passSince.current > 600 && countdown === null && !firing.current && movedSinceShot.current) setCountdown(1)
      } else {
        passSince.current = null
        if (countdown !== null && !firing.current) setCountdown(null)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [phase, countdown, faceSite])

  const capture = useCallback(async () => {
    const v = video.current
    if (!v || firing.current) return
    firing.current = true
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92))
    if (blob) {
      const idx = shots.length + 1
      const file = new File([blob], `frame_${idx}.jpg`, { type: 'image/jpeg' })
      setShots((s) => [...s, { url: URL.createObjectURL(blob), file }])
      if (idx >= n) {
        stop()
        setPhase('review')
      }
    }
    setCountdown(null)
    passSince.current = null
    movedSinceShot.current = false
    window.setTimeout(() => {
      firing.current = false
    }, 900)
  }, [shots.length, n, stop, setShots, setPhase])

  useEffect(() => {
    if (countdown === null) return
    const t = window.setTimeout(() => void capture(), 1000)
    return () => window.clearTimeout(t)
  }, [countdown, capture])


  const arcs: { key: keyof Gates; label: string }[] = [
    { key: 'light', label: 'Light' },
    { key: 'even', label: 'Even' },
    { key: 'still', label: 'Still' },
  ]
  const allPass = gates.light && gates.even && gates.still

  if (data.mode === 'live' && !prefs.consent()) return <Navigate to={`/start?next=${encodeURIComponent(`/capture/camera?${params.toString()}`)}`} replace />

  if (fixedN === null)
    return (
      <p className="mx-auto max-w-[36rem] px-5 pt-6 text-[15px] text-text-3 sm:px-8" role="status">
        Loading your sessions…
      </p>
    )

  if (phase === 'ask' || phase === 'denied')
    return (
      <div className="mx-auto max-w-[36rem] px-5 pb-16 pt-6 sm:px-8">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">{phase === 'ask' ? (faceSite ? 'Willow needs your camera for this selfie' : 'Willow needs your camera for this photo') : 'Camera is blocked'}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-text-2">
          {phase === 'ask'
            ? `Photos stay in your private space and are deleted after 30 days. ${n} photos, uncalibrated, so the result is a trend, not a measurement.${firstSession ? '' : ` Between photos: ${steps.between.charAt(0).toLowerCase() + steps.between.slice(1)}`}`
            : 'Allow it in the browser: on iPhone, tap “aA” in the address bar, Website Settings, Camera, Allow. Or upload a photo instead.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {phase === 'ask' ? (
            <Button onClick={start}>
              <Camera size={18} aria-hidden /> Allow camera
            </Button>
          ) : (
            <Button onClick={start}>Try again</Button>
          )}
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-(--radius-control) border border-border bg-surface px-4 text-[15px] font-medium hover:bg-surface-2">
            Upload a photo instead
            <input
              type="file"
              accept=".jpg,.jpeg,image/jpeg,.heic,image/heic,.dng,image/x-adobe-dng,image/dng"
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                // A RAW .dng is better than a selfie: send it as a calibrated session instead.
                const raw = files.filter((f) => /\.dng$/i.test(f.name))
                if (raw.length && raw.length !== files.length) {
                  setUploadErrors(['Choose either RAW .dng files or photos (.jpg / .heic), not both.'])
                  return
                }
                const mode: CaptureMode = raw.length ? 'calibrated_raw' : 'uncalibrated'
                const v = validateFiles(files, mode, n)
                setUploadMode(mode)
                setUploadErrors(v.errors)
                setRows(v.rows)
                if (v.rows.length) setPhase('upload')
              }}
            />
          </label>
        </div>
        {!faceSite ? (
          <ul className="mt-5 list-disc space-y-1 pl-5 text-[15px] text-text-2">
            <li>Four pen dots mark the corners of a 4 cm square; keep all four in the frame.</li>
            <li>A sheet of plain white paper beside the arm, in the same light.</li>
          </ul>
        ) : null}
        {phase === 'ask' && firstSession && data.mode === 'live' ? (
          <div className="mt-5">
            <FirstSessionGuide site={site} mode="uncalibrated" n={n} />
          </div>
        ) : null}
        {uploadErrors.length ? (
          <ul className="mt-3 space-y-1 text-[13px] text-danger">
            {uploadErrors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
        {!faceSite ? null : <p className="mt-6 text-[12px] text-text-3">Laptop camera? Expect lower quality; the checks are looser on desktop.</p>}
        <Link to={`/capture?site=${site}&mode=quick`} className="mt-6 inline-flex min-h-11 items-center text-[15px] text-text-2 underline-offset-2 hover:text-text hover:underline">
          Back to the photo guide
        </Link>
      </div>
    )

  if (phase === 'review')
    return (
      <div className="mx-auto max-w-[36rem] px-5 pb-16 pt-6 sm:px-8">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">{shots.length} photos</h1>
        <p className="mt-2 text-[15px] text-text-2">Tap one to retake it, or continue.</p>
        <ul className="mt-5 grid grid-cols-3 gap-2">
          {shots.map((s, i) => (
            <li key={s.url} className="relative aspect-[3/4] overflow-hidden rounded-(--radius-control) bg-stage">
              <img src={s.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label={`Retake photo ${i + 1}`}
                onClick={() => {
                  setShots((x) => x.filter((_, j) => j !== i))
                  setPhase('ask')
                  void start()
                }}
                className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface/90 text-text"
              >
                <RotateCcw size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <Button
          className="mt-6"
          onClick={() => {
            setUploadMode('uncalibrated')
            setRows(shots.map((s) => ({ file: s.file, contentType: 'image/jpeg', progress: 0, state: 'ready' as const })))
            setPhase('upload')
          }}
        >
          Use these {shots.length} photos
        </Button>
      </div>
    )

  if (phase === 'upload')
    return (
      <div className="mx-auto max-w-[36rem] px-5 pb-16 pt-6 sm:px-8">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Uploading</h1>
        {!user ? (
          <div className="mt-4 rounded-(--radius-tile) bg-surface-2 p-3 text-[13px]">
            Sign in to upload. A guest account is enough.{' '}
            <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => continueAsGuest().catch((e) => { const t = authErrorText(e); if (t) toast.error(t) })}>
              Continue as guest
            </button>
          </div>
        ) : (
          <div className="mt-5">
            {uploadMode === 'calibrated_raw' ? <p className="mb-3 text-[13px] text-text-2">RAW files: sent as a calibrated session.</p> : null}
            <UploadList site={site} mode={uploadMode} rows={rows} onRows={setRows} onDone={(sid) => {
              leaveDemo()
              // "Something is different today" from the capture guide travels with the session.
              const dev = params.get('dev') ? `&dev=1&note=${encodeURIComponent(params.get('note') ?? '')}` : ''
              navigate(`/processing/${sid}?site=${site}&n=${rows.length}${dev}`)
            }} />
          </div>
        )}
      </div>
    )

  return (
    <div className="relative flex h-dvh flex-col bg-stage">
      <div className="relative min-h-0 flex-1">
        <video ref={video} playsInline muted className={`h-full w-full object-cover ${faceSite ? '-scale-x-100' : ''}`} />
        {shots.length > 0 ? <img src={shots[shots.length - 1].url} alt="" aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30 ${faceSite ? '-scale-x-100' : ''}`} /> : null}
        {/* Guide and ring */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[62vmin] w-[62vmin] max-h-[70%] max-w-[85%]">
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
              {arcs.map((a, i) => {
                const seg = 120
                const gap = 6
                const r = 47
                const a0 = (i * seg + gap / 2) * (Math.PI / 180)
                const a1 = ((i + 1) * seg - gap / 2) * (Math.PI / 180)
                const d = `M ${50 + r * Math.cos(a0)} ${50 + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${50 + r * Math.cos(a1)} ${50 + r * Math.sin(a1)}`
                const on = gates[a.key]
                return <motion.path key={a.key} d={d} fill="none" strokeWidth="2.5" strokeLinecap="round" initial={false} animate={{ stroke: on ? 'var(--color-willow-500)' : 'rgba(255,255,255,0.55)', pathLength: on ? 1 : 0.35 }} transition={{ duration: reduce ? 0 : DUR.slow, ease: EASE_OUT }} />
              })}
            </svg>
            <motion.div animate={allPass && !reduce ? { scale: [1, 1.03, 1] } : { scale: 1 }} transition={{ duration: 1.2, ease: 'easeInOut' }} className={`absolute inset-[9%] ${faceSite ? 'rounded-[50%/42%]' : 'rounded-(--radius-tile)'} border-2 ${allPass ? 'border-willow-500' : 'border-white/70'}`} />
            {countdown !== null ? <span className="absolute inset-0 flex items-center justify-center font-mono text-[64px] font-medium text-white drop-shadow">{countdown}</span> : null}
          </div>
        </div>
        <div className="absolute left-4 right-4 top-4 flex items-start justify-between">
          <span className="rounded-(--radius-chip) bg-surface/90 px-2 py-1 text-[13px] font-medium" aria-live="polite">
            {hint}
          </span>
          <button type="button" aria-label="Close camera" onClick={() => { stop(); navigate(-1) }} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface/90">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="absolute bottom-4 left-4 flex gap-1.5" aria-label={`${shots.length} of ${n} taken`}>
          {Array.from({ length: n }, (_, i) => (
            <span key={i} className={`h-2 w-6 rounded-full ${i < shots.length ? 'bg-willow-500' : 'bg-white/50'}`} />
          ))}
        </div>
        <span className="absolute bottom-4 right-4 rounded-(--radius-chip) bg-surface/85 px-1.5 py-0.5 text-[11px] text-text-2">Phone photo · trend only</span>
      </div>
      <div className="flex items-center justify-center gap-6 bg-bg px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => void capture()}
          disabled={!allPass && !manual}
          aria-label="Take photo"
          className="inline-flex h-16 w-16 items-center justify-center rounded-full border-4 border-text bg-surface transition-transform active:scale-95 disabled:opacity-40"
        >
          <span className={`h-12 w-12 rounded-full ${allPass ? 'bg-willow-500' : 'bg-text'}`} />
        </button>
        <span className="w-44 text-[13px] leading-snug text-text-2">{shots.length > 0 ? steps.between : allPass ? 'Auto in 1 s' : manual ? 'Take it when ready' : 'Shutter enables when the ring is green'}</span>
      </div>
    </div>
  )
}
