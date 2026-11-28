import { REPO_BLOB } from './data'
import { Ext, Section, tile } from './parts'

/**
 * "AI working for you": every Gemini job that runs without the person asking, with what code checks before
 * its words or changes reach anyone. Static, from the api modules named; keep in step with them.
 */
const INVISIBLE_JOBS: { job: string; check: string; path: string }[] = [
  { job: 'Spot labels, read twice', check: 'Each spot is asked about twice, in a different order; a label is kept only when both reads agree with confidence.', path: 'api/app/labeller.py' },
  { job: 'Explanations of each reading', check: 'Only numbers from the measured input, comparison words checked against the change and its band, banned words rejected.', path: 'api/app/explain.py' },
  { job: 'Translation, checked', check: 'Written in English and checked first; a translation is kept only if it quotes exactly the same numbers.', path: 'api/app/translate.py' },
  { job: 'Routine fix proposals', check: 'Applied to a copy of the routine first: it must clear the flagged pair and add no new conflict, duplicate or gap.', path: 'api/app/routine_fix.py' },
  { job: 'Reminder and weekly recap text', check: 'From your products and your own verdicts only; at most 140 characters, no new numbers, no banned words, else the fixed text.', path: 'api/app/reminder_text.py' },
  { job: 'Note tags', check: 'Your note becomes tags from a fixed list (stinging, dryness…), never free text; low-confidence tags are dropped.', path: 'api/app/note_tags.py' },
  { job: 'Proof Ask slicing', check: 'Code picks the slices of the aggregates a question needs; every number in the answer must be in those slices.', path: 'api/app/retailer_ask.py' },
]

export function InvisibleAI() {
  return (
    <Section id="invisible-ai" title="AI working for you" lead="Gemini runs in the background on these jobs without being asked. It never measures; code checks each answer and falls back to fixed text when one fails.">
      <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2">
        {INVISIBLE_JOBS.map((j) => (
          <li key={j.job} className={`flex flex-col gap-1 ${tile}`}>
            <span className="text-[15px]">{j.job}</span>
            <span className="text-[13.5px] leading-[1.45] text-ink-2">{j.check}</span>
            <span className="text-[12.5px]">
              <Ext href={REPO_BLOB + j.path}>{j.path}</Ext>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
