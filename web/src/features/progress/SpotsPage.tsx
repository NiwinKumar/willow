import { useMemo, useState } from 'react'

import { useShell } from '../../components/shell/ShellContext'
import { useOwner, useSpots } from '../../data/hooks'
import { useData } from '../../data/useData'
import type { Session } from '../../data/types'
import type { SpotTrack } from '../../lib/api'
import { MOLE_NOTE } from '../../lib/spotLabels'
import { Crumb, Page, StatusCard } from './parts'
import { SpotDiary } from './SpotDiary'
import { useSessionView } from './useSessionView'

const EMPTY: Session[] = []

/**
 * The spot diary on its own page (`/spots`, api `GET /v1/spots`): each mark followed across face check-ins.
 * It lived on the face report until the result page became the day page (Oct 18); it is back here so the day
 * page stays as it is. Live accounts only: the demo journey has no diary of its own.
 */
export default function SpotsPage() {
  const owner = useOwner()
  const data = useData()
  const shell = useShell()
  const spots = useSpots()
  const [selected, setSelected] = useState<string | null>(null)
  const face = data.series('face_full')?.sessions ?? EMPTY

  // The spots are drawn on the latest face photo the diary covers (one with a preview and a result).
  const photo = useMemo(() => {
    const ids = spots.data?.sessions.map((x) => x.id) ?? []
    for (const id of [...ids].reverse()) {
      const s = face.find((x) => x.id === id)
      if (s?.preview && s.result) return s
    }
    return null
  }, [spots.data, face])
  // Its front and cheek photos, signed (only the single-session view signs them).
  const photoView = useSessionView(photo?.id ?? null)

  const crumb = <Crumb to="/progress" back="Progress" here="Spot diary" />
  if (!owner)
    return (
      <Page label="Spot diary">
        {crumb}
        <StatusCard
          title="The spot diary follows your own spots."
          body="It needs your own face check-ins, so it isn't part of the demo. Sign in and check in a few times to see it fill in."
        />
      </Page>
    )

  return (
    <Page label="Spot diary">
      {crumb}
      <SpotDiary
        status={spots.status}
        diary={spots.data}
        onRetry={() => void spots.refetch()}
        stageSessionId={photo?.id ?? null}
        selected={selected}
        onPick={(t: SpotTrack) => setSelected((id) => (id === t.id ? null : t.id))}
        onTake={() => shell.openCheckIn()}
        photo={photo}
        photoViews={photoView?.session.views ?? []}
      />
      <p className="max-w-[560px] text-[13px] leading-normal text-ink-2">Moles are not followed. {MOLE_NOTE}</p>
    </Page>
  )
}
