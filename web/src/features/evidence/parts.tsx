import type { ReactNode } from 'react'

/** One section of the Evidence page: a glass card with a serif heading (the look of /checks). */
export function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-6 flex-col gap-3.5 rounded-[32px] px-[clamp(16px,3.5vw,30px)] py-[clamp(18px,3vw,26px)] backdrop-blur-[24px]" style={{ background: 'rgba(250,250,248,.84)', boxShadow: '0 30px 70px -40px rgba(0,0,0,.3)' }}>
      <h2 id={`${id}-h`} className="m-0 font-serif text-[clamp(26px,3.2vw,36px)] leading-[1.05] font-normal">
        {title}
      </h2>
      {lead ? <p className="m-0 max-w-[640px] text-[15px] leading-[1.5] text-[#2A2926]">{lead}</p> : null}
      {children}
    </section>
  )
}

/** A link that leaves the site (GitHub), said so for screen readers. */
export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-ink underline decoration-ink/40 underline-offset-2">
      {children}
      <span aria-hidden> ↗</span>
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  )
}

/** A white tile inside a section. */
export const tile = 'rounded-[18px] bg-white/70 px-3.5 py-3'
