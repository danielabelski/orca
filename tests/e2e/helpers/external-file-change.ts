/**
 * Test-scoped helpers for external-filesystem-change reflection specs.
 * Extracted from external-file-change.spec.ts to keep the spec under the
 * 300-line oxlint ceiling while keeping each helper individually documented.
 */

import type { Page } from '@stablyai/playwright-test'

/**
 * Open a file via the store and return its id. Takes `worktreeId`
 * explicitly so the helper doesn't depend on `activeWorktreeId` — tests
 * that switch worktrees mid-flight can still seed correctly.
 */
export async function openFileInStore(
  page: Page,
  worktreeId: string,
  relativePath: string
): Promise<string | null> {
  return page.evaluate(
    ({ wId, relPath }) => {
      const store = window.__store
      if (!store) {
        return null
      }

      const state = store.getState()
      const worktree = Object.values(state.worktreesByRepo)
        .flat()
        .find((entry) => entry.id === wId)
      if (!worktree) {
        return null
      }

      const separator = worktree.path.includes('\\') ? '\\' : '/'
      const filePath = `${worktree.path}${separator}${relPath}`
      state.openFile({
        filePath,
        relativePath: relPath,
        worktreeId: wId,
        language: relPath.endsWith('.md')
          ? 'markdown'
          : relPath.endsWith('.json')
            ? 'json'
            : relPath.endsWith('.ts')
              ? 'typescript'
              : 'plaintext',
        mode: 'edit'
      })
      return store.getState().openFiles.find((f) => f.filePath === filePath)?.id ?? null
    },
    { wId: worktreeId, relPath: relativePath }
  )
}

export async function getWorktreePath(page: Page, worktreeId: string): Promise<string | null> {
  return page.evaluate((wId) => {
    const store = window.__store
    if (!store) {
      return null
    }

    const worktree = Object.values(store.getState().worktreesByRepo)
      .flat()
      .find((entry) => entry.id === wId)
    return worktree?.path ?? null
  }, worktreeId)
}

/**
 * Flip the given file to be the active editor tab. openFile() opens and
 * typically activates, but we also need activeTabType === 'editor' so the
 * EditorPanel mounts and Monaco/ProseMirror render into the DOM — the
 * beforeEach hook leaves activeTabType === 'terminal'. Without this the
 * DOM-level visible-text assertions in the specs would sit on a
 * non-rendered pane.
 */
export async function activateEditorTab(page: Page, fileId: string): Promise<void> {
  await page.evaluate((id) => {
    const state = window.__store?.getState()
    if (!state) {
      return
    }
    state.setActiveFile(id)
    state.setActiveTabType('editor')
  }, fileId)
}

export async function getOpenFileSummary(
  page: Page,
  fileId: string
): Promise<{
  isDirty: boolean
  externalMutation: string | null
  draft: string | undefined
} | null> {
  return page.evaluate((id) => {
    const state = window.__store?.getState()
    if (!state) {
      return null
    }

    const file = state.openFiles.find((f) => f.id === id)
    if (!file) {
      return null
    }

    return {
      isDirty: Boolean(file.isDirty),
      externalMutation: file.externalMutation ?? null,
      draft: state.editorDrafts[id]
    }
  }, fileId)
}

/**
 * Read the live Monaco editor's model content by absolute file path.
 * Uses the editor instance exposed on `window.__monacoEditors` in dev/E2E
 * (see MonacoEditor.tsx). This is Monaco's public `getValue()` API, so
 * assertions are stable across Monaco upgrades — unlike scraping
 * `.view-lines` which targets an internal class name.
 *
 * Returns null if the editor hasn't mounted yet for this path; callers
 * should poll until it becomes a string.
 */
export async function getMonacoContent(page: Page, filePath: string): Promise<string | null> {
  return page.evaluate((fp) => {
    const registry = (window as unknown as Record<string, unknown>).__monacoEditors as
      | Map<string, { getValue: () => string }>
      | undefined
    const editorInstance = registry?.get(fp)
    return editorInstance ? editorInstance.getValue() : null
  }, filePath)
}
