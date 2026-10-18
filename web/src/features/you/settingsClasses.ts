/** The settings page's shared control classes: an outlined button and a choice chip. */
export const outline = 'min-h-11 rounded-pill bg-white px-4 text-[14px] whitespace-nowrap shadow-[inset_0_0_0_1px_rgba(18,18,18,.15)] transition-colors hover:bg-ink/[.03] disabled:opacity-55'
export const chip = (on: boolean) => `min-h-10 rounded-pill px-3.5 text-[14px] transition-colors duration-200 ${on ? 'bg-selected text-inverse' : 'bg-white text-ink shadow-[inset_0_0_0_1px_rgba(18,18,18,.12)]'}`
