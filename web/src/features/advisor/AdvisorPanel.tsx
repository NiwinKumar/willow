import type { AdvisorSeed } from '../../components/shell/ShellContext'

/** STUB: replaced by the design port (Willow App Routine.dc.html, view="advisor"). */
export default function AdvisorPanel({ seed, onClose }: { seed: AdvisorSeed | null; onClose: () => void }) {
  return (
    <div className="p-4">
      <button type="button" onClick={onClose}>Close</button>
      <p>{seed?.text}</p>
    </div>
  )
}
