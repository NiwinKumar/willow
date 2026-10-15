import { leaveDemo } from '../../data/useData'

/** Demo journey: routine and advisor are the person's own, so they are not part of the read-only demo. */
export function AvailableInOwnAccount({ what, compact }: { what: string; compact?: boolean }) {
  return (
    <div className={`relative flex flex-col items-start gap-3.5 overflow-hidden bg-surface ${compact ? 'rounded-[30px] p-6' : 'rounded-[44px] p-[clamp(28px,5vw,56px)]'}`}>
      <span className="font-mono text-[11px] tracking-[.08em] text-ink-2">■ DEMO JOURNEY · READ-ONLY</span>
      <span className={`${compact ? 'text-[22px]' : 'text-[clamp(24px,2.6vw,32px)]'} leading-[1.15] tracking-[-0.02em]`}>Available in your own account</span>
      <span className="max-w-[460px] leading-[1.55] text-[#3E3C38]">{what} use your own account: nothing here is shared with the demo journey. Sign in, or continue as a guest, to use them.</span>
      <button type="button" onClick={() => leaveDemo()} className="min-h-[52px] rounded-pill bg-selected px-[22px] text-[15px] text-inverse">
        Use my own account
      </button>
    </div>
  )
}
