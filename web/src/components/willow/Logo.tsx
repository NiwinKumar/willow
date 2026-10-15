import { Link } from 'react-router-dom'

/** The frosted tulip-bud mark (radial bud, stem, leaf, all softly blurred) and the lowercase wordmark. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const k = size / 32
  return (
    <span
      aria-hidden
      className="relative block shrink-0 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,.8),0_4px_12px_-4px_rgba(0,0,0,.25)]"
      style={{ width: size, height: size, background: 'radial-gradient(circle at 50% 35%, #FFF7F0 0%, #E7E3F6 75%)' }}
    >
      <span className="absolute block" style={{ left: 9 * k, top: 4 * k, width: 14 * k, height: 16 * k, borderRadius: '50% 50% 46% 46%', background: 'radial-gradient(circle at 50% 72%, #FF6B4A 0%, #F25FA8 55%, #C9A8FF 100%)', filter: `blur(${1.4 * k}px)` }} />
      <span className="absolute block" style={{ left: 15.5 * k, top: 18 * k, width: 1.5, height: 15 * k, background: 'var(--willow-stem)', filter: 'blur(.5px)' }} />
      <span className="absolute block" style={{ left: 17 * k, top: 21 * k, width: 9 * k, height: 5 * k, borderRadius: '50%', background: 'var(--willow-leaf)', rotate: '-35deg', filter: `blur(${0.9 * k}px)` }} />
    </span>
  )
}

export function Logo({ to = '/', size = 32, label = 'Willow, home', dark }: { to?: string; size?: number; label?: string; dark?: boolean }) {
  return (
    <Link to={to} aria-label={label} className="flex items-center gap-2.5 no-underline">
      <LogoMark size={size} />
      <span className={`font-light tracking-[-0.03em] ${dark ? 'text-white' : 'text-ink'}`} style={{ fontSize: Math.round(size * 0.8) }}>
        willow
      </span>
    </Link>
  )
}
