import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

import pkg from './package.json' with { type: 'json' }

/** Open the connections the first screen needs (api, Firebase sign-in) while the code downloads. */
function preconnect(apiUrl: string | undefined): Plugin {
  return {
    name: 'willow-preconnect',
    transformIndexHtml: () => [
      ...(apiUrl ? [{ tag: 'link', attrs: { rel: 'preconnect', href: apiUrl, crossorigin: '' }, injectTo: 'head' as const }] : []),
      { tag: 'link', attrs: { rel: 'preconnect', href: 'https://identitytoolkit.googleapis.com', crossorigin: '' }, injectTo: 'head' as const },
      // photos (Mei's first one is the journey's opening image): a full connection, not only the name
      { tag: 'link', attrs: { rel: 'preconnect', href: 'https://storage.googleapis.com' }, injectTo: 'head' as const },
    ],
  }
}

/** /survey and /waitlist are their own pages (survey/index.html, waitlist/index.html): serve them locally the way
 * firebase.json's rewrites do in production. */
function surveyPage(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const m = req.url?.match(/^\/(survey|waitlist)(\/[^?]*)?(\?.*)?$/)
    if (m) req.url = `/${m[1]}/index.html${m[3] ?? ''}`
    next()
  }
  return { name: 'willow-survey-page', configureServer: (s) => void s.middlewares.use(rewrite), configurePreviewServer: (s) => void s.middlewares.use(rewrite) }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), surveyPage(), preconnect(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL || process.env.VITE_API_URL)],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // The catalog lives in api/seed/products.json (one source for the api and the demo).
  server: { port: 5173, host: true, fs: { allow: ['..'] } },
  // Three pages: the app, the survey (its own small bundle and link-preview tags, docs/SURVEY.md) and the waitlist.
  build: { rollupOptions: { input: { main: 'index.html', survey: 'survey/index.html', waitlist: 'waitlist/index.html' } } },
}))
