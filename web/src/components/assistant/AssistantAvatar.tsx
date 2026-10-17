import { memo, useEffect, useId, useLayoutEffect, useRef } from 'react'

import { arcPath, AvatarMotion, type AvatarState, type Frame } from './avatarMotion'
import { BUTTON_MINIMAL, CAT_EAR_L, CAT_EAR_R, CAT_GLOW, CAT_HEAD, EAR_PIVOTS } from './catSvg'

export type { AvatarState } from './avatarMotion'

/**
 * Willow's assistant: the shadow cat from the asset pack (`shadow_cat_avatar_assets`), redrawn in code and
 * animated in code, never as a flipbook. No raster files: every layer is vector, sharp at any size.
 *
 * Layers (all on the pack's shared 1024-unit canvas, so they register exactly when stacked at the same size):
 *   1. container: the pack's minimal button (`vector/button_minimal.svg`), or nothing (`container="none"`, the
 *      cat floats free). Static: the creature lives inside it.
 *   2. creature: one transformed group (float, breath, tilt, hop) holding the cat's parts, each moving within it:
 *        a. ears, left and right, behind the head, each turning about its base (pose, flicks, follow-through),
 *        b. head, which follows the gaze, holding
 *             - glow: a soft bloom of the rim light, behind the head; its opacity follows the state,
 *             - head and body: the cat redrawn as vector layers (`catArt.ts`, fitted to the pack's body layer:
 *               blurred darkness outlines, the iridescent rim light, a fine grain), built once in `catSvg.ts`,
 *             - eyes: vector eyes from the pack's SVG shapes (`vector/eyes/*.svg`: circles at 409,505 and
 *               615,505, r 30; arcs for closed / sleepy), as live SVG so blinks, glances, lids and arcs blend.
 *      In the button the creature is clipped to its inner circle, so a bounce never pokes out of it.
 *
 * Motion lives in `avatarMotion.ts`. One requestAnimationFrame loop per avatar writes transforms and SVG
 * attributes straight to the DOM: no React state per frame, nothing re-renders while it animates. The loop
 * pauses while the avatar is off screen (and the browser pauses it in background tabs). The body and glow are
 * images of SVG, so the browser rasterises their blurs once; frames only move them.
 */
export type AssistantAvatarProps = {
  state?: AvatarState
  /** CSS pixels (48, 64, 96, 128, 256, 512 all work; any size does) */
  size?: number
  /** 0..1 speech energy while speaking; smoothed inside. Omit it and speaking makes its own gentle energy. */
  audioLevel?: number
  /** the same, read every frame (e.g. from an AnalyserNode): live audio without re-rendering the avatar */
  audioSource?: () => number
  /** force reduced motion on or off; by default it follows prefers-reduced-motion */
  reducedMotion?: boolean
  className?: string
  /** accessible name; without one the avatar is decorative (its button or heading names it) */
  label?: string
  /** 'minimal': in the pack's minimal button (default). 'none': the cat on its own. */
  container?: 'minimal' | 'none'
}

const LAYER = 'pointer-events-none absolute inset-0 size-full select-none'
// The button's inner circle in the pack: centre 512, radius about 462 of 1024. The creature is clipped to it,
// then pushed back out by the same margin (as a share of the clip box) so its layers keep the full canvas.
const CLIP = (512 - 462) / 1024
const CLIP_INSET = `${CLIP * 100}%`
const UNCLIP_INSET = `${(-CLIP / (1 - 2 * CLIP)) * 100}%`

type EyeParts = {
  g: SVGGElement
  disc: SVGGElement
  circle: SVGCircleElement
  lid: SVGRectElement
  arc: SVGPathElement
}

function AssistantAvatarImpl({ state = 'idle', size = 64, audioLevel, audioSource, reducedMotion, className = '', label, container = 'minimal' }: AssistantAvatarProps) {
  const root = useRef<HTMLDivElement>(null)
  const creature = useRef<HTMLDivElement>(null)
  const glow = useRef<HTMLImageElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const ears = useRef<(HTMLImageElement | null)[]>([])
  const eyes = useRef<(EyeParts | null)[]>([])
  // Props the loop reads without restarting: kept in refs, updated on render.
  const live = useRef({ state, audioLevel, audioSource, reducedMotion, size })
  useLayoutEffect(() => {
    live.current = { state, audioLevel, audioSource, reducedMotion, size }
  })
  // useId's format varies by React version («r0», :r0:): keep only characters safe in url(#id)
  const uid = `cat${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  useEffect(() => {
    const el = root.current
    if (!el) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reduced = () => live.current.reducedMotion ?? media.matches
    const motion = new AvatarMotion({
      state: live.current.state,
      reducedMotion: reduced(),
    })
    let raf = 0
    let last = 0
    let visible = true
    let speechT = Math.random() * 10

    const draw = (f: Frame) => {
      const k = live.current.size / 1024 // pack units -> CSS px
      const c = creature.current
      if (c) c.style.transform = `translate3d(${(f.x * k).toFixed(3)}px, ${(f.y * k).toFixed(3)}px, 0) rotate(${f.tilt.toFixed(3)}deg) scale(${f.sx.toFixed(4)}, ${f.sy.toFixed(4)})`
      if (glow.current) glow.current.style.opacity = f.glow.toFixed(3)
      if (head.current) head.current.style.transform = `translate3d(${(f.head.x * k).toFixed(3)}px, ${(f.head.y * k).toFixed(3)}px, 0) rotate(${f.head.rot.toFixed(3)}deg)`
      f.ears.forEach((e, i) => {
        const el = ears.current[i]
        if (el) el.style.transform = `translate3d(${(e.x * k).toFixed(3)}px, ${(e.y * k).toFixed(3)}px, 0) rotate(${e.rot.toFixed(3)}deg) scaleX(${e.sx.toFixed(4)})`
      })
      f.eyes.forEach((e, i) => {
        const parts = eyes.current[i]
        if (!parts) return
        const { g, disc, circle, lid, arc } = parts
        g.setAttribute('transform', `translate(${e.x.toFixed(2)} ${e.y.toFixed(2)})`)
        // round eye: squashed for blinks, its top cut by the lid line
        disc.setAttribute('transform', `scale(1 ${e.sy.toFixed(4)})`)
        disc.setAttribute('opacity', e.disc.toFixed(3))
        circle.setAttribute('r', e.r.toFixed(2))
        lid.setAttribute('y', (-e.r + e.lid * 2 * e.r).toFixed(2))
        lid.setAttribute('transform', `rotate(${e.lidTilt.toFixed(2)})`)
        // arc eye: closed (sags down), sleepy (shallower), happy (arches up), cross-faded with the round eye
        arc.setAttribute('d', arcPath(e.sag))
        arc.setAttribute('stroke-width', e.stroke.toFixed(2))
        arc.setAttribute('opacity', e.arc.toFixed(3))
      })
    }

    const tick = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0
      last = now
      motion.setReducedMotion(reduced())
      const { state: s, audioSource: src } = live.current
      const a = src ? src() : live.current.audioLevel
      // Speaking without a level: a soft made-up voice (two slow waves and a syllable pulse, always smooth).
      let level: number | null = a ?? null
      if (level == null && s === 'speaking') {
        speechT += dt
        const syll = Math.max(0, Math.sin(speechT * 9.5)) ** 2
        level = 0.25 + 0.35 * syll * (0.6 + 0.4 * Math.sin(speechT * 1.7)) + 0.1 * Math.sin(speechT * 3.1)
      }
      draw(motion.step(dt, s, level))
      raf = visible ? requestAnimationFrame(tick) : 0
    }
    raf = requestAnimationFrame(tick)

    // Off screen: stop the loop; back on screen: resume from where it was (dt is capped, no lurch).
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible && !raf) {
        last = 0
        raf = requestAnimationFrame(tick)
      }
    })
    io.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [])

  const boxed = container === 'minimal'
  return (
    <div
      ref={root}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`relative shrink-0 ${className}`}
      style={{ width: size, height: size, contain: 'layout paint' }}
    >
      {/* 1. the button, static */}
      {boxed ? <img src={BUTTON_MINIMAL} alt="" draggable={false} className={LAYER} /> : null}
      {/* 2. the creature, clipped to the button and moved as one */}
      <div className={`pointer-events-none absolute ${boxed ? 'overflow-hidden rounded-full' : ''}`} style={{ inset: boxed ? CLIP_INSET : 0 }}>
        <div
          ref={creature}
          className="absolute will-change-transform"
          // undo the clip's inset so the layers keep the full canvas registration
          style={{
            inset: boxed ? UNCLIP_INSET : 0,
            transformOrigin: '50% 72%',
          }}
        >
          {[CAT_EAR_L, CAT_EAR_R].map((src, i) => (
            <img
              key={i}
              ref={(el) => {
                ears.current[i] = el
              }}
              src={src}
              alt=""
              draggable={false}
              className={LAYER}
              style={{
                transformOrigin: `${(EAR_PIVOTS[i][0] / 10.24).toFixed(2)}% ${(EAR_PIVOTS[i][1] / 10.24).toFixed(2)}%`,
              }}
            />
          ))}
          <div ref={head} className={LAYER} style={{ transformOrigin: '50% 62%' }}>
            <img ref={glow} src={CAT_GLOW} alt="" draggable={false} className={LAYER} style={{ opacity: 0.14 }} />
            <img src={CAT_HEAD} alt="" draggable={false} className={LAYER} />
            <svg viewBox="0 0 1024 1024" className={LAYER} aria-hidden>
              {[409, 615].map((x, i) => (
                <g
                  key={x}
                  ref={(g) => {
                    eyes.current[i] = g
                      ? {
                          g,
                          disc: g.querySelector('[data-disc]') as SVGGElement,
                          circle: g.querySelector('circle') as SVGCircleElement,
                          lid: g.querySelector('clipPath rect') as SVGRectElement,
                          arc: g.querySelector('path') as SVGPathElement,
                        }
                      : null
                  }}
                  transform={`translate(${x} 505)`}
                >
                  {/* the lid: everything below this line shows (moved down for half-lidded, tilted for focused) */}
                  <clipPath id={`${uid}-lid${i}`} clipPathUnits="userSpaceOnUse">
                    <rect x={-80} y={-30} width={160} height={160} />
                  </clipPath>
                  <g data-disc="">
                    <circle cx={0} cy={0} r={30} fill="#fff" clipPath={`url(#${uid}-lid${i})`} />
                  </g>
                  <path d={arcPath(34)} stroke="#fff" strokeWidth={10} strokeLinecap="round" fill="none" opacity={0} />
                </g>
              ))}
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Memoised: a parent re-rendering with the same props never touches the layers; the loop keeps running. */
export const AssistantAvatar = memo(AssistantAvatarImpl)
