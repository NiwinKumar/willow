import { Button } from '../../components/ui/Button'
import type { Site } from '../../data/types'
import { plural } from '../../lib/format'
import { unlockCues } from './cue'
import { quickChecks, SITE_NAME, SITE_SWATCH } from './model'
import { MonoEyebrow, SerifTitle } from './parts'

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
export function PlaceStep({ site, index, total, n, onStart, onSkip }: { site: Site; index: number; total: number; n: number; onStart: () => void; onSkip: () => void }) {
  return (
    <div className="mx-auto flex max-w-[560px] animate-rise flex-col items-start gap-5 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <div className="flex flex-col gap-2">
        <MonoEyebrow>
          {total > 1 ? `Place ${index + 1} of ${total}` : 'Your check-in'} · {camOf(site)}
        </MonoEyebrow>
        <SerifTitle id="ck-title">{SITE_NAME[site]}</SerifTitle>
      </div>
      <span aria-hidden className="h-28 w-full rounded-[28px] shadow-[inset_0_0_40px_rgba(255,255,255,.45)]" style={{ background: SITE_SWATCH[site] }} />
      <p className="m-0 text-[16px] leading-normal text-[#3E3C38]">{howTo(site)}</p>
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
        {site.endsWith('_macro') ? ' · move the phone away a little between photos' : ''}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ink"
          onClick={() => {
            unlockCues() // inside the tap: lets the tones and voice play on iOS
            onStart()
          }}
        >
          Start camera
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
 * Step "sent": every place of the check-in is uploaded and being measured on Willow's side. The person can
 * close the app; each result lands in Home (and Progress) when it is ready.
 */
export function SentStep({ sent, skipped, onHome }: { sent: Site[]; skipped: Site[]; onHome: () => void }) {
  return (
    <div className="mx-auto flex max-w-[560px] animate-rise flex-col items-start gap-5 px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <div className="flex flex-col gap-2">
        <MonoEyebrow>Check-in sent</MonoEyebrow>
        <SerifTitle id="ck-title">{sent.length ? 'All photos are in' : 'Nothing was sent'}</SerifTitle>
      </div>
      <p className="m-0 text-[16px] leading-normal text-[#3E3C38]">
        {sent.length ? 'Willow is measuring them now. Your report is ready in a few minutes; you can close the app, it will be in Home when you come back.' : 'Every place was skipped, so there is nothing to measure today.'}
      </p>
      {sent.length || skipped.length ? (
        <ul className="m-0 flex w-full list-none flex-col gap-1.5 p-0">
          {[...sent.map((s) => ({ s, done: true })), ...skipped.map((s) => ({ s, done: false }))].map(({ s, done }) => (
            <li key={s} className="flex min-h-14 items-center gap-3 rounded-[20px] bg-white/80 py-2 pr-3 pl-2">
              <span aria-hidden className="size-10 flex-none rounded-[14px] shadow-[inset_0_0_12px_rgba(255,255,255,.5)]" style={{ background: SITE_SWATCH[s] }} />
              <span className="flex-1 text-[15px]">{SITE_NAME[s]}</span>
              <span className="text-[13px] text-ink-2">{done ? 'Measuring' : 'Skipped today'}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Button variant="ink" onClick={onHome}>
        Done
      </Button>
    </div>
  )
}
