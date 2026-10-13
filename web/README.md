# web (owner: Niwin)

React 19 + Vite 8 + TypeScript + Tailwind v4 on Firebase Hosting. Design: `docs/DESIGN.md`. Screens and copy: `docs/UX_SPEC.md`.

```bash
cd web && npm install && npm run dev          # http://localhost:5173
npm run lint && npm run build
VITE_API_URL=https://<willow-api url> npm run build && (cd .. && firebase deploy --only hosting)
```

`web/.env.local` (never committed) holds the Firebase web config and `VITE_API_URL` for local dev. For the hosted build, pass `VITE_API_URL` on the command line as above.

## Where things are
- Catalog: `src/mock/catalog.ts` reads `api/seed/products.json` (the same 48 products the api serves), so the demo shows real products, prices, store links and each brand's own packshot (linked, never copied; `ProductImage` falls back to the category when an image fails). `vite.config.ts` allows reading from `..` for this.
- Local end-to-end mode: `VITE_AUTH_MODE=dev` skips Firebase sign-in and sends `X-Dev-Uid` to an api started with `AUTH_MODE=dev` (`src/lib/devAuth.ts`, docs/LOCAL_DEV.md). Never set for a deployed build.
- `src/data/` contract types, the inlined fixture, the data seam (`store.tsx`, demo vs live; `live.ts` maps the api's `SessionView` to what screens read)
- Live mode (anyone not in `?demo=1`): the Lens reads `GET /v1/sessions`, Processing runs `POST /v1/sessions/{id}/analyze` and writes each stage from the real result, Routine saves to `/v1/routine` with the real label scan and catalog search, Settings deletes through `DELETE /v1/me`. While the api runs the fixture engine, the Report says the numbers are a sample.
- `src/mock/` sample journeys, catalog, routine, advisor turns, retailer aggregates (all labelled sample in the UI)
- `src/components/` BandBar (the signature primitive), Stage, Scrubber, MetricRow, MetricDetail, ControlCompare, Sheet, Chip, UploadList, CoachMarks
- `src/routes/` Landing (live Lens), Report (the Lens), Start, Goals, Capture, QuickCapture, Processing, Routine, Advisor, Retailer, Science, Settings
- Report view state is in the URL: `/s/:site?t=<session index>&m=<metric>&layer=1` (plus `demo=1` for the sample journey)
