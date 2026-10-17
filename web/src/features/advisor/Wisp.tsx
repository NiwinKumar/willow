import { useEffect, useState } from 'react'

import { AssistantAvatar, type AvatarState } from '../../components/assistant/AssistantAvatar'

/**
 * Wisp, Willow's assistant, as it appears inside the chat: the shadow cat (components/assistant) on its own,
 * without the button. `still` keeps the body quiet (it still blinks): for the marks beside earlier answers,
 * so a long conversation is not a row of bobbing cats.
 */
export function WispMark({ size, state = 'idle', still }: { size: number; state?: AvatarState; still?: boolean }) {
  return <AssistantAvatar state={state} size={size} container="none" reducedMotion={still ? true : undefined} />
}

/** What the chat is doing, as Wisp's state: thinking while a question is out, speaking while the answer is revealed. */
export const wispState = (phase: 'idle' | 'thinking' | 'revealing'): AvatarState => (phase === 'thinking' ? 'thinking' : phase === 'revealing' ? 'speaking' : 'idle')

/** True while the question field has focus (Wisp listens). */
export function useComposing() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const check = () => setOn(document.activeElement?.id === 'ask-input')
    check()
    document.addEventListener('focusin', check)
    document.addEventListener('focusout', check)
    return () => {
      document.removeEventListener('focusin', check)
      document.removeEventListener('focusout', check)
    }
  }, [])
  return on
}
