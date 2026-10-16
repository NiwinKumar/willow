import type { ReactNode } from 'react'

import { GLOSSARY, type TermId } from './glossary'
import { useTooltip } from './Tooltip'

/**
 * An inline glossary term: dotted underline, focusable, definition on hover or focus (and to screen readers
 * as its description). `children` overrides the visible word ("lift" in a sentence).
 */
export function Term({ id, children }: { id: TermId; children?: ReactNode }) {
  const g = GLOSSARY[id]
  const tip = useTooltip(
    <>
      <strong className="font-medium">{g.term}.</strong> {g.text}
    </>,
  )
  return (
    <>
      <button
        type="button"
        {...tip.trigger}
        className="cursor-help border-0 bg-transparent p-0 text-inherit underline decoration-ink-2/60 decoration-dotted underline-offset-[3px] hover:decoration-ink"
      >
        {children ?? g.term}
      </button>
      {tip.node}
    </>
  )
}
