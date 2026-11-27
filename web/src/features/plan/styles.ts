/** The routine builder's shared classes, in onboarding's look (features/website/Welcome.tsx). */
export const card = 'rounded-[28px] backdrop-blur-[24px]'
export const cardStyle = { background: 'rgba(250,250,248,.84)', boxShadow: '0 30px 70px -40px rgba(0,0,0,.3)' }
export const primary =
  'flex min-h-[52px] items-center justify-center gap-3 rounded-[20px] bg-selected px-5 text-[16px] text-inverse transition-[background-color,opacity,transform] duration-200 ease-standard hover:bg-[#2A2A2A] active:scale-[.985] disabled:opacity-60 disabled:active:scale-100'
export const secondary =
  'flex min-h-[48px] items-center justify-center gap-2 rounded-[18px] border border-line-strong bg-white/55 px-4 text-[15px] text-ink backdrop-blur-[12px] transition-[background-color,transform] duration-200 ease-standard hover:bg-white/85 active:scale-[.985]'

/** Entrance stagger for a list's i-th item (CSS rise; the global reduced-motion rule makes it instant). */
export const stagger = (i: number, base = 40, step = 45) => ({ animation: `wRise .5s var(--ease-standard) ${base + i * step}ms both` })
