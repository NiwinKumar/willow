import { Languages } from 'lucide-react'
import { useId } from 'react'

import { LANGUAGES, setLanguage, useLanguage, type LangCode } from '../../lib/language'

/**
 * The language Willow's explanations, stories and Wisp come back in (lib/language.ts). A native select:
 * accessible, keyboard and screen-reader friendly everywhere, and each language listed in its own script.
 * `compact`: the icon-led pill for Wisp's header.
 */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const lang = useLanguage()
  const id = useId()
  return (
    <label htmlFor={id} className={`relative inline-flex items-center gap-1.5 ${compact ? 'min-h-10 rounded-[16px] bg-ink/5 pr-2 pl-3 text-[12.5px] transition-colors hover:bg-ink/10 squircle' : 'min-h-11 rounded-pill bg-white/70 pr-2 pl-3.5 text-[14px] shadow-[inset_0_0_0_1px_var(--line-strong)]'}`}>
      <Languages size={compact ? 14 : 16} strokeWidth={1.8} aria-hidden />
      <span className="sr-only">Language for Willow’s answers</span>
      <select id={id} value={lang} onChange={(e) => setLanguage(e.target.value as LangCode)} className="cursor-pointer appearance-none bg-transparent pr-1 outline-none">
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  )
}
