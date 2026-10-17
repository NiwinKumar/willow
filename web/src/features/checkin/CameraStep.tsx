import { ArrowLeft, SwitchCamera } from 'lucide-react'
import { useState } from 'react'

import type { Site } from '../../data/types'
import { photoSteps, WHY_FIVE } from '../../lib/baselineGuide'
import { closeUpPlace, isCloseUp } from '../../lib/metrics'
import { POSE_NAME, SITE_NAME, type Pose } from './model'
import { useCamera } from './useCamera'

type Shot = { file: File; url: string }

const DARK_BTN = 'grid flex-none place-items-center rounded-full bg-black/35 text-white backdrop-blur-[16px]'

/**
 * Step "camera" (CAP 06): ask for the camera, explain a blocked or missing one, then the live viewfinder
 * with the framing checks, auto-capture, the manual shutter and the 3 s timer. Dark, edge to edge.
 */
export function CameraStep({ site, n, poses, first, shots, onShot, onRetakeLast, onReview, onBack, onFiles }: { site: Site; n: number; poses: Pose[]; first: boolean; shots: Shot[]; onShot: (file: File, url: string) => void; onRetakeLast: () => void; onReview: () => void; onBack: () => void; onFiles: () => void }) {
  // The pose of the next photo: front, or a cheek photo (head turned about 45°) at the end of a face check-in.
  const pose = poses[Math.min(shots.length, n - 1)] ?? 'front'
  const sides = poses.some((p) => p !== 'front')
  const { video, ...cam } = useCamera({ site, n, taken: shots.length, pose, onShot })
  // The previous photo at 30% helps line the next one up (old web: always on); the design lets it be turned off.
  const [ghost, setGhost] = useState(true)
  const arm = site.startsWith('forearm')
  const close = isCloseUp(site)
  const taken = shots.length
  const all = taken >= n
  const last = shots[shots.length - 1]
  const name = SITE_NAME[site]
  const shotName = pose === 'front' ? name : POSE_NAME[pose]

  if (cam.phase !== 'live' && cam.phase !== 'done') {
    const blocked = cam.phase === 'denied' || cam.phase === 'unavailable' || cam.phase === 'ended'
    return (
      <div className="flex min-h-full flex-col items-center bg-[#050505] px-2.5 pt-[max(10px,env(safe-area-inset-top))] pb-[max(6px,env(safe-area-inset-bottom))] text-white">
        <div className="flex w-full max-w-[980px] items-center justify-between gap-3">
          <button type="button" onClick={onBack} aria-label="Back to preparation" className="grid size-[52px] place-items-center rounded-full bg-[#1C1C1C]">
            <ArrowLeft size={20} aria-hidden />
          </button>
          <span className="text-center text-[clamp(18px,2.4vw,26px)] tracking-[-0.01em]" aria-live="polite">
            {shotName} · photo {Math.min(taken + 1, n)} of {n}
          </span>
          <span className="size-[52px]" aria-hidden />
        </div>
        <div className="grid w-full max-w-[560px] flex-1 place-items-center py-6 text-center" role={blocked ? 'alert' : undefined}>
          {!blocked ? (
            <div className="flex flex-col items-center gap-5">
              <div aria-hidden className="size-[200px] rounded-full" style={{ background: 'radial-gradient(circle at 40% 35%, #9CD3FF, #3D7BFF 45%, #1B1F7A 80%)', boxShadow: '0 0 80px 10px rgba(61,123,255,.35)', animation: 'wBreathe 4s ease-in-out infinite' }} />
              <h1 id="ck-title" tabIndex={-1} className="m-0 text-[32px] font-light outline-none">
                Willow needs your camera
              </h1>
              <p className="m-0 leading-normal text-[#BDBAB4]">The preview stays on this device; only the photos you keep are uploaded, to your private space, and deleted after 30 days. Your browser asks for permission next.</p>
              <button type="button" onClick={cam.start} disabled={cam.phase === 'starting'} className="min-h-14 rounded-pill bg-white px-[30px] text-[16px] text-ink">
                {cam.phase === 'starting' ? 'Opening the camera…' : 'Allow camera'}
              </button>
              <button type="button" onClick={onFiles} className="min-h-11 text-[15px] text-white underline underline-offset-4">
                Upload photos instead
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-[18px]">
              <span aria-hidden className="font-dot text-[72px] text-coral">
                —
              </span>
              <h1 id="ck-title" tabIndex={-1} className="m-0 text-[30px] font-light outline-none">
                {cam.phase === 'denied' ? 'Camera access is blocked' : cam.phase === 'ended' ? 'The camera stopped' : 'No camera found'}
              </h1>
              <p className="m-0 leading-[1.55] text-[#BDBAB4]">
                {cam.phase === 'denied'
                  ? 'On iPhone, tap “aA” in the address bar, then Website Settings, Camera, Allow. On a computer, use the camera icon in the address bar. Or upload photos instead.'
                  : cam.phase === 'ended'
                    ? 'The tab went to the background or another app took the camera. Try again, or upload photos instead.'
                    : 'This device has no camera Willow can use here, or another app is using it. Close other camera apps, or upload photos instead.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2.5">
                <button type="button" onClick={cam.start} className="min-h-[52px] rounded-pill bg-white px-6 text-[15px] text-ink">
                  Try again
                </button>
                <button type="button" onClick={onFiles} className="min-h-[52px] rounded-pill border border-[#444] px-6 text-[15px]">
                  Upload photos
                </button>
              </div>
            </div>
          )}
          <ul className="mt-8 flex list-disc flex-col gap-1.5 pl-5 text-left text-[14px] leading-[1.5] text-[#BDBAB4]">
            {arm ? (
              <>
                <li>Four pen dots mark the corners of a 4 cm square; keep all four in the frame.</li>
                <li>A sheet of plain white paper beside the arm, in the same light.</li>
              </>
            ) : close ? (
              <>
                <li>Hold the phone about 10 cm from your face (a hand’s width), much closer than a selfie: pores need that much detail.</li>
                <li>Keep one eye in the photo: Willow measures size from your iris.</li>
                <li>{closeUpPlace(site, true)} in the middle, facing a window or lamp. Hair back, nothing on the skin.</li>
                <li>Use a phone: a laptop camera is too far away and too soft to show pores.</li>
              </>
            ) : (
              <>
                <li>Hair back, glasses off, hands away from your face.</li>
                <li>Camera at eye level, looking into the lens. Come close enough that your face fills the oval.</li>
                <li>Face a window or lamp so both cheeks are lit.</li>
                <li>Laptop camera? Raise it to eye level and sit facing a window. Soft or tilted photos are left out of the measurement.</li>
              </>
            )}
            {sides ? <li>The last two photos show each cheek: turn your head about 45° to your right, then to your left, keeping one eye and the tip of your nose in view.</li> : null}
            <li>Between photos: {photoSteps(site, 'uncalibrated').between.charAt(0).toLowerCase() + photoSteps(site, 'uncalibrated').between.slice(1)}</li>
            {first ? <li>{WHY_FIVE}</li> : null}
          </ul>
        </div>
      </div>
    )
  }

  const guide = arm ? { w: '80%', h: '34%', r: '999px' } : close ? { w: '70%', h: '56%', r: '40px' } : { w: '58%', h: '66%', r: '50%' }
  const ok = cam.allPass || all
  return (
    <div className="flex h-full flex-col items-center bg-[#050505] px-2.5 pt-[max(10px,env(safe-area-inset-top))] pb-[max(6px,env(safe-area-inset-bottom))] text-white">
      <h1 id="ck-title" tabIndex={-1} className="sr-only">
        {name} camera
      </h1>
      <div className="grid min-h-0 w-full flex-1 place-items-center">
        <div className="relative aspect-[3/4] h-full max-h-full max-w-full overflow-hidden rounded-xl shadow-[0_0_0_1px_rgba(255,255,255,.06)]" style={{ background: '#17121A' }}>
          {all && last ? (
            <img src={last.url} alt={`Photo ${taken} of ${n}`} className={`absolute inset-0 size-full object-cover ${cam.mirrored ? '-scale-x-100' : ''}`} />
          ) : (
            <video ref={video} playsInline muted aria-label="Camera preview" className={`absolute inset-0 size-full object-cover ${cam.mirrored ? '-scale-x-100' : ''}`} />
          )}
          {!all && last && ghost ? <img src={last.url} alt="" aria-hidden className={`pointer-events-none absolute inset-0 size-full object-cover opacity-30 ${cam.mirrored ? '-scale-x-100' : ''}`} /> : null}
          <div aria-hidden className="ck-guide absolute top-[52%] left-1/2 -translate-1/2" style={{ width: guide.w, height: guide.h, borderRadius: guide.r, ['--ck-dot' as string]: ok ? 'rgba(220,242,75,.75)' : 'rgba(255,255,255,.55)' }} />
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-live="assertive">
            {cam.countdown ? (
              <span key={cam.countdown.n} className="font-dot text-[clamp(120px,22vw,220px)] text-white [text-shadow:0_0_40px_rgba(255,255,255,.5)]" style={{ animation: 'wPop 1s ease-out both' }}>
                {cam.countdown.n}
              </span>
            ) : null}
          </div>
          {cam.flash ? <div key={cam.flash} aria-hidden className="pointer-events-none absolute inset-0 bg-white" style={{ animation: 'wFlash .45s ease-out both' }} /> : null}

          <div className="absolute top-3.5 right-3.5 left-3.5 flex items-center justify-between gap-2.5">
            <button type="button" onClick={onBack} aria-label="Back to preparation" className={`${DARK_BTN} size-12`}>
              <ArrowLeft size={18} aria-hidden />
            </button>
            <div className="flex flex-col items-center gap-2 rounded-[22px] bg-black/35 px-4 py-2.5 backdrop-blur-[16px]">
              <span aria-live="polite" className="font-mono text-[11px] tracking-[.1em] whitespace-nowrap">
                {all ? `ALL ${n} TAKEN` : `${shotName.toUpperCase()} · ${taken + 1} OF ${n}`}
              </span>
              <span aria-hidden className="flex items-center gap-1">
                {Array.from({ length: n }, (_, i) => (
                  <span key={i} className="h-1.5 rounded-[6px] transition-[width,background] duration-[400ms] ease-standard" style={{ width: i === taken ? 20 : 6, background: i < taken ? 'var(--signal-baseline)' : i === taken ? '#fff' : 'rgba(255,255,255,.3)' }} />
                ))}
              </span>
            </div>
            <button type="button" onClick={cam.flip} disabled={all} aria-label={`Switch to ${cam.facing === 'user' ? 'rear' : 'front'} camera`} className={`${DARK_BTN} size-12`}>
              <SwitchCamera size={18} aria-hidden />
            </button>
          </div>

          {last && !all ? (
            <button
              type="button"
              onClick={() => setGhost(!ghost)}
              aria-pressed={ghost}
              className="absolute right-3.5 bottom-[68px] min-h-9 rounded-pill border bg-black/35 px-3.5 text-[12px] backdrop-blur-[16px] transition-[color,border-color] duration-300"
              style={{ borderColor: ghost ? 'var(--signal-baseline)' : 'rgba(255,255,255,.25)', color: ghost ? 'var(--signal-baseline)' : '#fff' }}
            >
              Align to last
            </button>
          ) : null}
          <div className="pointer-events-none absolute right-0 bottom-[18px] left-0 flex justify-center px-3.5" aria-live="polite">
            <span className="flex max-w-full items-center gap-[9px] rounded-pill px-4 py-2.5 text-[14px] backdrop-blur-[16px] transition-[background,color] duration-300" style={{ background: ok ? 'rgba(220,242,75,.92)' : 'rgba(0,0,0,.45)', color: ok ? 'var(--text-primary)' : '#fff' }}>
              <span aria-hidden className="size-[7px] flex-none rounded-full bg-current" />
              {all ? 'All photos taken' : cam.hint}
            </span>
          </div>
        </div>
      </div>

      <div className="grid h-[104px] w-full max-w-[640px] flex-none grid-cols-[1fr_auto_1fr] items-center gap-x-[18px] px-1.5">
        <span className="justify-self-start">
          {last ? (
            <button
              type="button"
              onClick={() => {
                onRetakeLast()
                cam.resume()
              }}
              aria-label={`Retake photo ${taken}`}
              title="Retake last photo"
              className="relative h-[66px] w-[52px] animate-[wCkDot_.35s_both] rounded-[16px] border-[1.5px] border-white/70 bg-cover bg-center p-0"
              style={{ backgroundImage: `url(${last.url})` }}
            >
              <span className="absolute -top-2 -right-2 grid h-6 min-w-6 place-items-center rounded-pill bg-lime px-1.5 font-dot text-[13px] text-ink">{taken}</span>
              <span className="absolute -bottom-[22px] left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap text-[#BDBAB4]">Retake</span>
            </button>
          ) : null}
        </span>
        {all ? (
          <button type="button" onClick={onReview} className="min-h-[60px] animate-[wCkDot_.4s_both] rounded-pill bg-lime px-[30px] text-[16px] whitespace-nowrap text-ink">
            Review {n} photos →
          </button>
        ) : (
          <button type="button" onClick={cam.shoot} disabled={!cam.canShoot} aria-label={`Take photo ${taken + 1} of ${n}${pose === 'front' ? '' : `, ${shotName.toLowerCase()}`}`} className="grid size-20 place-items-center rounded-full border-[3px] border-white p-[5px] transition-[scale] active:scale-[.92]">
            <span aria-hidden className="size-full rounded-full transition-[background] duration-300" style={{ background: cam.allPass ? '#fff' : 'rgba(255,255,255,.55)' }} />
          </button>
        )}
        <span className="justify-self-end">
          {!all ? (
            <button
              type="button"
              onClick={cam.timer}
              disabled={!cam.canShoot && cam.countdown?.by !== 'timer'}
              aria-label={cam.countdown?.by === 'timer' ? 'Cancel timer' : 'Take photo after 3 seconds'}
              className="size-[52px] rounded-full border border-white/25 font-mono text-[13px] transition-[background] duration-300"
              style={{ background: cam.countdown?.by === 'timer' ? '#fff' : 'rgba(255,255,255,.08)', color: cam.countdown?.by === 'timer' ? 'var(--text-primary)' : '#fff' }}
            >
              {cam.countdown?.by === 'timer' ? '✕' : '3s'}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  )
}
