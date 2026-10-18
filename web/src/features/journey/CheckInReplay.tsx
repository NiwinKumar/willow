import { Check } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import type { Session } from '../../data/types'
import { useData } from '../../data/useData'
import { FlowBackdrop, Orb } from '../checkin/parts'
import { counts } from '../progress/model'

/**
 * /replay/:day: Mei's check-in of that day, replayed quickly for the journey walkthrough (demo only). Her real photo
 * is in the viewfinder, the shutter fires, the photos upload and the four stages tick with what the engine really
 * found for that check-in, then her result opens. Nothing is uploaded or measured again: it is a replay, and says so.
 * ?full=1 plays the slower first-time version (week 1).
 */
type Phase = 'camera' | 'closeup' | 'upload' | 'measure' | 'done'

export default function CheckInReplay() {
  const { day = '' } = useParams()
  const [params] = useSearchParams()
  const full = params.get('full') === '1'
  const navigate = useNavigate()
  const data = useData()
  const ofDay = useMemo(() => data.all.filter((s) => s.created_at.slice(0, 10) === day && s.status === 'done' && s.result), [data.all, day])
  const face = ofDay.find((s) => s.site === 'face_full') ?? null
  const close = ofDay.find((s) => s.site !== 'face_full') ?? null
  const [phase, setPhase] = useState<Phase>('camera')
  const [shots, setShots] = useState(0)
  const [ticks, setTicks] = useState(0)
  const n = face?.n_frames ?? 3

  // The whole replay runs on one timeline (about 9 s, or 14 s the first time).
  useEffect(() => {
    if (!face) return
    const k = full ? 1.5 : 1
    const plan: [number, () => void][] = []
    let t = 900 * k
    for (let i = 1; i <= Math.min(n, 5); i++) {
      plan.push([t, () => setShots(i)])
      t += 420 * k
    }
    if (close) {
      plan.push([t + 200, () => setPhase('closeup')])
      t += 1500 * k
    }
    plan.push([t + 300, () => setPhase('upload')])
    t += 1700 * k
    plan.push([t, () => setPhase('measure')])
    for (let i = 1; i <= 4; i++) plan.push([t + i * 650 * k, () => setTicks(i)])
    t += 4 * 650 * k + 900
    plan.push([t, () => setPhase('done')])
    plan.push([t + 500, () => navigate(`/progress/${day}`, { replace: true })])
    const timers = plan.map(([at, fn]) => window.setTimeout(fn, at))
    return () => timers.forEach(clearTimeout)
  }, [face, close, full, n, day, navigate])

  if (!face) return <div className="grid min-h-[60vh] place-items-center text-ink-2">Loading her check-in…</div>
  const url = face.preview?.url ?? null
  return (
    <main className="fixed inset-0 z-[70] overflow-hidden">
      {phase === 'camera' || phase === 'closeup' ? <Camera url={phase === 'closeup' ? (close?.preview?.url ?? url) : url} closeup={phase === 'closeup'} shots={phase === 'closeup' ? 1 : shots} n={phase === 'closeup' ? 1 : Math.min(n, 5)} /> : <Measuring face={face} close={close} phase={phase} ticks={ticks} />}
      <span className="absolute top-4 left-1/2 z-[3] -translate-x-1/2 rounded-pill bg-black/55 px-3.5 py-1.5 text-[12.5px] text-white/85 backdrop-blur">Replay of Mei’s check-in · {new Date(face.created_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
    </main>
  )
}

function Camera({ url, closeup, shots, n }: { url: string | null; closeup: boolean; shots: number; n: number }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[#0c0c0e] p-4 text-white">
      <div className="relative aspect-[3/4] h-[min(72vh,640px)] max-w-full overflow-hidden rounded-[34px] bg-black">
        {url ? <img src={url} alt="" className="absolute inset-0 size-full object-cover" /> : null}
        {/* the face guide, as in the real camera step */}
        {closeup ? null : <span aria-hidden className="absolute top-[16%] left-1/2 h-[52%] w-[54%] -translate-x-1/2 rounded-[50%] border-2 border-dashed border-white/70" />}
        <div className="absolute inset-x-3 top-3 flex flex-wrap justify-center gap-1.5">
          {(closeup ? ['Steady', 'Close to the cheek', 'Sharp'] : ['Even light', 'Face centred', 'Steady']).map((c) => (
            <span key={c} className="flex items-center gap-1 rounded-pill bg-black/50 px-2.5 py-1 text-[12px] backdrop-blur">
              <Check size={12} className="text-lime" /> {c}
            </span>
          ))}
        </div>
        {shots ? <span key={shots} aria-hidden className="absolute inset-0 bg-white" style={{ animation: 'wFlash .35s ease-out forwards' }} /> : null}
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill bg-black/55 px-3 py-1 text-[13px] tabular-nums backdrop-blur">
          {closeup ? 'Cheek close-up' : 'Face'} · photo {Math.min(shots + 1, n)} of {n}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex gap-1.5">
          {Array.from({ length: n }, (_, i) => (
            <span key={i} className={`size-11 overflow-hidden rounded-[12px] border border-white/25 ${i < shots ? '' : 'opacity-25'}`}>
              {i < shots && url ? <img src={url} alt="" className="size-full object-cover" /> : null}
            </span>
          ))}
        </div>
        <span aria-hidden className="grid size-[68px] place-items-center rounded-full border-4 border-white">
          <span key={shots} className="size-[52px] rounded-full bg-white" style={{ animation: shots ? 'wPress .3s ease-out' : undefined }} />
        </span>
      </div>
    </div>
  )
}

function Measuring({ face, close, phase, ticks }: { face: Session; close: Session | null; phase: Phase; ticks: number }) {
  const c = counts(face)
  const r = face.result!
  const photos = face.n_frames + (close?.n_frames ?? 0)
  const lines: [string, string][] = [
    ['Photo quality', `${r.frames_used} of ${face.n_frames} face photos usable${close ? ` · close-up ${close.result?.frames_used ?? 0} of ${close.n_frames}` : ''}`],
    ['Face and skin areas', 'Found by classical computer vision'],
    ['Measured against her baseline', face.is_baseline ? 'This is her baseline: later weeks compare with it' : `${c.changed} moved beyond her normal range · ${c.normal} within it`],
    ['Explained', 'Gemini explains the measured numbers, never makes them'],
  ]
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <FlowBackdrop />
      <div className="relative flex w-full max-w-[560px] flex-col items-center gap-6 px-4">
        {phase === 'upload' ? (
          <div className="flex w-full flex-col gap-3 rounded-[28px] bg-surface/80 p-5 backdrop-blur">
            <span className="text-[20px]">Uploading {photos} photos</span>
            {Array.from({ length: Math.min(photos, 6) }, (_, i) => (
              <span key={i} className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                <span className="block h-full origin-left rounded-full bg-ink" style={{ animation: `wFill ${700 + i * 160}ms ease-out forwards` }} />
              </span>
            ))}
            <span className="text-[13px] text-ink-2">To her private space · photos are deleted after 30 days</span>
          </div>
        ) : (
          <>
            <Orb state={phase === 'done' ? 'done' : 'run'} />
            <ul className="m-0 flex w-full list-none flex-col gap-2 rounded-[28px] bg-surface/80 p-5 backdrop-blur">
              {lines.map(([t, d], i) => (
                <li key={t} className={`flex items-start gap-3 transition-opacity duration-300 ${i < ticks ? 'opacity-100' : 'opacity-35'}`}>
                  <span className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full ${i < ticks ? 'bg-ink text-inverse' : 'border border-ink/30'}`}>{i < ticks ? <Check size={12} /> : null}</span>
                  <span className="flex flex-col">
                    <span className="text-[15px]">{t}</span>
                    {i < ticks ? <span className="text-[13px] text-ink-2">{d}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
