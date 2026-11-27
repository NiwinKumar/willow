import './website.css'

import { useEffect, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { fmtDate } from '../../lib/format'
import { CONSENT_VERSION } from '../../lib/prefs'
import { backButton, Lockup, SoftBackdrop } from './Decor'

/** The date this notice last changed. Change it with every edit to the wording below. */
const UPDATED = '2026-11-27'
const ISSUES = 'https://github.com/NiwinKumar/willow/issues'

const BACKDROP = 'radial-gradient(40% 40% at 12% 18%, rgba(156,211,255,.55), transparent 70%), radial-gradient(40% 45% at 88% 82%, rgba(216,184,255,.5), transparent 70%), var(--bg-canvas)'

const day = (iso: string) => fmtDate(iso, { day: 'numeric', month: 'long', year: 'numeric' })

/** What Willow does and never does (research/finals/04-legal-regulatory.md §7b). Judge's safety panel links here. */
const DO_NEVER: [string, string][] = [
  ['Measure how skin looks with classical computer vision', 'Let an AI model produce a number, a score, a skin age or a diagnosis'],
  ['Compare you only with your own baseline and normal range', 'Rank people, or treat lighter skin as better'],
  ['Describe what is seen: “more red areas”, “fewer blemishes counted”', 'Name a condition about you or grade how severe anything is'],
  ['Suggest over-the-counter cosmetics from a facts-only catalog', 'Suggest prescription medicines, or pharmacy medicines where they are not freely sold'],
  ['Check a routine for well-known ingredient clashes and missing sunscreen', 'Give a dose, or tell anyone to start, stop or change a prescribed treatment'],
  ['Show patch-test steps and a sunscreen note with a new active', 'Suggest retinoids to someone who says they are pregnant, breastfeeding or trying'],
  ['Tell you to see a dermatologist for a changing mole, pain or a reaction', 'Assess, track, count or classify a mole'],
  ['Label paid placement “Sponsored” on the card, and say we may earn a commission at store links', 'Sell ranking, or let payment change what we suggest to you'],
  ['Let brands quote what was measured, in how many people, over what period, as observational', 'Say “clinically proven”, “treats” or “cures”, or attach a condition name to a claim'],
  ['Ask separately for photos, AI processing and sharing; delete photos after 30 days', 'Use face data to recognise anyone, sell individual data, or serve under-18s'],
]

/**
 * Terms and privacy notice (/terms). Plain language, and every sentence true of the running system:
 * retention from the bucket lifecycle (infra/setup.sh), deletion from DELETE /v1/me, Wisp's history from
 * api/app/advisor.py (newest 200 turns, DELETE /v1/advisor/history), the separate choices from lib/consent,
 * AI use from the api's Gemini features, sharing from the consent opt-in and the export (groups of 10+), daily
 * limits from api/app/limits.py. Change the wording only with the code, and move UPDATED.
 */
export default function Terms() {
  const navigate = useNavigate()
  useEffect(() => {
    // A link to a section (/terms#safe from the judge page) lands on it; otherwise the top.
    const id = window.location.hash.slice(1)
    const el = id ? document.getElementById(id) : null
    if (el) el.scrollIntoView()
    else window.scrollTo(0, 0)
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
          <h1 className="mb-0 font-serif text-[clamp(40px,6vw,76px)] leading-[.95] font-normal tracking-[-0.01em] text-balance">Terms and privacy notice</h1>
          {/* the versions are a record, not a heading: one quiet line under the title */}
          <p className="mt-3 mb-0 text-[13.5px] text-ink-2">
            Last updated {day(UPDATED)} · photo consent version {day(CONSENT_VERSION)}
          </p>
          <p className="mt-4 mb-0 max-w-[640px] text-[17px] leading-[1.5] text-[#3E3C38]">What Willow is, what it keeps about you, where, for how long, and how to remove it. Written to be read, not skimmed past.</p>
        </div>

        <Card>
          <h2 className="m-0 text-[20px] font-normal tracking-[-0.01em]">In short</h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[16px] leading-[1.5]">
            {[
              'Willow is for adults (18+). It tracks how your skin looks over time against your own baseline. It is cosmetic only and never diagnoses.',
              'Original photos, previews and spot close-ups are deleted 30 days after upload. Measurements stay until you delete them.',
              'Every number comes from computer vision. Gemini explains, answers and reads labels; it never produces a measurement.',
              'Your chats with Wisp are kept (the newest 200 messages) so the conversation continues; New chat clears them.',
              'Sharing group statistics with brands and retailers is off unless you switch it on, and groups under 10 people are never shown.',
              'We may earn a commission from store links. Routine can show one product marked Sponsored; switch it off in You. Delete everything at any time from You.',
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
            <strong className="font-medium">Willow is intended only for general wellbeing and cosmetic appearance tracking.</strong> It is not intended for the detection, diagnosis, monitoring, management or treatment of any medical condition or disease, and what it tells you is not medical advice. It does not name conditions, estimate skin age or rank anyone by skin tone; skin tone is shown as a description only, and no tone is better than another. Moles are never assessed, counted or compared. If a mole changes, a product causes a reaction, or anything about your skin worries you, see a doctor or dermatologist.
          </p>
        </Section>

        <Section title="Who can use it">
          <p>Willow is for adults, 18 and over. Onboarding asks you to confirm it, and Willow is not designed for, or offered to, anyone younger.</p>
        </Section>

        <Section title="Who runs it">
          <p>
            Willow is a prototype built by a two-person team as an entry to the Google Cloud AI Builder Cup 2026. It is not a company product, and it is provided as is: it can be unavailable, change, or stop, and its measurements and suggestions come with no guarantee. Use your own judgement about any product you buy, and patch test anything new.
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

        <Section title="Your choices, asked separately">
          <ul>
            <li>
              <strong className="font-medium">Photos and measurements</strong> (needed to use Willow): your photos are stored and measured so each check-in can be compared with your baseline.
            </li>
            <li>
              <strong className="font-medium">AI processing with Gemini</strong> (needed for explanations, spot labels, Wisp and label reading): small crops of your photos and your measured numbers are sent to Google’s Gemini model.
            </li>
            <li>
              <strong className="font-medium">Group statistics for brands and retailers</strong> (optional, off unless you switch it on): see Sharing below.
            </li>
          </ul>
          <p>Each choice is recorded with its date and the consent version. You can turn sharing off at any time in You; to withdraw the others, delete your data.</p>
        </Section>

        <Section title="Your face and your photos">
          <p>
            To measure the same areas each time, the software finds points on your face, such as the corners of your eyes and mouth. They are used only to place the measurement areas. Face data is never used to recognise you or anyone else, no identity template is made, and none of it is shared.
          </p>
        </Section>

        <Section title="What Willow keeps">
          <dl className="m-0 flex flex-col">
            {(
              [
                ['Your photos', 'The originals you upload for a check-in.', 'Deleted automatically 30 days after upload.'],
                ['Previews, spot close-ups and overlays', 'Small images made from your photos for your results.', 'Deleted automatically 30 days after they are made, so with the photos.'],
                ['Measurements', 'The numbers, verdicts and spot locations for each check-in, your baselines, and notes you add.', 'Kept until you delete them, so your history keeps working.'],
                ['Conversations with Wisp', 'Your questions and Wisp’s answers, so a chat continues where you left it.', 'The newest 200 messages are kept; New chat in Wisp clears them, and so does deleting everything.'],
                ['Routine', 'Products you add from the catalog, the days you tick them, how a product feels to you, and product tests.', 'Kept until you remove them or delete everything.'],
                ['Skin safety profile and reactions', 'If you give them: what to avoid, whether your skin reacts easily, life stage, a prescription skin treatment, your market, and reactions you report. Used only to flag products for you.', 'Kept until you change them or delete everything.'],
                ['Profile', 'Your goals, places you track, usual photo time, check-in days and time zone, display name, whether sponsored suggestions are shown and, if you give it, skin type.', 'Kept until you change it or delete everything.'],
                ['Product requests', 'A product you ask Willow to add, and a photo of its pack if you attach one.', 'Kept until the request is answered; deleting everything removes them.'],
                ['Reminders', 'If you turn on notifications, the browser’s push address for them.', 'Kept until you turn them off or delete everything.'],
                ['Sponsored suggestions', 'If a brand’s campaign matches your goals: whether you were shown its card or held back as the comparison group, the day that was decided, and whether you added the product. Stored under a one-way code instead of your account.', 'Kept with that campaign’s results; it cannot be traced back to you.'],
                ['Store-link taps', 'Which product and store was tapped, from which screen, and the day. Nothing that identifies you.', 'Kept as counts.'],
                ['Consent', 'Which version of the consent you agreed to, when, and whether sharing is on.', 'Kept until you delete everything.'],
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
            A label photo you scan while asking for a product is read once; only an attached pack photo is kept with the request. Like any web service, Google Cloud records standard request logs (time, address, page requested) to run and secure the service. Willow uses no analytics or advertising trackers.
          </p>
        </Section>

        <Section title="Where it is kept">
          <p>
            Photos, records and aggregate tables are stored in the United States, in Google Cloud’s us-central1 region (Iowa): a private Cloud Storage bucket that only Willow’s own services can read, a Firestore database and a BigQuery dataset. Willow’s services run on Cloud Run in the same region, and the website is served by Firebase Hosting. If you live outside the US, using Willow means your data is stored there. Nobody at a retailer or brand can see your photos or your records.
          </p>
        </Section>

        <Section title="How AI is used">
          <p>
            Measurements come from classical computer vision. Gemini, Google’s AI model on Gemini Enterprise Agent Platform (formerly Vertex AI), is used to explain your measured results in words, describe the spots the measurement found (from small close-ups of them), read ingredient labels you photograph, suggest what to add to your product checks from your note about past reactions (only when you ask, and nothing is added until you tap it), check your routine for clashes, and answer your questions as Wisp, using your own measurements and routine. It may only quote numbers your measurements produced: an answer containing any other number is rejected, and so is one that names a condition. Safety flags, routine plans and “see a doctor” messages are fixed rules written in code, never Gemini’s opinion; <Link to="/checks" className="text-ink underline underline-offset-2">how we check products</Link> lists every rule with its source, and what we deliberately don’t flag. Requests go to Google’s global endpoint, so Google may process them outside us-central1. Google does not use them to train its models.
          </p>
          <p>AI features have daily limits per person (for example 20 questions to Wisp a day) so the service stays available to everyone.</p>
        </Section>

        <Section title="Sharing with brands and retailers">
          <p>
            Off by default. If you switch it on (at consent, or later in You), the numbers from your measured check-ins, your goals, your skin-tone band and the catalog products in your routine can be included in group statistics that brands and retailers pay to see, under a one-way code instead of your account. Never your photos, name, email or individual results. Any group smaller than 10 people is hidden. Switch it off at any time and later statistics leave you out; figures already shared cannot be recalled.
          </p>
          <p>
            Today the retailer view is built mostly from a synthetic cohort: made-up people generated by a program, labelled as simulated on every chart. Real people appear only if they opted in.
          </p>
        </Section>

        <Section title="Money">
          <p>
            Willow is free. Store links go to the store’s own page, and we may earn a commission if you buy through them; this never changes which products Willow shows you or in what order. Prices can change; the store’s own page has the current one.
          </p>
          <p>
            Brands can pay to show one product on Routine, under your own routine, marked “Sponsored” in words. Only a product whose measured results met Willow’s evidence bar for your goals can be shown, and “Why am I seeing this?” on the card says which of your goals matched. Payment never changes your measurements, Wisp’s answers or your other suggestions. Switch sponsored suggestions off at any time in You.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            In You, “Delete my data” removes your photos, previews, measurements, notes, routine, conversations with Wisp, safety profile (including your note about past reactions), product requests and their photos, profile and consent from Willow, then removes your sign-in account too (if Google asks for a recent sign-in first, you are signed out instead). It cannot be undone. Group statistics already published cannot be traced back to you, and the next refresh leaves you out. You can also remove single products from your routine, clear Wisp with New chat, and change your profile, your note about past reactions or sharing at any time. That note is used only for your own product checks and by Wisp; it is never shared with brands or retailers.
          </p>
        </Section>

        <Section title="The demo and sample photos">
          <p>
            The demo journey follows Mei, a simulated person: her photos are generated and show no real person, and her routine and notes are written for the demo. Her readings are measured by the live engine like anyone’s. The sample check-in in the judge tour and a new guest’s sample sessions are Mei’s week-one check-ins, so they show no real person either.
          </p>
        </Section>

        <section id="safe" aria-label="What Willow does and never does" className="scroll-mt-6">
          <Card>
            <h2 className="m-0 font-serif text-[clamp(28px,3.4vw,38px)] leading-[1.05] font-normal">What Willow does, and never does</h2>
            <div className="grid grid-cols-2 gap-x-4 text-[15px] leading-[1.5] text-[#2A2926] max-sm:grid-cols-1">
              <span className="hidden pb-2 text-[14px] text-ink-2 sm:block">We do</span>
              <span className="hidden pb-2 text-[14px] text-ink-2 sm:block">We never do</span>
              {DO_NEVER.map(([yes, no]) => (
                <div key={yes} className="contents">
                  <span className="flex gap-2.5 border-t border-ink/[.07] py-3 max-sm:pb-1">
                    <span aria-hidden className="mt-[8px] size-2 flex-none rounded-full bg-willow-400" />
                    <span>
                      <span className="sr-only">We do: </span>
                      {yes}
                    </span>
                  </span>
                  <span className="flex gap-2.5 py-3 sm:border-t sm:border-ink/[.07] max-sm:pt-1 max-sm:text-ink-2">
                    <span aria-hidden className="mt-[8px] size-2 flex-none rounded-full border-[1.5px] border-ink/45" />
                    <span>
                      <span className="sr-only">We never: </span>
                      <span aria-hidden className="sm:hidden">Never: </span>
                      {no}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </section>

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
