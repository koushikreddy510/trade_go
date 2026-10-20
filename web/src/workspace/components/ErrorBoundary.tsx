import { Component, type ErrorInfo, type ReactNode } from 'react'

/** If one part of the screen throws while rendering, show a message there instead of blanking the app. */
export class ErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} crashed`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="boundary" role="alert">
        <b>The {this.props.label} hit a problem.</b>
        <p className="muted">{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    )
  }
}
