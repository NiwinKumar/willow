import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; /** A new value (the path) clears the error, so navigating away recovers. */ resetKey?: string }
type State = { error: Error | null; key?: string }

/** A render error anywhere in a page shows a calm way out instead of a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Willow page error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="card mx-auto my-12 max-w-[36rem] p-8">
        <h1 className="text-h1 font-normal">Something went wrong</h1>
        <p className="mt-3 text-[15px] text-ink-2">This page hit a problem. Your photos and results are safe. Reloading usually fixes it.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-11 items-center rounded-pill bg-selected px-[22px] text-[15px] font-medium text-inverse">
            Reload
          </button>
          {/* A full load, not a router link: the app's state starts fresh. */}
          <a href="/" onClick={() => { try { sessionStorage.removeItem('willow.demo') } catch { /* storage blocked */ } }} className="inline-flex min-h-11 items-center rounded-pill px-[22px] text-[15px] font-medium no-underline shadow-[inset_0_0_0_1px_var(--line-strong)]">
            Go to the start
          </a>
        </div>
      </div>
    )
  }
}
