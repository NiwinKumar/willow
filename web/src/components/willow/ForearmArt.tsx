/*
 * Four tests: it shows what a product test is (two arms, one square each, photographed together) faster than
 * the sentence beside it; it is a plain line drawing a first-timer reads at once; it sits beside the copy and
 * covers nothing; it is drawn in the ink hairline and lime the rest of the app uses. Draws itself in on load.
 */

/** Two forearms side by side, a treated square on one and an untouched square on the other, as a line drawing that draws itself. */
export function ForearmArt({ width = 220, className = '', delay = 200 }: { width?: number; className?: string; delay?: number }) {
  const draw = (ms: number, len = 1) => ({ strokeDasharray: len, strokeDashoffset: len, animation: `wDrawPath 1.1s var(--ease-standard) ${delay + ms}ms both` })
  return (
    <svg viewBox="0 0 220 120" width={width} height={(width * 120) / 220} aria-hidden className={`block overflow-visible ${className}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {/* left arm: wrist at the top, elbow at the foot */}
      <path pathLength={1} d="M38 8c-6 18-8 36-6 56 1 12 4 22 8 32M92 8c6 18 8 36 6 56-1 12-4 22-8 32" style={draw(0)} />
      <path pathLength={1} d="M38 8c10-7 44-7 54 0" style={draw(150)} />
      {/* right arm */}
      <path pathLength={1} d="M128 8c-6 18-8 36-6 56 1 12 4 22 8 32M182 8c6 18 8 36 6 56-1 12-4 22-8 32" style={draw(100)} />
      <path pathLength={1} d="M128 8c10-7 44-7 54 0" style={draw(250)} />
      {/* the treated square (filled lime) and the untouched square (dashed) */}
      <rect x="50" y="38" width="30" height="30" rx="6" pathLength={1} style={{ ...draw(500), fill: 'var(--signal-baseline)', fillOpacity: 0 }} className="animate-[wFillIn_.5s_1.3s_both]" />
      <rect x="140" y="38" width="30" height="30" rx="6" pathLength={1} strokeDasharray="0.05 0.03" style={{ strokeDashoffset: 1, animation: `wDrawPath 1.1s var(--ease-standard) ${delay + 600}ms both` }} />
      <text x="65" y="84" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing=".08em" fill="currentColor" stroke="none" className="animate-[wWord_.5s_1.5s_both]">
        TREATED
      </text>
      <text x="155" y="84" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing=".08em" fill="currentColor" stroke="none" className="animate-[wWord_.5s_1.6s_both]">
        UNTOUCHED
      </text>
      {/* the phone above both, one frame for the pair */}
      <rect x="88" y="104" width="44" height="14" rx="5" pathLength={1} style={draw(800)} />
      <circle cx="110" cy="111" r="2.5" pathLength={1} style={draw(950)} />
      <path pathLength={1} d="M65 70v6M155 70v6" strokeOpacity=".35" style={draw(700)} />
    </svg>
  )
}
