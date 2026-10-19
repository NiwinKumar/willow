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

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), preconnect(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL || process.env.VITE_API_URL)],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // The catalog lives in api/seed/products.json (one source for the api and the demo).
  server: { port: 5173, host: true, fs: { allow: ['..'] } },
}))
