import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOverflowExternalReloadTargets } from './useEditorExternalWatch'
import { useAppStore } from '@/store'

vi.mock('@/store', () => ({
  useAppStore: {
    getState: vi.fn()
  }
}))

describe('getOverflowExternalReloadTargets', () => {
  const setExternalMutation = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears tombstones and reloads clean edit tabs on overflow', () => {
    vi.mocked(useAppStore.getState).mockReturnValue({
      openFiles: [
        {
          id: 'file-1',
          worktreeId: 'wt-1',
          worktreePath: '/repo',
          relativePath: 'notes.md',
          mode: 'edit',
          isDirty: false,
          externalMutation: 'deleted'
        },
        {
          id: 'file-2',
          worktreeId: 'wt-1',
          worktreePath: '/repo',
          relativePath: 'dirty.md',
          mode: 'edit',
          isDirty: true
        },
        {
          id: 'file-3',
          worktreeId: 'wt-1',
          worktreePath: '/repo',
          relativePath: 'staged.ts',
          mode: 'diff',
          diffSource: 'staged',
          isDirty: false
        }
      ],
      setExternalMutation
    } as never)

    expect(
      getOverflowExternalReloadTargets({
        worktreeId: 'wt-1',
        worktreePath: '/repo'
      })
    ).toEqual([
      {
        worktreeId: 'wt-1',
        worktreePath: '/repo',
        relativePath: 'notes.md'
      }
    ])
    expect(setExternalMutation).toHaveBeenCalledWith('file-1', null)
  })
})
