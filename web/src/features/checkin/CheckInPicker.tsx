import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { SegmentedControl } from '../../components/ui/SegmentedControl'
import type { CaptureMode, Site } from '../../data/types'
import { useData } from '../../data/useData'
import { baselineState } from '../../lib/baselineGuide'
import { fmtDate } from '../../lib/format'
import { prefs } from '../../lib/prefs'
import { placesOf } from '../../lib/profile'
import { minutesFor, type TrackPlace } from '../../lib/track'
import './checkin.css'
import { baselineLine, neededFor, quickChecks, SITE_NAME, SITE_SWATCH, siteForMode, sitesFor, whenCaps } from './model'

/**
 * The "Check in" side sheet (Willow App.dc.html, capOpen). It opens on today's check-in: the places the
 * person tracks (profile.track, chosen in onboarding), about how long it takes, and one "Start check-in"
 * that walks through all of them. "One place, or RAW files" (and any preset place) shows the single-place
 * picker: which place, Camera or RAW upload, three checks. Each row's line comes from the person's own
 * sessions in that mode (baselines are per site and mode). A native <dialog>: focus trap, Esc and the scrim
 * for free.
 */
export default function CheckInPicker({
  open,
  onClose,
  preset,
  onStart,
  onStartAll,
}: {
  open: boolean
  onClose: () => void
  preset?: { site?: Site; mode?: CaptureMode }
  onStart: (site: Site, mode: CaptureMode) => void
  onStartAll: (places: TrackPlace[]) => void
}) {
  const data = useData()
  const navigate = useNavigate()
  const ref = useRef<HTMLDialogElement>(null)
  // A place asked for (Progress "today", a result's "Check in again") opens the single-place picker.
  const [single, setSingle] = useState(Boolean(preset?.site || preset?.mode))
  const places = placesOf(data.profile)
  const [mode, setModeOnly] = useState<CaptureMode>(preset?.mode ?? 'uncalibrated')
  const [site, setSite] = useState<Site>(siteForMode(preset?.site ?? 'face_full', preset?.mode ?? 'uncalibrated'))
  // RAW is for close-ups of one place and the forearms: switching mode keeps the place if that mode has it.
  const setMode = (m: CaptureMode) => {
    setModeOnly(m)
    setSite((s) => siteForMode(s, m))
  }

  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      d.showModal()
    }
    if (!open && d.open) d.close()
  }, [open])
  // The shell unmounts the picker on close, which drops focus to <body>: hand it back to the + / Check in button.
  useEffect(
    () => () => {
      const o = opener.current
      requestAnimationFrame(() => {
        const a = document.activeElement
        if (o?.isConnected && (!a || a === document.body)) o.focus({ preventScroll: true })
      })
    },
    [],
  )

  const live = data.mode === 'live'
  const known = live && data.status !== 'loading'
  const sessionsOf = (s: Site) => data.series(s)?.sessions ?? []
  const n = known ? neededFor(sessionsOf(site), mode) : null
  const first = known && baselineState(sessionsOf(site), mode).state === 'none'
  const raw = mode === 'calibrated_raw'
  const last = live ? data.all[data.all.length - 1] : undefined

  const note = raw
    ? `${n ?? 'The'} DNG files from Lightroom${site.startsWith('forearm') ? ', with pen dots and white paper' : ', phone about 10 cm away'}. RAW is for close-ups and the forearms; take your whole face with the camera.`
    : first
      ? `${n ?? 5} photos with this device’s camera. They become your camera baseline.`
      : `${n ?? 3} photos with this device’s camera, compared with your camera baseline.`
  // The flow opens on the guide for a first session (or RAW before the one-time setup), else straight in.
  // Same rule as the flow (computedN === 5): a thin baseline (no normal range) also opens the guide.
  const cta = first || n === 5 ? 'Prepare your baseline' : raw ? (prefs.lightroomDone() ? 'Choose RAW files' : 'Set up RAW') : 'Open camera'
  const checks = quickChecks(site)

  return (
    <dialog
      ref={ref}
      aria-labelledby="cap-h"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className="squircle mt-3 mr-3 mb-3 ml-auto h-[calc(100dvh-24px)] max-h-none w-[min(400px,calc(100vw-24px))] max-w-none animate-[wCapIn_.45s_var(--ease-standard)_both] overflow-hidden rounded-lg bg-surface p-0 text-ink shadow-[0_40px_90px_-30px_rgba(0,0,0,.45)] backdrop:bg-[rgba(18,18,18,.26)] backdrop:backdrop-blur-[4px]"
    >
      {open ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-2">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10.5px] tracking-[.08em] text-ink-2">■ {whenCaps()}</span>
              <h2 id="cap-h" className="m-0 text-[22px] font-normal tracking-[-0.01em]">
                Check in
              </h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-11 place-items-center rounded-full bg-sunken text-ink transition-[scale] active:scale-95">
              <X size={16} strokeWidth={1.8} aria-hidden />
            </button>
          </div>

          {!single ? (
            <Today
              live={live}
              known={known}
              places={places}
              line={(p) => baselineLine(sessionsOf(p), 'uncalibrated').text}
              onStart={() => onStartAll(places)}
              onChange={() => {
                onClose()
                navigate('/you#places')
              }}
              onSingle={() => setSingle(true)}
            />
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 pt-2 pb-4">
                {!live ? (
                  <p className="m-0 rounded-[18px] bg-sunken px-3.5 py-3 text-[13px] leading-[1.45] text-ink-2">You’re looking at the sample journey. Checking in switches to your own account and your own photos.</p>
                ) : null}
                <div role="radiogroup" aria-label="What are you photographing" className="flex flex-col gap-1.5">
                  {sitesFor(mode).map((s) => {
                    const on = s === site
                    const meta = !live ? null : !known ? 'Checking…' : baselineLine(sessionsOf(s), mode).text
                    return (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setSite(s)}
                        className={`flex min-h-14 w-full items-center gap-3 rounded-[20px] py-2 pr-3 pl-2 text-left transition-[background,box-shadow] duration-200 ${on ? 'bg-white shadow-[0_0_0_1.5px_var(--text-primary),0_10px_24px_-16px_rgba(0,0,0,.3)]' : 'hover:bg-ink/[.03]'}`}
                      >
                        <span aria-hidden className="size-10 flex-none rounded-[14px] shadow-[inset_0_0_12px_rgba(255,255,255,.5)]" style={{ background: SITE_SWATCH[s] }} />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-[15px]">{SITE_NAME[s]}</span>
                          {meta ? <span className="text-[12px] text-ink-2">{meta}</span> : null}
                        </span>
                        <span aria-hidden className={`grid size-5 flex-none place-items-center rounded-full text-[11px] text-inverse ${on ? 'bg-selected' : 'border-[1.5px] border-ink/20'}`}>
                          {on ? '✓' : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="flex flex-col gap-2">
                  <SegmentedControl
                    label="How"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'uncalibrated', label: 'Camera' },
                      { value: 'calibrated_raw', label: 'RAW upload' },
                    ]}
                  />
                  <span className="px-1 text-[13px] leading-[1.45] text-[#3E3C38]">{note}</span>
                </div>

                <details className="ck-details rounded-[18px] bg-sunken px-3.5">
                  <summary className="flex min-h-11 cursor-pointer items-center text-[14px]">Before you start · {checks.length} checks</summary>
                  <ol className="m-0 mb-3 flex flex-col gap-1.5 pl-[18px] text-[13px] leading-[1.45] text-[#3E3C38]">
                    {checks.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ol>
                </details>
              </div>

              <div className="flex flex-col gap-2 border-t border-ink/[.06] px-5 pt-3.5 pb-5">
                <button type="button" onClick={() => onStart(site, mode)} className="flex min-h-[50px] items-center justify-center gap-2.5 rounded-pill bg-selected text-[15px] text-inverse transition-[background] hover:bg-[#2a2a2a]">
                  {cta} <span aria-hidden>→</span>
                </button>
                <span className="text-center text-[12px] text-ink-2">
                  {!live ? ' ' : !known ? 'Checking your check-ins…' : last ? `Last capture ${fmtDate(last.created_at)} · ${SITE_NAME[last.site]} · ${last.capture_mode === 'calibrated_raw' ? 'RAW' : 'Camera'}` : 'No check-ins yet'}
                </span>
              </div>
            </>
          )}
        </div>
      ) : null}
    </dialog>
  )
}

/**
 * Today's check-in: every tracked place in capture order, each with its baseline line, then one button.
 * Close-ups use the back camera, the face the front one; the flow says which before each place.
 */
function Today({ live, known, places, line, onStart, onChange, onSingle }: { live: boolean; known: boolean; places: TrackPlace[]; line: (p: TrackPlace) => string; onStart: () => void; onChange: () => void; onSingle: () => void }) {
  const min = minutesFor(places)
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 pt-2 pb-4">
        {!live ? (
          <p className="m-0 rounded-[18px] bg-sunken px-3.5 py-3 text-[13px] leading-[1.45] text-ink-2">You’re looking at the sample journey. Checking in switches to your own account and your own photos.</p>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="text-[15px]">
            {places.length === 1 ? 'One place' : `${places.length} places`} · about {min} min
          </span>
          <span className="text-[13px] leading-[1.45] text-ink-2">The camera guides you through each place in turn. When the last photo is in, you can close the app: your report is ready a few minutes later.</span>
        </div>
        <ol aria-label="Places in this check-in" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {places.map((p, i) => (
            <li key={p} className="flex min-h-14 items-center gap-3 rounded-[20px] bg-white py-2 pr-3 pl-2 shadow-[0_10px_24px_-18px_rgba(0,0,0,.3)]">
              <span aria-hidden className="relative size-10 flex-none rounded-[14px] shadow-[inset_0_0_12px_rgba(255,255,255,.5)]" style={{ background: SITE_SWATCH[p] }}>
                <span className="absolute -top-1 -left-1 grid size-5 place-items-center rounded-full bg-selected font-dot text-[9.5px] text-inverse">{i + 1}</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px]">{SITE_NAME[p]}</span>
                <span className="text-[12px] text-ink-2">{!live ? (p === 'face_full' ? 'Front camera' : 'Back camera') : !known ? 'Checking…' : `${p === 'face_full' ? 'Front camera' : 'Back camera'} · ${line(p)}`}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px]">
          <button type="button" onClick={onChange} className="min-h-11 text-ink underline decoration-ink/30 underline-offset-4">
            Change places
          </button>
          <button type="button" onClick={onSingle} className="min-h-11 text-ink underline decoration-ink/30 underline-offset-4">
            One place, or RAW files
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-ink/[.06] px-5 pt-3.5 pb-5">
        <button type="button" onClick={onStart} className="flex min-h-[50px] items-center justify-center gap-2.5 rounded-pill bg-selected text-[15px] text-inverse transition-[background] hover:bg-[#2a2a2a]">
          Start check-in <span aria-hidden>→</span>
        </button>
      </div>
    </>
  )
}
