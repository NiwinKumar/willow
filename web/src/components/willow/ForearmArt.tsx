/*
 * Four tests: it shows what a product test is (two forearms, one square each, photographed together) faster
 * than the sentence beside it; it is a plain line drawing a first-timer reads at once; it sits beside the copy
 * and covers nothing; it is drawn in the ink hairline and lime the rest of the app uses. Draws itself in on load.
 */

/** Two forearms side by side, cuffs at the top: a treated square on one, an untouched square on the other, one phone framing both. */
export function ForearmArt({ width = 220, className = '', delay = 200 }: { width?: number; className?: string; delay?: number }) {
  const draw = (ms: number) => ({ strokeDasharray: 1, strokeDashoffset: 1, animation: `wDrawPath 1s var(--ease-standard) ${delay + ms}ms both` })
  // One forearm about x = 0: a rolled sleeve at the top, the arm tapering to the wrist, a hand resting below.
  const arm = (cx: number, ms: number) => (
    <g transform={`translate(${cx} 0)`}>
      {/* sleeve cuff */}
      <path pathLength={1} d="M-25 4 H25 V14 H-25 Z" style={draw(ms)} />
      {/* the arm, slightly narrower at the wrist */}
      <path pathLength={1} d="M-23 14 C-24 44 -21 70 -17 92" style={draw(ms + 120)} />
      <path pathLength={1} d="M23 14 C24 44 21 70 17 92" style={draw(ms + 200)} />
      {/* the hand: a soft palm, thumb to the outside */}
      <path pathLength={1} d="M-17 92 C-18 108 -8 116 0 116 C8 116 18 108 17 92" style={draw(ms + 320)} />
    </g>
  )
  return (
    <svg viewBox="0 0 220 134" width={width} height={(width * 134) / 220} aria-hidden className={`block overflow-visible ${className}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {arm(64, 0)}
      {arm(156, 120)}
      {/* the treated square (filled lime) and the untouched square (dashed) */}
      <rect x="50" y="36" width="28" height="28" rx="7" fill="var(--signal-baseline)" stroke="none" className="animate-[wFadeIn_.5s_both]" style={{ animationDelay: `${delay + 1300}ms` }} />
      <rect x="50" y="36" width="28" height="28" rx="7" pathLength={1} style={draw(560)} />
      <rect x="142" y="36" width="28" height="28" rx="7" pathLength={1} strokeDasharray="0.06 0.04" style={{ strokeDashoffset: 1, animation: `wDrawPath 1s var(--ease-standard) ${delay + 680}ms both` }} />
      <text x="64" y="78" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7" letterSpacing=".1em" fill="currentColor" stroke="none" className="animate-[wWord_.5s_1.6s_both]">
        TREATED
      </text>
      <text x="156" y="78" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7" letterSpacing=".1em" fill="currentColor" stroke="none" className="animate-[wWord_.5s_1.7s_both]">
        UNTOUCHED
      </text>
      {/* the phone, one frame for both squares: a dotted frame around them and the phone beneath */}
      <rect x="40" y="26" width="140" height="48" rx="10" pathLength={1} strokeDasharray="0.012 0.012" strokeOpacity=".45" style={{ strokeDashoffset: 1, animation: `wDrawPath 1.2s var(--ease-standard) ${delay + 900}ms both` }} />
      <rect x="94" y="122" width="32" height="10" rx="3.5" pathLength={1} style={draw(1050)} />
      <circle cx="110" cy="127" r="1.8" pathLength={1} style={draw(1150)} />
    </svg>
  )
}
