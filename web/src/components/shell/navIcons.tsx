/** Duotone nav icons drawn in the design (fill path turns lime when active, stroke path in ink). */
export const NAV_ICON = {
  home: ['M12 7.2a4.8 4.8 0 1 0 0 9.6a4.8 4.8 0 1 0 0-9.6z', 'M12 2.8v1.6M12 19.6v1.6M2.8 12h1.6M19.6 12h1.6M5.5 5.5l1.1 1.1M17.4 17.4l1.1 1.1M5.5 18.5l1.1-1.1M17.4 6.6l1.1-1.1M12 7.2a4.8 4.8 0 1 0 0 9.6a4.8 4.8 0 1 0 0-9.6z'],
  progress: ['M4.5 9.5h15v7.5a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3z', 'M7.5 5.5h9a3 3 0 0 1 3 3v8.5a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3V8.5a3 3 0 0 1 3-3zM4.5 10h15M8.5 3.5v3.5M15.5 3.5v3.5M8.5 14h.01M12 14h.01M15.5 14h.01'],
  routine: ['M12 3.8c3.4 4.3 5.4 7 5.4 9.8a5.4 5.4 0 0 1-10.8 0c0-2.8 2-5.5 5.4-9.8z', 'M12 3.8c3.4 4.3 5.4 7 5.4 9.8a5.4 5.4 0 0 1-10.8 0c0-2.8 2-5.5 5.4-9.8zM9.6 14.2a2.6 2.6 0 0 0 2.4 2.4'],
  advisor: ['M7 5h10a3 3 0 0 1 3 3v5.5a3 3 0 0 1-3 3h-4.5L8 20v-3.5H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z', 'M7 5h10a3 3 0 0 1 3 3v5.5a3 3 0 0 1-3 3h-4.5L8 20v-3.5H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM8.5 10.8h.01M12 10.8h.01M15.5 10.8h.01'],
} as const
export type NavIconName = keyof typeof NAV_ICON

export function NavIcon({ name, active, size = 18 }: { name: NavIconName; active: boolean; size?: number }) {
  const [duo, line] = NAV_ICON[name]
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="relative shrink-0 overflow-visible transition-[scale,rotate,translate] duration-[400ms] ease-bounce group-hover:-translate-y-px group-hover:scale-[1.14] group-hover:-rotate-[8deg] group-active:scale-90">
      <path d={duo} fill={active ? 'rgba(220,242,75,.9)' : 'rgba(18,18,18,.07)'} className="transition-[fill] duration-300" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
