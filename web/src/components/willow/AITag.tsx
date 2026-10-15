import { Sparkles } from 'lucide-react'

/** Only on Gemini output: words written by AI, numbers never. */
export function AITag({ label = 'AI-written', className = '' }: { label?: 'AI-written' | 'AI-suggested' | string; className?: string }) {
  return (
    <span className={`glass-pill inline-flex min-h-6 items-center gap-1.5 rounded-pill px-2.5 font-mono text-[11px] tracking-[.08em] uppercase shadow-[inset_0_0_0_1px_rgba(255,255,255,.7)] ${className}`}>
      <Sparkles size={12} strokeWidth={1.6} aria-hidden />
      {label}
    </span>
  )
}
