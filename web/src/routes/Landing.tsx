import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'

import { Button } from '../components/Button'
import { useAuth } from '../lib/useAuth'

const entries = [
  { title: 'Explore a real journey', sub: 'A 5-day self-tanner split-arm test. Read-only.', eta: '~1 min' },
  { title: 'Try with sample photos', sub: 'Run the live pipeline on our RAW samples.', eta: '~30 s' },
  { title: 'Try your own selfie', sub: 'Phone or laptop camera. Uncalibrated, trend only.', eta: '~1 min' },
]

export function Landing() {
  const { user, loading, continueAsGuest, signInWithGoogle } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="max-w-[36rem]">
      <h1 className="text-[clamp(36px,8vw,56px)] font-bold leading-[1.0] tracking-[-0.03em]">
        Did your serum actually work?
      </h1>
      <p className="mt-6 text-[17px] leading-relaxed text-text-2">
        Willow measures your skin from standardized photos and tells you whether a change is real or just the
        camera. Every number comes from calibrated computer vision; the AI only explains.
      </p>

      <div className="mt-10 flex flex-col gap-3">
        {entries.map((e) => (
          <Button
            key={e.title}
            variant="secondary"
            className="flex-col items-start !py-3 text-left"
            onClick={() => toast('Coming Wednesday. The upload test is live already.')}
          >
            <span className="flex w-full items-center justify-between">
              <span className="font-semibold">{e.title}</span>
              <span className="font-mono text-[13px] text-text-3">{e.eta}</span>
            </span>
            <span className="text-[13px] font-normal text-text-2">{e.sub}</span>
          </Button>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3 text-[13px] text-text-2">
        {loading ? (
          <span>Checking sign-in…</span>
        ) : user ? (
          <>
            <span>
              Signed in{user.isAnonymous ? ' as a guest' : user.email ? ` as ${user.email}` : ''}.
            </span>
            <Button variant="quiet" onClick={() => navigate('/upload-test')}>
              Go to the upload test
            </Button>
          </>
        ) : (
          <>
            <span>No sign-in needed to try it.</span>
            <Button variant="quiet" onClick={() => continueAsGuest().catch((e) => toast.error(String(e)))}>
              Continue as guest
            </Button>
            <Button variant="quiet" onClick={() => signInWithGoogle().catch((e) => toast.error(String(e)))}>
              Sign in with Google to keep your results
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
