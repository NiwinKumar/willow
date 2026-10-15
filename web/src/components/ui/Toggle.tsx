/** 44×26 switch: off grey, on ink (never green). role=switch; the whole row is the label. */
export function Toggle({ label, checked, onChange, description, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-11 items-center justify-between gap-4 ${disabled ? 'opacity-55' : 'cursor-pointer'}`}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px]">{label}</span>
        {description ? <span className="text-[13px] text-ink-2">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[26px] w-11 shrink-0 rounded-pill transition-colors ${checked ? 'bg-selected' : 'bg-ink/20'}`}
      >
        <span aria-hidden className={`absolute top-[3px] size-5 rounded-full bg-white shadow-raised transition-[left] duration-200 ${checked ? 'left-[21px]' : 'left-[3px]'}`} />
      </button>
    </label>
  )
}
