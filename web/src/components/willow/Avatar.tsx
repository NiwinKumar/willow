/** Violet initials avatar (profile pill, sidebar, You). */
export function Avatar({ initials, size = 36 }: { initials: string; size?: number }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full text-white" style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: 'radial-gradient(circle at 40% 30%, var(--aura-lilac), var(--aura-violet))' }}>
      {initials}
    </span>
  )
}
