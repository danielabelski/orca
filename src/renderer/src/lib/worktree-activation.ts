import type { WorktreeSetupLaunch } from '../../../shared/types'
import { buildSetupRunnerCommand } from './setup-runner'

type WorktreeActivationStore = {
  tabsByWorktree: Record<string, { id: string }[]>
  createTab: (worktreeId: string) => { id: string }
  setActiveTab: (tabId: string) => void
  queueTabStartupCommand: (
    tabId: string,
    startup: { command: string; env?: Record<string, string> }
  ) => void
}

export function ensureWorktreeHasInitialTerminal(
  store: WorktreeActivationStore,
  worktreeId: string,
  setup?: WorktreeSetupLaunch
): void {
  const existingTabs = store.tabsByWorktree[worktreeId] ?? []
  if (existingTabs.length > 0) {
    return
  }

  const terminalTab = store.createTab(worktreeId)
  store.setActiveTab(terminalTab.id)

  // Why: UI-created and CLI-created worktrees must bootstrap their first Orca
  // terminal the same way or repo setup commands only run for one entry point.
  // Keep the "create first tab and queue setup in that tab" behavior centralized
  // so future activation changes cannot silently break one flow again.
  if (setup) {
    store.queueTabStartupCommand(terminalTab.id, {
      command: buildSetupRunnerCommand(setup.runnerScriptPath),
      env: setup.envVars
    })
  }
}
