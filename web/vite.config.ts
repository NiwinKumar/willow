import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // The catalog lives in api/seed/products.json (one source for the api and the demo).
  server: { port: 5173, host: true, fs: { allow: ['..'] } },
})
