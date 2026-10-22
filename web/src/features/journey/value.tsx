import type { ReactNode } from 'react'

/**
 * The value slides shared by both journeys (/journey, /journey/brand): what Willow is worth to a retailer, said
 * against the four parts of the Retail & Commerce brief (understand, engage and serve customers; run efficiently).
 */

/** One point on a value slide: what it is, then why it matters. */
export function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-[18px] bg-white/75 px-4 py-3">
      <span className="text-[15.5px]">{title}</span>
      <span className="text-[14px] leading-[1.45] text-ink-2">{children}</span>
    </li>
  )
}

/** What the retailer gains, one point per part of the brief. */
export function BriefPoints() {
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      <Point title="Understand customers">What visibly changed for each skin type and goal, across every brand on the shelf. Not just what was bought.</Point>
      <Point title="Engage them">Wisp, a Gemini adviser, answers in the shopper’s own words from her own measurements.</Point>
      <Point title="Serve them better">Recommend what worked for people with the same skin and goal, and catch clashes before they turn into returns.</Point>
      <Point title="Run more efficiently">Stock and promote what is proven. Proof flags what to rethink, and every campaign’s lift is measured against a holdout.</Point>
    </ul>
  )
}

/** A chapter's worth, in one line under its lead. */
export function Worth({ label = 'What it’s worth', shopper = false, children }: { label?: string; shopper?: boolean; children: ReactNode }) {
  return (
    <p className={`m-0 flex max-w-[540px] flex-col gap-1 rounded-[18px] px-4 py-3 text-[14.5px] leading-[1.45] ${shopper ? 'bg-[#EEF7E6]' : 'bg-[#ECEFFB]'}`}>
      <span className="text-[12.5px] text-ink-2">{label}</span>
      {children}
    </p>
  )
}
