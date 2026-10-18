import { useState } from 'react'

import type { Session } from '../../data/types'
import { SITE_LABEL, qualityCopy } from '../../lib/metrics'
import { REASON_SHORT } from './model'

/** A saved photo as a tile background (signed per frame by GET /v1/sessions/{id}); nothing for RAW, missing or unreadable files. */
export function FrameThumb({ url, alt }: { url: string | null | undefined; alt: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!url || failed === url) return null
  return <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(url)} className="absolute inset-0 size-full object-cover" />
}

const PEN_DOTS_FIX = 'Mark the corners of a 4 cm square on the forearm, keep all four dots in the frame, and put white paper beside the arm.'

/** One card per photo that did not pass, with the reason and the fix; the photo itself when the api signed it. */
export function RejectedPhotos({ session, frameUrls }: { session: Session; frameUrls?: (string | null)[] }) {
  const frames = session.result?.quality.per_frame?.length ? session.result.quality.per_frame : [{ index: 0, passed: false, reasons: session.result?.quality.reasons ?? [] }]
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3.5">
      {frames
        .filter((f) => !f.passed)
        .map((f) => {
          // Missing pen dots come as a warning ("photo 2: pen-dot square not found"), not a frame reason.
          const dots = !f.reasons.length && (session.result?.warnings ?? []).some((w) => new RegExp(`^photo ${f.index + 1}: pen-dot square not found`, 'i').test(w))
          const copy = f.reasons.map((r) => qualityCopy(r, session.site)).filter(Boolean)
          return (
            <div key={f.index} className="flex flex-col gap-3 rounded-[36px] bg-surface p-3.5 squircle">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[26px]" style={{ background: 'repeating-linear-gradient(135deg, #E2DFD9 0 8px, #ECEAE5 8px 16px)' }}>
                <FrameThumb url={frameUrls?.[f.index]} alt={`Photo ${f.index + 1}, not used: ${f.reasons.length ? f.reasons.map((r) => REASON_SHORT[r] ?? r).join(', ').toLowerCase() : dots ? 'pen dots not found' : 'did not pass the quality check'}`} />
                <span className="absolute top-3.5 left-3.5 rounded-pill bg-white/80 px-2 py-0.5 font-mono text-[11px] text-ink-2">PHOTO {f.index + 1}</span>
                <span aria-hidden className="absolute top-3.5 right-3.5 grid size-[34px] place-items-center rounded-full bg-[var(--aura-coral)] text-white">
                  !
                </span>
              </div>
              <span className="px-1.5 text-[17px]">{f.reasons.length ? f.reasons.map((r) => REASON_SHORT[r] ?? r).join(' · ') : dots ? 'Pen dots not found' : 'Did not pass the quality check'}</span>
              <span className="px-1.5 pb-1.5 text-[14px] leading-[1.45] text-ink-2">{copy.map((x) => x!.text).join(' ') || (dots ? PEN_DOTS_FIX : 'Retake in the same light and position.')}</span>
            </div>
          )
        })}
    </div>
  )
}

/** A check-in saved but not measured: its photos, each marked saved. */
export function UnmeasuredPhotos({ session, frameUrls }: { session: Session; frameUrls?: (string | null)[] }) {
  const site = session.site
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3.5">
      {Array.from({ length: session.n_frames }, (_, i) => (
        <div key={i} className="relative flex aspect-square flex-col justify-between overflow-hidden rounded-[36px] p-[18px] squircle" style={{ background: 'repeating-linear-gradient(135deg, #E2DFD9 0 8px, #ECEAE5 8px 16px)' }}>
          <FrameThumb url={frameUrls?.[i]} alt={`${SITE_LABEL[site]}, photo ${i + 1} (saved, not measured)`} />
          <span className="relative self-start rounded-pill bg-white/80 px-2 py-0.5 font-mono text-[11px] text-ink-2 uppercase">
            {SITE_LABEL[site]} · photo {i + 1}
          </span>
          <span className="relative self-start rounded-pill bg-white px-3 py-2 text-[13px]">✓ Saved · — not measured</span>
        </div>
      ))}
    </div>
  )
}
