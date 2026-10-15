import { pad2 } from './model'
import { SerifTitle } from './parts'

/**
 * Step "review" (CAP 06b): the photos just taken, each retakeable. Retake removes that photo and
 * reopens the camera for one more (the others stay). A photo that looks soft next to the others is
 * marked "Looks soft · consider retaking" (useSoft; advisory only). The engine checks quality after upload.
 */
export function ReviewStep({ shots, n, soft, onRetake, onUpload }: { shots: { url: string }[]; n: number; soft: Set<string>; onRetake: (i: number) => void; onUpload: () => void }) {
  return (
    <div className="relative mx-auto flex max-w-[980px] animate-rise flex-col gap-[18px] px-[clamp(16px,4vw,40px)] pt-[clamp(12px,3vw,32px)] pb-20">
      <SerifTitle id="ck-title" size="md">
        Check your photos
      </SerifTitle>
      <p className="m-0 leading-normal text-[#3E3C38]">Retake any that look blurry, too bright or covered by hair. Willow checks quality again after upload and leaves out any photo it can’t use.</p>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-3 p-0">
        {shots.map((s, i) => (
          <li key={s.url} className="flex animate-rise flex-col gap-2 rounded-[28px] bg-surface p-2.5" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="relative aspect-[3/4] overflow-hidden rounded-[20px] bg-muted">
              <img src={s.url} alt={`Photo ${i + 1}${soft.has(s.url) ? ', looks soft' : ''}`} className="size-full object-cover" />
              <span className="absolute top-2.5 left-2.5 font-dot text-[16px] text-white [text-shadow:0_1px_6px_rgba(0,0,0,.5)]">{pad2(i + 1)}</span>
              {soft.has(s.url) ? (
                <span className="absolute inset-x-2 bottom-2 rounded-[12px] bg-cta px-2 py-1.5 text-center text-[11px] text-ink">Looks soft · consider retaking</span>
              ) : null}
            </div>
            <button type="button" onClick={() => onRetake(i)} aria-label={`Retake photo ${i + 1}`} className="min-h-11 rounded-pill border border-ink/12 bg-white text-[13px]">
              Retake
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onUpload} disabled={shots.length === 0} className="min-h-[60px] rounded-[24px] bg-selected text-[17px] text-inverse">
        Upload {shots.length === n ? n : shots.length} photos and analyse
      </button>
    </div>
  )
}
