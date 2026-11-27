import { Download, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { canShareFiles, drawShareCard, saveImage, shareOrSave, type ShareCard } from '../../lib/share'

/**
 * "Share" on a result or a product test verdict: opens a preview of the card first (so the person sees exactly
 * what leaves the app: words, no photo, no numbers), then the system share sheet or a saved image. The card is
 * drawn when the sheet opens, so the Share tap itself still counts as a gesture for navigator.share.
 */
export function ShareButton({ card, className = '' }: { card: ShareCard | null; className?: string }) {
  const [open, setOpen] = useState(false)
  if (!card) return null
  return (
    <>
      <Button variant="glass" size="sm" icon={Share2} className={className} onClick={() => setOpen(true)}>
        Share
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Share this result" variant="modal" size="sm">
        {open ? <SharePreview card={card} onDone={() => setOpen(false)} /> : null}
      </Sheet>
    </>
  )
}

function SharePreview({ card, onDone }: { card: ShareCard; onDone: () => void }) {
  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null)
  const [failed, setFailed] = useState(false)
  // Drawn again only when the card's words change (callers build a new object on every render).
  const sig = JSON.stringify(card)
  useEffect(() => {
    let url: string | null = null
    let live = true
    drawShareCard(JSON.parse(sig) as ShareCard)
      .then((blob) => {
        if (!live) return
        url = URL.createObjectURL(blob)
        setPng({ blob, url })
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [sig])
  const share = canShareFiles()

  const run = async () => {
    if (!png) return
    const how = await shareOrSave(card, png.blob)
    if (how === 'saved') toast('Card saved', { description: `Post it with ${card.text.match(/#\w+/)?.[0] ?? '#DoesItWork'}.` })
    if (how !== 'cancelled') onDone()
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="relative mx-auto aspect-[4/5] w-full max-w-[300px] overflow-hidden rounded-[24px] bg-sunken shadow-[0_24px_48px_-28px_rgba(0,0,0,.45)]">
        {png ? (
          <img src={png.url} alt={`${card.title}. ${card.lines.map((l) => `${l.label}: ${l.verdict}`).join('. ')}.`} className="block size-full animate-[wRise_.45s_var(--ease-standard)_both] object-cover" />
        ) : failed ? (
          <p className="m-0 grid size-full place-items-center p-6 text-center text-[14px] text-ink-2">The card couldn’t be drawn in this browser.</p>
        ) : (
          <span aria-hidden className="skeleton block size-full" />
        )}
      </div>
      <p className="m-0 text-center text-[13px] leading-[1.45] text-ink-2">Only words: no photo of you, no numbers, never compared with anyone.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="ink" icon={share ? Share2 : Download} disabled={!png} onClick={() => void run()}>
          {share ? 'Share' : 'Save image'}
        </Button>
        {share && png ? (
          <Button variant="outline" icon={Download} onClick={() => saveImage(card, png.blob)}>
            Save image
          </Button>
        ) : null}
      </div>
    </div>
  )
}
