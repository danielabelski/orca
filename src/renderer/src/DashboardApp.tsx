import { useEffect } from 'react'
import { useAppStore } from './store'
import { useShallow } from 'zustand/react/shallow'
import AgentDashboard from './components/dashboard/AgentDashboard'
import { parseAgentStatusPayload } from '../../shared/agent-status-types'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

// Why: the detached dashboard is a lean secondary window. It does NOT
// reconnect PTYs, own terminal scrollback, or write the workspace session.
// It only hydrates enough state (repos, worktrees, tabs, agent status) to
// render AgentDashboard live, and subscribes to IPC pushes so the view stays
// in sync with whatever the main window does.
export default function DashboardApp(): React.JSX.Element {
  console.log('[DashboardApp] mounting detached dashboard renderer')
  const actions = useAppStore(
    useShallow((s) => ({
      fetchRepos: s.fetchRepos,
      fetchAllWorktrees: s.fetchAllWorktrees,
      fetchWorktrees: s.fetchWorktrees,
      hydrateObserverSession: s.hydrateObserverSession,
      hydrateTabsSession: s.hydrateTabsSession,
      setAgentStatus: s.setAgentStatus
    }))
  )

  useEffect(() => {
    let cancelled = false
    const hydrate = async (): Promise<void> => {
      try {
        console.log('[DashboardApp] hydrating: fetchRepos')
        await actions.fetchRepos()
        console.log('[DashboardApp] hydrating: fetchAllWorktrees')
        await actions.fetchAllWorktrees()
        console.log('[DashboardApp] hydrating: session.get')
        const session = await window.api.session.get()
        if (cancelled) {
          return
        }
        actions.hydrateObserverSession(session)
        actions.hydrateTabsSession(session)
        console.log('[DashboardApp] hydration complete')
      } catch (error) {
        console.error('[DashboardApp] hydration failed', error)
      }
    }
    void hydrate()
    return () => {
      cancelled = true
    }
  }, [actions])

  useEffect(() => {
    const unsubs: (() => void)[] = []

    unsubs.push(
      window.api.repos.onChanged(() => {
        void useAppStore.getState().fetchRepos()
      })
    )

    unsubs.push(
      window.api.worktrees.onChanged((data: { repoId: string }) => {
        void useAppStore.getState().fetchWorktrees(data.repoId)
      })
    )

    // Why: the main window is the source of truth for terminal tabs (it owns
    // every PTY). When it writes session:set, re-fetch so this window sees new
    // tabs, retitled agents, or tabs that were closed.
    unsubs.push(
      window.api.session.onUpdated(() => {
        void (async () => {
          const session = await window.api.session.get()
          const store = useAppStore.getState()
          store.hydrateObserverSession(session)
          store.hydrateTabsSession(session)
        })()
      })
    )

    unsubs.push(
      window.api.agentStatus.onSet((data) => {
        const payload = parseAgentStatusPayload(
          JSON.stringify({
            state: data.state,
            statusText: data.statusText,
            promptText: data.promptText,
            agentType: data.agentType
          })
        )
        if (!payload) {
          return
        }
        const store = useAppStore.getState()
        store.setAgentStatus(data.paneKey, payload, undefined)
      })
    )

    return () => {
      for (const fn of unsubs) {
        fn()
      }
    }
  }, [])

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <AgentDashboard />
      </div>
      <Toaster />
    </TooltipProvider>
  )
}
