import React from 'react'
import { formatCrashDiagnostics, reportRendererCrash } from '../lib/crash-log'

type Props = { children: React.ReactNode }
type State = { error: Error | null; componentStack: string | null; copied: boolean }

// Why: renderer root last-resort boundary per error-boundary-design.md Layer 1.
// Fallback UI must be as close to static as possible — zero context/store
// access, zero i18n lookups, zero imports from app code — because if the
// fallback itself crashes, the window is fully blank with no recovery. Do not
// add `useTheme`, `useTranslation`, or similar hooks here.
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null, copied: false }
  private buttonRef = React.createRef<HTMLButtonElement>()

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    // Why: forwarding is wrapped so a logging failure cannot itself crash
    // the fallback — the fallback is our last defense against white-screens.
    try {
      reportRendererCrash({
        kind: 'render',
        boundary: 'AppErrorBoundary',
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack ?? undefined
      })
    } catch {
      /* swallow */
    }
  }

  componentDidUpdate(_prevProps: Props, prevState: State): void {
    if (!prevState.error && this.state.error) {
      // Why: accessibility — move focus to the primary Reload action when
      // the fallback first renders. Wrapped so a focus failure cannot loop
      // into componentDidCatch.
      try {
        this.buttonRef.current?.focus()
      } catch {
        /* ignore */
      }
    }
  }

  handleReload = (): void => {
    try {
      window.location.reload()
    } catch {
      /* If even reload fails, there is nothing sensible to do. */
    }
  }

  handleCopy = async (): Promise<void> => {
    try {
      const text = formatCrashDiagnostics(this.state.error, this.state.componentStack ?? undefined)
      await navigator.clipboard.writeText(text)
      this.setState({ copied: true })
    } catch {
      // Clipboard can fail on older Electron / permission denied — fall back
      // to a textarea selection so the user can still copy manually.
      this.setState({ copied: false })
    }
  }

  render(): React.ReactNode {
    if (!this.state.error) {
      return this.props.children
    }

    // Inline styles by design: no Tailwind class lookups, no theme hooks.
    // If the app's CSS failed to load, the fallback still renders.
    const wrap: React.CSSProperties = {
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: '#111',
      color: '#f5f5f5',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      zIndex: 2147483647
    }
    const card: React.CSSProperties = {
      maxWidth: '560px',
      width: '100%',
      padding: '24px',
      borderRadius: '8px',
      background: '#1c1c1c',
      border: '1px solid #333',
      boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
    }
    const title: React.CSSProperties = {
      margin: '0 0 8px',
      fontSize: '18px',
      fontWeight: 600
    }
    const body: React.CSSProperties = {
      margin: '0 0 16px',
      fontSize: '13px',
      lineHeight: 1.5,
      opacity: 0.85
    }
    const row: React.CSSProperties = {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      marginTop: '12px'
    }
    const btn: React.CSSProperties = {
      appearance: 'none',
      border: '1px solid #444',
      background: '#2a2a2a',
      color: '#f5f5f5',
      padding: '8px 14px',
      borderRadius: '6px',
      fontSize: '13px',
      cursor: 'pointer'
    }
    const btnPrimary: React.CSSProperties = {
      ...btn,
      background: '#2563eb',
      borderColor: '#2563eb'
    }
    const link: React.CSSProperties = {
      ...btn,
      display: 'inline-block',
      textDecoration: 'none',
      textAlign: 'center'
    }

    return (
      <div role="alert" style={wrap}>
        <div style={card}>
          <h2 style={title}>Orca hit an unexpected error</h2>
          <p style={body}>
            Something in the window crashed and we reset to this safe screen to keep the app from
            getting stuck. Reload the window to get back to work. Copy diagnostics if you want to
            share details with us.
          </p>
          <div style={row}>
            <button
              ref={this.buttonRef}
              type="button"
              style={btnPrimary}
              onClick={this.handleReload}
            >
              Reload window
            </button>
            <button type="button" style={btn} onClick={this.handleCopy}>
              {this.state.copied ? 'Copied!' : 'Copy diagnostics'}
            </button>
            <a
              href="https://github.com/stablyai/orca/issues/new"
              target="_blank"
              rel="noreferrer"
              style={link}
            >
              Open an issue
            </a>
          </div>
        </div>
      </div>
    )
  }
}
