import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { installGlobalRendererErrorHandlers } from './lib/crash-log'

if (import.meta.env.DEV) {
  import('react-grab').then(({ init }) => init())
  import('react-grab/styles.css')
}

// Respect system dark mode preference
function applySystemTheme(): void {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', isDark)
}

applySystemTheme()
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySystemTheme)

// Why: global error handlers must install before React mounts so a crash
// during initial module evaluation or inside createRoot() still reaches the
// crash log. See docs/error-boundary-design.md §B2.
installGlobalRendererErrorHandlers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
)
