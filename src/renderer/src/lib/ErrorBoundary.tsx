import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col gap-3 overflow-auto bg-zinc-950 p-6 text-zinc-100">
          <h1 className="text-lg font-semibold text-red-400">Render error</h1>
          <pre className="whitespace-pre-wrap rounded-md bg-zinc-900 p-3 text-xs">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="self-start rounded bg-indigo-500 px-3 py-1.5 text-sm"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
