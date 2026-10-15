/** The two drifting blurred blobs behind the app (once, in the shell; static under reduced motion). */
export function CanvasBlobs() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden" style={{ background: 'radial-gradient(45% 50% at 85% 0%, rgba(255,178,122,.55), transparent 70%), radial-gradient(40% 45% at 0% 20%, rgba(216,184,255,.5), transparent 70%)' }}>
      <div className="absolute rounded-full blur-[50px]" style={{ left: '70%', top: '-20%', width: '40vw', height: '40vw', background: 'rgba(255,160,100,.45)', animation: 'wDrift 18s ease-in-out 0s infinite alternate' }} />
      <div className="absolute rounded-full blur-[50px]" style={{ left: '-10%', top: '10%', width: '36vw', height: '36vw', background: 'rgba(190,150,255,.45)', animation: 'wDrift 22s ease-in-out -3s infinite alternate' }} />
    </div>
  )
}
