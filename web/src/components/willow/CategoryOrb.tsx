import { categoryOf, orbGradient } from './productVisual'

/**
 * A product's category as the design's 3D colour orb with the category's lucide icon (docs/DESIGN.md
 * "Product category" icon table): the fallback wherever a product has no photo. `muted`: the Home-style
 * "not ticked today" look; `rest`: fainter still ("rests today").
 */
export function CategoryOrb({ category, size = 56, muted = false, rest = false, breathe = false }: { category: string; size?: number; muted?: boolean; rest?: boolean; breathe?: boolean }) {
  const { icon: Icon, c } = categoryOf(category)
  return (
    <span
      aria-hidden
      className={`relative grid shrink-0 place-items-center rounded-full text-white transition-[opacity,filter,box-shadow] duration-300 ${breathe ? 'animate-breathe' : ''}`}
      style={{
        width: size,
        height: size,
        background: orbGradient(category),
        opacity: muted ? (rest ? 0.32 : 0.55) : 1,
        filter: muted ? 'saturate(.35)' : 'none',
        boxShadow: `inset ${-size / 9}px ${-size / 7}px ${size / 4}px rgba(0,0,0,.18), inset ${size / 9}px ${size / 9}px ${size / 5}px rgba(255,255,255,.6)${muted ? '' : `, 0 ${size / 5}px ${size / 3}px -${size / 7}px ${c[1]}`}`,
      }}
    >
      <Icon size={Math.round(size * 0.4)} strokeWidth={1.5} className="drop-shadow-[0_1px_2px_rgba(0,0,0,.25)]" />
    </span>
  )
}
