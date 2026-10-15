import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { SegmentedControl } from '../../components/ui/SegmentedControl'
import type { CaptureMode, Site } from '../../data/types'
import { useData } from '../../data/useData'
import { baselineState } from '../../lib/baselineGuide'
import { fmtDate } from '../../lib/format'
import { prefs } from '../../lib/prefs'
import './checkin.css'
import { baselineLine, neededFor, quickChecks, SITE_NAME, SITE_SWATCH, SITES, whenCaps } from './model'

/**
 * The "Check in" side sheet (Willow App.dc.html, capOpen): which place, Camera or RAW upload, three
 * checks, then the flow. Each row's line comes from the person's own sessions in the chosen mode
 * (baselines are per site and mode). A native <dialog>: focus trap, Esc and the scrim for free.
 */
export default function CheckInPicker({ open, onClose, preset, onStart }: { open: boolean; onClose: () => void; preset?: { site?: Site; mode?: CaptureMode }; onStart: (site: Site, mode: CaptureMode) => void }) {
  const data = useData()
  const ref = useRef<HTMLDialogElement>(null)
  const [site, setSite] = useState<Site>(preset?.site ?? 'face_full')
  const [mode, setMode] = useState<CaptureMode>(preset?.mode ?? 'uncalibrated')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const live = data.mode === 'live'
  const known = live && data.status !== 'loading'
  const sessionsOf = (s: Site) => data.series(s)?.sessions ?? []
  const n = known ? neededFor(sessionsOf(site), mode) : null
  const first = known && baselineState(sessionsOf(site), mode).state === 'none'
  const raw = mode === 'calibrated_raw'
  const last = live ? data.all[data.all.length - 1] : undefined

  const note = raw
    ? `${n ?? 'The'} DNG files from Lightroom${site.startsWith('forearm') ? ', with pen dots and white paper' : site === 'face_full' ? ', with a colour card' : ''}. RAW keeps its own baseline, apart from quick photos.`
    : first
      ? `${n ?? 5} photos with this device’s camera. They become your quick-photo baseline.`
      : `${n ?? 3} photos with this device’s camera, compared with your quick-photo baseline.`
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

          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 pt-2 pb-4">
            {!live ? (
              <p className="m-0 rounded-[18px] bg-sunken px-3.5 py-3 text-[13px] leading-[1.45] text-ink-2">You’re looking at the sample journey. Checking in switches to your own account and your own photos.</p>
            ) : null}
            <div role="radiogroup" aria-label="What are you photographing" className="flex flex-col gap-1.5">
              {SITES.map((s) => {
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
              {!live ? ' ' : !known ? 'Checking your check-ins…' : last ? `Last capture ${fmtDate(last.created_at)} · ${SITE_NAME[last.site]} · ${last.capture_mode === 'calibrated_raw' ? 'RAW' : 'Quick'}` : 'No check-ins yet'}
            </span>
          </div>
        </div>
      ) : null}
    </dialog>
  )
}
