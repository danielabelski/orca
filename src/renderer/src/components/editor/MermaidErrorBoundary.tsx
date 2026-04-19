import React from 'react'
import { reportRendererCrash } from '../../lib/crash-log'

type Props = {
  /** Reset key — the mermaid source string. When it changes, a transient
   *  render failure auto-recovers on the next content. See design §Layer 3. */
  resetKey: string
  /** Fallback should expose the raw source so a persistently bad diagram is
   *  still inspectable ("view source" escape hatch, per design §Layer 3). */
  source: string
  children: React.ReactNode
}

type State = { error: Error | null }

// Why: mermaid is a third-party renderer consuming user-authored input; a
// malformed diagram string can throw inside its internal render pipeline and
// — without this boundary — unmount the parent markdown preview tree. Re-keying
// on the source string means changing the diagram auto-recovers without the
// user needing to click anything.
export class MermaidErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      reportRendererCrash({
        kind: 'render',
        boundary: 'MermaidErrorBoundary',
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack ?? undefined
      })
    } catch {
      /* swallow */
    }
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="mermaid-block">
          <div className="mermaid-error">
            Diagram could not be rendered. Showing source instead.
          </div>
          <pre>
            <code>{this.props.source}</code>
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}
