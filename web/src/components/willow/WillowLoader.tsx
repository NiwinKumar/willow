import { LogoMark } from './Logo'

/**
 * Willow's loading moment. PLACEHOLDER: the website port replaces the body with the design's dot-matrix
 * tulip loader (Willow.dc.html); keep this API so every caller gets the real one:
 *   <WillowLoader />                 full-screen, while the app or a page opens
 *   <WillowLoader inline label=… />  inside a card or panel
 */
export function WillowLoader({ label = 'Loading', inline = false }: { label?: string; inline?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`grid place-items-center ${inline ? 'min-h-40 w-full' : 'fixed inset-0 z-[80] bg-canvas'}`}>
      <span className="animate-breathe">
        <LogoMark size={inline ? 40 : 56} />
      </span>
      <span className="sr-only">{label}</span>
    </div>
  )
}
