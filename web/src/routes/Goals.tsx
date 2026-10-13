import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '../components/Button'
import { GOALS } from '../lib/metrics'
import { prefs } from '../lib/prefs'

const times = [
  { id: 'evening', label: 'Evening', hint: 'Most people do this after washing their face in the evening.' },
  { id: 'morning', label: 'Morning', hint: 'Before any product, after washing.' },
  { id: 'skip', label: 'Skip', hint: 'No reminder copy.' },
]

export function Goals() {
  const [picked, setPicked] = useState<string[]>(prefs.goals())
  const [time, setTime] = useState<string>(prefs.photoTime() ?? 'evening')
  const navigate = useNavigate()
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]))
  return (
    <div className="mx-auto max-w-[36rem] px-5 pb-16 pt-4 sm:px-8">
      <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">What would you like to track?</h1>
      <p className="mt-2 text-[15px] text-text-2">Pick up to three. This only changes the order of your report. Everything is still measured.</p>
      <ul className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Goals">
        {GOALS.map((g) => {
          const on = picked.includes(g.id)
          return (
            <li key={g.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(g.id)}
                className={`min-h-11 rounded-full border px-4 text-[15px] transition-[background-color,color,transform] duration-150 active:scale-[0.98] ${on ? 'border-text bg-text text-surface' : 'border-border bg-surface text-text hover:bg-surface-2'}`}
              >
                {g.label}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 font-mono text-[12px] text-text-3">{picked.length} of 3</p>

      <h2 className="mt-8 text-[17px] font-semibold">When will you usually take photos?</h2>
      <ul className="mt-3 space-y-2" role="radiogroup" aria-label="Photo time">
        {times.map((t) => (
          <li key={t.id}>
            <label className={`flex cursor-pointer items-center gap-3 rounded-(--radius-tile) border p-3 ${time === t.id ? 'border-text bg-surface' : 'border-border'}`}>
              <input type="radio" name="time" className="h-5 w-5 accent-[var(--color-text)]" checked={time === t.id} onChange={() => setTime(t.id)} />
              <span>
                <span className="block text-[15px] font-medium">{t.label}</span>
                <span className="block text-[13px] text-text-2">{t.hint}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <Button
        className="mt-8"
        onClick={() => {
          prefs.setGoals(picked)
          prefs.setPhotoTime(time)
          try {
            sessionStorage.setItem('willow.goals', JSON.stringify(picked))
          } catch {
            /* ignore */
          }
          navigate('/capture')
        }}
      >
        Start my baseline
      </Button>
    </div>
  )
}
