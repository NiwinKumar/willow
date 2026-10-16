import type { BrandDetail } from '../../types'
import { EmptyState, int, MIN_GROUP, Panel, useTooltip } from '../../ui'
import { switchRows } from '../../ui/insight'

const MINUS = '−'
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? MINUS : '±'}${int(Math.abs(n))}`

/**
 * Switching: people who stopped a product and started another in the same category within 2 weeks, per
 * counterpart brand, as diverging bars (lost to, left, gray; won from, right, leaf). The net counts every
 * switch, including pairs under 10 that aren't listed, so it can differ from the bars' sum.
 */
export function SwitchingPanel({ b, className = '' }: { b: BrandDetail; className?: string }) {
  const rows = switchRows(b.switching.won, b.switching.lost)
  const max = Math.max(1, ...rows.flatMap((r) => [r.won ?? 0, r.lost ?? 0]))
  const net = b.switching.net
  const tip = useTooltip(`Every switch in or out, including brand pairs under ${MIN_GROUP} people that aren’t listed.`)
  const w = (v: number | null) => `${((v ?? 0) / max) * 100}%`
  return (
    <div id="switching" className={`scroll-mt-24 ${className}`}>
      <Panel
        title="Switching"
        id="switch-h"
        description="Stopped a product and started another in the same category within 2 weeks."
        actions={
          net === null ? (
            <span className="text-proof-small text-ink-2">Net: fewer than {MIN_GROUP}</span>
          ) : (
            <>
              <span {...tip.trigger} tabIndex={0} className={`cursor-help text-proof-body tnum ${net > 0 ? 'text-proof-leaf' : 'text-ink'}`}>
                Net {signed(net)} {Math.abs(net) === 1 ? 'person' : 'people'}
              </span>
              {tip.node}
            </>
          )
        }
        className="h-full"
      >
        {rows.length === 0 ? (
          <EmptyState compact title={`No brand pair with ${MIN_GROUP}+ switchers`} body={`Nobody switched between ${b.brand} and one other brand in groups of ${MIN_GROUP} or more in this filter.`} />
        ) : (
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">People who switched between {b.brand} and other brands</caption>
            <thead>
              <tr className="text-proof-label text-ink-2">
                <th scope="col" className="w-[34%] pb-2 text-left font-normal">
                  Brand
                </th>
                <th scope="col" className="pb-2 pr-2 text-right font-normal">
                  Lost to
                </th>
                <th scope="col" className="pb-2 pl-2 text-left font-normal">
                  Won from
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.brand} className="border-t border-line">
                  <th scope="row" className="h-10 truncate pr-2 text-left text-proof-body font-normal text-ink" title={r.brand}>
                    {r.brand}
                  </th>
                  <td className="border-r border-line-strong pr-2">
                    <span className="flex items-center justify-end gap-2">
                      <span className="text-proof-small text-ink-2 tnum">{r.lost === null ? <span className="sr-only">fewer than {MIN_GROUP}</span> : int(r.lost)}</span>
                      <span aria-hidden className="block h-2.5 rounded-l-[3px] bg-[var(--pf-base)]" style={{ width: `calc(${w(r.lost)} * 0.7)` }} />
                    </span>
                  </td>
                  <td className="pl-2">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="block h-2.5 rounded-r-[3px] bg-proof-leaf" style={{ width: `calc(${w(r.won)} * 0.7)` }} />
                      <span className="text-proof-small text-ink tnum">{r.won === null ? <span className="sr-only">fewer than {MIN_GROUP}</span> : int(r.won)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}
