/** The advisor's identity: a small body of water that moves faster while it is busy (design: water()). */
export function Water({ small, busy }: { small?: boolean; busy: boolean }) {
  const blur = (px: number) => `blur(${small ? px / 4 : px}px)`
  const layer = 'absolute inset-0 rounded-full'
  return (
    <div aria-hidden className="relative size-full">
      <div className={layer} style={{ background: 'linear-gradient(180deg, #0B1E6E 0%, #1F5FE0 40%, #66B8FF 75%, rgba(200,230,255,.6) 100%)', filter: blur(14), animation: `advWave ${busy ? 2.4 : 8}s ease-in-out infinite` }} />
      <div className={layer} style={{ background: 'radial-gradient(40% 18% at 40% 52%, #BFF1FF, transparent 70%)', filter: blur(6), animation: `wDrift ${busy ? 1.8 : 7}s ease-in-out infinite alternate` }} />
      <div className={layer} style={{ background: 'radial-gradient(50% 30% at 60% 20%, rgba(255,255,255,.4), transparent 70%)', filter: blur(10), animation: 'wBreathe 6s ease-in-out infinite' }} />
    </div>
  )
}

/** The small blue orb beside each answer. */
export function AnswerOrb({ breathing }: { breathing?: boolean }) {
  return (
    <span
      aria-hidden
      className="size-[26px] shrink-0 rounded-full"
      style={{ background: 'radial-gradient(circle at 40% 35%, #BFF1FF, var(--aura-sky) 55%, #0B1E6E)', boxShadow: '0 0 18px rgba(61,123,255,.35)', animation: breathing ? 'wBreathe 1.6s ease-in-out infinite' : undefined }}
    />
  )
}
