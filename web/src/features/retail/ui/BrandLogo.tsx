import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'

import { retailerGet } from '../../../lib/api'
import { hueOf, monogramOf } from './brandMark.ts'

/*
 * A brand's (or organisation's) logo as a small rounded square: the logo on a white tile (most brand marks are
 * drawn for light grounds, so the tile stays white in dark mode too, like Vercel's integration icons), fading in
 * once loaded. Without a logo, or when it fails to load, a monogram tile: the brand's initials on a quiet tint
 * whose hue is stable per name (the same brand is the same colour everywhere), never the leaf accent.
 *
 * Logos come once per session from GET /v1/catalog/brand-logos ({logos: {brand: url}}); rows that carry their
 * own `logo_url` (orgs, /v1/retailer/brands) pass it as `src`, or merge many at once with `primeBrandLogos`.
 *
 * Four tests: it tells the person whose data they are looking at at a glance (1); a logo or initials need no
 * label (2); fixed size, no layout shift, decorative to screen readers when a name sits beside it (3); radius,
 * hairline and motion are the kit's (4).
 */

type Store = { map: Record<string, string>; byKey: Map<string, string>; loaded: boolean; v: number }
const store: Store = { map: {}, byKey: new Map(), loaded: false, v: 0 }
const subs = new Set<() => void>()
let inflight: Promise<void> | null = null
const failed = new Set<string>()

/** "La Roche-Posay" and "la roche posay" find the same logo. */
const keyOf = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

function emit() {
  store.v++
  subs.forEach((f) => f())
}

/** Add logos from any source (a row's `logo_url`, an org's); existing entries are kept unless `override`. */
export function primeBrandLogos(entries: Record<string, string | null | undefined>, override = false) {
  let changed = false
  for (const [brand, url] of Object.entries(entries)) {
    if (!url) continue
    const k = keyOf(brand)
    if (!override && store.byKey.has(k)) continue
    store.map[brand] = url
    store.byKey.set(k, url)
    changed = true
  }
  if (changed) emit()
}

function load() {
  if (inflight || store.loaded) return
  inflight = retailerGet<{ logos: Record<string, string> }>('/v1/catalog/brand-logos')
    .then((r) => primeBrandLogos(r?.logos ?? {}))
    .catch(() => undefined) // an api build without logos: every brand shows its monogram
    .finally(() => {
      store.loaded = true
      emit()
    })
}

function subscribe(f: () => void) {
  subs.add(f)
  load()
  return () => subs.delete(f)
}

/** The logo map, loaded once; re-renders when logos arrive. `logoFor(brand)` looks a brand up. */
export function useBrandLogos(): { logoFor: (brand: string | null | undefined) => string | null; loaded: boolean } {
  useSyncExternalStore(
    subscribe,
    () => store.v,
    () => 0,
  )
  return { logoFor: logoOf, loaded: store.loaded }
}

/** A brand's logo url from the loaded map (null when none is known yet). */
export function logoOf(brand: string | null | undefined): string | null {
  if (!brand) return null
  return store.map[brand] ?? store.byKey.get(keyOf(brand)) ?? null
}

/**
 * The logo tile. `size` in px (16-64). `src` wins over the shared map. `kind="retailer"` with no logo draws an
 * ink tile (the retailer is the house, not a brand). `decorative` (default) hides it from screen readers because
 * a name sits next to it; pass `decorative={false}` when the logo stands alone.
 */
export function BrandLogo({ brand, src, size = 24, kind = 'brand', decorative = true, className = '' }: { brand: string; src?: string | null; size?: number; kind?: 'brand' | 'retailer'; decorative?: boolean; className?: string }) {
  const { logoFor } = useBrandLogos()
  const url = src || logoFor(brand)
  const usable = url && !failed.has(url) ? url : null
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setLoaded(false)
    setBroken(false)
  }, [usable])
  const radius = Math.max(4, Math.round(size * 0.24))
  const box: CSSProperties = { width: size, height: size, borderRadius: radius }
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': `${brand} logo` }
  if (usable && !broken) {
    return (
      <span {...a11y} className={`relative inline-grid shrink-0 place-items-center overflow-hidden border border-line bg-white ${className}`} style={box}>
        {!loaded ? <Monogram name={brand} size={size} kind={kind} inset /> : null}
        <img
          src={usable}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => {
            failed.add(usable)
            setBroken(true)
          }}
          className={`relative size-full object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          style={{ padding: Math.max(1, Math.round(size * 0.1)) }}
        />
      </span>
    )
  }
  return (
    <span {...a11y} className={`inline-grid shrink-0 ${className}`} style={box}>
      <Monogram name={brand} size={size} kind={kind} radius={radius} />
    </span>
  )
}

function Monogram({ name, size, kind, inset = false, radius }: { name: string; size: number; kind: 'brand' | 'retailer'; inset?: boolean; radius?: number }) {
  const text = kind === 'retailer' && !name ? 'R' : monogramOf(name)
  const font = Math.max(8, Math.round(size * (text.length > 1 ? 0.38 : 0.46)))
  const style: CSSProperties = { fontSize: font, borderRadius: inset ? undefined : radius, ['--h' as string]: hueOf(name) }
  return (
    <span className={`${inset ? 'absolute inset-0' : 'size-full'} grid place-items-center font-semibold leading-none tracking-[-0.02em] ${kind === 'retailer' ? 'bg-ink text-inverse' : 'proof-mono-tile'}`} style={style}>
      {text}
    </span>
  )
}
