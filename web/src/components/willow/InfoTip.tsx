import { Info } from 'lucide-react'
import { useId, useState, type PointerEvent } from 'react'

/**
 * A small "i" button that explains something in a popover: opens on hover (mouse), on tap, or with the
 * keyboard; closes on leave, blur or Escape. The wrapper carries data-tip-open while open, so a parent can
 * lift itself above its neighbours (`has-[[data-tip-open]]:z-30`). Pass a positioning class (default `relative`): the popover hangs from the wrapper..
 */
export function InfoTip({ label, text, className = 'relative' }: { label: string; text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const mouse = (on: boolean) => (e: PointerEvent) => {
    if (e.pointerType === 'mouse') setOpen(on)
  }
  return (
    <span className={`inline-flex ${className}`} data-tip-open={open || undefined} onPointerEnter={mouse(true)} onPointerLeave={mouse(false)}>
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        className="group/tip grid size-11 place-items-center rounded-full outline-none"
      >
        <span className="grid size-7 place-items-center rounded-full bg-white/55 backdrop-blur-[8px] transition-colors group-hover/tip:bg-white/85 group-focus-visible/tip:outline-2 group-focus-visible/tip:outline-offset-2 group-focus-visible/tip:outline-ink">
          <Info size={15} strokeWidth={1.9} aria-hidden />
        </span>
      </button>
      {open ? (
        <span role="tooltip" id={id} className="absolute top-[calc(100%-2px)] right-0 z-30 w-[min(260px,72vw)] animate-[wFadeIn_.18s_both] rounded-[18px] bg-surface p-3.5 text-left text-[13px] leading-[1.45] text-ink shadow-[0_24px_50px_-18px_rgba(0,0,0,.45)]">
          {text}
        </span>
      ) : null}
    </span>
  )
}
