import React from 'react'
import { reportRendererCrash } from '../../lib/crash-log'

type Props = {
  /** Reset key — the highlighted source. Changing the source retries the
   *  highlighter automatically. See design §Layer 3. */
  resetKey: string
  /** Fallback source shown un-highlighted so a persistently bad payload is
   *  still readable — "view source" escape hatch per design §Layer 3. */
  source: string
  className?: string
  children: React.ReactNode
}

type State = { error: Error | null }

// Why: rehype-highlight (lowlight) runs untrusted-ish source through a
// language grammar. A malformed payload can throw inside the highlighter and
// — without containment — blow away the surrounding markdown tree. Falling
// back to the plain <code> with source text keeps the content readable.
export class CodeHighlightErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      reportRendererCrash({
        kind: 'render',
        boundary: 'CodeHighlightErrorBoundary',
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
      return <code className={this.props.className}>{this.props.source}</code>
    }
    return this.props.children
  }
}
