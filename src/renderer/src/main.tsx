import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import DashboardApp from './DashboardApp'

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

// Why: the detached agent dashboard window loads the same renderer bundle but
// with ?view=agent-dashboard in its URL. Mount the lean DashboardApp in that
// case so the second window does not try to claim PTYs or write workspace
// session — it just renders AgentDashboard over live IPC-pushed state.
const isDashboardView =
  new URLSearchParams(window.location.search).get('view') === 'agent-dashboard'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isDashboardView ? <DashboardApp /> : <App />}</StrictMode>
)
