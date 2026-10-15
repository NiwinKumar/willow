import { Cloud, Droplets, Eye, FlaskConical, GlassWater, Layers, Package, Pipette, Sun, Waves, type LucideIcon } from 'lucide-react'

/**
 * Product visuals (CategoryOrb, ProductImage). The orb is coloured by category, never by brand, never data
 * (docs/DESIGN.md "Product category" icon table); ember tones are left out on purpose: ember means
 * "Changed" only.
 */
const CATEGORY: Record<string, { icon: LucideIcon; c: [string, string, string] }> = {
  cleanser: { icon: Droplets, c: ['#9CD3FF', '#3D7BFF', '#1A3E99'] },
  toner: { icon: GlassWater, c: ['#D8B8FF', '#7A5CFF', '#3B2A99'] },
  serum: { icon: Pipette, c: ['#B8E986', '#4FB866', '#1F6B3A'] },
  treatment: { icon: FlaskConical, c: ['#8EE0C0', '#1E8C6C', '#0F3B3A'] },
  exfoliant: { icon: Waves, c: ['#F7C6E4', '#C77DDB', '#5B2A86'] },
  moisturizer: { icon: Cloud, c: ['#FFC2DF', '#F25FA8', '#8E2560'] },
  sunscreen: { icon: Sun, c: ['#FFF4C9', '#F2B53A', '#8F5E08'] },
  eye_care: { icon: Eye, c: ['#DCEBFF', '#8AA9E8', '#33508F'] },
  mask: { icon: Layers, c: ['#E3F2C2', '#9DBF5A', '#4E6B1C'] },
}
const OTHER = { icon: Package, c: ['#F1F0EC', '#B8B5AE', '#5E5B56'] as [string, string, string] }

export const categoryOf = (category: string) => CATEGORY[category] ?? OTHER

export function orbGradient(category: string): string {
  const [a, b, c] = categoryOf(category).c
  return `radial-gradient(circle at 34% 28%, #FFFFFF 0%, ${a} 34%, ${b} 72%, ${c} 100%)`
}

/** Ask image CDNs that support it for a copy near the box size (2x for retina), not the 1600 px original. */
export function sizedImage(url: string, px: number): string {
  try {
    const u = new URL(url)
    if (u.pathname.includes('/cdn/shop/') || u.hostname === 'cdn.shopify.com') u.searchParams.set('width', String(px))
    else if (u.pathname.includes('/dw/image/')) u.searchParams.set('sw', String(px))
    else if (u.hostname === 'media.ulta.com') {
      u.searchParams.set('w', String(px))
      u.searchParams.set('h', String(px))
    } else return url
    return u.toString()
  } catch {
    return url
  }
}

/** The site the packshot is credited to ("theordinary.com"), from the page it is published on. */
export function imageCredit(p: { image_url?: string | null; image_source?: string | null }): string | null {
  if (!p.image_url || !p.image_source) return null
  try {
    return new URL(p.image_source).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
