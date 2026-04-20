/**
 * E2E tests for external-filesystem-change reflection paths that the first
 * spec file (`external-file-change.spec.ts`) doesn't cover. The tests here
 * exercise contracts PR #735 ships that are easy to regress independently:
 *
 * - The editor-reload subscription is hoisted to an always-mounted hook, so
 *   tabs still reflect external writes when the right sidebar is on
 *   Source Control / Checks / Search rather than Explorer. This is the
 *   crown-jewel behavior of #735 — Explorer's own watcher isn't enough.
 * - A non-active editor tab's retained Monaco model must rehydrate to the
 *   current file contents when the user switches back to it; otherwise
 *   `keepCurrentModel` leaves stale in-memory content in place.
 * - External writes scoped to one worktree must not bleed into tabs from a
 *   different worktree (multi-worktree isolation).
 * - A single-payload delete + paired-create with matching basename flips the
 *   open tab to `externalMutation === 'renamed'` rather than 'deleted' —
 *   covers the rename correlation path in `hasRenameCorrelatedCreate`.
 */

import { writeFileSync, unlinkSync, existsSync, renameSync, mkdirSync, rmdirSync } from 'fs'
import path from 'path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree, getAllWorktreeIds } from './helpers/store'
import {
  openFileInStore,
  getWorktreePath,
  activateEditorTab,
  getOpenFileSummary,
  getMonacoContent
} from './helpers/external-file-change'

const uniqueRel = (prefix: string, ext: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

function safeUnlink(absPath: string): void {
  if (existsSync(absPath)) {
    try {
      unlinkSync(absPath)
    } catch {
      /* ignore */
    }
  }
}

test.describe('External File Change Reflection — additional paths', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  /**
   * The always-mounted subscription in useEditorExternalWatch. PR #735 moved
   * the editor-reload watcher out of the File Explorer panel so that tabs
   * still reload when the user has another right-sidebar pane active. If the
   * subscription ever regresses back into the Explorer panel, switching away
   * from Explorer would silently drop external-reload dispatch and this test
   * would fail.
   */
  test('external write reloads tab while right sidebar is on source control', async ({
    orcaPage
  }) => {
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const worktreePath = await getWorktreePath(orcaPage, worktreeId)
    expect(worktreePath).not.toBeNull()

    const scratchRel = uniqueRel('scratch-sidebar-off-explorer', 'ts')
    const scratchAbs = path.join(worktreePath!, scratchRel)
    writeFileSync(scratchAbs, 'export const scratch = "initial"\n')

    try {
      const fileId = await openFileInStore(orcaPage, worktreeId, scratchRel)
      expect(fileId).not.toBeNull()
      await activateEditorTab(orcaPage, fileId!)

      await expect
        .poll(async () => getMonacoContent(orcaPage, scratchAbs), { timeout: 10_000 })
        .toBe('export const scratch = "initial"\n')

      // Flip the sidebar to Source Control so the File Explorer panel's own
      // watcher is unmounted — only the always-mounted useEditorExternalWatch
      // hook remains subscribed. A regression that folded the subscription
      // back into the Explorer would miss the write below.
      await orcaPage.evaluate(() => {
        const state = window.__store?.getState()
        if (!state) {
          return
        }
        state.setRightSidebarOpen(true)
        state.setRightSidebarTab('source-control')
      })
      await expect
        .poll(
          async () => orcaPage.evaluate(() => window.__store?.getState().rightSidebarTab ?? null),
          { timeout: 3_000 }
        )
        .toBe('source-control')

      const token = `sidebar-off-explorer-${Date.now()}`
      const externalContent = `export const scratch = "${token}"\n`
      writeFileSync(scratchAbs, externalContent)

      await expect
        .poll(async () => getMonacoContent(orcaPage, scratchAbs), {
          timeout: 10_000,
          message: 'editor did not reload while sidebar was off explorer'
        })
        .toBe(externalContent)
    } finally {
      safeUnlink(scratchAbs)
    }
  })

  /**
   * Retained-model sync. Monaco is configured with keepCurrentModel so a tab
   * switch doesn't discard the editor view, but that same retention means the
   * non-active tab's model can drift from the on-disk contents when another
   * tab is active during the external write. PR #735 adds a content-prop
   * drift sync on remount so activating the non-active tab paints its
   * current file contents rather than the stale retained model.
   *
   * The assertion is against Monaco's public getValue() after the switch:
   * that's what the user sees, and it's stable across Monaco internals.
   */
  test('non-active tab reloads on switch after external write', async ({ orcaPage }) => {
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const worktreePath = await getWorktreePath(orcaPage, worktreeId)
    expect(worktreePath).not.toBeNull()

    const activeRel = uniqueRel('scratch-active', 'ts')
    const backgroundRel = uniqueRel('scratch-background', 'ts')
    const activeAbs = path.join(worktreePath!, activeRel)
    const backgroundAbs = path.join(worktreePath!, backgroundRel)
    writeFileSync(activeAbs, 'export const active = "initial"\n')
    const backgroundSeed = 'export const background = "initial"\n'
    writeFileSync(backgroundAbs, backgroundSeed)

    try {
      const backgroundId = await openFileInStore(orcaPage, worktreeId, backgroundRel)
      const activeId = await openFileInStore(orcaPage, worktreeId, activeRel)
      expect(backgroundId).not.toBeNull()
      expect(activeId).not.toBeNull()
      await activateEditorTab(orcaPage, activeId!)

      // Ensure Monaco mounted the active tab with its seed so we have a
      // known-good baseline before the external write. Without this the
      // post-switch assertion could pass against a still-mounting frame.
      await expect
        .poll(async () => getMonacoContent(orcaPage, activeAbs), { timeout: 10_000 })
        .toBe('export const active = "initial"\n')

      const token = `background-switch-${Date.now()}`
      const backgroundExternal = `export const background = "${token}"\n`
      writeFileSync(backgroundAbs, backgroundExternal)

      // Positive signal that the reload pipeline has run: the background
      // tab's store-level content has updated (its on-disk read landed), but
      // the Monaco model for the non-active tab is what we actually care
      // about. We can't assert on Monaco for the background tab yet because
      // its editor isn't mounted — EditorPanel only mounts Monaco for the
      // active file. Instead, wait for the store to reflect the reload and
      // then switch to the background tab and assert the Monaco model.
      await expect
        .poll(
          async () =>
            orcaPage.evaluate(async (filePath) => {
              const result = await window.api.fs.readFile({ filePath })
              return result?.content ?? null
            }, backgroundAbs),
          { timeout: 5_000 }
        )
        .toBe(backgroundExternal)

      await activateEditorTab(orcaPage, backgroundId!)

      await expect
        .poll(async () => getMonacoContent(orcaPage, backgroundAbs), {
          timeout: 10_000,
          message: 'background tab did not rehydrate to external content after switch'
        })
        .toBe(backgroundExternal)
      // Store flags must not have been flipped in the process.
      expect(await getOpenFileSummary(orcaPage, backgroundId!)).toEqual({
        isDirty: false,
        externalMutation: null,
        draft: undefined
      })
    } finally {
      safeUnlink(activeAbs)
      safeUnlink(backgroundAbs)
    }
  })

  /**
   * Multi-worktree isolation. `useEditorExternalWatch` subscribes one watcher
   * per watched worktree and routes `fs:changed` payloads through
   * `findTarget(payload.worktreePath)`. A regression that cross-wires the
   * watch targets would deliver WT1's events to WT2's open tabs (and vice
   * versa), flipping state where it shouldn't.
   *
   * Why writeFileSync into each worktree's directly-rooted path: both
   * worktrees share the same git-init'd parent, but each has its own
   * filesystem root and its own @parcel/watcher subscription. Writing into
   * worktree 1's path must fire only its watcher.
   */
  test('external write in one worktree does not touch another worktree tab', async ({
    orcaPage
  }) => {
    const worktreeIds = await getAllWorktreeIds(orcaPage)
    expect(
      worktreeIds.length,
      'fixture must provide primary + e2e-secondary worktrees'
    ).toBeGreaterThanOrEqual(2)

    const primaryId = await waitForActiveWorktree(orcaPage)
    const secondaryId = worktreeIds.find((id) => id !== primaryId)!
    const primaryPath = await getWorktreePath(orcaPage, primaryId)
    const secondaryPath = await getWorktreePath(orcaPage, secondaryId)
    expect(primaryPath).not.toBeNull()
    expect(secondaryPath).not.toBeNull()

    const primaryRel = uniqueRel('scratch-primary', 'ts')
    const secondaryRel = uniqueRel('scratch-secondary', 'ts')
    const primaryAbs = path.join(primaryPath!, primaryRel)
    const secondaryAbs = path.join(secondaryPath!, secondaryRel)
    const secondarySeed = 'export const secondary = "initial"\n'
    writeFileSync(primaryAbs, 'export const primary = "initial"\n')
    writeFileSync(secondaryAbs, secondarySeed)

    try {
      const primaryFileId = await openFileInStore(orcaPage, primaryId, primaryRel)
      const secondaryFileId = await openFileInStore(orcaPage, secondaryId, secondaryRel)
      expect(primaryFileId).not.toBeNull()
      expect(secondaryFileId).not.toBeNull()
      // Activate the primary — Monaco only mounts for the active tab, so this
      // is the tab whose model we'll read to confirm the reload landed.
      await activateEditorTab(orcaPage, primaryFileId!)

      await expect
        .poll(async () => getMonacoContent(orcaPage, primaryAbs), { timeout: 10_000 })
        .toBe('export const primary = "initial"\n')

      const token = `primary-only-${Date.now()}`
      const primaryExternal = `export const primary = "${token}"\n`
      writeFileSync(primaryAbs, primaryExternal)

      await expect
        .poll(async () => getMonacoContent(orcaPage, primaryAbs), {
          timeout: 10_000,
          message: 'primary worktree tab did not reflect its own external write'
        })
        .toBe(primaryExternal)

      // Cross-worktree isolation check: the secondary worktree's tab must not
      // have been touched. Its file on disk is unchanged, and its store flags
      // must be clean. A regression that cross-wires watcher targets would
      // either leave isDirty true (if the reload somehow loaded primary's
      // content into secondary's tab) or mark externalMutation non-null.
      const reloadedSecondaryFromDisk = await orcaPage.evaluate(async (filePath) => {
        const result = await window.api.fs.readFile({ filePath })
        return result?.content ?? null
      }, secondaryAbs)
      expect(reloadedSecondaryFromDisk).toBe(secondarySeed)
      expect(await getOpenFileSummary(orcaPage, secondaryFileId!)).toEqual({
        isDirty: false,
        externalMutation: null,
        draft: undefined
      })
    } finally {
      safeUnlink(primaryAbs)
      safeUnlink(secondaryAbs)
    }
  })

  /**
   * Rename correlation. `hasRenameCorrelatedCreate` detects a delete+create
   * pair in the same fs:changed payload where the basenames match, and flips
   * the tombstone label from 'deleted' to 'renamed'. An `fs.renameSync` call
   * lands both events in a single debounced batch (trailing 150ms), which is
   * the production case (`git mv` / editor move). This test exercises that
   * pair — existing test 4 only covers the unpaired-delete path.
   *
   * Why basename-preserving rename: `hasRenameCorrelatedCreate` intentionally
   * does NOT correlate by parent directory (save-as-temp patterns would
   * false-positive). A rename that keeps the filename is the reliable case.
   */
  test('external rename marks the tab as renamed rather than deleted', async ({ orcaPage }) => {
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const worktreePath = await getWorktreePath(orcaPage, worktreeId)
    expect(worktreePath).not.toBeNull()

    const baseName = `scratch-rename-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ts`
    const oldAbs = path.join(worktreePath!, baseName)
    const newDirName = `subdir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const newDirAbs = path.join(worktreePath!, newDirName)
    const newAbs = path.join(newDirAbs, baseName)
    writeFileSync(oldAbs, 'export const scratch = "initial"\n')

    try {
      const fileId = await openFileInStore(orcaPage, worktreeId, baseName)
      expect(fileId).not.toBeNull()

      await expect
        .poll(async () => getOpenFileSummary(orcaPage, fileId!), { timeout: 3_000 })
        .toEqual({ isDirty: false, externalMutation: null, draft: undefined })

      // Atomic rename into a sibling directory keeps the basename so the
      // rename-correlation code matches, and renameSync issues both fs events
      // within a single @parcel/watcher poll cycle — they land in the same
      // debounced flush window (trailing 150ms) and the renderer sees one
      // payload with both delete + create events.
      mkdirSync(newDirAbs, { recursive: true })
      renameSync(oldAbs, newAbs)

      await expect
        .poll(
          async () =>
            orcaPage.evaluate(
              (id) =>
                window.__store?.getState().openFiles.find((f) => f.id === id)?.externalMutation ??
                null,
              fileId!
            ),
          {
            timeout: 5_000,
            message: 'rename did not flip externalMutation to renamed'
          }
        )
        .toBe('renamed')
    } finally {
      safeUnlink(oldAbs)
      safeUnlink(newAbs)
      if (existsSync(newDirAbs)) {
        try {
          rmdirSync(newDirAbs)
        } catch {
          /* ignore */
        }
      }
    }
  })
})
