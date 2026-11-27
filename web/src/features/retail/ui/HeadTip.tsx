import type { ReactNode } from 'react'

import { useTooltip } from './Tooltip'

/** A column header (or short label) with a definition on hover and focus: dotted underline, help cursor. */
export function HeadTip({ label, tip }: { label: string; tip: ReactNode }) {
  const t = useTooltip(tip)
  return (
    <>
      <span {...t.trigger} tabIndex={0} className="cursor-help underline decoration-line-strong decoration-dotted underline-offset-4">
        {label}
      </span>
      {t.node}
    </>
  )
}
