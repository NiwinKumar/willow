import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'

import { useShell } from '../../components/shell/ShellContext'
import { Button, ButtonLink } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { WillowLoader } from '../../components/willow/WillowLoader'
import { SITE_ORDER } from '../../data/live'
import type { Site } from '../../data/types'
import { useData } from '../../data/useData'
import { CLOSE_UPS } from '../../lib/metrics'
import { dayOf } from './model'
import { Page } from './parts'

const isSite = (v: string | null): v is Site => v !== null && (SITE_ORDER as string[]).includes(v)
const PLACES: Site[] = ['face_full', ...CLOSE_UPS]

/**
 * /result and /result/:sessionId: there is one result page, the day's (/progress/:day?session=). Old links land
 * there, keeping ?metric= (a metric's detail) and ?from= (the check-in's "same time tomorrow?"). /result
 * alone is the latest analysed check-in (?site= picks a place).
 */
export default function Result() {
  const { sessionId } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const data = useData()
  const shell = useShell()

  if ((data.status === 'loading' || data.status === 'idle') && !data.all.length) return <WillowLoader inline label="Loading your results" />
  if (data.status === 'error' && !data.all.length)
    return (
      <Page label="Result">
        <EmptyState title="Your results did not load" body="Check your connection, then try again. Nothing was lost." action={<Button onClick={() => void data.refresh()}>Try again</Button>} />
      </Page>
    )

  const qSite = params.get('site')
  const pool = (isSite(qSite) ? [qSite] : PLACES).flatMap((p) => data.series(p)?.sessions ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const session = sessionId ? (data.all.find((s) => s.id === sessionId) ?? null) : ([...pool].reverse().find((s) => s.status === 'done') ?? pool[pool.length - 1] ?? null)

  if (!session)
    return (
      <Page label="Result">
        {sessionId ? (
          <EmptyState title="This check-in isn’t in your account" body="The link may be old, or it belongs to someone else." action={<ButtonLink to="/progress">Go to your progress</ButtonLink>} />
        ) : (
          <EmptyState
            title="Your first check-in becomes your baseline."
            body="Follow the light and distance checklist. With 3 or more usable photos, Willow measures how much your readings wobble on their own. Results appear here."
            action={
              <Button variant="ink" size="lg" onClick={() => shell.openCheckIn()}>
                Start my baseline
              </Button>
            }
          />
        )}
      </Page>
    )

  const q = new URLSearchParams({ session: session.id })
  for (const k of ['metric', 'from']) {
    const v = params.get(k)
    if (v) q.set(k, v)
  }
  return <Navigate to={`/progress/${dayOf(session)}?${q}`} replace state={location.state} />
}
