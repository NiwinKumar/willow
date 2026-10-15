import { forwardRef, useMemo, useState } from 'react'

import type { Session } from '../../data/types'
import { fmtDate } from '../../lib/format'
import { MOLE_NOTE } from '../../lib/spotLabels'
import { leftOutPhotos, readableWarnings } from '../../lib/warnings'
import { MODE_LABEL, photoExpired, siteHasSpots } from './model'
import { frameFor, photoSize, toPct } from './frame'
import { PhotoFrame } from './PhotoFrame'
import { spotItems, spotLabelLine, spotShort, type SpotItem } from './spots'

/** A spot diary sighting shown on this photo: its box in this photo's pixels. */
export type DiaryFocus = { bbox: [number, number, number, number] | null; tag: string; area: string; status: string; backLabel: string; onBack: () => void }

const LIST_LIMIT = 8

/**
 * The reference photo with the engine's spot candidates as numbered rings (Spots / None), the "Detected
 * spots" panel, the mole note and the photo-quality card. No redness overlay: the engine draws none.
 */
export const PhotoPanel = forwardRef<HTMLElement, { session: Session; focus: DiaryFocus | null }>(function PhotoPanel({ session, focus }, ref) {
  const [overlay, setOverlay] = useState<'spots' | 'none'>('spots')
  const [showHidden, setShowHidden] = useState(false)
  const [picked, setPicked] = useState<{ sid: string; n: number } | null>(null)
  const [all, setAll] = useState(false)
  const items = useMemo(() => spotItems(session), [session])
  const box = useMemo(() => frameFor(session.site, session.result, photoSize(session)), [session])
  const visible = items.filter((it) => showHidden || !it.hidden)
  const skin = items.filter((it) => !it.hidden)
  const labelsMissing = items.length > 0 && !Object.keys(session.label_details ?? {}).length
  const selN = picked?.sid === session.id ? picked.n : (visible[0]?.n ?? null)
  const sel = visible.find((it) => it.n === selN) ?? null
  const spotsHere = siteHasSpots(session.site)
  const expired = !session.preview && photoExpired(session)
  const missing = expired ? 'Photos are deleted 30 days after upload. The measurements stay.' : 'No photo preview for this check-in. The numbers are measured from your photos.'
  const caption = `${session.capture_mode === 'uncalibrated' ? 'QUICK PHOTO' : 'MEASURED REFERENCE PHOTO'} · ${fmtDate(session.created_at).toUpperCase()}${session.capture_mode === 'uncalibrated' ? ' · UNCALIBRATED' : ''}`
  const focusPos = focus?.bbox ? toPct(box, focus.bbox[0] + focus.bbox[2] / 2, focus.bbox[1] + focus.bbox[3] / 2) : null
  const focusSize = focus?.bbox ? Math.min(64, Math.max(28, (Math.max(focus.bbox[2], focus.bbox[3]) / box.w) * 420 + 14)) : 0

  const ring = (it: SpotItem) => {
    const [x, y, w, h] = it.c.bbox
    const p = toPct(box, x + w / 2, y + h / 2)
    if (p.left < 0 || p.left > 100 || p.top < 0 || p.top > 100) return null
    const on = it.n === selN
    return (
      <button
        key={it.n}
        type="button"
        onClick={() => setPicked({ sid: session.id, n: it.n })}
        aria-label={`Spot ${it.n}: ${it.kind}`}
        aria-pressed={on}
        className="group absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center"
        style={{ left: `${p.left}%`, top: `${p.top}%`, zIndex: on ? 3 : 1 }}
      >
        <span
          className={`grid size-[26px] place-items-center rounded-full border-2 bg-white/30 text-[12px] font-semibold text-ink backdrop-blur-[2px] transition-transform duration-200 group-hover:scale-115 ${on ? 'animate-[wPulse_1.6s_ease-out_infinite]' : ''}`}
          style={{ borderColor: it.ring }}
        >
          {it.n}
        </span>
      </button>
    )
  }

  return (
    <div className={`grid items-start gap-4 pt-6 ${spotsHere ? 'grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]' : ''}`}>
      <section ref={ref} aria-label="Reference photo" className="flex scroll-mt-24 flex-col gap-3 rounded-[44px] bg-surface p-3.5 shadow-[0_30px_70px_-50px_rgba(0,0,0,.35)] squircle">
        <div className="relative">
          <PhotoFrame session={session} box={box} alt={`Your ${MODE_LABEL[session.capture_mode]} photo from ${fmtDate(session.created_at, { day: 'numeric', month: 'long' })}`} missing={missing}>
            {overlay === 'spots' ? visible.map(ring) : null}
            {focus && focusPos ? (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 animate-[wDotIn_.45s_cubic-bezier(.2,.8,.2,1)_both,wRingPulse_1.8s_.5s_ease-out_infinite] rounded-full border-[2.5px] border-ink outline-[3px] outline-white/85 outline-solid"
                  style={{ left: `${focusPos.left}%`, top: `${focusPos.top}%`, width: focusSize, height: focusSize, zIndex: 4 }}
                />
                <span className="pointer-events-none absolute -translate-x-1/2 animate-[wRise_.4s_.1s_both] rounded-pill bg-selected px-3 py-[7px] text-[12px] whitespace-nowrap text-inverse" style={{ left: `${focusPos.left}%`, top: `calc(${focusPos.top}% + ${focusSize / 2 + 8}px)`, zIndex: 4 }}>
                  {focus.tag}
                </span>
              </>
            ) : null}
          </PhotoFrame>
          <span className="pointer-events-none absolute top-[18px] left-[18px] rounded-pill bg-white/70 px-2 py-0.5 font-mono text-[11px] tracking-[.06em] text-ink-2">{caption}</span>
          {focus ? (
            <div className="absolute inset-x-3.5 top-11 z-[5] flex animate-[wRise_.35s_both] items-center gap-3 rounded-[22px] bg-surface/90 py-2.5 pr-2.5 pl-4 backdrop-blur-[14px]">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px]">{focus.area}</span>
                <span className="text-[13px] text-ink-2">{focus.bbox ? focus.status : 'Not seen on this photo'}</span>
              </span>
              <button type="button" onClick={focus.onBack} className="min-h-11 shrink-0 rounded-pill bg-selected px-3.5 text-[13px] text-inverse">
                Back to {focus.backLabel}
              </button>
            </div>
          ) : null}
          {session.preview && items.length ? (
            <div role="radiogroup" aria-label="Show on the photo" className="absolute bottom-4 left-1/2 z-[5] flex -translate-x-1/2 gap-[3px] rounded-pill bg-white/75 p-1 backdrop-blur-[16px]">
              {(['spots', 'none'] as const).map((o) => (
                <button key={o} type="button" role="radio" aria-checked={overlay === o} onClick={() => setOverlay(o)} className={`min-h-10 rounded-pill px-3.5 text-[13px] transition-colors ${overlay === o ? 'bg-selected text-inverse' : 'text-ink'}`}>
                  {o === 'spots' ? 'Spots' : 'None'}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section aria-label={spotsHere ? 'Detected spots' : 'Photo quality'} className="flex flex-col gap-3">
        {spotsHere ? (
          <div className="flex flex-col gap-3.5 rounded-[36px] bg-selected p-[clamp(20px,3vw,28px)] text-inverse squircle">
            <div className="flex flex-wrap items-baseline justify-between gap-2.5">
              <h3 className="m-0 text-[24px] font-normal">Detected spots</h3>
              <span className="font-dot text-[30px] font-extrabold text-lime" aria-label={`${skin.length} skin ${skin.length === 1 ? 'finding' : 'findings'}`}>
                {String(skin.length).padStart(2, '0')}
              </span>
            </div>
            <p className="m-0 text-[14px] leading-[1.45] text-white/75">
              {!items.length
                ? 'No spots were found on this photo.'
                : labelsMissing
                  ? 'Found by image measurement. AI labels weren’t available for this check-in, so candidates are shown without appearance labels.'
                  : 'Found by image measurement. Labels are AI suggestions about appearance, not diagnoses.'}
            </p>
            {sel ? (
              <div key={sel.n} className="flex animate-[wRise_.35s_both] items-center gap-3.5 rounded-[24px] bg-white/8 p-3.5">
                <span aria-hidden className="size-[76px] shrink-0 rounded-full border-2 shadow-[0_0_0_5px_rgba(255,255,255,.06)]" style={{ borderColor: sel.ring, background: 'radial-gradient(circle at 50% 50%, #6E4636 0%, #8A5D48 40%, #3A2A24 80%)' }} />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-[17px]">
                    {sel.n} · {sel.kind}
                  </span>
                  <span className="text-[13px] text-white/85">{spotLabelLine(sel, labelsMissing)}</span>
                  {sel.agree ? (
                    <span className="flex items-center gap-1.5 text-[12px] text-white/70">
                      <span aria-hidden className="flex gap-[3px]">
                        {Array.from({ length: sel.agree.of }, (_, i) => (
                          <span key={i} className={`size-2 rounded-full ${i < sel.agree!.seen ? 'bg-lime' : 'bg-white/20'}`} />
                        ))}
                      </span>
                      Seen in {sel.agree.seen} of {sel.agree.of} photos
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
            {visible.length ? (
              <div className="flex flex-col gap-1">
                {(all ? visible : visible.slice(0, LIST_LIMIT)).map((it) => (
                  <button
                    key={it.n}
                    type="button"
                    aria-pressed={it.n === selN}
                    onClick={() => setPicked({ sid: session.id, n: it.n })}
                    className={`flex min-h-11 w-full items-center gap-3.5 rounded-[18px] px-3 py-2.5 text-left transition-colors ${it.n === selN ? 'bg-white/14' : 'hover:bg-white/6'}`}
                  >
                    <span className="grid size-[30px] shrink-0 place-items-center rounded-full border-2 text-[12px]" style={{ borderColor: it.ring }}>
                      {it.n}
                    </span>
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-[15px]">{it.kind}</span>
                      <span className="text-[12px] text-white/70">{spotShort(it, labelsMissing)}</span>
                    </span>
                  </button>
                ))}
                {visible.length > LIST_LIMIT ? (
                  <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className="min-h-11 self-start rounded-pill bg-white/10 px-4 text-[13px]">
                    {all ? 'Show fewer' : `Show all ${visible.length}`}
                  </button>
                ) : null}
              </div>
            ) : null}
            {items.some((it) => it.hidden) ? (
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-2.5 rounded-[18px] bg-white/6 px-3 py-2.5 text-[14px]">
                Show hair and artefacts
                <input type="checkbox" role="switch" checked={showHidden} onChange={() => setShowHidden((v) => !v)} className="size-[22px] accent-[var(--signal-baseline)]" />
              </label>
            ) : null}
          </div>
        ) : null}
        {spotsHere ? <div className="rounded-[28px] bg-surface px-[22px] py-[18px] text-[14px] leading-normal text-ink-2 squircle">Moles are not assessed. {MOLE_NOTE}</div> : null}
        <QualityCard session={session} />
      </section>
    </div>
  )
})

/** Which photos were used, or the engine's notes in plain words (design "quality" card). */
function QualityCard({ session }: { session: Session }) {
  const r = session.result
  if (!r) return null
  const left = leftOutPhotos(r)
  const notes = readableWarnings(r)
  const all = r.quality.passed && r.frames_used === session.n_frames
  const title = left ? (r.frames_used === 1 ? `Only 1 of ${session.n_frames} photos was used` : `${r.frames_used} of ${session.n_frames} photos were used`) : all ? (session.n_frames === 1 ? 'Your photo was usable' : `All ${session.n_frames} photos usable`) : 'Photo quality'
  const tone = left ? 'bg-[var(--action-primary)]' : session.is_baseline && all ? 'bg-lime' : 'bg-surface'
  return (
    <div className={`flex flex-col gap-1.5 rounded-[28px] px-[22px] py-[18px] squircle ${tone}`}>
      <span className="text-[15px]">{title}</span>
      {left ? <span className="text-[14px] leading-[1.45]">{left}</span> : null}
      {notes.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] leading-[1.45]">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : !left ? (
        <span className="text-[14px] leading-[1.45]">No quality issues recorded for this check-in.</span>
      ) : null}
    </div>
  )
}
