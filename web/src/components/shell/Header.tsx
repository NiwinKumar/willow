import { Logo } from '../willow/Logo'

/**
 * Narrow screens (<900px): the logo on the left; the right corner is kept for Wisp (AdvisorFab sits there on
 * phones). No page label: the tab bar already says where you are, and You is a tab.
 */
export function Header() {
  return (
    <header
      className="sticky top-0 z-20 flex min-h-[68px] items-center justify-between gap-3 backdrop-blur-[6px] [mask-image:linear-gradient(180deg,#000_78%,transparent)]"
      style={{ paddingInline: 'clamp(16px,4vw,40px)', paddingTop: 'env(safe-area-inset-top)', background: 'linear-gradient(180deg, rgba(236,235,231,.94) 0%, rgba(236,235,231,.6) 60%, rgba(236,235,231,0))' }}
    >
      <Logo to="/home" label="Willow, Home" />
    </header>
  )
}
