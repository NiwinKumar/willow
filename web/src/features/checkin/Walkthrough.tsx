import { Button } from '../../components/ui/Button'
import type { Site } from '../../data/types'
import { useData } from '../../data/useData'
import { plural } from '../../lib/format'
import { unlockCues } from './cue'
import { quickChecks, SITE_NAME, SITE_SWATCH } from './model'
import { MonoEyebrow, SerifTitle } from './parts'
import { placeState, sentTitle } from './sent'

const camOf = (site: Site) => (site === 'face_full' ? 'Front camera' : 'Back camera')

/** One line before each place, next to its checks (CAPTURE_PROTOCOL: close-ups on the back camera with an eye in view). */
function howTo(site: Site): string {
  if (site === 'face_full') return 'Front camera at eye level, arm’s length, facing a window or lamp.'
  if (site.startsWith('forearm')) return 'Back camera straight above the marked square, about 30 cm away, white paper beside the arm.'
  return 'You won’t see the screen while the photos are taken: a tone marks each one and a voice says what to do.'
}

/**
 * Step "place" of a whole check-in (?places=): the card before each place. Which camera, one line on how,
 * three checks, then the camera. Nothing to choose: the places come from the profile.
 */
export function PlaceStep({
  site,
  index,
  total,
  n,
  upload = false,
  topupDate = null,
  onStart,
  onSkip,
}: {
  site: Site
  index: number
  total: number
  n: number
  upload?: boolean
  topupDate?: string | null
  onStart: () => void
  onSkip: () => void
}) {
  return (
    <div className="mx-auto flex max-w-[560px] animate-rise flex-col items-start gap-5 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <div className="flex flex-col gap-2">
        <MonoEyebrow>
          {total > 1 ? `Place ${index + 1} of ${total}` : 'Your check-in'} · {upload ? 'Your photos' : camOf(site)}
        </MonoEyebrow>
        <SerifTitle id="ck-title">{SITE_NAME[site]}</SerifTitle>
      </div>
      <span aria-hidden className="h-28 w-full rounded-[28px] shadow-[inset_0_0_40px_rgba(255,255,255,.45)]" style={{ background: SITE_SWATCH[site] }} />
      <p className="m-0 text-[16px] leading-normal text-[#3E3C38]">{upload ? 'Photos you already took of this place, from your library or files. RAW (DNG) works for close-ups and arms.' : howTo(site)}</p>
      {topupDate ? <p className="m-0 rounded-[18px] bg-sunken px-3.5 py-3 text-[13px] leading-[1.45] text-ink-2">These photos join your baseline from {topupDate}, so it gets its normal range. Same light as that day if you can.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[14px] text-ink">
        {quickChecks(site).map((c) => (
          <li key={c} className="flex items-start gap-2.5">
            <span aria-hidden className="mt-[7px] size-1.5 flex-none rounded-full bg-ink" />
            {c}
          </li>
        ))}
      </ul>
      <span className="text-[13px] text-ink-2">
        {plural(n, 'photo')}
        {!upload && site.endsWith('_macro') ? ' · move the phone away a little between photos' : ''}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ink"
          onClick={() => {
            unlockCues() // inside the tap: lets the tones and voice play on iOS
            onStart()
          }}
        >
          {upload ? 'Choose photos' : 'Start camera'}
        </Button>
        {total > 1 ? (
          <button type="button" onClick={onSkip} className="min-h-11 px-2 text-[14px] text-ink-2 underline decoration-ink/25 underline-offset-4">
            Skip this place today
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Step "sent": every place of the check-in is uploaded and measured on Willow's side. Each row reads its session
 * live (the DataProvider polls sessions in flight), so a face that is ready says so while a cheek close-up is
 * still measuring (the engine needs a few minutes on a close-up). A ready place opens its result; Home is one tap
 * away, and the app-wide "Your result is ready" note (progress/useResultReady.ts) says when the rest land.
 */
export function SentStep({ sent, skipped, onHome, onView }: { sent: { site: Site; id: string }[]; skipped: Site[]; onHome: () => void; onView: (id: string) => void }) {
  const data = useData()
  const states = sent.map(({ site, id }) => placeState(site, data.all.find((x) => x.id === id)))
  const waiting = states.some((s) => s.kind === 'measuring')
  const rows = [...sent.map(({ site, id }, i) => ({ s: site, id, state: states[i] })), ...skipped.map((s) => ({ s, id: null, state: null }))]
  return (
    <div className="mx-auto flex max-w-[560px] animate-rise flex-col items-start gap-5 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <div className="flex flex-col gap-2">
        <MonoEyebrow>Check-in sent</MonoEyebrow>
        <SerifTitle id="ck-title">{sentTitle(states)}</SerifTitle>
      </div>
      <p className="m-0 text-[16px] leading-normal text-[#3E3C38]">
        {!sent.length
          ? 'Every place was skipped, so there is nothing to measure today.'
          : waiting
            ? 'Willow is measuring on its side; close-ups take a few minutes. You can go to Home or close the app: a note says when each result is ready.'
            : 'Every place is back. Open one to see it, or find them all in Home.'}
      </p>
      {rows.length ? (
        <ul aria-live="polite" className="m-0 flex w-full list-none flex-col gap-1.5 p-0">
          {rows.map(({ s, id, state }) => (
            <li key={s} className="flex min-h-14 items-center gap-3 rounded-[20px] bg-white/80 py-2 pr-3 pl-2">
              <span aria-hidden className="size-10 flex-none rounded-[14px] shadow-[inset_0_0_12px_rgba(255,255,255,.5)]" style={{ background: SITE_SWATCH[s] }} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px]">{SITE_NAME[s]}</span>
                <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                  {/* a measuring place breathes; a finished or skipped one sits still */}
                  {state?.kind === 'measuring' ? <span aria-hidden className="size-1.5 flex-none rounded-full bg-[var(--aura-lilac)] motion-safe:animate-[wBreathe_2.4s_ease-in-out_infinite]" /> : null}
                  {state ? state.line : 'Skipped today'}
                </span>
              </span>
              {id && state?.view ? (
                <button type="button" onClick={() => onView(id)} className="min-h-11 flex-none rounded-pill px-3 text-[14px] underline underline-offset-4 transition-[color,scale] duration-200 ease-standard hover:text-ink active:scale-[.97]">
                  View
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button variant="ink" onClick={onHome}>
          {sent.length ? 'Go to Home' : 'Done'}
        </Button>
      </div>
    </div>
  )
}
