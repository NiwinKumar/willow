import { AlertCircle, ArrowLeftRight, FlaskConical, Info, type LucideIcon } from 'lucide-react'

import { Sheet } from '../../components/ui/Sheet'
import type { RoutineEntry } from '../../data/types'
import { ProductImage } from './productUi'
import { entryName, imageOf, metaLine } from './routineModel'

type Action = { id: 'details' | 'test' | 'reaction' | 'swap'; label: string; hint: string; icon: LucideIcon }

/** A routine row's ⋯: the product's details, test it on the forearm, log a reaction, see a swap. */
export function EntryActions({ entry, onClose, onPick }: { entry: RoutineEntry | null; onClose: () => void; onPick: (id: Action['id'], e: RoutineEntry) => void }) {
  const actions: Action[] = entry
    ? [
        { id: 'details', label: 'Product details', hint: 'Ingredients, how often, your readings', icon: Info },
        { id: 'test', label: 'Test this product', hint: 'On one forearm square, against an untouched one', icon: FlaskConical },
        { id: 'reaction', label: 'I had a reaction', hint: 'What to do now, from fixed rules', icon: AlertCircle },
        ...(entry.product_id ? [{ id: 'swap' as const, label: 'See a swap', hint: 'Same active at a similar strength', icon: ArrowLeftRight }] : []),
      ]
    : []
  return (
    <Sheet open={entry !== null} onClose={onClose} title={entry ? entryName(entry) : 'Product'} hideTitle variant="modal" size="sm">
      {entry ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <ProductImage product={imageOf(entry)} size={44} decorative />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[16px]">{entryName(entry)}</span>
              <span className="truncate text-[12.5px] text-ink-2">{metaLine(entry.brand, entry.category)}</span>
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {actions.map((a, i) => (
              <li key={a.id} style={{ animation: `wRise .35s ${i * 50}ms both` }}>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onPick(a.id, entry)
                  }}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-[16px] bg-sunken px-3.5 text-left transition-[background-color,scale] duration-200 ease-standard hover:bg-muted active:scale-[.985]"
                >
                  <a.icon size={17} strokeWidth={1.7} aria-hidden className="shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[14.5px]">{a.label}</span>
                    <span className="truncate text-[12px] text-ink-2">{a.hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Sheet>
  )
}
