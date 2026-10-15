import { categoryOf, orbGradient } from './routineModel'

/** The design's 3D orb with the category icon. `muted`: the Home-style "not ticked today" look. */
export function CategoryOrb({ category, size = 56, muted = false, breathe = false }: { category: string; size?: number; muted?: boolean; breathe?: boolean }) {
  const { icon: Icon, c } = categoryOf(category)
  return (
    <span
      aria-hidden
      className={`relative grid shrink-0 place-items-center rounded-full text-white transition-[opacity,filter,box-shadow] duration-300 ${breathe ? 'animate-breathe' : ''}`}
      style={{
        width: size,
        height: size,
        background: orbGradient(category),
        opacity: muted ? 0.55 : 1,
        filter: muted ? 'saturate(.35)' : 'none',
        boxShadow: `inset ${-size / 9}px ${-size / 7}px ${size / 4}px rgba(0,0,0,.18), inset ${size / 9}px ${size / 9}px ${size / 5}px rgba(255,255,255,.6)${muted ? '' : `, 0 ${size / 5}px ${size / 3}px -${size / 7}px ${c[1]}`}`,
      }}
    >
      <Icon size={Math.round(size * 0.4)} strokeWidth={1.5} className="drop-shadow-[0_1px_2px_rgba(0,0,0,.25)]" />
    </span>
  )
}
