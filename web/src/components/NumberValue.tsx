import NumberFlow from '@number-flow/react'

/** Tabular, reduced-motion-aware number. Unit sits after the value, smaller and quieter. */
export function NumberValue({ value, decimals, unit, size = 'lg', signed = false, className = '' }: { value: number | null; decimals: number; unit?: string; size?: 'lg' | 'md' | 'sm'; signed?: boolean; className?: string }) {
  const sz = size === 'lg' ? 'text-[26px]' : size === 'md' ? 'text-[17px]' : 'text-[15px]'
  if (value === null) return <span className={`font-mono ${sz} text-text-3 ${className}`}>–</span>
  return (
    <span className={`inline-flex items-baseline gap-1 font-mono font-medium leading-none tabular-nums ${sz} ${className}`}>
      <NumberFlow value={value} format={{ minimumFractionDigits: decimals, maximumFractionDigits: decimals, signDisplay: signed ? 'exceptZero' : 'auto' }} />
      {unit ? <span className="font-sans text-[0.72em] font-normal text-text-2">{unit}</span> : null}
    </span>
  )
}
