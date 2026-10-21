// Build guard: web/public is deployed as-is, so it must never hold photos or RAW files
// (CLAUDE.md: never ship images of people). Test photos belong outside web/ (see docs/LOCAL_DEV.md).
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// The app icon (cut from the logo tile, not a photo) and the link-preview cards are the only images allowed here, by exact name.
const ICONS = new Set(['favicon-32.png', 'favicon-64.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'])
// Link-preview cards (rendered from the landing's tulip field, the waitlist's ASCII field and the logo, no people), by exact path.
const CARDS = new Set(['og/survey-v1.jpg', 'og/waitlist-v1.jpg'])
const PHOTO = /\.(dng|jpe?g|heic|heif|png|webp|tiff?)$/i
const root = new URL('../public', import.meta.url).pathname
const found = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (PHOTO.test(name) && !(dir === root && ICONS.has(name)) && !CARDS.has(relative(root, p))) found.push(p)
  }
}
walk(root)
if (found.length) {
  console.error(`Refusing to build: photos in web/public would be published:\n  ${found.join('\n  ')}`)
  process.exit(1)
}
