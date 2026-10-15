import { Info } from 'lucide-react'

/** On every report and retail export (docs/DESIGN.md rule 13). */
export function Disclaimer({ className = '' }: { className?: string }) {
  return (
    <p role="note" className={`flex items-start gap-2 text-caption text-ink-2 ${className}`}>
      <Info size={14} strokeWidth={1.6} aria-hidden className="mt-px shrink-0" />
      <span>Cosmetic measurements from photos. Not a medical assessment. See a dermatologist for a mole or spot that changes.</span>
    </p>
  )
}
