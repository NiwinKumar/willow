import type { ReactNode } from 'react'
import { Drawer } from 'vaul'

/** Bottom sheet (phone) with drag-to-dismiss. Content scrolls inside; the grabber is the handle. */
export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-text/30" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[640px] flex-col rounded-t-(--radius-sheet) bg-bg shadow-[0_-8px_24px_oklch(0.24_0.018_130/0.1)] outline-none">
          <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-noise-500/60" aria-hidden />
          <Drawer.Title className="px-5 pt-3 text-[17px] font-semibold">{title}</Drawer.Title>
          <div className="overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-2">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
