import { useEffect, useState, type ReactNode } from 'react'

/**
 * The settings page's two building blocks: a Group (a small heading over one card) and a Row (the setting's
 * name and a line of help on the left, its control on the right; `stack` puts the control below, for chips).
 * Rows inside a group are divided by hairlines, so every setting reads the same way.
 */
export function Group({ id, title, children, tone = 'plain' }: { id: string; title: string; children: ReactNode; tone?: 'plain' | 'danger' }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-24 flex-col gap-2">
      <h2 id={`${id}-h`} className="m-0 px-1 text-[13px] font-normal text-ink-2">
        {title}
      </h2>
      <div className={`flex flex-col divide-y rounded-[24px] px-5 squircle ${tone === 'danger' ? 'divide-coral/25 bg-surface shadow-[inset_0_0_0_1px_rgba(255,107,74,.35)]' : 'divide-ink/[.07] bg-surface'}`}>{children}</div>
    </section>
  )
}

export function Row({ label, hint, children, stack = false, id }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; stack?: boolean; id?: string }) {
  return (
    <div id={id} className={`flex scroll-mt-24 gap-x-6 gap-y-3 py-4 ${stack ? 'flex-col' : 'flex-wrap items-center justify-between'}`}>
      <div className={`flex min-w-0 flex-col gap-0.5 ${stack ? '' : 'flex-[1_1_240px]'}`}>
        <span className="text-[15px]">{label}</span>
        {hint ? <span className="text-[13px] leading-[1.45] text-ink-2">{hint}</span> : null}
      </div>
      {children ? <div className={stack ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-2'}>{children}</div> : null}
    </div>
  )
}

/** A toggle in a group: the same padding as a Row. */
export function ToggleRow({ children }: { children: ReactNode }) {
  return <div className="py-2.5">{children}</div>
}

/**
 * Wide screens only (≥1180px): the page's groups as a short index in the empty gutter beside the column, so a
 * long settings page is one click from any group. The current group (the one under the header line) is marked by
 * an ink bar that slides between names.
 * Four tests: one click to any of the seven groups on a page ~2,400px tall; plain group names, nothing to learn;
 * sits in the gutter where nothing else is, still while reading; the page's own type and ink.
 */
export function GroupIndex({ groups }: { groups: { id: string; title: string }[] }) {
  const [current, setCurrent] = useState<string | undefined>(groups[0]?.id)
  useEffect(() => {
    const els = groups.map((g) => document.getElementById(g.id)).filter((x): x is HTMLElement => Boolean(x))
    const pick = () => {
      // the last group whose top has passed a line a third of the way down the window
      const line = window.innerHeight / 3
      let id: string | undefined = els[0]?.id
      for (const el of els) if (el.getBoundingClientRect().top <= line) id = el.id
      // at the very end the last (short) group is current even if its top never reaches the line
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) id = els.at(-1)?.id
      setCurrent(id)
    }
    pick()
    window.addEventListener('scroll', pick, { passive: true })
    window.addEventListener('resize', pick)
    return () => {
      window.removeEventListener('scroll', pick)
      window.removeEventListener('resize', pick)
    }
  }, [groups])
  const at = Math.max(0, groups.findIndex((g) => g.id === current))
  const go = (id: string) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }
  return (
    <nav aria-label="Settings groups" className="absolute top-[72px] bottom-0 left-full hidden w-[200px] pl-8 xl:block">
      <div className="sticky top-24 flex flex-col">
        <span aria-hidden className="absolute top-0 left-0 h-9 w-[2px] rounded-pill bg-ink transition-transform duration-300 ease-standard" style={{ transform: `translateY(${at * 36}px)` }} />
        {groups.map((g) => (
          <button key={g.id} type="button" onClick={() => go(g.id)} aria-current={g.id === current ? 'true' : undefined} className={`flex h-9 items-center pl-4 text-left text-[13px] transition-colors duration-200 ${g.id === current ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
            {g.title}
          </button>
        ))}
        <span aria-hidden className="absolute top-0 left-0 -z-10 h-full w-[2px] rounded-pill bg-ink/10" />
      </div>
    </nav>
  )
}
