import { useState } from 'react'

import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { dayOf, modelName, pct, REPO_BLOB, type Evals, type Failure, type FailureKind } from './data'
import { Ext, Section } from './parts'

const KIND: Record<FailureKind, { label: string; fg: string; bg: string }> = {
  fallback: { label: 'Replaced by a fixed reply', fg: 'var(--state-caution-fg)', bg: 'var(--state-caution-bg)' },
  slipped: { label: 'Got through', fg: 'var(--state-avoid-fg)', bg: 'var(--state-avoid-bg)' },
  fixed: { label: 'Rejected, then fixed', fg: 'var(--willow-700)', bg: 'rgba(79,184,102,.14)' },
}

/** What happened to the case, from the fields the results file keeps (the verdicts, and what was shown). */
function story(f: Failure): string {
  if (f.kind === 'fallback') return `Each of the ${f.answers_asked} answers Gemini gave was rejected by ${f.check}. The person saw the fixed reply instead.`
  if (f.kind === 'slipped') return `This passed Willow’s validators and was shown. The eval’s own check caught it afterwards: ${f.check}.`
  return `The first answer was rejected by ${f.check}. Answer ${f.answers_asked} passed and was shown. The file keeps the verdict, not the rejected text.`
}

/**
 * "Gemini is checked, not trusted": the eval run in evidence.json (api/evals/results, exported by
 * api/scripts/evidence_export.py). The headline, what went wrong, one row per job for the chosen model, and
 * failure cases quoted from the file.
 */
export function EvalSection({ e }: { e: Evals }) {
  const ran = e.models.filter((m) => m.available)
  const [model, setModel] = useState(ran[0]?.model ?? '')
  const rows = e.rows.filter((r) => r.model === model)
  const h = e.headline
  const went: [number, string][] = [
    [h.first_try_rejected, 'first answers rejected by a check'],
    [h.fixed_on_retry, 'of those fixed on the next try'],
    [h.fallback, 'replaced by a fixed reply'],
    [h.slipped, 'shown with a slip the eval caught'],
  ]
  return (
    <Section id="checked" title="Gemini is checked, not trusted">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex flex-col justify-between gap-3 rounded-[24px] bg-selected p-5 text-inverse">
          <span className="text-[clamp(44px,9vw,64px)] leading-none font-light tracking-[-0.03em] tnum">
            {h.invented_shown} <span className="text-[.45em] tracking-normal">of {h.answers}</span>
          </span>
          <span className="text-[15px] leading-[1.4]">
            invented numbers reached a person, across {h.answers} answers from {ran.length} Gemini models. {h.adversarial} of the cases were written to break it.
          </span>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-2">
          {went.map(([n, label], i) => (
            <div key={label} className="flex flex-col gap-1 rounded-[20px] bg-white/70 p-3.5" style={{ animation: `wRise .4s var(--ease-standard) ${80 + i * 60}ms both` }}>
              <dd className="m-0 text-[26px] leading-none tracking-[-0.02em] tnum">{n}</dd>
              <dt className="text-[13px] leading-[1.35] text-ink-2">{label}</dt>
            </div>
          ))}
        </dl>
      </div>
      {e.production ? (
        <p className="m-0 text-[14.5px] leading-[1.5]">
          In the live app since {dayOf(e.production.since)}: {e.production.rejected} answers were rejected before a person saw them, out of {e.production.logged_calls} logged model calls.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <h3 className="m-0 text-[17px] font-normal">By job</h3>
        {ran.length > 1 ? <SegmentedControl size="sm" label="Model" options={ran.map((m) => ({ value: m.model, label: modelName(m.model) }))} value={model} onChange={setModel} /> : null}
      </div>
      <ul key={model} className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((r, i) => (
          <li key={r.job} className="flex flex-col gap-2 rounded-[18px] bg-white/70 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4" style={{ animation: `wRise .35s var(--ease-standard) ${i * 35}ms both` }}>
            <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 sm:flex-col sm:justify-start">
              <span className="text-[15px]">{r.job_name}</span>
              <span className="text-[12.5px] text-ink-2">
                {r.cases} cases, {r.adversarial} adversarial
              </span>
            </span>
            <dl className="m-0 grid grid-cols-4 gap-x-3 text-[14px] sm:w-[340px] sm:flex-none">
              {(
                [
                  ['First try', pct(r.first_try_pass)],
                  ['Final', pct(r.final_pass)],
                  ['Fixed reply', pct(r.fallback)],
                  ['p50 / p95', r.p50_s === null ? 'n/a' : `${r.p50_s} / ${r.p95_s} s`],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-[11.5px] text-ink-2">{k}</dt>
                  <dd className="m-0 whitespace-nowrap tnum">{v}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
        First try: the model’s first answer passed Willow’s validators as written. Final: a validated model answer was shown. Fixed reply: the person got the code template instead. Times are what a person waits for the whole job.
      </p>

      <h3 className="m-0 pt-1 text-[17px] font-normal">What went wrong, from the file</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {e.failures.map((f, i) => (
          <FailureCase key={`${f.job}-${f.case_id}-${f.model}`} f={f} startOpen={i === 0} />
        ))}
      </ul>
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
        {e.failures.length} of the {h.flagged} cases with a rejection or a slip are quoted, cut at the 400 characters the file keeps. Cases whose text names a condition are counted, not quoted. Run on {dayOf(e.run_started_at)}
        {e.model_calls ? `, ${e.model_calls} model calls` : ''}. <Ext href={REPO_BLOB + e.source}>Every case in the results file</Ext> · <Ext href={`${REPO_BLOB}docs/EVALS.md`}>How the columns are scored</Ext>
      </p>
    </Section>
  )
}

/** One failure case: what it was and what was asked, with the rest (what happened, what the person saw) one tap away. */
function FailureCase({ f, startOpen }: { f: Failure; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <li className="rounded-[20px] bg-white/70">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full flex-col gap-2 rounded-[20px] p-4 text-left transition-[background-color,scale] duration-200 ease-standard hover:bg-white/60 active:scale-[.995]">
        <span className="flex w-full items-start justify-between gap-2">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="rounded-pill px-2.5 py-1 text-[12px]" style={{ color: KIND[f.kind].fg, background: KIND[f.kind].bg }}>
              {KIND[f.kind].label}
            </span>
            <span className="text-[13px] text-ink-2">
              {f.job_name} · {modelName(f.model)}
              {f.adversarial ? ' · adversarial' : ''}
            </span>
          </span>
          <span aria-hidden className={`mt-1 flex-none text-[13px] text-ink-2 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
            ▾
          </span>
        </span>
        <span className="text-[14.5px] leading-[1.45]">{f.asked ? <>Asked: “{f.asked}”</> : `Case ${f.case_id.replace(/_/g, ' ')}`}</span>
      </button>
      {open ? (
        <div className="flex animate-[wRise_.25s_var(--ease-standard)_both] flex-col gap-2 px-4 pb-4">
          <p className="m-0 text-[13.5px] leading-[1.5] text-ink-2">{story(f)}</p>
          <blockquote className="m-0 flex flex-col gap-1 rounded-[14px] bg-sunken px-3.5 py-3 text-[13.5px] leading-[1.45]">
            <span className="text-[12px] text-ink-2">What the person saw</span>
            {f.shown.split(' | ').map((line, k, all) => (
              <span key={k}>
                {line}
                {f.shown_cut && k === all.length - 1 ? '…' : ''}
              </span>
            ))}
          </blockquote>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            <Ext href={REPO_BLOB + f.check_path}>{f.check_path}</Ext>
            <span className="font-mono text-[11.5px] text-ink-2">case {f.case_id}</span>
          </span>
        </div>
      ) : null}
    </li>
  )
}
