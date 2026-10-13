# web (owner: Niwin)

React 19 + Vite 8 + TypeScript + Tailwind v4 on Firebase Hosting. Design: `docs/DESIGN.md`. Screens and copy: `docs/UX_SPEC.md`.

```bash
cd web && npm install && npm run dev          # http://localhost:5173
npm run lint && npm run build
VITE_API_URL=https://<willow-api url> npm run build && (cd .. && firebase deploy --only hosting)
```

`web/.env.local` (never committed) holds the Firebase web config and `VITE_API_URL` for local dev. For the hosted build, pass `VITE_API_URL` on the command line as above.
