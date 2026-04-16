import { describe, expect, it, vi } from 'vitest'
import { ensureWorktreeHasInitialTerminal } from './worktree-activation'

function createMockStore(overrides: Record<string, unknown> = {}) {
  return {
    tabsByWorktree: {} as Record<string, { id: string }[]>,
    createTab: vi.fn(() => ({ id: 'tab-1' })),
    setActiveTab: vi.fn(),
    reconcileWorktreeTabModel: vi.fn(() => ({ renderableTabCount: 0 })),
    queueTabStartupCommand: vi.fn(),
    queueTabSetupSplit: vi.fn(),
    queueTabIssueCommandSplit: vi.fn(),
    ...overrides
  }
}

describe('ensureWorktreeHasInitialTerminal', () => {
  it('creates a tab and queues a setup split for newly created worktrees', () => {
    const store = createMockStore()

    ensureWorktreeHasInitialTerminal(store, 'wt-1', undefined, {
      runnerScriptPath: '/tmp/repo/.git/orca/setup-runner.sh',
      envVars: {
        ORCA_ROOT_PATH: '/tmp/repo',
        ORCA_WORKTREE_PATH: '/tmp/worktrees/wt-1'
      }
    })

    expect(store.createTab).toHaveBeenCalledWith('wt-1')
    expect(store.setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(store.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(store.queueTabSetupSplit).toHaveBeenCalledWith('tab-1', {
      command: 'bash /tmp/repo/.git/orca/setup-runner.sh',
      env: {
        ORCA_ROOT_PATH: '/tmp/repo',
        ORCA_WORKTREE_PATH: '/tmp/worktrees/wt-1'
      }
    })
  })

  it('creates a single tab without setup split when no setup is provided', () => {
    const store = createMockStore()

    ensureWorktreeHasInitialTerminal(store, 'wt-1')

    expect(store.createTab).toHaveBeenCalledWith('wt-1')
    expect(store.setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(store.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(store.queueTabSetupSplit).not.toHaveBeenCalled()
  })

  it('does not create or queue anything when the worktree already has renderable content', () => {
    const store = createMockStore({
      reconcileWorktreeTabModel: vi.fn(() => ({ renderableTabCount: 1 }))
    })

    ensureWorktreeHasInitialTerminal(store, 'wt-1', undefined, {
      runnerScriptPath: '/tmp/repo/.git/orca/setup-runner.sh',
      envVars: {}
    })

    expect(store.createTab).not.toHaveBeenCalled()
    expect(store.setActiveTab).not.toHaveBeenCalled()
    expect(store.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(store.queueTabSetupSplit).not.toHaveBeenCalled()
    expect(store.queueTabIssueCommandSplit).not.toHaveBeenCalled()
  })

  it('queues a startup command when agent launch is provided', () => {
    const store = createMockStore()

    ensureWorktreeHasInitialTerminal(
      store,
      'wt-1',
      { command: 'claude "Fix this bug"' },
      undefined,
      undefined
    )

    expect(store.createTab).toHaveBeenCalledWith('wt-1')
    expect(store.setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(store.queueTabStartupCommand).toHaveBeenCalledWith('tab-1', {
      command: 'claude "Fix this bug"'
    })
    expect(store.queueTabSetupSplit).not.toHaveBeenCalled()
    expect(store.queueTabIssueCommandSplit).not.toHaveBeenCalled()
  })

  it('does not create a terminal just because the legacy terminal slice is empty', () => {
    const store = createMockStore({
      tabsByWorktree: { 'wt-1': [] },
      reconcileWorktreeTabModel: vi.fn(() => ({ renderableTabCount: 2 }))
    })

    ensureWorktreeHasInitialTerminal(store, 'wt-1')

    expect(store.createTab).not.toHaveBeenCalled()
    expect(store.setActiveTab).not.toHaveBeenCalled()
  })

  it('queues an issue command split when issueCommand is provided', () => {
    const store = createMockStore()

    ensureWorktreeHasInitialTerminal(store, 'wt-1', undefined, undefined, {
      runnerScriptPath: '/tmp/repo/.git/orca/issue-command-runner.sh',
      envVars: {
        ORCA_ROOT_PATH: '/tmp/repo',
        ORCA_WORKTREE_PATH: '/tmp/worktrees/wt-1'
      }
    })

    expect(store.createTab).toHaveBeenCalledWith('wt-1')
    expect(store.setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(store.queueTabSetupSplit).not.toHaveBeenCalled()
    expect(store.queueTabIssueCommandSplit).toHaveBeenCalledWith('tab-1', {
      command: 'bash /tmp/repo/.git/orca/issue-command-runner.sh',
      env: {
        ORCA_ROOT_PATH: '/tmp/repo',
        ORCA_WORKTREE_PATH: '/tmp/worktrees/wt-1'
      }
    })
  })

  it('queues both setup split and issue command split when both are provided', () => {
    const store = createMockStore()

    ensureWorktreeHasInitialTerminal(
      store,
      'wt-1',
      undefined,
      {
        runnerScriptPath: '/tmp/repo/.git/orca/setup-runner.sh',
        envVars: { ORCA_ROOT_PATH: '/tmp/repo' }
      },
      {
        runnerScriptPath: '/tmp/repo/.git/orca/issue-command-runner.sh',
        envVars: { ORCA_ROOT_PATH: '/tmp/repo' }
      }
    )

    expect(store.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(store.queueTabSetupSplit).toHaveBeenCalledWith('tab-1', {
      command: 'bash /tmp/repo/.git/orca/setup-runner.sh',
      env: { ORCA_ROOT_PATH: '/tmp/repo' }
    })
    expect(store.queueTabIssueCommandSplit).toHaveBeenCalledWith('tab-1', {
      command: 'bash /tmp/repo/.git/orca/issue-command-runner.sh',
      env: { ORCA_ROOT_PATH: '/tmp/repo' }
    })
  })

  it('does not queue issue command split when issueCommand is not provided', () => {
    const store = createMockStore()

    ensureWorktreeHasInitialTerminal(store, 'wt-1')

    expect(store.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(store.queueTabIssueCommandSplit).not.toHaveBeenCalled()
  })
})
