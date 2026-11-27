import { FlaskConical } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import { useProductTests, testDay } from './productTests'
import { StartTest, type TestPreset } from './StartTest'

/** What "Test this product" was pressed on: a routine entry or a catalog product. */
export type TestTarget = { entry_id?: string; product_id?: string; name: string }

/**
 * "Test this product" from anywhere a product is listed (search results, product sheet, routine rows): the
 * existing forearm test, started for that product. One test runs at a time, so a running one is shown instead.
 */
export function TestSheet({ target, onClose }: { target: TestTarget | null; onClose: () => void }) {
  const tests = useProductTests()
  const navigate = useNavigate()
  const running = tests.running
  const preset: TestPreset | null = target ? { ...target, fixedName: true } : null
  return (
    <Sheet open={target !== null} onClose={onClose} title="Test this product" variant="modal" size="sm">
      {target && preset ? (
        <div className="flex flex-col gap-3" style={{ animation: 'wRise .35s var(--ease-standard) both' }}>
          <span className="text-[17px] leading-[1.3] text-pretty">{target.name}</span>
          {running ? (
            <>
              <p className="m-0 rounded-[16px] bg-sunken px-4 py-3 text-[14px] leading-[1.5]">
                A test of {running.name} is running (day {testDay(running).day} of {running.length_days}). End it on the test page before starting another.
              </p>
              <Button
                variant="outline"
                size="sm"
                icon={FlaskConical}
                className="self-start"
                onClick={() => {
                  onClose()
                  navigate('/test')
                }}
              >
                Open the running test
              </Button>
            </>
          ) : tests.status === 'ready' ? (
            <StartTest key={target.entry_id ?? target.product_id ?? target.name} preset={preset} onCancel={onClose} onStarted={onClose} />
          ) : tests.status === 'error' ? (
            <p role="alert" className="m-0 text-[14px] text-avoid">
              Your tests didn’t load. Close this and try again.
            </p>
          ) : (
            <span aria-busy className="skeleton block h-24 rounded-[16px]" />
          )}
        </div>
      ) : null}
    </Sheet>
  )
}

/** The small "Test this product" pill used on product rows. */
export function TestThisButton({ onClick, label = 'Test this product', name, className = '' }: { onClick: () => void; label?: string; /** The product, for the accessible name. */ name?: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={name ? `${label}: ${name}` : undefined} className={`hit44 inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-[12px] whitespace-nowrap shadow-[inset_0_0_0_1px_var(--line-strong)] transition-[background-color,scale] duration-200 ease-standard hover:bg-ink/5 active:scale-[.97] ${className}`}>
      <FlaskConical size={13} strokeWidth={1.7} aria-hidden />
      {label}
    </button>
  )
}
