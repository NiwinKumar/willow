import { Logo } from '../willow/Logo'

/**
 * Narrow screens (<900px): the logo on the left; the right corner is kept for Wisp (AdvisorFab sits there on
 * phones). No page label: the tab bar already says where you are, and You is a tab.
 */
// The frost eases in over F at the top edge: 24px in Safari (no top inset), 0 in a Home Screen app, where the
// status bar sits on the header's own padding and must stay covered.
const F = 'max(0px, calc(24px - env(safe-area-inset-top) * 100))'
const MASK = `linear-gradient(180deg, transparent 0, rgba(0,0,0,.35) calc(${F} / 3), #000 ${F}, #000 70%, rgba(0,0,0,.4) 88%, transparent)`

export function Header() {
  return (
    <header
      className="sticky top-0 z-20 flex min-h-[68px] items-center justify-between gap-3 backdrop-blur-[6px]"
      style={{
        paddingInline: 'clamp(16px,4vw,40px)',
        paddingTop: 'env(safe-area-inset-top)',
        background: 'linear-gradient(180deg, rgba(236,235,231,.94) 0%, rgba(236,235,231,.6) 60%, rgba(236,235,231,0))',
        // Eased in at the top edge and out below the logo: in Safari the page also runs under Safari's own status
        // bar, so a frost that started solid at the edge showed as a hard line there.
        WebkitMaskImage: MASK,
        maskImage: MASK,
      }}
    >
      <Logo to="/home" label="Willow, Home" />
    </header>
  )
}
