# web/ rules (owner: Niwin)
- React + Vite + TypeScript + Tailwind, Firebase Hosting, Firebase Auth.
- Mobile-first (iPhone Safari), accessible (contrast, labels, no color-only meaning).
- Inclusive, calm copy. Tone is descriptive, never "better/worse". Disclaimer on every report.
- Design system: `docs/DESIGN.md` (v3, tokens in `src/styles/tokens.css`); screens are built from `design-from-claude-design/Willow App.dc.html` (+ App Routine, Capture, Willow, Retail). Real data only: never sample arrays or fixtures in the UI; record design-vs-backend gaps in `docs/DESIGN_GAPS.md`.
- Layout: `src/features/<area>/` per destination, shared pieces in `src/components/{ui,willow,charts,shell}`, data in `src/data` (`useData`, `hooks.ts`) and `src/lib` (`api`, `query`, `verdict`, `metrics`).
