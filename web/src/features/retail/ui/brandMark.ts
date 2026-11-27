/* BrandLogo's monogram: initials and a stable hue per name (pure; web/tests/proof-home-dash.test.ts). */

/** Initials: the first letters of the first two words ("La Roche-Posay" → LR), else two letters ("CeraVe" → CE). */
export function monogramOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** A stable hue per name (FNV-1a), so a brand keeps its colour on every screen and every visit. */
export function hueOf(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return Math.abs(h) % 360
}

