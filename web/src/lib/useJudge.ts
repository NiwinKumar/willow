import { useEffect, useState } from 'react'

import { judge } from './judge'

export function useJudge() {
  const [state, setState] = useState(judge.state)
  useEffect(() => {
    const on = () => setState(judge.state())
    window.addEventListener('willow-judge', on)
    return () => window.removeEventListener('willow-judge', on)
  }, [])
  return state
}

export function useJudgeOn(): boolean {
  return useJudge().on
}
