import './website.css'

import { useEffect, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { fmtDate } from '../../lib/format'
import { CONSENT_VERSION } from '../../lib/prefs'
import { backButton, Lockup, SoftBackdrop } from './Decor'

/** The date this notice last changed. Change it with every edit to the wording below. */
const UPDATED = '2026-10-16'
const ISSUES = 'https://github.com/NiwinKumar/willow/issues'

const BACKDROP = 'radial-gradient(40% 40% at 12% 18%, rgba(156,211,255,.55), transparent 70%), radial-gradient(40% 45% at 88% 82%, rgba(216,184,255,.5), transparent 70%), var(--bg-canvas)'

const day = (iso: string) => fmtDate(iso, { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Terms and privacy notice (/terms). Plain language, and every sentence true of the running system:
 * retention from the bucket lifecycle (infra/setup.sh), deletion from DELETE /v1/me, AI use from the api's
 * Gemini features, sharing from the consent opt-in and the export (api/scripts/export_bq.py, groups of 10+),
 * daily limits from api/app/limits.py. Change the wording only with the code, and move UPDATED.
 */
export default function Terms() {
  const navigate = useNavigate()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  return (
    <div className="relative flex min-h-dvh flex-col gap-5 overflow-x-clip p-[clamp(16px,3vw,32px)]">
      <SoftBackdrop background={BACKDROP} />
      <header className="relative flex items-center justify-between gap-3">
        <button type="button" aria-label="Back" className={backButton} onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}>
          ←
        </button>
        <Lockup />
      </header>

      <main className="relative mx-auto flex w-full max-w-[820px] animate-[wRiseLg_.6s_cubic-bezier(.2,.7,.2,1)_both] flex-col gap-5 pb-12">
        <div className="px-1 pt-[clamp(20px,4vw,40px)] pb-2">
          <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">
            ■ LAST UPDATED {day(UPDATED).toUpperCase()} · PHOTO CONSENT VERSION {day(CONSENT_VERSION).toUpperCase()}
          </span>
          <h1 className="mt-3.5 mb-0 font-serif text-[clamp(44px,6vw,76px)] leading-[.95] font-normal tracking-[-0.01em]">Terms and privacy notice</h1>
          <p className="mt-4 mb-0 max-w-[640px] text-[17px] leading-[1.5] text-[#3E3C38]">What Willow is, what it keeps about you, where, for how long, and how to remove it. Written to be read, not skimmed past.</p>
        </div>

        <Card>
          <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ IN SHORT</span>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[16px] leading-[1.5]">
            {[
              'Willow tracks how your skin looks over time, compared with your own baseline. It is cosmetic only and never diagnoses.',
              'Original photos, previews and spot close-ups are deleted 30 days after upload. Measurements stay until you delete them.',
              'Every number comes from computer vision. Gemini explains and reads labels; it never produces a measurement.',
              'Sharing anonymized numbers with retailers is off unless you switch it on, and groups under 10 people are never shown.',
              'Your results carry no ads. Routine can show one product marked Sponsored, only one that met Willow’s evidence bar; switch it off in You. You can delete everything at any time from You.',
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <span aria-hidden className="mt-[9px] size-2 flex-none rounded-full bg-willow-400" />
                {t}
              </li>
            ))}
          </ul>
        </Card>

        <Section title="What Willow is, and is not">
          <p>
            Willow measures the appearance of your skin in photos you take (tone, dark spots, redness, blemishes, pores, texture, lines, under-eye, shine and glow) and tells you whether a change since your own baseline is larger than the normal variation of your photos. It helps you see whether a skincare product made a visible difference.
          </p>
          <p>
            It is not a medical device. It does not diagnose, name conditions, estimate skin age or rank anyone by skin tone; skin tone is shown as a description only, and no tone is better than another. If a mole changes, or anything about your skin worries you, see a dermatologist.
          </p>
        </Section>

        <Section title="Who runs it">
          <p>
            Willow is a prototype built by a two-person team as an entry to the Google Cloud AI Builder Cup 2026. It is not a company product, and it is provided as is: it can be unavailable, change, or stop, and its measurements and suggestions come with no guarantee. Use your own judgement about any product you buy.
          </p>
        </Section>

        <Section title="Your account">
          <p>You can use Willow in three ways:</p>
          <ul>
            <li>
              <strong className="font-medium">As a guest</strong>: an anonymous account tied to this browser. If you sign out or clear the browser, you lose access to its results.
            </li>
            <li>
              <strong className="font-medium">With Google</strong>: your Google name and email identify the account, and your results follow you to any device. A guest who signs in with Google keeps their results.
            </li>
            <li>
              <strong className="font-medium">With email and password</strong>: your name, email and password (held by Firebase Authentication, never by Willow’s own services).
            </li>
          </ul>
          <p>Sign-in is handled by Firebase Authentication, a Google service.</p>
        </Section>

        <Section title="What Willow keeps">
          <dl className="m-0 flex flex-col">
            {(
              [
                ['Your photos', 'The originals you upload for a check-in.', 'Deleted automatically 30 days after upload.'],
                ['Previews, spot close-ups and overlays', 'Small images made from your photos for your results.', 'Deleted automatically 30 days after they are made, so with the photos.'],
                ['Measurements', 'The numbers, verdicts and spot locations for each check-in, your baselines, and notes you add.', 'Kept until you delete them, so your history keeps working.'],
                ['Routine', 'Products you add (from the catalog, a label scan or typed in), the days you tick them, and product tests.', 'Kept until you remove them or delete everything.'],
                ['Profile', 'Your goals, usual photo time, check-in days and time zone, display name, whether sponsored suggestions are shown and, if you give it, skin type.', 'Kept until you change it or delete everything.'],
                ['Sponsored suggestions', 'If a brand’s campaign matches your goals: whether you were shown its card or held back as the comparison group, the day that was decided, and whether you added the product. Stored under a one-way code instead of your account.', 'Kept with that campaign’s results; it cannot be traced back to you.'],
                ['Consent', 'Which version of the photo consent you agreed to, when, and whether aggregate sharing is on.', 'Kept until you delete everything.'],
                ['Daily usage counts', 'How many AI requests you made each day, to enforce daily limits.', 'Kept until you delete everything.'],
              ] as const
            ).map(([k, what, howLong]) => (
              <div key={k} className="grid gap-1 border-b border-ink/[.07] py-3.5 sm:grid-cols-[200px_1fr] sm:gap-5">
                <dt className="text-[15px] font-medium">{k}</dt>
                <dd className="m-0 flex flex-col gap-1 text-[15px] leading-[1.5]">
                  <span>{what}</span>
                  <span className="text-ink-2">{howLong}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Label photos you scan and conversations with Wisp (the assistant) are not stored: a label photo is read once and discarded (what you add to your routine is kept), and the chat with Wisp lives only in the open page. Like any web service, Google Cloud records standard request logs (time, address, page requested) to run and secure the service. Willow uses no analytics or advertising trackers.
          </p>
        </Section>

        <Section title="Where it is kept">
          <p>
            Photos, records and aggregate tables live in Google Cloud in the us-central1 region (Iowa, USA): a private Cloud Storage bucket that only Willow’s own services can read, a Firestore database and a BigQuery dataset. Willow’s services run on Cloud Run in the same region, and the website is served by Firebase Hosting. Nobody at a retailer or brand can see your photos or your records.
          </p>
        </Section>

        <Section title="How AI is used">
          <p>
            Measurements come from classical computer vision. Gemini, Google’s AI model on Vertex AI, is used to explain your measured results in words, name the spots the measurement found (from small close-ups of them), read ingredient labels you photograph, check your routine for clashes, and answer your questions as Wisp, using your own measurements and routine. It may only quote numbers your measurements produced: an answer containing any other number is rejected. Requests go to Vertex AI’s global endpoint, so Google may process them outside us-central1. Google does not use them to train its models.
          </p>
          <p>AI features have daily limits per person (for example 20 questions to Wisp a day) so the service stays available to everyone.</p>
        </Section>

        <Section title="Sharing with retailers">
          <p>
            Off by default. If you switch on “anonymized aggregate sharing” (at consent, or later in You), the numbers from your measured check-ins, your goals, your skin-tone band and the catalog products in your routine can be included in aggregate figures for retailers, under a one-way code instead of your account. Never your photos, name or email. Any group smaller than 10 people is never shown. Switch it off at any time; later aggregates leave you out.
          </p>
          <p>
            Today the retailer view is built mostly from a synthetic cohort: made-up people generated by a program, labelled as synthetic on every chart. Real people appear only if they opted in.
          </p>
        </Section>

        <Section title="Money">
          <p>
            Willow is free and earns nothing from the store links it shows: links go to the store’s own page. Prices can change; the store’s own page has the current one.
          </p>
          <p>
            Brands can pay to show one product on Routine, under your own routine, marked “Sponsored” in words. Only a product whose measured results met Willow’s evidence bar for your goals can be shown, and “Why am I seeing this?” on the card says which of your goals matched. Payment never changes your measurements, Wisp’s answers or the order of your own recommendations. Switch sponsored suggestions off at any time in You. If this ever changes, this notice changes first.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            In You, “Delete my data” removes your photos, previews, measurements, notes, routine, profile and consent from Willow, then removes your sign-in account too (if Google asks for a recent sign-in first, you are signed out instead). It cannot be undone. Anonymized aggregate figures already published cannot be traced back to you, and the next refresh leaves you out. You can also remove single products from your routine, and change your profile or sharing at any time.
          </p>
        </Section>

        <Section title="The demo and sample photos">
          <p>The demo journey follows Mei, a simulated person: her photos are generated and show no real person, and her routine and notes are written for the demo. Her readings are measured by the live engine like anyone’s. The sample photos in the judge tour are the team’s own photos, used with the agreement of each person photographed.</p>
        </Section>

        <Section title="Changes and contact">
          <p>
            If this notice or the photo consent changes, the dates at the top change. The consent version you agreed to, and when, is shown in You.
          </p>
          <p>
            Questions or problems: open an issue at{' '}
            <a href={ISSUES} target="_blank" rel="noopener noreferrer" className="break-words text-ink underline underline-offset-2">
              github.com/NiwinKumar/willow/issues
            </a>
            . Issues there are public, so please do not post personal details or photos; to remove your data, use Delete my data in You.
          </p>
        </Section>

        <div className="flex flex-wrap gap-3 px-1">
          <Link to="/" className="flex min-h-[52px] items-center rounded-pill bg-selected px-6 text-[15px] text-inverse no-underline">
            Back to Willow
          </Link>
          <Link to="/science" className="flex min-h-[52px] items-center rounded-pill bg-white/70 px-6 text-[15px] text-ink no-underline shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]">
            Science and limits
          </Link>
        </div>
      </main>
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-[36px] px-[clamp(20px,3.5vw,32px)] py-[clamp(20px,3vw,28px)] backdrop-blur-[24px]" style={{ background: 'rgba(250,250,248,.84)', boxShadow: '0 30px 70px -40px rgba(0,0,0,.3)' }}>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <Card>
        <h2 className="m-0 font-serif text-[clamp(28px,3.4vw,38px)] leading-[1.05] font-normal">{title}</h2>
        <div className="flex flex-col gap-3 text-[16px] leading-[1.6] text-[#2A2926] [&_li]:pl-1 [&_p]:m-0 [&_ul]:m-0 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5">{children}</div>
      </Card>
    </section>
  )
}
