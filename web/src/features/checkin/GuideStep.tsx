import { useState } from 'react'

import { Toggle } from '../../components/ui/Toggle'
import type { CaptureMode, Session, Site } from '../../data/types'
import { fmtDate } from '../../lib/format'
import { prefs } from '../../lib/prefs'
import { canAddCheeks, checklist, hasCheeks, GUIDE_BG, kindOf, lightroomSteps, pad2, POSE_NAME, shotPoses, SITE_NAME } from './model'

const NOTE_CHIPS = ['New lamp', 'After a workout', 'Skipped products today']

/**
 * Step "guide" (CAP 05): what the photos are for (first session: why 5 and the noise band), the
 * one-time Lightroom setup for RAW, the per-site checklist, "Anything different today?", then camera
 * or files. Ticks only help the person; nothing here is saved except the note and the setup flag.
 */
export function GuideStep(props: {
  site: Site
  mode: CaptureMode
  n: number
  baseline: Session | null
  thin: boolean
  /** Face check-ins of 3+ photos: the last two show the left and the right cheek. */
  cheeks: boolean
  onCheeks: (v: boolean) => void
  goals: string[]
  note: string
  deviation: boolean
  onNote: (v: string) => void
  onDeviation: (v: boolean) => void
  onCamera: () => void
  onFiles: () => void
  onSite: (s: Site) => void
  onChangePlace: () => void
}) {
  const { site, mode, n, baseline, thin, cheeks, goals, note, deviation } = props
  const poses = shotPoses(site, n, cheeks)
  const total = poses.length
  const sides = total > n || poses.some((p) => p !== 'front')
  // A baseline taken the other way: the counts compare with the check-ins taken this way instead.
  const otherWay = Boolean(baseline && hasCheeks(baseline) !== cheeks)
  const raw = mode === 'calibrated_raw'
  const kind = kindOf(site)
  const first = n === 5
  // Truly new here (not restarting a baseline): nothing earlier to match, so no "as last time" and no
  // "Anything different today?" (different from what?). Both come back from the next session.
  const firstTime = first && !baseline
  const items = checklist(site, mode, firstTime)
  const [ticks, setTicks] = useState<boolean[]>(() => items.map(() => false))
  const [rawOpen, setRawOpen] = useState(!prefs.lightroomDone())
  const [rawDone, setRawDone] = useState(prefs.lightroomDone)
  const on = ticks.filter(Boolean).length
  const name = SITE_NAME[site]

  // First sessions: just how to take the photos, in plain words (why 5 photos is explained elsewhere).
  const again = kind === 'arm' ? 'point it at the four dots again' : kind === 'close' ? 'bring it back a hand’s width from your face' : 'line your face up in the oval again'
  const howTo = `Take one photo at a time. After each one, lower the phone, then ${again}. Same spot, same light.`
  const body = first
    ? thin && baseline
      ? `Your last baseline had too few clear photos, so let’s take ${n} new ones. ${howTo}`
      : howTo
    : baseline
      ? `Your baseline for ${name.toLowerCase()} is from ${fmtDate(baseline.created_at)}. Matching its light, pose and distance keeps today’s reading comparable.${kind === 'arm' ? ' Check in the other arm right after this one.' : ''}`
      : `Your earlier photos for ${name.toLowerCase()} are saved. Matching their light, pose and distance keeps today’s reading comparable.`

  return (
    <div className="relative mx-auto grid max-w-[1180px] animate-rise grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-4 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <section
        aria-labelledby="ck-title"
        className="relative flex min-h-[540px] flex-col justify-between gap-6 overflow-hidden rounded-xl p-[clamp(24px,4vw,40px)] text-inverse squircle"
        style={{ background: GUIDE_BG[kind], boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08), inset 0 -30px 60px rgba(255,255,255,.12), 0 40px 80px -40px rgba(60,20,90,.6)' }}
      >
        <div>
          <span className="font-mono text-[12px] tracking-[.08em] opacity-90">
            ■ {name.toUpperCase()} · {first ? (thin && baseline ? 'NEW BASELINE' : 'FIRST SESSION') : 'LATER SESSION'}
          </span>
          <h1 id="ck-title" tabIndex={-1} className="mt-[18px] mb-0 text-[clamp(30px,3.4vw,44px)] leading-[1.05] font-light tracking-[-0.02em] outline-none">
            {sides ? `${total} photos: ${total - 2} facing the camera, then each cheek.` : first ? `${n} photos today, then 3 each time after.` : `${n} photos, the same way as your baseline.`}
          </h1>
        </div>
        <div className="flex items-start justify-center gap-[clamp(8px,2vw,18px)]" role="img" aria-label={sides ? `${total} photos: ${total - 2} facing the camera, then the left and the right cheek` : `${n} photos`}>
          {poses.map((pose, i) => (
            <span key={i} className="flex flex-col items-center gap-2.5">
              <span
                className={`h-[clamp(52px,8vw,80px)] rounded-full border-[1.5px] border-dashed border-white/65 transition-[width] duration-300 ${pose === 'front' ? 'w-[clamp(40px,6vw,62px)]' : 'w-[clamp(30px,4.5vw,46px)]'}`}
                style={{ background: `radial-gradient(circle at ${pose === 'left' ? 35 : pose === 'right' ? 65 : 50}% 40%, rgba(255,255,255,.25), transparent 70%)`, rotate: `${(i - (total - 1) / 2) * 6}deg`, animation: `wBreathe 4s ease-in-out ${-i * 0.6}s infinite` }}
              />
              <span className="font-dot text-[20px]">{pad2(i + 1)}</span>
              {pose !== 'front' ? <span className="-mt-1.5 font-mono text-[10px] tracking-[.08em] opacity-85">{pose === 'left' ? 'LEFT' : 'RIGHT'}</span> : null}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="m-0 text-[16px] leading-[1.55]">{body}</p>
          <button type="button" onClick={props.onChangePlace} className="min-h-11 self-start text-[14px] underline underline-offset-4 opacity-90">
            Change place
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3.5">
        {site === 'face_full' && goals.includes('pores_texture') ? (
          <p className="m-0 rounded-[24px] bg-surface/80 px-5 py-4 text-[14px] leading-[1.45] text-[#3E3C38]">
            Tracking texture and pores? They are measured on the cheek close-up (pores on the nose close-up too), not the full face.{' '}
            <button type="button" onClick={() => props.onSite('cheek_macro')} className="min-h-11 font-medium text-ink underline underline-offset-4">
              Photograph a cheek close-up
            </button>
          </p>
        ) : null}

        {/* RAW: the one-time Lightroom setup comes first, before the shot checklist. */}
        {raw ? (
          <div className="rounded-[36px] bg-selected p-[clamp(20px,3vw,30px)] text-inverse squircle">
            <button type="button" onClick={() => setRawOpen(!rawOpen)} aria-expanded={rawOpen} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
              <span className="flex flex-col gap-1">
                <span className="text-[20px]">RAW setup in Lightroom</span>
                <span className="text-[14px]" style={{ color: rawDone ? 'var(--signal-baseline)' : 'var(--aura-apricot)' }}>
                  {rawDone ? '✓ Setup recorded on this phone' : 'Not recorded · about 3 minutes, once'}
                </span>
              </span>
              <span aria-hidden className="text-[22px] transition-[rotate] duration-300" style={{ rotate: rawOpen ? '45deg' : '0deg' }}>
                +
              </span>
            </button>
            {rawOpen ? (
              <>
                <ol className="m-0 mt-[18px] flex animate-rise list-none flex-col gap-2.5 p-0">
                  {lightroomSteps(site).map((t, i) => (
                    <li key={t} className="flex items-start gap-3 text-[15px] leading-[1.45] text-[#E4E1DB]">
                      <span className="grid size-7 flex-none place-items-center rounded-full bg-[#242424] font-dot text-[13px] text-lime">{i + 1}</span>
                      {t}
                    </li>
                  ))}
                </ol>
                <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={rawDone}
                    onChange={(e) => {
                      prefs.setLightroomDone(e.target.checked)
                      setRawDone(e.target.checked)
                    }}
                    className="size-[22px] accent-[var(--signal-baseline)]"
                  />
                  I’ve completed setup on this phone
                </label>
                <p className="m-0 mt-1 text-[13px] text-[#BDBAB4]">Lock it once and never change it. If you do, start a new baseline.</p>
              </>
            ) : null}

        <div className="rounded-[36px] bg-surface/[.88] p-[clamp(20px,3vw,30px)] shadow-[0_30px_60px_-44px_rgba(0,0,0,.3)] backdrop-blur-[20px] squircle">
          <div className="flex items-baseline justify-between gap-2.5">
            <h2 className="m-0 mb-1.5 text-[22px] font-normal">{kind === 'arm' ? 'Forearm checklist' : kind === 'close' ? 'Close-up checklist' : first ? 'First-session checklist' : 'Session checklist'}</h2>
            <span className="font-dot text-[22px]" aria-label={`${on} of ${items.length} ready`}>
              {on}/{items.length}
            </span>
          </div>
          <p className="m-0 mb-3.5 text-[14px] leading-[1.45] text-ink-2">Same light, pose and distance every session. Camera checks help you frame; they don’t measure.</p>
          <div className="flex flex-col gap-0.5">
            {items.map((c, i) => (
              <label key={c.title} className="flex min-h-[54px] cursor-pointer items-center gap-3.5 rounded-[18px] px-2.5 py-1.5 transition-[background] hover:bg-ink/[.04]">
                <input type="checkbox" checked={ticks[i]} onChange={() => setTicks((t) => t.map((x, j) => (j === i ? !x : x)))} className="m-0 size-[22px] flex-none accent-[var(--text-primary)]" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[16px]">{c.title}</span>
                  <span className="text-[13px] leading-[1.35] text-ink-2">{c.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {canAddCheeks(site, n) ? (
          <div className="flex flex-col gap-1.5 rounded-[28px] bg-surface/[.88] px-[22px] py-3">
            <Toggle
              label="Cheek photos"
              checked={cheeks}
              onChange={props.onCheeks}
              description={cheeks ? `Photos ${total - 1} and ${total}: turn your head about 45° to show your ${POSE_NAME.left.toLowerCase()}, then your ${POSE_NAME.right.toLowerCase()}. Spots on the cheeks and jaw are counted on them.` : 'Every photo faces the camera. Cheek photos show the spots a front photo misses.'}
            />
            {otherWay ? <span className="pb-1 text-[13px] leading-[1.4] text-ink-2">Blemish and dark-spot counts are compared with your earlier check-ins taken {cheeks ? 'with' : 'without'} cheek photos. Everything else is compared with your baseline.</span> : null}
          </div>
        ) : null}

          </div>
        ) : null}

        {firstTime ? null : (
          <div className="flex flex-col gap-2 rounded-[28px] bg-surface/[.88] px-[22px] py-[18px]">
            <label htmlFor="ck-note" className="text-[15px]">
              Anything different today? <span className="text-ink-2">Optional · saved with this check-in</span>
            </label>
            <input
              id="ck-note"
              type="text"
              maxLength={140}
              placeholder="e.g. new lamp, after a workout, skipped serum"
              value={note}
              onChange={(e) => props.onNote(e.target.value)}
              className="min-h-12 rounded-[14px] border-0 bg-[#EFEEEA] px-3.5 text-[16px] text-ink"
            />
            <span className="flex flex-wrap gap-1.5">
              {NOTE_CHIPS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    props.onNote(note ? `${note}, ${t.toLowerCase()}` : t)
                    props.onDeviation(true)
                  }}
                  className="min-h-9 rounded-pill border border-ink/10 bg-white px-3 text-[13px]"
                >
                  + {t}
                </button>
              ))}
            </span>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
              <input type="checkbox" checked={deviation} onChange={(e) => props.onDeviation(e.target.checked)} className="size-5 accent-[var(--text-primary)]" />
              <span>
                Something is different today <span className="text-ink-2">· shown next to this reading, so a change is never misread</span>
              </span>
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={props.onCamera} disabled={raw} className={`min-h-16 rounded-[24px] text-[16px] ${raw ? 'bg-[#E4E3DE] text-[#8E8B85]' : 'bg-selected text-inverse'}`}>
            Use camera
          </button>
          <button type="button" onClick={props.onFiles} className={`min-h-16 rounded-[24px] border border-ink/15 text-[16px] ${raw ? 'bg-selected text-inverse' : 'bg-white text-ink'}`}>
            Upload files
          </button>
        </div>
        <span className="px-1.5 text-[13px] text-ink-2">{raw ? 'The browser camera can’t take RAW photos. Use Lightroom, then upload the DNG files.' : 'Camera checks guide framing only. They don’t measure anything.'}</span>
      </section>
    </div>
  )
}
