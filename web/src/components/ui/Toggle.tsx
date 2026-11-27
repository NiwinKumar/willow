/** 44×26 switch: off grey, on ink (never green). role=switch; the whole row is the label. The knob slides on a spring and stretches a little while pressed. */
export function Toggle({ label, checked, onChange, description, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-11 items-center justify-between gap-4 transition-opacity duration-300 ${disabled ? 'opacity-55' : 'cursor-pointer'}`}>
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
        className={`group relative h-[26px] w-11 shrink-0 rounded-pill transition-[background-color,scale] duration-200 ease-standard active:scale-[.97] active:duration-100 disabled:active:scale-100 ${checked ? 'bg-selected' : 'bg-ink/20'}`}
      >
        <span
          aria-hidden
          className={`absolute top-[3px] left-[3px] h-5 w-5 rounded-full bg-white shadow-raised transition-[translate,width,margin] duration-[260ms] ease-spring group-enabled:group-active:w-6 motion-reduce:transition-none ${checked ? 'group-enabled:group-active:-ml-1' : ''}`}
          style={{ translate: checked ? '18px 0' : '0 0' }}
        />
      </button>
    </label>
  )
}
