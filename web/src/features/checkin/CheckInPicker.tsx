import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import type { Site } from '../../data/types'
import { useData } from '../../data/useData'
import { placesOf } from '../../lib/profile'
import { minutesFor, type TrackPlace } from '../../lib/track'
import './checkin.css'
import { baselineLine, SITE_NAME, SITE_SWATCH, whenCaps } from './model'

/**
 * The "Check in" side sheet (Willow App.dc.html, capOpen): the one way to check in. It lists today's
 * check-in, every place the person tracks (profile.track, chosen in onboarding or You), about how long it
 * takes, and one "Start check-in" that walks through all of them (RAW files can be uploaded at any place
 * from its camera step). It never asks for places: with none saved it uses the default ones (lib/track), and
 * places are changed in You.
 * A native <dialog>: focus trap, Esc and the scrim for free.
 */
export default function CheckInPicker({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (places: TrackPlace[], upload: boolean) => void }) {
  const data = useData()
  const navigate = useNavigate()
  const ref = useRef<HTMLDialogElement>(null)
  const places = placesOf(data.profile)
  const live = data.mode === 'live'
  const known = live && data.status !== 'loading'
  const sessionsOf = (s: Site) => data.series(s)?.sessions ?? []

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

          <Today
            live={live}
            known={known}
            places={places}
            line={(p) => baselineLine(sessionsOf(p), 'uncalibrated').text}
            onStart={() => onStart(places, false)}
            onUpload={() => onStart(places, true)}
            onChange={() => {
              onClose()
              navigate('/you#places')
            }}
          />
        </div>
      ) : null}
    </dialog>
  )
}

/**
 * Today's check-in: every tracked place in capture order, each with its baseline line, then one button.
 * Close-ups use the back camera, the face the front one; the flow says which before each place.
 */
function Today({ live, known, places, line, onStart, onUpload, onChange }: { live: boolean; known: boolean; places: TrackPlace[]; line: (p: TrackPlace) => string; onStart: () => void; onUpload: () => void; onChange: () => void }) {
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
          <span className="text-[13px] leading-[1.45] text-ink-2">Willow guides you through each place in turn. When the last photo is in, you can close the app: your report is ready a few minutes later.</span>
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
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-ink/[.06] px-5 pt-3.5 pb-5">
        <button type="button" onClick={onStart} className="flex min-h-[50px] items-center justify-center gap-2.5 rounded-pill bg-selected text-[15px] text-inverse transition-[background] hover:bg-[#2a2a2a]">
          Start check-in <span aria-hidden>→</span>
        </button>
        <button type="button" onClick={onUpload} className="min-h-11 text-[14px] text-ink underline decoration-ink/30 underline-offset-4">
          Upload photos instead
        </button>
        <span className="text-center text-[12px] leading-[1.4] text-ink-2">Photos from your library or files, place by place. RAW (DNG) works too; higher quality photos can give steadier readings.</span>
      </div>
    </>
  )
}

/** First open for someone who never chose places: the onboarding cards, then today's check-in. */
