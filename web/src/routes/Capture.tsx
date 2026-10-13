import { Camera, Check, ChevronRight, FolderOpen, Lock, Sun, Thermometer, Timer, Wind } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { DemoBar } from '../components/DemoBar'
import { UploadList } from '../components/UploadList'
import { validateFiles, type Row } from '../lib/upload'
import { useData } from '../data/useData'
import type { CaptureMode, Site } from '../lib/api'
import { SITE_LABEL } from '../lib/metrics'
import { DUR, EASE_OUT } from '../lib/motion'
import { prefs } from '../lib/prefs'
import { useAuth } from '../lib/useAuth'

const SITES: Site[] = ['face_full', 'cheek_macro', 'nose_macro', 'forearm_treated', 'forearm_control']
const RITUAL = [
  { icon: Sun, text: 'Same lamp, same spot, curtains closed.', why: 'Lighting is the biggest source of photo-to-photo change. Keeping it fixed is what makes the noise band small.' },
  { icon: Timer, text: 'Clean skin, nothing applied, waited 15 minutes.', why: 'Water, products and rubbing all change redness and shine for a while.' },
  { icon: Wind, text: 'Hair back, glasses off, neutral face.', why: 'Hair and glasses cover regions; expressions move the landmarks the regions are built from.' },
  { icon: Thermometer, text: 'Colour card next to the skin, flat, not in shadow.', why: 'The card is how each photo gets colour-corrected. Shadow or glare on it fails the quality check.', calibratedOnly: true },
]

type Step = 'guide' | 'lightroom' | 'ring' | 'export' | 'upload'

export function Capture() {
  const [params] = useSearchParams()
  const data = useData()
  const navigate = useNavigate()
  const { user, continueAsGuest } = useAuth()
  const reduce = useReducedMotion()
  const sample = params.get('sample') === '1'
  const initialMode: CaptureMode = params.get('mode') === 'quick' ? 'uncalibrated' : 'calibrated_raw'
  const [site, setSite] = useState<Site>((params.get('site') as Site) ?? 'face_full')
  const [mode, setMode] = useState<CaptureMode>(initialMode)
  const [why, setWhy] = useState<number | null>(null)
  const [deviation, setDeviation] = useState(false)
  const [note, setNote] = useState('')
  const [step, setStep] = useState<Step>('guide')
  const [shots, setShots] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const baselineNeeded = !data.series(site)?.sessions.some((s) => s.is_baseline)
  const expected = baselineNeeded ? 5 : 3

  if (sample) return <Samples />

  const ring = (
    <div className="relative mx-auto h-44 w-44" role="img" aria-label={`${shots} of ${expected} photos taken`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        {Array.from({ length: expected }, (_, i) => {
          const gap = 4
          const seg = 360 / expected
          const r = 44
          const a0 = (i * seg + gap / 2) * (Math.PI / 180)
          const a1 = ((i + 1) * seg - gap / 2) * (Math.PI / 180)
          const d = `M ${50 + r * Math.cos(a0)} ${50 + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${50 + r * Math.cos(a1)} ${50 + r * Math.sin(a1)}`
          const on = i < shots
          return <motion.path key={i} d={d} fill="none" strokeWidth="7" strokeLinecap="round" stroke={on ? 'var(--color-willow-500)' : 'var(--color-border)'} initial={false} animate={{ pathLength: on ? 1 : 0.0001, stroke: on ? 'var(--color-willow-500)' : 'var(--color-border)' }} transition={{ duration: reduce ? 0 : DUR.slow, ease: EASE_OUT }} />
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[40px] font-medium leading-none">{shots}</span>
        <span className="text-[13px] text-text-2">of {expected}</span>
      </div>
    </div>
  )

  return (
    <div className="mx-auto max-w-[36rem] px-5 pb-16 pt-4 sm:px-8">
      {data.mode === 'demo' ? <div className="-mx-5 mb-4 sm:-mx-8"><DemoBar /></div> : null}

      {step === 'guide' ? (
        <>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">What are we photographing today?</h1>
          <ul className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Site">
            {SITES.map((s) => (
              <li key={s}>
                <button type="button" aria-pressed={site === s} onClick={() => setSite(s)} className={`min-h-11 rounded-full border px-4 text-[15px] transition-[background-color,color,transform] duration-150 active:scale-[0.98] ${site === s ? 'border-text bg-text text-surface' : 'border-border bg-surface hover:bg-surface-2'}`}>
                  {SITE_LABEL[s]}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-text-2">{baselineNeeded ? `No baseline yet for ${SITE_LABEL[site]}: this session takes 5 photos.` : `Check-in: 3 photos, compared to your baseline.`}</p>

          <div className="mt-6 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mode">
            {(
              [
                ['calibrated_raw', 'Calibrated', 'RAW photo + colour card. Measured results.'],
                ['uncalibrated', 'Quick selfie', 'Phone camera in the browser. Trend only.'],
              ] as const
            ).map(([id, label, sub]) => (
              <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={`rounded-(--radius-tile) border p-3 text-left transition-[border-color,background-color] ${mode === id ? 'border-text bg-surface' : 'border-border hover:bg-surface-2'}`}>
                <span className="block text-[15px] font-semibold">{label}</span>
                <span className="block text-[13px] text-text-2">{sub}</span>
              </button>
            ))}
          </div>

          <h2 className="mt-8 text-[17px] font-semibold">The ritual</h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {RITUAL.filter((r) => !r.calibratedOnly || mode === 'calibrated_raw').map((r, i) => (
              <li key={r.text}>
                <button type="button" aria-expanded={why === i} onClick={() => setWhy(why === i ? null : i)} className="flex min-h-12 w-full items-center gap-3 py-2 text-left">
                  <r.icon size={22} aria-hidden className="shrink-0 text-willow-700" />
                  <span className="flex-1 text-[15px]">{r.text}</span>
                  <ChevronRight size={16} aria-hidden className={`text-text-3 transition-transform ${why === i ? 'rotate-90' : ''}`} />
                </button>
                {why === i ? <p className="pb-3 pl-9 text-[13px] leading-relaxed text-text-2">{r.why}</p> : null}
              </li>
            ))}
            {site === 'cheek_macro' || site === 'nose_macro' ? (
              <li className="flex min-h-12 items-center gap-3 py-2">
                <Camera size={22} aria-hidden className="shrink-0 text-willow-700" />
                <span className="text-[15px]">Cone touching the cheek for close-ups.</span>
              </li>
            ) : null}
            <li className="flex min-h-12 items-center gap-3 py-2">
              <Check size={22} aria-hidden className="shrink-0 text-willow-700" />
              <span className="text-[15px]">{baselineNeeded ? 'Baseline: 5 photos. Move the phone away and back between each.' : 'Check-in: 3 photos. Reposition between each.'}</span>
            </li>
          </ul>

          <label className="mt-6 flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-text)]" checked={deviation} onChange={(e) => setDeviation(e.target.checked)} />
            <span>
              <span className="block text-[15px] font-medium">Something is different today</span>
              <span className="block text-[13px] text-text-2">Sick, sunburn, new product, different light. It shows next to this reading, so a change is never misread.</span>
            </span>
          </label>
          {deviation ? <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" className="mt-2 w-full rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-[16px]" /> : null}

          <div className="mt-8 flex flex-wrap gap-3">
            {mode === 'calibrated_raw' ? (
              <Button onClick={() => setStep(prefs.lightroomDone() ? 'ring' : 'lightroom')}>I'm set up</Button>
            ) : (
              <Button onClick={() => navigate(`/capture/camera?site=${site}&n=${expected}`)}>Open camera</Button>
            )}
          </div>
        </>
      ) : null}

      {step === 'lightroom' ? (
        <>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Set up Lightroom once</h1>
          <p className="mt-2 text-[15px] text-text-2">Lock it once. Never change it again. If you do, tell Willow and we start a new baseline.</p>
          <ol className="mt-5 space-y-3 text-[15px]">
            {[
              ['Open the camera in Lightroom Mobile.', 'Camera, then tap “Auto” left of the shutter and choose “Professional”.'],
              ['File format DNG.', 'In the capture settings, pick DNG. This is the RAW file Willow needs.'],
              ['Set and lock.', 'ISO 50 to 200, shutter 1/60 to 1/125, white balance a fixed Kelvin such as 5000 K, manual focus. Tap the lock so it turns yellow.'],
              ['Same lens every time.', '1x for the face and forearm; macro for close-ups.'],
            ].map(([t, s], i) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[12px]">{i + 1}</span>
                <span>
                  <span className="block font-medium">{t}</span>
                  <span className="block text-text-2">{s}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex items-center gap-2 rounded-(--radius-tile) bg-surface-2 p-3 text-[13px] text-text-2">
            <Lock size={16} aria-hidden /> Willow remembers you did this. You will not see it again unless you reset.
          </div>
          <Button className="mt-6" onClick={() => { prefs.setLightroomDone(true); setStep('ring') }}>
            Locked. Next
          </Button>
        </>
      ) : null}

      {step === 'ring' ? (
        <>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Take your {expected} photos</h1>
          <p className="mt-2 text-[15px] text-text-2">Tap after each shot in Lightroom. Between shots: {site.includes('macro') ? 'lift the cone off and put it back on the same spot.' : 'move the phone away, then back to about 35 to 40 cm.'}</p>
          <div className="mt-8">{ring}</div>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button onClick={() => setShots((s) => Math.min(expected, s + 1))} disabled={shots >= expected}>
              Took one
            </Button>
            <Button variant="quiet" onClick={() => setShots((s) => Math.max(0, s - 1))} disabled={shots === 0}>
              Undo
            </Button>
            {shots >= expected ? <Button variant="secondary" onClick={() => setStep('export')}>All {expected} taken</Button> : null}
          </div>
        </>
      ) : null}

      {step === 'export' ? (
        <>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Export to Files</h1>
          <ol className="mt-5 space-y-3 text-[15px]">
            {[
              ['In Lightroom, select the photos.', `All ${expected} from this session.`],
              ['Share, then Export Original.', 'Not “Export to Camera Roll”. Photos hands over a JPEG; the RAW is what makes the measurement comparable.'],
              ['Save to Files.', 'A folder such as Willow / today. iCloud files must finish downloading before they can be chosen.'],
            ].map(([t, s], i) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[12px]">{i + 1}</span>
                <span>
                  <span className="block font-medium">{t}</span>
                  <span className="block text-text-2">{s}</span>
                </span>
              </li>
            ))}
          </ol>
          <Button className="mt-6" onClick={() => setStep('upload')}>
            <FolderOpen size={18} aria-hidden /> Choose the files
          </Button>
        </>
      ) : null}

      {step === 'upload' ? (
        <>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Upload</h1>
          <p className="mt-2 text-[15px] text-text-2">
            Choose {expected} DNG files from the Files app. To pick several: Browse, then the … menu, then Select.
          </p>
          {!user ? (
            <div className="mt-4 rounded-(--radius-tile) bg-surface-2 p-3 text-[13px]">
              Sign in to upload. A guest account is enough.{' '}
              <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => void continueAsGuest()}>
                Continue as guest
              </button>
            </div>
          ) : null}
          {rows.length === 0 ? (
            <label className="mt-5 block">
              <span className="sr-only">Choose files</span>
              <input
                type="file"
                multiple
                accept={mode === 'calibrated_raw' ? '.dng,image/x-adobe-dng,image/dng' : '.jpg,.jpeg,image/jpeg,.heic,image/heic'}
                onChange={(e) => {
                  const v = validateFiles(Array.from(e.target.files ?? []), mode, expected)
                  setErrors(v.errors)
                  setRows(v.rows)
                }}
                className="block w-full text-[15px] file:mr-3 file:min-h-11 file:rounded-(--radius-control) file:border file:border-border file:bg-surface file:px-4 file:text-[15px] file:font-medium"
              />
            </label>
          ) : null}
          {errors.length ? (
            <ul className="mt-3 space-y-1 text-[13px] text-danger">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {rows.length > 0 && user ? (
            <div className="mt-5">
              <UploadList
                site={site}
                mode={mode}
                rows={rows}
                onRows={setRows}
                onDone={(sid) => navigate(`/processing/${sid}?site=${site}&n=${rows.length}${deviation ? `&dev=1&note=${encodeURIComponent(note)}` : ''}`)}
              />
            </div>
          ) : null}
          {rows.length > 0 && rows.length < expected ? <p className="mt-3 text-[13px] text-warn-text">{expected - rows.length} more to go. Choose the rest and they will be added.</p> : null}
        </>
      ) : null}
    </div>
  )
}

/** Judge path: hosted RAW sample sessions, one tap runs the pipeline (live engine from Thursday; until then the sample journey plays). */
function Samples() {
  const navigate = useNavigate()
  const data = useData()
  const packs = [
    { id: 'forearm_treated', title: 'Forearm, treated, +24 h', frames: 3, note: 'self-tanner applied the evening before' },
    { id: 'face_full', title: 'Face, week 6 check-in', frames: 3, note: 'azelaic acid started at week 2' },
  ] as const
  return (
    <div className="mx-auto max-w-[36rem] px-5 pb-16 pt-4 sm:px-8">
      {data.mode === 'demo' ? <div className="-mx-5 mb-4 sm:-mx-8"><DemoBar /></div> : null}
      <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Try with sample photos</h1>
      <p className="mt-2 text-[15px] text-text-2">These RAW sessions are already in Willow's bucket, so nothing to download. One tap runs the pipeline and lands on the real report.</p>
      <ul className="mt-5 space-y-3">
        {packs.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 rounded-(--radius-tile) border border-border bg-surface p-4">
            <span>
              <span className="block text-[15px] font-semibold">{p.title}</span>
              <span className="block text-[13px] text-text-2">{p.frames} RAW frames with colour card · {p.note}</span>
            </span>
            <Button onClick={() => navigate(`/processing/sample?site=${p.id}&n=${p.frames}&sample=1`)}>Run</Button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12px] text-text-3">
        <Chip tone="neutral">until Thursday</Chip> the measurement engine is a placeholder, so this plays the sample journey after the processing stages.
      </p>
      <p className="mt-6 text-[13px] text-text-2">
        Want to see the upload itself?{' '}
        <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => navigate('/capture')}>
          Upload your own RAW files
        </button>
      </p>
    </div>
  )
}
