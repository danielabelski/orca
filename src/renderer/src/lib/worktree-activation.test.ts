import { describe, expect, it, vi } from 'vitest'
import { ensureWorktreeHasInitialTerminal } from './worktree-activation'

describe('ensureWorktreeHasInitialTerminal', () => {
  it('creates a first tab and queues setup for newly created worktrees', () => {
    const createTab = vi.fn(() => ({ id: 'tab-1' }))
    const setActiveTab = vi.fn()
    const queueTabStartupCommand = vi.fn()

    ensureWorktreeHasInitialTerminal(
      {
        tabsByWorktree: {},
        createTab,
        setActiveTab,
        queueTabStartupCommand
      },
      'wt-1',
      {
        runnerScriptPath: '/tmp/repo/.git/orca/setup-runner.sh',
        envVars: {
          ORCA_ROOT_PATH: '/tmp/repo',
          ORCA_WORKTREE_PATH: '/tmp/worktrees/wt-1'
        }
      }
    )

    expect(createTab).toHaveBeenCalledWith('wt-1')
    expect(setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(queueTabStartupCommand).toHaveBeenCalledWith('tab-1', {
      command: 'bash /tmp/repo/.git/orca/setup-runner.sh',
      env: {
        ORCA_ROOT_PATH: '/tmp/repo',
        ORCA_WORKTREE_PATH: '/tmp/worktrees/wt-1'
      }
    })
  })

  it('does not create or queue anything when the worktree already has tabs', () => {
    const createTab = vi.fn()
    const setActiveTab = vi.fn()
    const queueTabStartupCommand = vi.fn()

    ensureWorktreeHasInitialTerminal(
      {
        tabsByWorktree: {
          'wt-1': [{ id: 'tab-existing' }]
        },
        createTab,
        setActiveTab,
        queueTabStartupCommand
      },
      'wt-1',
      {
        runnerScriptPath: '/tmp/repo/.git/orca/setup-runner.sh',
        envVars: {}
      }
    )

    expect(createTab).not.toHaveBeenCalled()
    expect(setActiveTab).not.toHaveBeenCalled()
    expect(queueTabStartupCommand).not.toHaveBeenCalled()
  })
})
