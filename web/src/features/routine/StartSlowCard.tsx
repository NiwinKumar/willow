import { ExternalLink, FlaskConical } from 'lucide-react'

import { Button } from '../../components/ui/Button'

/** The American Academy of Dermatology's patch-test page (the steps below follow it). */
const AAD_URL = 'https://www.aad.org/public/everyday-care/skin-care-basics/care/test-skin-care-products'

/**
 * Patch test, start slow, sunscreen: fixed words for any product with a strong active (retinoid, exfoliating
 * acid, vitamin C, benzoyl peroxide, azelaic acid), shown when it is added and in its product sheet. Never
 * written by Gemini. `compact` drops the heading for use inside a sheet section.
 */
export function StartSlowCard({ name, actives, onTest, compact = false }: { name: string; actives: string[]; onTest?: () => void; compact?: boolean }) {
  const steps = [
    { k: 'Patch test first', t: 'A little on the inside of your forearm, twice a day for 7 to 10 days. No redness, itch or swelling? Then use it on your face.' },
    { k: 'Start slow', t: 'Use it 2 to 3 nights a week at first, and more often only if your skin stays comfortable.' },
    { k: 'Sunscreen every morning', t: 'While you use it, even on cloudy days.' },
  ]
  return (
    <section aria-label={`How to start ${name}`} className="flex flex-col gap-3 rounded-[24px] bg-sunken p-4 sm:p-5" style={{ animation: 'wRise .45s var(--ease-standard) both' }}>
      {compact ? null : (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ BEFORE YOU START</span>
          <span className="text-[17px] leading-[1.3] text-pretty">
            {name} has {actives.join(' and ')}. Go gently with it.
          </span>
        </div>
      )}
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {steps.map((s, i) => (
          <li key={s.k} className="flex gap-3" style={{ animation: `wRise .45s ${120 + i * 90}ms both` }}>
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-selected font-mono text-[11px] text-inverse animate-[wDotIn_.35s_var(--ease-standard)_both]" style={{ animationDelay: `${260 + i * 90}ms` }}>
              {i + 1}
            </span>
            <span className="flex flex-col text-[14px] leading-[1.45]">
              <span>{s.k}</span>
              <span className="text-ink-2">{s.t}</span>
            </span>
          </li>
        ))}
      </ol>
      <span className="text-[12.5px] leading-[1.45] text-ink-2">Stop and rinse it off if it burns, or you see swelling or hives. If that happens, use “I had a reaction” on the product.</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {onTest ? (
          <Button variant="outline" size="sm" icon={FlaskConical} onClick={onTest}>
            Measure it on your forearm
          </Button>
        ) : null}
        <a href={AAD_URL} target="_blank" rel="noopener noreferrer" className="hit44 inline-flex items-center gap-1 text-[12.5px] text-ink-2 underline underline-offset-4 hover:text-ink">
          Source: American Academy of Dermatology
          <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </div>
    </section>
  )
}
