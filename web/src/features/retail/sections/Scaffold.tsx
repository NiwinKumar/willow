import { useRetailState } from '../state'
import { EmptyState, SectionHeader } from '../ui'
import { useWorkspaceLabel } from './shared'

/**
 * A section whose screen is built by the next slice (slice D) before release: its route, header and an honest
 * "coming in this release" state, with a way to related data that already exists.
 */
export function Scaffold({ title, question, coming, next }: { title: string; question: string; coming: string; next: { label: string; path: string } }) {
  const eyebrow = useWorkspaceLabel()
  const { carry } = useRetailState()
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader eyebrow={eyebrow} title={title} answer={question} />
      <EmptyState glyph="··" title="Coming in this release" body={coming} action={{ label: next.label, to: `${next.path}${carry}` }} />
    </div>
  )
}
