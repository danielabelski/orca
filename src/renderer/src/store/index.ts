import { create } from 'zustand'
import type { AppState } from './types'
import { createRepoSlice } from './slices/repos'
import { createWorktreeSlice } from './slices/worktrees'
import { createTerminalSlice } from './slices/terminals'
import { createUISlice } from './slices/ui'
import { createSettingsSlice } from './slices/settings'
import { createGitHubSlice } from './slices/github'
import { createEditorSlice } from './slices/editor'

export const useAppStore = create<AppState>()((...a) => ({
  ...createRepoSlice(...a),
  ...createWorktreeSlice(...a),
  ...createTerminalSlice(...a),
  ...createUISlice(...a),
  ...createSettingsSlice(...a),
  ...createGitHubSlice(...a),
  ...createEditorSlice(...a)
}))

export type { AppState } from './types'
