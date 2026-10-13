import type { Session, Site } from '../data/types'

/**
 * Drawn stand-in for the aligned preview in demo mode (no stock faces; docs/UX_SPEC.md).
 * Same coordinate frame as the engine's image_size (3024 x 4032) so ROI polygons overlay 1:1.
 * The forearm square's shade follows the measured ITA so scrubbing shows the self-tanner darkening.
 */
export function Illustration({ site, session }: { site: Site; session: Session | null }) {
  const ink = 'var(--color-text)'
  if (site === 'forearm_treated' || site === 'forearm_control') {
    const ita = session?.result?.metrics.find((m) => m.id === 'tone_ita')?.value ?? 41
    // ITA 41 (light) -> L 0.80; ITA 31 -> L 0.66. Hue stays warm; this is a drawing, not a measurement.
    const L = Math.max(0.5, Math.min(0.86, 0.8 - (41 - ita) * 0.014))
    const skin = `oklch(${L.toFixed(3)} 0.055 60)`
    return (
      <g>
        <rect x="0" y="0" width="3024" height="4032" fill="var(--color-surface-2)" />
        <path d="M 700 300 C 600 1400, 600 2600, 760 3900 L 2300 3900 C 2440 2600, 2440 1400, 2340 300 Z" fill={skin} opacity="0.55" stroke={ink} strokeOpacity="0.25" strokeWidth="10" />
        <rect x="1000" y="1300" width="1024" height="1024" fill={skin} stroke={ink} strokeOpacity="0.5" strokeWidth="8" />
        {[[1000, 1300], [2024, 1300], [1000, 2324], [2024, 2324]].map(([x, y], i) => (
          <rect key={i} x={x - 90} y={y - 40} width="180" height="80" fill="var(--color-surface)" stroke={ink} strokeOpacity="0.35" strokeWidth="6" transform={`rotate(${i % 2 ? -8 : 8} ${x} ${y})`} />
        ))}
        <rect x="2250" y="2700" width="560" height="760" rx="24" fill="var(--color-surface)" stroke={ink} strokeOpacity="0.3" strokeWidth="6" />
        {Array.from({ length: 24 }, (_, i) => (
          <rect key={i} x={2290 + (i % 4) * 125} y={2740 + Math.floor(i / 4) * 115} width="105" height="95" fill={`oklch(${(0.35 + ((i * 7) % 11) * 0.05).toFixed(2)} ${i < 18 ? 0.12 : 0} ${(i * 47) % 360})`} />
        ))}
      </g>
    )
  }
  return (
    <g>
      <rect x="0" y="0" width="3024" height="4032" fill="var(--color-surface-2)" />
      <path d="M 1512 760 C 2160 760, 2280 1500, 2240 2150 C 2200 2800, 1900 3200, 1512 3200 C 1124 3200, 824 2800, 784 2150 C 744 1500, 864 760, 1512 760 Z" fill="var(--color-surface)" stroke={ink} strokeOpacity="0.45" strokeWidth="12" />
      <path d="M 1280 3150 L 1260 3500 C 1100 3600, 700 3700, 500 4032 L 2524 4032 C 2324 3700, 1924 3600, 1764 3500 L 1744 3150" fill="var(--color-surface)" stroke={ink} strokeOpacity="0.35" strokeWidth="10" />
      <path d="M 1040 1620 Q 1180 1540 1320 1620" fill="none" stroke={ink} strokeOpacity="0.5" strokeWidth="14" strokeLinecap="round" />
      <path d="M 1704 1620 Q 1844 1540 1984 1620" fill="none" stroke={ink} strokeOpacity="0.5" strokeWidth="14" strokeLinecap="round" />
      <path d="M 1512 1700 L 1470 2080 Q 1512 2130 1560 2080" fill="none" stroke={ink} strokeOpacity="0.35" strokeWidth="12" strokeLinecap="round" />
      <path d="M 1330 2520 Q 1512 2620 1694 2520" fill="none" stroke={ink} strokeOpacity="0.45" strokeWidth="14" strokeLinecap="round" />
      <rect x="2380" y="900" width="500" height="700" rx="20" fill="var(--color-surface)" stroke={ink} strokeOpacity="0.3" strokeWidth="6" />
      {Array.from({ length: 24 }, (_, i) => (
        <rect key={i} x={2410 + (i % 4) * 115} y={930 + Math.floor(i / 4) * 108} width="95" height="88" fill={`oklch(${(0.35 + ((i * 7) % 11) * 0.05).toFixed(2)} ${i < 18 ? 0.12 : 0} ${(i * 47) % 360})`} />
      ))}
    </g>
  )
}
