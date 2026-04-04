import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import type { AppState } from '../types'
import type { Worktree, TerminalTab, TerminalLayoutSnapshot } from '../../../../shared/types'

// Mock sonner (imported by repos.ts)
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

// Mock agent-status (imported by terminal-helpers)
vi.mock('@/lib/agent-status', () => ({
  detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
}))

// Mock window.api before anything uses it
const mockApi = {
  worktrees: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    updateMeta: vi.fn().mockResolvedValue({})
  },
  repos: {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({}),
    pickFolder: vi.fn().mockResolvedValue(null)
  },
  pty: {
    kill: vi.fn().mockResolvedValue(undefined)
  },
  gh: {
    prForBranch: vi.fn().mockResolvedValue(null),
    issue: vi.fn().mockResolvedValue(null)
  },
  settings: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined)
  },
  cache: {
    getGitHub: vi.fn().mockResolvedValue(null),
    setGitHub: vi.fn().mockResolvedValue(undefined)
  }
}

// @ts-expect-error -- mock
globalThis.window = { api: mockApi }

import { createRepoSlice } from './repos'
import { createWorktreeSlice } from './worktrees'
import { createTerminalSlice } from './terminals'
import { createUISlice } from './ui'
import { createSettingsSlice } from './settings'
import { createGitHubSlice } from './github'
import { createEditorSlice } from './editor'

function createTestStore() {
  return create<AppState>()((...a) => ({
    ...createRepoSlice(...a),
    ...createWorktreeSlice(...a),
    ...createTerminalSlice(...a),
    ...createUISlice(...a),
    ...createSettingsSlice(...a),
    ...createGitHubSlice(...a),
    ...createEditorSlice(...a)
  }))
}

// ─── Helpers ──────────────────────────────────────────────────────────

function makeWorktree(overrides: Partial<Worktree> & { id: string; repoId: string }): Worktree {
  return {
    path: '/tmp/wt',
    head: 'abc123',
    branch: 'refs/heads/feature',
    isBare: false,
    isMainWorktree: false,
    displayName: 'feature',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    isArchived: false,
    isUnread: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function makeTab(
  overrides: Partial<TerminalTab> & { id: string; worktreeId: string }
): TerminalTab {
  return {
    ptyId: null,
    title: 'Terminal 1',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: Date.now(),
    ...overrides
  }
}

function makeLayout(): TerminalLayoutSnapshot {
  return { root: null, activeLeafId: null, expandedLeafId: null }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('removeRepo cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.repos.remove.mockResolvedValue(undefined)
    mockApi.pty.kill.mockResolvedValue(undefined)
  })

  it('cleans up all associated worktrees, tabs, ptys, and filter state', async () => {
    const store = createTestStore()
    const wt1 = 'repo1::/path/wt1'
    const wt2 = 'repo1::/path/wt2'

    store.setState({
      repos: [
        { id: 'repo1', path: '/repo1', displayName: 'Repo 1', badgeColor: '#000', addedAt: 0 }
      ],
      activeRepoId: 'repo1',
      filterRepoIds: ['repo1'],
      worktreesByRepo: {
        repo1: [
          makeWorktree({ id: wt1, repoId: 'repo1', path: '/path/wt1' }),
          makeWorktree({ id: wt2, repoId: 'repo1', path: '/path/wt2' })
        ]
      },
      tabsByWorktree: {
        [wt1]: [makeTab({ id: 'tab1', worktreeId: wt1 })],
        [wt2]: [makeTab({ id: 'tab2', worktreeId: wt2 })]
      },
      ptyIdsByTabId: {
        tab1: ['pty1'],
        tab2: ['pty2']
      },
      terminalLayoutsByTabId: {
        tab1: makeLayout(),
        tab2: makeLayout()
      },
      activeTabId: 'tab1'
    })

    await store.getState().removeRepo('repo1')
    const s = store.getState()

    expect(s.repos).toEqual([])
    expect(s.activeRepoId).toBeNull()
    expect(s.filterRepoIds).not.toContain('repo1')
    expect(s.worktreesByRepo['repo1']).toBeUndefined()
    expect(s.tabsByWorktree[wt1]).toBeUndefined()
    expect(s.tabsByWorktree[wt2]).toBeUndefined()
    expect(s.ptyIdsByTabId['tab1']).toBeUndefined()
    expect(s.ptyIdsByTabId['tab2']).toBeUndefined()
    expect(s.terminalLayoutsByTabId['tab1']).toBeUndefined()
    expect(s.terminalLayoutsByTabId['tab2']).toBeUndefined()
    expect(s.activeTabId).toBeNull()

    // PTYs were killed
    expect(mockApi.pty.kill).toHaveBeenCalledWith('pty1')
    expect(mockApi.pty.kill).toHaveBeenCalledWith('pty2')

    // Killed PTY IDs are suppressed
    expect(s.suppressedPtyExitIds['pty1']).toBe(true)
    expect(s.suppressedPtyExitIds['pty2']).toBe(true)
  })
})

describe('hydrateWorkspaceSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters out tabs for invalid worktree IDs', () => {
    const store = createTestStore()
    const validWt = 'repo1::/path/wt1'
    const invalidWt = 'repo1::/path/gone'

    store.setState({
      repos: [
        { id: 'repo1', path: '/repo1', displayName: 'Repo 1', badgeColor: '#000', addedAt: 0 }
      ],
      worktreesByRepo: {
        repo1: [makeWorktree({ id: validWt, repoId: 'repo1', path: '/path/wt1' })]
      }
    })

    store.getState().hydrateWorkspaceSession({
      activeRepoId: 'repo1',
      activeWorktreeId: invalidWt,
      activeTabId: 'tab-invalid',
      tabsByWorktree: {
        [validWt]: [makeTab({ id: 'tab-valid', worktreeId: validWt })],
        [invalidWt]: [makeTab({ id: 'tab-invalid', worktreeId: invalidWt })]
      },
      terminalLayoutsByTabId: {
        'tab-valid': makeLayout(),
        'tab-invalid': makeLayout()
      }
    })

    const s = store.getState()

    // Valid worktree tabs restored
    expect(s.tabsByWorktree[validWt]).toHaveLength(1)
    expect(s.tabsByWorktree[validWt][0].id).toBe('tab-valid')

    // Invalid worktree tabs dropped
    expect(s.tabsByWorktree[invalidWt]).toBeUndefined()

    // activeWorktreeId is null because it referenced an invalid worktree
    expect(s.activeWorktreeId).toBeNull()

    // activeTabId is null because it referenced an invalid tab
    expect(s.activeTabId).toBeNull()

    // Terminal layouts only contain valid tabs
    expect(s.terminalLayoutsByTabId['tab-valid']).toBeDefined()
    expect(s.terminalLayoutsByTabId['tab-invalid']).toBeUndefined()

    // Session is marked ready
    expect(s.workspaceSessionReady).toBe(true)
  })

  it('restores valid activeWorktreeId and activeTabId', () => {
    const store = createTestStore()
    const validWt = 'repo1::/path/wt1'

    store.setState({
      repos: [
        { id: 'repo1', path: '/repo1', displayName: 'Repo 1', badgeColor: '#000', addedAt: 0 }
      ],
      worktreesByRepo: {
        repo1: [makeWorktree({ id: validWt, repoId: 'repo1', path: '/path/wt1' })]
      }
    })

    store.getState().hydrateWorkspaceSession({
      activeRepoId: 'repo1',
      activeWorktreeId: validWt,
      activeTabId: 'tab1',
      tabsByWorktree: {
        [validWt]: [makeTab({ id: 'tab1', worktreeId: validWt })]
      },
      terminalLayoutsByTabId: {
        tab1: makeLayout()
      }
    })

    const s = store.getState()
    expect(s.activeWorktreeId).toBe(validWt)
    expect(s.activeTabId).toBe('tab1')
    expect(s.activeRepoId).toBe('repo1')
  })
})

describe('terminal slice behaviors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves tabs omitted from a reorder request instead of dropping them', () => {
    const store = createTestStore()
    const worktreeId = 'repo1::/path/wt1'

    store.setState({
      tabsByWorktree: {
        [worktreeId]: [
          makeTab({ id: 'tab-a', worktreeId, sortOrder: 0, createdAt: 1 }),
          makeTab({ id: 'tab-b', worktreeId, sortOrder: 1, createdAt: 2 }),
          makeTab({ id: 'tab-c', worktreeId, sortOrder: 2, createdAt: 3 })
        ]
      }
    })

    store.getState().reorderTabs(worktreeId, ['tab-c', 'tab-a'])

    expect(store.getState().tabsByWorktree[worktreeId]).toEqual([
      expect.objectContaining({ id: 'tab-c', sortOrder: 0 }),
      expect.objectContaining({ id: 'tab-a', sortOrder: 1 }),
      expect.objectContaining({ id: 'tab-b', sortOrder: 2 })
    ])
  })

  it('falls back to the previous PTY id when clearing the active pane PTY', () => {
    const store = createTestStore()
    const worktreeId = 'repo1::/path/wt1'

    store.setState({
      repos: [
        { id: 'repo1', path: '/repo1', displayName: 'Repo 1', badgeColor: '#000', addedAt: 0 }
      ],
      worktreesByRepo: {
        repo1: [makeWorktree({ id: worktreeId, repoId: 'repo1', path: '/path/wt1' })]
      },
      tabsByWorktree: {
        [worktreeId]: [makeTab({ id: 'tab-1', worktreeId, ptyId: 'pty-2' })]
      },
      ptyIdsByTabId: {
        'tab-1': ['pty-1', 'pty-2']
      }
    })

    store.getState().clearTabPtyId('tab-1', 'pty-2')

    const tab = store.getState().tabsByWorktree[worktreeId][0]
    expect(tab.ptyId).toBe('pty-1')
    expect(store.getState().ptyIdsByTabId['tab-1']).toEqual(['pty-1'])
  })
})
