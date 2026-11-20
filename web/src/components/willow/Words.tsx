/**
 * A heading whose words come into focus one after another (the serif page titles and greetings). Each word
 * rises a third of a line and sharpens, 110ms apart, so a title reads as it is written rather than appearing
 * at once. Reduced motion: the global rule makes every step instant.
 */
export function Words({ text, delay = 120, step = 110, className = '' }: { text: string; delay?: number; step?: number; className?: string }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((w, i) => (
        <span key={`${w}${i}`} className={`inline-block animate-[wLetter_.7s_var(--ease-standard)_both] ${className}`} style={{ animationDelay: `${delay + i * step}ms` }}>
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}
