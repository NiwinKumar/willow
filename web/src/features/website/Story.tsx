import type { ReactNode } from 'react'
import { Cloud } from 'lucide-react'

import { PROBLEM_STATS, UNUSED_SKINCARE } from '../journey/problem'
import { BriefPoints, Point } from '../journey/value'
import { MEASURES } from './measures'
import { MethodCards } from './Method'

/**
 * The landing's story below the hero: the problem (with public figures), how Willow fixes it step by step and the
 * Google Cloud service behind each step, what makes it different, who gains, and the culture it builds.
 */

const pad = 'px-[clamp(18px,4vw,52px)]'
/** Sections after the hero leave room for the rail on wide screens. */
const railRoom = 'min-[760px]:pr-[max(64px,4vw)]'
export const storySection = `pt-[clamp(72px,10vw,140px)] ${pad} ${railRoom}`

export function SectionHead({ tag, title, lead }: { tag: string; title: string; lead?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
      <div className="flex max-w-[760px] flex-col gap-4">
        <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ {tag}</span>
        <h2 className="m-0 font-serif text-[clamp(34px,4.2vw,58px)] font-normal leading-[1.02] tracking-[-0.01em] [text-wrap:balance]">{title}</h2>
      </div>
      {lead ? <p className="m-0 max-w-[460px] text-[16px] leading-normal text-ink-2">{lead}</p> : null}
    </div>
  )
}

/** The four parts of the problem; each step below names the ones it fixes. */
const PROBLEMS = {
  slow: { dot: '#7A5CFF', title: 'Slow change is invisible', body: 'Skin changes over weeks. A mirror and memory can’t tell a real change from a good day.' },
  photos: { dot: '#3D7BFF', title: 'Photos change with every lamp and angle', body: 'So a before-and-after can show a change that never happened, or hide one that did.' },
  guess: { dot: '#E5603F', title: 'Shoppers guess, and money is wasted', body: 'The next product is bought on a claim, and the last one is never judged.' },
  blind: { dot: '#3E9B5A', title: 'Retailers see purchases, never outcomes', body: 'Routines mix brands, so no single brand sees what changed. A retailer that sells them all could.' },
} as const
type ProblemId = keyof typeof PROBLEMS

function Fixes({ ids }: { ids: readonly ProblemId[] }) {
  return (
    <ul aria-label="Fixes" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {ids.map((id) => (
        <li key={id} className="flex items-center gap-2 rounded-pill bg-canvas px-3 py-1.5 text-[13px]">
          <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: PROBLEMS[id].dot }} />
          <span className="text-ink-2">Fixes:</span> {PROBLEMS[id].title}
        </li>
      ))}
    </ul>
  )
}

export function Problem() {
  return (
    <section id="problem" className={storySection}>
      <SectionHead
        tag="THE PROBLEM"
        title="Skincare is sold on claims. Nobody sees whether it worked."
        lead="Shoppers guess, and the shops that sold the products never learn what happened. The figures below are public surveys, each with its source."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {(Object.keys(PROBLEMS) as ProblemId[]).map((id) => (
            <li key={id} className="flex flex-col gap-2 rounded-[26px] bg-surface p-5">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: PROBLEMS[id].dot }} />
              <span className="text-[18px] leading-[1.25] tracking-[-0.01em]">{PROBLEMS[id].title}</span>
              <span className="text-[14px] leading-[1.45] text-ink-2">{PROBLEMS[id].body}</span>
            </li>
          ))}
          <li className="flex flex-col gap-1 rounded-[26px] bg-selected p-5 text-inverse sm:col-span-2">
            <span className="text-[clamp(28px,3vw,38px)] leading-none tracking-[-0.02em] tnum">{UNUSED_SKINCARE.value}</span>
            <span className="text-[15px]">{UNUSED_SKINCARE.label}</span>
            <span className="text-[12px] text-[#C9C6C0]">{UNUSED_SKINCARE.source}</span>
          </li>
        </ul>
        <figure className="m-0 flex flex-col gap-5 rounded-[30px] bg-surface p-[clamp(20px,2.6vw,30px)]">
          {PROBLEM_STATS.map((g) => (
            <div key={g.group} className="flex flex-col gap-2.5">
              <span className="text-[13px] text-ink-2">{g.group}</span>
              <ul className="m-0 grid list-none gap-3 p-0">
                {g.rows.map((r) => (
                  <li key={r.label} className="grid grid-cols-[3.4em_minmax(0,1fr)] items-baseline gap-x-3">
                    <span className={`text-[clamp(20px,2vw,26px)] leading-none tracking-[-0.02em] tnum ${r.good ? 'text-[#1F7F45]' : ''}`}>{r.value ?? `${r.pct}%`}</span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-[14px] leading-[1.35]">{r.label}</span>
                      <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-ink/[.07]">
                        <span className={`block h-full rounded-full ${r.good ? 'bg-[#1F7F45]' : 'bg-[#C8603A]'}`} style={{ width: `${r.pct}%` }} />
                      </span>
                      <span className="text-[11.5px] text-ink-2">{r.source}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </figure>
      </div>
    </section>
  )
}

type Step = { title: string; line: string; body: string; fixes: readonly ProblemId[]; cloud: [string, string][] }

/** Willow's pipeline, in order: what each step does, which problem it fixes, and what it runs on. */
const STEPS: Step[] = [
  {
    title: 'Capture',
    line: 'Standardized phone photos, in the browser.',
    body: 'Five photos on day one, repositioned between each, and three at every check-in after. The screen guides light, pose and distance so photos stay comparable. Nothing to install.',
    fixes: ['photos'],
    cloud: [
      ['Firebase Hosting', 'serves the web app to any phone'],
      ['Firebase Auth', 'accounts, plus one-tap guest access'],
      ['Cloud Storage', 'photos upload straight from the phone through signed URLs; originals are deleted after 30 days'],
    ],
  },
  {
    title: 'Measure',
    line: 'Computer vision computes every number.',
    body: `${MEASURES.count} cosmetic measurements. Face check-ins read ${MEASURES.face}. Cheek and nose close-ups add ${MEASURES.closeUp}, with the iris setting the scale.`,
    fixes: ['slow'],
    cloud: [
      ['Cloud Run', 'the Python vision engine; each photo set gets a whole instance, and it scales with demand'],
      ['Cloud Build', 'builds and ships the engine’s container'],
    ],
  },
  {
    title: 'Compare with yourself',
    line: 'A change counts only when it beats your own noise.',
    body: 'The spread across your five baseline photos is your normal range, at 95% confidence. A later reading is called a real change only when it lands outside that range, in the same kind of photo. Never against anyone else.',
    fixes: ['slow', 'photos'],
    cloud: [
      ['Firestore', 'your baseline, check-ins, routine and spot diary, kept per person'],
      ['Cloud Run', 'the API that compares each reading with your range'],
    ],
  },
  {
    title: 'Explain and advise',
    line: 'Gemini explains. It never measures.',
    body: 'Each check-in is explained in plain words. Wisp answers from your own measurements and routine, the routine check flags clashing actives and duplicates, and a label photo is read for its ingredients. Every number Gemini writes is checked against the data, and an answer with a new number is rejected.',
    fixes: ['guess'],
    cloud: [
      ['Gemini on Vertex AI', 'structured answers checked against a schema, function calling over a facts-only catalog, and reading label photos'],
      ['Cloud Scheduler', 'check-in reminders, so a routine actually gets measured'],
    ],
  },
  {
    title: 'Prove it to the business',
    line: 'Outcomes, not just sales.',
    body: 'Measured change is pooled by product, skin type and goal, across every brand on the shelf. Willow Proof shows what works for whom, drafts claims only from measured results, and measures each campaign against a holdout. In the demo, Proof runs on a labelled synthetic cohort.',
    fixes: ['blind'],
    cloud: [
      ['BigQuery', 'the outcome tables behind every Proof chart'],
      ['Gemini on Vertex AI', 'answers a retailer’s questions from BigQuery aggregates and reads campaign rules written in plain words'],
    ],
  },
]

export function How() {
  return (
    <section id="how" className={storySection}>
      <SectionHead
        tag="HOW WILLOW FIXES IT · ON GOOGLE CLOUD"
        title="Measure the outcome. Then explain it."
        lead="Five steps, each answering part of the problem, each running on Google Cloud in us-central1. Gemini 3 models are served from Vertex AI’s global endpoint."
      />
      <ol className="m-0 grid list-none gap-3 p-0">
        {STEPS.map((s, i) => (
          <li key={s.title} className="grid gap-4 rounded-[30px] bg-surface p-[clamp(18px,2.4vw,28px)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-8">
            <div className="flex gap-4">
              <span aria-hidden className="font-dot text-[clamp(36px,3.4vw,48px)] font-extrabold leading-none">{String(i + 1).padStart(2, '0')}</span>
              <div className="flex min-w-0 flex-col gap-2.5">
                <h3 className="m-0 text-[clamp(21px,1.9vw,25px)] font-normal leading-[1.2] tracking-[-0.015em]">
                  {s.title}. <span className="text-ink-2">{s.line}</span>
                </h3>
                <p className="m-0 max-w-[620px] text-[15px] leading-[1.55] text-ink-2">{s.body}</p>
                <Fixes ids={s.fixes} />
              </div>
            </div>
            <div className="flex flex-col gap-3 self-start rounded-[22px] bg-[#EEF3FF] p-4">
              <span className="flex items-center gap-2 text-[13px] text-ink-2">
                <Cloud aria-hidden size={16} strokeWidth={1.8} /> On Google Cloud
              </span>
              <dl className="m-0 grid gap-2.5">
                {s.cloud.map(([svc, role]) => (
                  <div key={svc} className="flex flex-col gap-0.5">
                    <dt className="text-[15px]">{svc}</dt>
                    <dd className="m-0 text-[13.5px] leading-[1.4] text-ink-2">{role}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

const VERSUS: [string, string, string][] = [
  ['Compared with', 'Other people: a skin score, a skin age, a ranking', 'Only you: your own baseline and normal range. No scores, no skin age, no ranking'],
  ['Where numbers come from', 'An AI model’s estimate', 'Computer vision measures. Gemini only explains, and every number it writes is checked'],
  ['Over time', 'A one-off scan, or a before-and-after by eye', 'Weekly check-ins, so a good-lighting day is never called a breakthrough'],
  ['What the business sees', 'Sales and reviews', 'Measured outcomes per product and skin type, across every brand'],
]

const LIMITS = [
  { tag: 'MEASURED', title: 'Close-up pores and texture, forearm tone and redness', body: 'The photo carries its own reference: the iris sets the scale, a white sheet corrects the light.' },
  { tag: 'INDICATIVE', title: 'Face readings', body: 'Faces carry no colour reference, so these are labelled indicative. A change outside your range is still reported.' },
  { tag: 'NOT MEASURED', title: 'Hydration, firmness, UV damage', body: 'A phone photo cannot measure these honestly, so Willow does not try.' },
  { tag: 'NEVER SHOWN', title: 'Skin age, beauty scores, diagnoses', body: 'Tone is a description, never a score. No condition is ever named.' },
]

/** What makes Willow different, with the method and limits behind it (the App's "How this is measured" lands here). */
export function Unique() {
  return (
    <section id="science" className={storySection}>
      <SectionHead
        tag="WHAT MAKES WILLOW DIFFERENT"
        title="Built to answer one question honestly: did it really change?"
        lead="The usual ways to judge skincare compare you with other people, or guess. Willow measures, and compares you only with yourself."
      />
      <div className="overflow-x-auto rounded-[30px] bg-surface">
        <table className="w-full min-w-[560px] border-collapse text-left text-[14.5px] leading-[1.45]">
          <thead>
            <tr className="text-[13px] text-ink-2">
              <th scope="col" className="w-[22%] px-5 pt-5 pb-3 font-normal">
                <span className="sr-only">Question</span>
              </th>
              <th scope="col" className="w-[36%] px-5 pt-5 pb-3 font-normal">The usual way</th>
              <th scope="col" className="px-5 pt-5 pb-3 font-normal text-ink">Willow</th>
            </tr>
          </thead>
          <tbody>
            {VERSUS.map(([q, usual, willow]) => (
              <tr key={q} className="border-t border-line">
                <th scope="row" className="px-5 py-4 align-top font-normal text-ink-2">{q}</th>
                <td className="px-5 py-4 align-top text-ink-2">{usual}</td>
                <td className="px-5 py-4 align-top">{willow}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MethodCards className="mt-3" />
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-px overflow-hidden rounded-[30px] bg-line">
        {LIMITS.map((l) => (
          <div key={l.tag} className="flex flex-col gap-2.5 bg-canvas p-6">
            <span className="font-mono text-[11.5px] tracking-[.08em] text-ink-2">■ {l.tag}</span>
            <span className="text-[18px] leading-[1.25] tracking-[-0.01em]">{l.title}</span>
            <span className="text-[14px] leading-normal text-ink-2">{l.body}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function StackLine({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mt-auto flex items-center gap-2 text-[13px] text-ink-2">
      <Cloud aria-hidden size={15} strokeWidth={1.8} /> {children}
    </p>
  )
}

export function Gains() {
  return (
    <section id="gains" className={storySection}>
      <SectionHead tag="WHO GAINS" title="Shoppers stop guessing. Retailers learn what works." />
      <div className="grid gap-4 lg:grid-cols-2">
        <div
          className="flex flex-col gap-4 rounded-[36px] p-[clamp(20px,3vw,34px)]"
          style={{ background: 'radial-gradient(90% 80% at 0% 0%, #FFD9C2 0%, transparent 60%), radial-gradient(80% 90% at 100% 100%, #F9C6DE 0%, transparent 65%), #FBEDE6' }}
        >
          <h3 className="m-0 font-serif text-[clamp(26px,2.6vw,34px)] font-normal leading-[1.1]">For shoppers</h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            <Point title="Proof, not a feeling">What clearly changed against your own normal range, and what hasn’t moved yet.</Point>
            <Point title="Problems caught early">Clashing actives and duplicate products are flagged, with a one-tap fix.</Point>
            <Point title="Less money wasted">Keep what works for your skin, stop what doesn’t.</Point>
            <Point title="Advice in your own words">Wisp answers from your measurements and routine, and never invents a number.</Point>
          </ul>
          <StackLine>Cloud Run, Firestore, Gemini on Vertex AI, Cloud Scheduler</StackLine>
        </div>
        <div
          className="flex flex-col gap-4 rounded-[36px] p-[clamp(20px,3vw,34px)]"
          style={{ background: 'radial-gradient(90% 80% at 0% 0%, #CFE6FF 0%, transparent 60%), radial-gradient(80% 90% at 100% 100%, #D6F2C2 0%, transparent 65%), #ECEFFB' }}
        >
          <h3 className="m-0 font-serif text-[clamp(26px,2.6vw,34px)] font-normal leading-[1.1]">For retailers and brands</h3>
          <BriefPoints />
          <StackLine>BigQuery, Gemini on Vertex AI, Cloud Run</StackLine>
        </div>
      </div>
    </section>
  )
}

const CULTURE = [
  { title: 'Proof over claims', body: 'Brands compete on measured outcomes. Proof drafts claims only from results it measured, and each campaign’s lift is measured against a holdout.' },
  { title: 'Every skin tone on its own terms', body: 'Spots and redness are found against your own median and spread, never a fixed lightness cut-off. Tone is a description, and no tone is treated as better than another.' },
  { title: 'Honest about limits', body: 'Cosmetic appearance only, never a diagnosis. Willow is not clinically validated; it checks repeatability through your own normal range, and says how firm each reading is.' },
  { title: 'Buy what works, waste less', body: 'Knowing what works for your skin means fewer half-used bottles: keep what works, stop what doesn’t.' },
]

export function Culture() {
  return (
    <section id="culture" className={storySection}>
      <div
        className="grid gap-8 overflow-hidden rounded-[44px] p-[clamp(26px,4vw,48px)] text-inverse lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]"
        style={{ background: 'radial-gradient(60% 60% at 20% 15%, #6E5BFF 0%, transparent 70%), radial-gradient(60% 60% at 85% 95%, #F25FA8 0%, transparent 70%), #120C2E' }}
      >
        <div className="flex flex-col gap-5">
          <span className="font-mono text-[12px] tracking-[.08em]">■ THE CULTURE IT BUILDS</span>
          <h2 className="m-0 font-serif text-[clamp(34px,4.2vw,56px)] font-normal leading-[1.02] [text-wrap:balance]">Proof over claims, and every skin measured against itself.</h2>
          <p className="m-0 max-w-[460px] leading-[1.55] text-[#E7E2FF]">When outcomes are measured, honesty becomes the way to sell. Willow is built so that shoppers, brands and retailers all win by telling the truth about what changed.</p>
        </div>
        <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2">
          {CULTURE.map((c) => (
            <li key={c.title} className="flex flex-col gap-1.5 rounded-[24px] bg-white/[.08] p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]">
              <span className="text-[17px]">{c.title}</span>
              <span className="text-[14px] leading-[1.5] text-[#D9D4F5]">{c.body}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
