/**
 * A number in the dot-matrix face (Doto) with a real decimal point. Doto draws "." as a five-dot cross, which reads
 * as a plus between the digits ("2+1"); here the point is one round dot sized to the digits' dots. Screen readers
 * get the plain text.
 */
export function DotNumber({ text, className = '' }: { text: string; className?: string }) {
  if (!text.includes('.')) return <span className={`font-dot ${className}`}>{text}</span>
  const parts = text.split('.')
  return (
    <span className={`font-dot ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {parts.map((p, i) => (
          <span key={i}>
            {i ? <span className="mx-[.05em] inline-block size-[.14em] rounded-full bg-current align-baseline" /> : null}
            {p}
          </span>
        ))}
      </span>
    </span>
  )
}
