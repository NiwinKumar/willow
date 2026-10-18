// Build guard: web/public is deployed as-is, so it must never hold photos or RAW files
// (CLAUDE.md: never ship images of people). Test photos belong outside web/ (see docs/LOCAL_DEV.md).
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The app icon (cut from the logo tile, not a photo) is the one set of images allowed here, by exact name.
const ICONS = new Set(['favicon-32.png', 'favicon-64.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'])
const PHOTO = /\.(dng|jpe?g|heic|heif|png|webp|tiff?)$/i
const root = new URL('../public', import.meta.url).pathname
const found = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (PHOTO.test(name) && !(dir === root && ICONS.has(name))) found.push(p)
  }
}
walk(root)
if (found.length) {
  console.error(`Refusing to build: photos in web/public would be published:\n  ${found.join('\n  ')}`)
  process.exit(1)
}
