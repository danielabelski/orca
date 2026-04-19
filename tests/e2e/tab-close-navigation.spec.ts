/**
 * E2E tests for what happens when tabs are closed: which neighbor becomes
 * active, and how the app returns to Landing when the last tab is gone.
 *
 * Why these flows:
 * - PR #693 (`close editor/diff tabs should navigate to visual neighbor tab`)
 *   fixed a regression where closing the active editor tab jumped to an
 *   arbitrary file. The existing `tabs.spec.ts` only covers terminal tab
 *   close; the editor/diff close path has no E2E guard today.
 * - PR #677 (`return to Orca landing screen after closing last terminal`)
 *   plus editor.ts's `shouldDeactivateWorktree` branch (also hardened in
 *   tabs.ts's `closeUnifiedTab`) require that when a worktree's last visible
 *   surface closes, the app clears `activeWorktreeId` instead of leaving a
 *   selected worktree with nothing to render. Any regression here shows up
 *   as a blank workspace.
 * - PR #532 had to be patched because `closeFile` forgot to keep
 *   `activeFileIdByWorktree` honest. This spec covers the user-visible
 *   invariant: after closing the active editor tab, the replacement active
 *   file is one that is still open.
 */

import { test, expect } from './helpers/orca-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  getActiveTabType,
  getOpenFiles,
  ensureTerminalVisible
} from './helpers/store'

async function openSeededEditorTabs(
  page: Parameters<typeof getActiveWorktreeId>[0],
  relativePaths: string[]
): Promise<string[]> {
  return page.evaluate((relPaths) => {
    const store = window.__store
    if (!store) {
      return []
    }

    const state = store.getState()
    const worktreeId = state.activeWorktreeId
    if (!worktreeId) {
      return []
    }

    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((entry) => entry.id === worktreeId)
    if (!worktree) {
      return []
    }

    const separator = worktree.path.includes('\\') ? '\\' : '/'
    const ids: string[] = []
    for (const relPath of relPaths) {
      const filePath = `${worktree.path}${separator}${relPath}`
      state.openFile({
        filePath,
        relativePath: relPath,
        worktreeId,
        language: relPath.endsWith('.md')
          ? 'markdown'
          : relPath.endsWith('.json')
            ? 'json'
            : relPath.endsWith('.ts')
              ? 'typescript'
              : 'plaintext',
        mode: 'edit'
      })
      const latest = store.getState().openFiles.find((f) => f.filePath === filePath)
      if (latest) {
        ids.push(latest.id)
      }
    }
    return ids
  }, relativePaths)
}

async function setActiveFile(
  page: Parameters<typeof getActiveWorktreeId>[0],
  fileId: string
): Promise<void> {
  await page.evaluate((id) => {
    const store = window.__store
    if (!store) {
      return
    }

    const state = store.getState()
    state.setActiveFile(id)
    state.setActiveTabType('editor')
  }, fileId)
}

async function closeFile(
  page: Parameters<typeof getActiveWorktreeId>[0],
  fileId: string
): Promise<void> {
  await page.evaluate((id) => {
    window.__store?.getState().closeFile(id)
  }, fileId)
}

async function getActiveFileId(
  page: Parameters<typeof getActiveWorktreeId>[0]
): Promise<string | null> {
  return page.evaluate(() => window.__store?.getState().activeFileId ?? null)
}

test.describe('Tab Close Navigation', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  /**
   * Covers PR #693: closing the active editor tab should activate the visual
   * neighbor in the same worktree, not the first file in the list.
   */
  test('closing the active editor tab activates its visual neighbor', async ({ orcaPage }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!

    const fileIds = await openSeededEditorTabs(orcaPage, [
      'package.json',
      'README.md',
      'tsconfig.json'
    ])
    expect(fileIds.length).toBe(3)

    // Activate the middle tab and close it. The neighbor-picking logic in
    // closeFile should pick the file that sat immediately after the closed
    // one in the worktree's openFiles slice.
    await setActiveFile(orcaPage, fileIds[1])
    await expect.poll(async () => getActiveFileId(orcaPage), { timeout: 3_000 }).toBe(fileIds[1])

    await closeFile(orcaPage, fileIds[1])

    const openFilesAfter = await getOpenFiles(orcaPage, worktreeId)
    const remainingIds = new Set(openFilesAfter.map((f) => f.id))
    expect(remainingIds.has(fileIds[1])).toBe(false)

    // The replacement active file must be one that is still open (the exact
    // neighbor index is a product decision; the regression in #693 was that
    // the replacement pointer wasn't in openFiles at all).
    await expect
      .poll(
        async () => {
          const activeId = await getActiveFileId(orcaPage)
          return activeId != null && remainingIds.has(activeId)
        },
        { timeout: 5_000, message: 'activeFileId did not point to a file still in openFiles' }
      )
      .toBe(true)

    // And the workspace must still be showing an editor, not silently flipping
    // back to terminal while editors remain open.
    await expect.poll(async () => getActiveTabType(orcaPage), { timeout: 3_000 }).toBe('editor')
  })

  /**
   * Same visual-neighbor invariant but for diff tabs — they share the
   * openFiles list with editor tabs (contentType='diff') and route through
   * the same closeFile path, which is where #693 regressed.
   */
  test('closing the active diff tab activates a still-open neighbor', async ({ orcaPage }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!

    // Seed two editor tabs + one diff tab in the same worktree.
    const editorIds = await openSeededEditorTabs(orcaPage, ['package.json', 'README.md'])
    expect(editorIds.length).toBe(2)

    const diffId = await orcaPage.evaluate((wId) => {
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
      state.openDiff(
        wId,
        `${worktree.path}${separator}src${separator}index.ts`,
        `src${separator}index.ts`,
        'typescript',
        false
      )
      return store.getState().activeFileId
    }, worktreeId)

    expect(diffId).not.toBeNull()
    await expect.poll(async () => getActiveFileId(orcaPage), { timeout: 3_000 }).toBe(diffId)

    await closeFile(orcaPage, diffId!)

    const openFilesAfter = await getOpenFiles(orcaPage, worktreeId)
    const remainingIds = new Set(openFilesAfter.map((f) => f.id))
    expect(remainingIds.has(diffId!)).toBe(false)
    expect(remainingIds.size).toBeGreaterThan(0)

    await expect
      .poll(
        async () => {
          const activeId = await getActiveFileId(orcaPage)
          return activeId != null && remainingIds.has(activeId)
        },
        { timeout: 5_000, message: 'Closing diff tab left activeFileId pointing at a missing file' }
      )
      .toBe(true)
  })

  /**
   * Covers PR #677 and the `shouldDeactivateWorktree` branch in closeFile:
   * when the last editor closes and no terminal/browser surface remains for
   * the worktree, the app must return to Landing (activeWorktreeId === null).
   */
  test('closing the last visible surface returns the app to Landing', async ({ orcaPage }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!

    // Prepare the worktree so only a single editor tab is present as a
    // visible surface: no browser tabs and no terminal tabs.
    await orcaPage.evaluate((wId) => {
      const store = window.__store
      if (!store) {
        return
      }

      const state = store.getState()
      // Close every terminal tab in this worktree so removing the last editor
      // leaves nothing visible. Terminal tabs persist in tabsByWorktree even
      // when activeTabType flips to 'editor'.
      for (const tab of state.tabsByWorktree[wId] ?? []) {
        state.closeTab(tab.id)
      }

      // Drop any browser tabs too, for the same reason.
      for (const bt of state.browserTabsByWorktree[wId] ?? []) {
        state.closeBrowserTab(bt.id)
      }
    }, worktreeId)

    const editorIds = await openSeededEditorTabs(orcaPage, ['package.json'])
    expect(editorIds.length).toBe(1)

    await setActiveFile(orcaPage, editorIds[0])
    await expect.poll(async () => getActiveFileId(orcaPage), { timeout: 3_000 }).toBe(editorIds[0])

    // Sanity: confirm the worktree has no backing terminal/browser surfaces
    // before we close the last editor. Otherwise the deactivate branch would
    // not trigger for reasons unrelated to this regression.
    const surfaceCounts = await orcaPage.evaluate((wId) => {
      const state = window.__store!.getState()
      return {
        terminals: (state.tabsByWorktree[wId] ?? []).length,
        browserTabs: (state.browserTabsByWorktree[wId] ?? []).length
      }
    }, worktreeId)
    expect(surfaceCounts).toEqual({ terminals: 0, browserTabs: 0 })

    await closeFile(orcaPage, editorIds[0])

    // The worktree should be deselected. Landing renders when
    // activeWorktreeId === null.
    await expect
      .poll(async () => getActiveWorktreeId(orcaPage), {
        timeout: 5_000,
        message: 'activeWorktreeId was not cleared after closing the last visible surface'
      })
      .toBeNull()
  })
})
