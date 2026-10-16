import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { toast } from 'sonner'

import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { useOwner } from '../../data/hooks'
import { api, localDay, type SponsoredEventKind, type SponsoredItem } from '../../lib/api'
import { GOALS } from '../../lib/metrics'
import { invalidate, useQuery } from '../../lib/query'
import { useAuth } from '../../lib/useAuth'
import { ProductImage } from './productUi'
import { SPONSORED_EYEBROW, showSponsored, whyLines } from './sponsored'

const goalLabel = (id: string) => GOALS.find((g) => g.id === id)?.label ?? id
// Impressions already sent this page session (the api also counts one per person per day).
const sentToday = new Set<string>()

function useSponsored() {
  const uid = useOwner()
  return useQuery(['sponsored', uid], (t) => api.sponsored(t).then((r) => r.item), { enabled: Boolean(uid) })
}

/**
 * "Sponsored · Willow Proven" (docs/RETAILER_INSIGHTS.md "Proof-gated promotion"): at most one small card under the
 * person's own routine, for a product that cleared Willow's evidence bar and matches their goals. The word
 * "Sponsored" leads the card; "Why am I seeing this?" says what matched and what payment can and can't buy.
 * Events: impression once at least half the card is on screen, click on "View product", add when the product
 * reaches the routine after that view. Live accounts only (useOwner is null in the demo journey).
 */
export function SponsoredCard({ inRoutine, onView }: { inRoutine: ReadonlySet<string>; onView: (productId: string) => void }) {
  const uid = useOwner()
  const { getIdToken } = useAuth()
  const sponsored = useSponsored()
  const item = sponsored.data ?? null
  const [hidden, setHidden] = useState(false)
  const [why, setWhy] = useState(false)
  const viewed = useRef<string | null>(null)
  const ref = useRef<HTMLElement>(null)
  const visible = !hidden && showSponsored(item, { demo: !uid, inRoutine })

  const send = (it: SponsoredItem, kind: SponsoredEventKind) => {
    void getIdToken()
      .then((t) => api.sponsoredEvent(t, it.campaign_id, kind))
      .catch(() => undefined) // measurement only: never in the person's way
  }

  // impression: once, when at least half the card is visible
  useEffect(() => {
    const el = ref.current
    if (!item || !visible || !el) return
    const key = `${item.campaign_id}:${localDay()}`
    if (sentToday.has(key)) return
    const seen = () => {
      if (sentToday.has(key)) return
      sentToday.add(key)
      send(item, 'impression')
    }
    if (typeof IntersectionObserver === 'undefined') {
      seen()
      return
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) {
        seen()
        io.disconnect()
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per campaign shown
  }, [item?.campaign_id, visible])

  // add: the product reached the routine after "View product" on this card
  useEffect(() => {
    if (item && viewed.current === item.campaign_id && inRoutine.has(item.product_id)) {
      viewed.current = null
      send(item, 'add')
      invalidate(['sponsored', uid])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs as the routine changes
  }, [inRoutine, item?.campaign_id])

  if (!item || !visible) return null

  const view = () => {
    viewed.current = item.campaign_id
    send(item, 'click')
    onView(item.product_id)
  }
  const setHide = async (on: boolean) => {
    await api.putProfile(await getIdToken(), { hide_sponsored: on })
    invalidate(['me', uid])
    invalidate(['sponsored', uid])
  }
  const hide = async () => {
    setWhy(false)
    setHidden(true)
    try {
      await setHide(true)
    } catch {
      setHidden(false)
      toast("Couldn't hide sponsored suggestions. Try again.")
      return
    }
    toast('Sponsored suggestions hidden', {
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          try {
            await setHide(false)
            setHidden(false)
          } catch {
            toast("Couldn't undo. Turn sponsored suggestions on in You.")
          }
        },
      },
    })
  }
  const lines = whyLines(item, goalLabel)

  return (
    <SponsoredCardView ref={ref} item={item} onWhy={() => setWhy(true)} onView={view} onHide={() => void hide()}>
      <Sheet open={why} onClose={() => setWhy(false)} title="Why am I seeing this?" variant="modal" size="sm">
        <div className="flex flex-col gap-3 text-[15px] leading-[1.5]">
          <WhySeeing brand={item.brand} lines={lines} />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="ink" size="sm" onClick={() => setWhy(false)}>
              Got it
            </Button>
            <Button variant="outline" size="sm" onClick={() => void hide()}>
              Hide sponsored
            </Button>
          </div>
        </div>
      </Sheet>
    </SponsoredCardView>
  )
}

/**
 * The card as shoppers see it, without data fetching or events: Routine renders it live (above), and Willow
 * Proof's Promote screen renders the same component as its campaign preview, so the two never drift apart.
 * `children` sits inside the card's section (Routine's "Why am I seeing this?" sheet).
 */
export function SponsoredCardView({ item, onWhy, onView, onHide, ref, headingId = 'sponsored-h', children }: {
  item: Pick<SponsoredItem, 'product' | 'brand' | 'image_url' | 'category' | 'evidence' | 'cohort_label'>
  onWhy: () => void
  onView: () => void
  onHide: () => void
  ref?: Ref<HTMLElement>
  headingId?: string
  children?: ReactNode
}) {
  return (
    <section ref={ref} aria-labelledby={headingId} className="card flex w-full max-w-[640px] flex-col gap-3.5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* the disclosure leads the card: "Sponsored" in text, outlined so it reads before anything else */}
        <h2 id={headingId} aria-label={SPONSORED_EYEBROW} className="m-0 flex items-center gap-2 font-mono text-[12px] font-normal tracking-[.06em] text-ink">
          <span className="rounded-pill px-2.5 py-1 shadow-[inset_0_0_0_1px_var(--line-strong)]">{SPONSORED_EYEBROW.split(' · ')[0]}</span>
          <span className="text-ink-2">{SPONSORED_EYEBROW.split(' · ')[1]}</span>
        </h2>
        <button type="button" onClick={onWhy} className="min-h-9 text-[13px] text-ink-2 underline underline-offset-4 hover:text-ink">
          Why am I seeing this?
        </button>
      </div>
      <div className="flex items-start gap-4">
        <ProductImage product={{ image_url: item.image_url, category: item.category, name: item.product }} size={64} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[13px] text-ink-2">{item.brand}</span>
          <span className="text-[17px] leading-[1.25] text-pretty">{item.product}</span>
          {item.evidence ? <span className="text-[13px] leading-[1.45] text-pretty text-ink-2">{item.evidence}</span> : null}
          <span className="mt-1 self-start rounded-pill bg-[var(--synthetic-bg)] px-2.5 py-0.5 font-mono text-[11px] tracking-[.04em] text-[var(--synthetic-fg)]">{item.cohort_label}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="ink" size="sm" onClick={onView}>
          View product
        </Button>
        <Button variant="outline" size="sm" onClick={onHide}>
          Hide sponsored
        </Button>
      </div>
      {children}
    </section>
  )
}

/** "Why am I seeing this?": who sponsors it, what matched the person's profile, and the disclosure. */
export function WhySeeing({ brand, lines }: { brand: string; lines: { matched: string[]; disclosure: string } }) {
  return (
    <>
      <p className="m-0">This product is sponsored by {brand}. It matched your profile:</p>
      {lines.matched.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {lines.matched.map((l) => (
            <li key={l} className="rounded-[14px] bg-sunken px-3.5 py-2 text-[14px]">
              {l}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 text-[14px] text-ink-2">{lines.disclosure}</p>
    </>
  )
}
