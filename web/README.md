# web (owner: Niwin)

React 19 + Vite 8 + TypeScript + Tailwind v4 on Firebase Hosting. Design: `docs/DESIGN.md`. Screens and copy: `docs/UX_SPEC.md`.

```bash
cd web && npm install && npm run dev          # http://localhost:5173
npm run lint && npm run build
VITE_API_URL=https://<willow-api url> npm run build && (cd .. && firebase deploy --only hosting)
```

`web/.env.local` (never committed) holds the Firebase web config and `VITE_API_URL` for local dev. For the hosted build, pass `VITE_API_URL` on the command line as above.

## Where things are
- `src/data/` contract types, the inlined fixture, the data seam (`store.tsx`, demo vs live)
- `src/mock/` sample journeys, catalog, routine, advisor turns, retailer aggregates (all labelled sample in the UI)
- `src/components/` BandBar (the signature primitive), Stage, Scrubber, MetricRow, MetricDetail, ControlCompare, Sheet, Chip, UploadList, CoachMarks
- `src/routes/` Landing (live Lens), Report (the Lens), Start, Goals, Capture, QuickCapture, Processing, Routine, Advisor, Retailer, Science, Settings
- Report view state is in the URL: `/s/:site?t=<session index>&m=<metric>&layer=1` (plus `demo=1` for the sample journey)
