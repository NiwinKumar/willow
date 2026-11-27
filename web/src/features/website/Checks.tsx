import './website.css'

import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { CHECK_WORDS, useSafetyRules, type CheckStatus, type Grade, type RuleFamily } from '../../lib/safety'
import { backButton, Lockup, SoftBackdrop } from './Decor'

const BACKDROP = 'radial-gradient(40% 40% at 86% 14%, rgba(184,233,134,.5), transparent 70%), radial-gradient(42% 44% at 10% 80%, rgba(156,211,255,.45), transparent 70%), var(--bg-canvas)'

const LOOK: Record<CheckStatus, { fg: string; bg: string }> = {
  clear: { fg: 'var(--willow-700)', bg: 'rgba(79,184,102,.14)' },
  check: { fg: 'var(--state-caution-fg)', bg: 'var(--state-caution-bg)' },
  avoid: { fg: 'var(--state-avoid-fg)', bg: 'var(--state-avoid-bg)' },
  not_sold: { fg: 'var(--text-secondary)', bg: 'var(--bg-muted)' },
}

const GRADES: { g: Grade; text: string }[] = [
  { g: 'A', text: 'A regulation, or a professional body’s own rule' },
  { g: 'B', text: 'A professional body’s guidance, or consistent studies' },
  { g: 'C', text: 'Weak or self-reported evidence, or convention' },
]

type Src = { label: string; url: string }
/**
 * Things Willow deliberately does not flag (research/finals/05-consumer-needs-safety.md §3.3 and §5 #9). Each
 * says what the code does instead; every link was opened before it was added. Worded without condition names.
 */
const NOT_FLAGGED: { title: string; grade: Grade; why: string; instead: string; sources: Src[] }[] = [
  {
    title: 'Niacinamide with vitamin C',
    grade: 'C',
    why: 'The warning comes from lab chemistry in the 1960s, under heat and strong acid. We found no modern evidence of a problem when both are used on skin.',
    instead: 'A routine check says they’re fine together.',
    sources: [{ label: 'Paula’s Choice: niacinamide and vitamin C (a brand’s article)', url: 'https://www.paulaschoice.com.au/blogs/expert-skincare-advice/can-niacinamide-and-vitamin-c-be-used-together' }],
  },
  {
    title: 'Comedogenic scores',
    grade: 'C',
    why: 'The 0 to 5 scores come from a rabbit-ear test with known false positives, and a finished product that lists a “comedogenic” ingredient often doesn’t clog pores on people.',
    instead: 'No scores are shown. If a product gave you breakouts, add its ingredients under “Anything you’ve reacted to before?” or log a reaction.',
    sources: [
      { label: 'Draelos and DiNardo, 2006 (PubMed)', url: 'https://pubmed.ncbi.nlm.nih.gov/16488305/' },
      { label: 'Journal of the Society of Cosmetic Chemists, 1996', url: 'https://library.scconline.org/v047n01/39' },
    ],
  },
  {
    title: '“Fungal-safe” labels',
    grade: 'C',
    why: 'These ingredient lists rest on lab studies of what a skin yeast feeds on. No trial shows that following one changes anything on skin, and the question belongs with a doctor or pharmacist.',
    instead: 'Willow doesn’t mark products this way.',
    sources: [
      { label: 'Frontiers, 2020 (a lab study)', url: 'https://www.frontiersin.org/articles/10.3389/fcimb.2020.00338' },
      { label: 'DermNet (gives no ingredient list)', url: 'https://dermnetnz.org/topics/malassezia-folliculitis' },
    ],
  },
  {
    title: 'Every salicylic acid product in pregnancy',
    grade: 'B',
    why: 'Small amounts for a short time are generally considered fine; peels and products left on large areas are the ones to ask about.',
    instead: 'Only salicylic acid left on the skin at 2% or more, and salicylic exfoliants, are marked Check this. Cleansers aren’t flagged.',
    sources: [
      { label: 'American Academy of Dermatology: skin treatments during pregnancy', url: 'https://www.aad.org/public/diseases/acne/derm-treat/pregnancy' },
      { label: 'Bozzo et al., Canadian Family Physician 2011', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3114665' },
    ],
  },
  {
    title: 'Copper peptides with acids',
    grade: 'C',
    why: 'The concern comes from solution chemistry. No study on skin was found, and the most detailed source is a seller’s.',
    instead: 'A routine check shows it as an information note at most, never as a flag on a product.',
    sources: [{ label: 'Evenskyn: copper peptides with vitamin C (a seller’s article)', url: 'https://www.evenskyn.com/blogs/skin-beautyarticles/copper-peptides-with-vitamin-c-retinol-layering-guide' }],
  },
]

/**
 * How we check products (/checks): how a product is checked, the rule families with their sources and grades
 * (GET /v1/safety/rules, read from the rule file), and what we deliberately don't flag. Linked from every
 * check's reasons ("How we check") and from Terms.
 */
export default function Checks() {
  const navigate = useNavigate()
  const rules = useSafetyRules()
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
          <span className="font-mono text-[12px] tracking-[.08em] text-ink-2">■ HOW WE CHECK PRODUCTS</span>
          <h1 className="mt-3.5 mb-0 font-serif text-[clamp(40px,5.6vw,68px)] leading-[.98] font-normal tracking-[-0.01em]">What we flag, what we don’t, and why</h1>
          <p className="mt-4 mb-0 max-w-[640px] text-[17px] leading-[1.5] text-[#3E3C38]">Every product’s ingredient list is checked against what you told Willow, with fixed rules from published sources. AI never adds or removes a flag.</p>
        </div>

        <Card label="How a product is checked">
          <ol className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-3">
            {[
              ['The label', 'Its ingredient list and key actives, from the catalog or a label you photograph.'],
              [`The rule file${rules.data ? ` · ${rules.data.rules} rules` : ''}`, 'Each rule names what it matches, who it applies to, its source and its evidence grade.'],
              ['Your answers', 'Life stage, what you avoid or reacted to, skin that reacts easily, a prescription treatment, where you shop.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex flex-col gap-1 rounded-[20px] bg-white/70 p-3.5" style={{ animation: `wRise .45s var(--ease-standard) ${120 + i * 70}ms both` }}>
                <span className="font-mono text-[11px] text-ink-2">{i + 1}</span>
                <span className="text-[15.5px]">{t}</span>
                <span className="text-[13.5px] leading-[1.45] text-ink-2">{d}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CHECK_WORDS) as CheckStatus[]).map((s, i) => (
              <span key={s} className="inline-flex min-h-[26px] items-center gap-1.5 rounded-pill py-1 pr-3 pl-1 text-[13px]" style={{ color: LOOK[s].fg, background: LOOK[s].bg, animation: `wDotIn .3s var(--ease-bounce) ${300 + i * 60}ms both` }}>
                <span aria-hidden className="grid size-[18px] place-items-center rounded-full bg-white/70 text-[10.5px] font-semibold">
                  {CHECK_WORDS[s].glyph}
                </span>
                {CHECK_WORDS[s].label}
              </span>
            ))}
          </div>
          <p className="m-0 text-[14.5px] leading-[1.55] text-[#2A2926]">
            The best a product can get is “No flags for you”, never “safe”. Labels can be incomplete: products labelled for other markets may list only “parfum”, so a name missing from a label is “not listed”, never “free from”.
          </p>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
            {GRADES.map((g) => (
              <div key={g.g} className="contents">
                <dt>
                  <GradeTag g={g.g} />
                </dt>
                <dd className="m-0 self-center text-ink-2">{g.text}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card label="What we flag">
          {rules.status === 'error' ? (
            <p className="m-0 text-[14px] text-ink-2">
              The rule list couldn’t load just now.{' '}
              <button type="button" onClick={rules.refetch} className="text-ink underline underline-offset-2">
                Try again
              </button>
            </p>
          ) : !rules.data ? (
            <div aria-busy className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="skeleton block h-[58px] rounded-[18px]" />
              ))}
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {rules.data.personal.map((f, i) => (
                <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[18px] bg-white/70 px-3.5 py-3" style={{ animation: `wRise .4s var(--ease-standard) ${i * 40}ms both` }}>
                  <span className="flex flex-col">
                    <span className="text-[15px]">{f.label}</span>
                    <span className="text-[13px] text-ink-2">{f.applies}</span>
                  </span>
                  <LevelTag level="avoid" />
                </li>
              ))}
              {rules.data.families.map((f, i) => (
                <Family key={f.id} f={f} delay={(i + 2) * 40} />
              ))}
            </ul>
          )}
        </Card>

        <Card label="What we don’t flag, and why">
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {NOT_FLAGGED.map((n, i) => (
              <li key={n.title} className="flex flex-col gap-1.5 rounded-[20px] bg-white/70 p-4" style={{ animation: `wRise .45s var(--ease-standard) ${i * 60}ms both` }}>
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[16px]">{n.title}</span>
                  <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
                    Evidence for a problem <GradeTag g={n.grade} />
                  </span>
                </span>
                <span className="text-[14px] leading-[1.5] text-[#2A2926]">{n.why}</span>
                <span className="text-[14px] leading-[1.5] text-ink-2">{n.instead}</span>
                <Sources sources={n.sources} />
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-wrap gap-3 px-1">
          <Link to="/terms#safe" className="flex min-h-[52px] items-center rounded-pill bg-selected px-6 text-[15px] text-inverse no-underline">
            What Willow does and never does
          </Link>
          <Link to="/science" className="flex min-h-[52px] items-center rounded-pill bg-white/70 px-6 text-[15px] text-ink no-underline shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]">
            Science and limits
          </Link>
        </div>
      </main>
    </div>
  )
}

function Family({ f, delay }: { f: RuleFamily; delay: number }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-[18px] bg-white/70" style={{ animation: `wRise .4s var(--ease-standard) ${delay}ms both` }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[18px] px-3.5 py-3 text-left transition-[background-color,scale] duration-200 ease-standard hover:bg-white/60 active:scale-[.995]">
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px]">{f.label}</span>
          <span className="text-[13px] text-ink-2">{f.applies}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {f.levels.map((l) => (
            <LevelTag key={l} level={l} />
          ))}
          {f.grades.map((g) => (
            <GradeTag key={g} g={g} />
          ))}
          <span aria-hidden className={`ml-1 text-[12px] text-ink-2 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
            ▾
          </span>
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-3.5 pb-3.5 animate-[wRise_.25s_var(--ease-standard)_both]">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13.5px]">
            {f.rules.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-2">
                <span>{r.title}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-ink-2">
                  {r.level === 'avoid' ? 'NOT ADVISED' : 'CHECK'} · {r.grade}
                </span>
              </li>
            ))}
          </ul>
          <Sources sources={f.sources.filter((s): s is Src => Boolean(s.url))} />
        </div>
      ) : null}
    </li>
  )
}

function Sources({ sources }: { sources: Src[] }) {
  return (
    <span className="flex flex-col gap-0.5 text-[12.5px] text-ink-2">
      {sources.map((s) => (
        <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="self-start text-ink underline decoration-ink/30 underline-offset-2">
          {s.label}
          <span aria-hidden> ↗</span>
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      ))}
    </span>
  )
}

function GradeTag({ g }: { g: Grade }) {
  return (
    <span className="rounded-pill bg-sunken px-1.5 py-0.5 font-mono text-[10.5px]" title={GRADES.find((x) => x.g === g)?.text}>
      Grade {g}
    </span>
  )
}

function LevelTag({ level }: { level: 'check' | 'avoid' }) {
  const s: CheckStatus = level
  return (
    <span className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11.5px] whitespace-nowrap" style={{ color: LOOK[s].fg, background: LOOK[s].bg }}>
      <span aria-hidden>{CHECK_WORDS[s].glyph}</span>
      {CHECK_WORDS[s].short}
    </span>
  )
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-4 rounded-[36px] px-[clamp(18px,3.5vw,32px)] py-[clamp(20px,3vw,28px)] backdrop-blur-[24px]" style={{ background: 'rgba(250,250,248,.84)', boxShadow: '0 30px 70px -40px rgba(0,0,0,.3)' }}>
      <h2 className="m-0 font-serif text-[clamp(26px,3.2vw,36px)] leading-[1.05] font-normal">{label}</h2>
      {children}
    </section>
  )
}
