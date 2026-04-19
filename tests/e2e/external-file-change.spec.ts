/**
 * E2E tests for external-filesystem-change reflection in open editor tabs.
 *
 * Why these flows:
 * - PR #735 (`reflect external file changes in editor tabs`) lifted the
 *   editor-reload subscription to an always-mounted hook so that edits from
 *   the integrated terminal, formatters, or other external writers land in
 *   open tabs regardless of which sidebar panel is visible. It also added
 *   the critical guard that a *dirty* tab must not be silently clobbered,
 *   and the tombstone/rename mutation marks that show the user when the
 *   file on disk has changed out from under them.
 * - PR #832 (`contain rich editor crashes and dedupe external reloads`) then
 *   debounced the reload dispatch to collapse atomic-write bursts and
 *   prevent the rich-markdown editor from flashing or wedging.
 *
 * Assertions span two layers on purpose: store flags
 * (isDirty / externalMutation / editorDrafts / markdownViewMode) catch
 * state-machine regressions, and content-level checks against Monaco's
 * model (via the editor instance exposed on `window.__monacoEditors`) plus
 * ProseMirror's rendered heading catch the user-visible behavior PR #735
 * actually ships — the editor pane updating with the new content. Without
 * the content layer the negative store-flag checks in tests 1-3 would pass
 * even if the reload subscription were deleted entirely. Reading via
 * `editor.getValue()` — Monaco's public API — keeps the assertions stable
 * across Monaco upgrades.
 */

import { writeFileSync, unlinkSync, existsSync } from 'fs'
import path from 'path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'
import {
  openFileInStore,
  getWorktreePath,
  activateEditorTab,
  getOpenFileSummary,
  getMonacoContent
} from './helpers/external-file-change'

test.describe('External File Change Reflection', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  /**
   * Baseline for PR #735's contract: a clean, non-markdown open editor tab
   * must not be marked dirty, deleted, or renamed when the on-disk file is
   * rewritten by an external process (e.g. the integrated terminal running
   * `sed`, or a formatter). We also assert the on-disk content actually
   * changed so the test isn't tautological — if the write somehow didn't
   * land, the assertion that `externalMutation` stayed `null` would pass
   * vacuously.
   */
  test('non-markdown tab reflects external writes without dirty or tombstone flags', async ({
    orcaPage
  }) => {
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const worktreePath = await getWorktreePath(orcaPage, worktreeId)
    expect(worktreePath).not.toBeNull()

    // Why a dedicated per-test scratch file: `testRepoPath` is worker-shared
    // (persisted via TEST_REPO_PATH_FILE in global-setup), so tests in other
    // workers writing to `src/index.ts` would race the watcher here and flip
    // our Monaco pane to their content. A unique relative path per test
    // isolates the fs-level effect and keeps the assertion order-independent.
    const scratchRel = `scratch-external-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ts`
    const scratchAbs = path.join(worktreePath!, scratchRel)
    const seedContent = 'export const scratch = "initial"\n'
    writeFileSync(scratchAbs, seedContent)

    try {
      const fileId = await openFileInStore(orcaPage, worktreeId, scratchRel)
      expect(fileId).not.toBeNull()
      await activateEditorTab(orcaPage, fileId!)

      // Baseline: clean, no tombstone, no draft.
      await expect
        .poll(async () => getOpenFileSummary(orcaPage, fileId!), { timeout: 3_000 })
        .toEqual({ isDirty: false, externalMutation: null, draft: undefined })

      // Monaco must have mounted with the seed content before we assert an
      // external write replaces it — otherwise a freshly mounted "initial"
      // followed by late arriving "external-write-..." could look identical
      // to the load-bearing reload we want to prove.
      await expect
        .poll(async () => getMonacoContent(orcaPage, scratchAbs), { timeout: 10_000 })
        .toBe(seedContent)

      // Simulate an external writer (integrated terminal, formatter, etc.)
      // rewriting the file. Unique token keeps this assertion from passing
      // against any coincidental seed-text match.
      const uniqueToken = `external-write-${Date.now()}`
      const externalContent = `export const scratch = "${uniqueToken}"\n`
      writeFileSync(scratchAbs, externalContent)

      // The store-observable contract: no dirty flag, no tombstone, no draft
      // should appear. The watcher's 75ms debounce + fs event settle time
      // means we need to poll rather than sample once. A regression that
      // mis-classifies the update as a delete would flip `externalMutation`
      // to `'deleted'` here; a regression that clobbers an in-flight edit
      // would set `isDirty` or write into `editorDrafts`.
      await expect
        .poll(async () => getOpenFileSummary(orcaPage, fileId!), {
          timeout: 5_000,
          message: 'external write left unexpected mutation flags on a clean tab'
        })
        .toEqual({ isDirty: false, externalMutation: null, draft: undefined })

      // Prove the on-disk write actually took effect — otherwise the assertion
      // above is vacuous. We read via the main-process IPC the editor uses so
      // the read is apples-to-apples with what the reload pipeline would see.
      const reloadedFromDisk = await orcaPage.evaluate(async (filePath) => {
        const result = await window.api.fs.readFile({ filePath })
        return result?.content ?? null
      }, scratchAbs)
      expect(reloadedFromDisk).toBe(externalContent)

      // The load-bearing assertion: Monaco's model now holds the external
      // content. This is what PR #735 actually ships — store flags are the
      // diagnostic surface, but what the user sees is the pane updating.
      // Asserting against editor.getValue() hits Monaco's public API, so the
      // check is stable across Monaco upgrades (no `.view-lines` dependency).
      await expect
        .poll(async () => getMonacoContent(orcaPage, scratchAbs), { timeout: 5_000 })
        .toBe(externalContent)
    } finally {
      if (existsSync(scratchAbs)) {
        try {
          unlinkSync(scratchAbs)
        } catch {
          /* ignore */
        }
      }
    }
  })

  /**
   * Same contract, markdown path. Markdown files default to rich-preview
   * mode (`markdownViewMode[fileId] === 'rich'`) — the PR #832 debounce
   * specifically targets the rich-markdown pane since it rebuilds a
   * ProseMirror document on every reload. A regression that drops the
   * markdown file out of rich mode after an external write (e.g. by
   * re-running the file-open flow which would inherit the default) would
   * flip the mode and is worth asserting explicitly.
   */
  test('markdown tab stays in rich mode after external write', async ({ orcaPage }) => {
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const worktreePath = await getWorktreePath(orcaPage, worktreeId)
    expect(worktreePath).not.toBeNull()

    // Dedicated per-test scratch file — same isolation rationale as test 1.
    // Using a unique .md path means a parallel worker rewriting README.md
    // can't flip the heading this test is asserting on.
    const scratchRel = `scratch-external-md-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`
    const scratchAbs = path.join(worktreePath!, scratchRel)
    const initialHeading = `Initial ${Date.now()}`
    writeFileSync(scratchAbs, `# ${initialHeading}\n\nInitial paragraph.\n`)

    try {
      const fileId = await openFileInStore(orcaPage, worktreeId, scratchRel)
      expect(fileId).not.toBeNull()
      await activateEditorTab(orcaPage, fileId!)

      // Confirm the tab entered rich mode before the external write. Without
      // this baseline, "still rich after write" could mean "never was rich."
      await expect
        .poll(
          async () =>
            orcaPage.evaluate(
              (id) => window.__store?.getState().markdownViewMode[id] ?? 'rich',
              fileId!
            ),
          { timeout: 5_000, message: 'markdown tab did not default to rich mode' }
        )
        .toBe('rich')

      // ProseMirror must have mounted and painted the seed heading before we
      // assert a replacement — otherwise the post-write assertion could pass
      // against a still-rendering initial frame.
      await expect(orcaPage.getByRole('heading', { name: initialHeading })).toBeVisible({
        timeout: 10_000
      })

      const uniqueHeading = `External Write ${Date.now()}`
      const externalContent = `# ${uniqueHeading}\n\nUpdated paragraph.\n`
      writeFileSync(scratchAbs, externalContent)

      // After the watcher fires, rich mode must still be set and the tab must
      // not have been marked dirty or tombstoned.
      await expect
        .poll(
          async () =>
            orcaPage.evaluate((id) => {
              const state = window.__store?.getState()
              if (!state) {
                return null
              }
              const file = state.openFiles.find((f) => f.id === id)
              return {
                isDirty: Boolean(file?.isDirty),
                externalMutation: file?.externalMutation ?? null,
                mode: state.markdownViewMode[id] ?? 'rich'
              }
            }, fileId!),
          { timeout: 5_000, message: 'markdown tab flipped state after external write' }
        )
        .toEqual({ isDirty: false, externalMutation: null, mode: 'rich' })

      // The user-visible contract from PR #832's debounce work: rich-markdown
      // must actually repaint with the new heading. ProseMirror renders plain
      // semantic nodes, so `getByRole('heading')` with the unique text is a
      // stable assertion regardless of editor internals.
      await expect(orcaPage.getByRole('heading', { name: uniqueHeading })).toBeVisible({
        timeout: 5_000
      })
    } finally {
      if (existsSync(scratchAbs)) {
        try {
          unlinkSync(scratchAbs)
        } catch {
          /* ignore */
        }
      }
    }
  })

  /**
   * The dirty-tab guard from PR #735. If the user has unsaved edits, an
   * external write must NOT silently clobber them. The store-level signal
   * is that `editorDrafts[fileId]` is preserved and `isDirty` stays true —
   * the reload pipeline should skip this tab entirely.
   */
  test('dirty tab is not clobbered by external write', async ({ orcaPage }) => {
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const worktreePath = await getWorktreePath(orcaPage, worktreeId)
    expect(worktreePath).not.toBeNull()

    const scratchRel = `scratch-external-dirty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ts`
    const scratchAbs = path.join(worktreePath!, scratchRel)
    writeFileSync(scratchAbs, 'export const scratch = "initial"\n')

    try {
      const fileId = await openFileInStore(orcaPage, worktreeId, scratchRel)
      expect(fileId).not.toBeNull()
      await activateEditorTab(orcaPage, fileId!)

      await expect
        .poll(async () => getMonacoContent(orcaPage, scratchAbs), { timeout: 10_000 })
        .toBe('export const scratch = "initial"\n')

      // Seed an unsaved edit. Why drive `markFileDirty` + `setEditorDraft`
      // directly instead of typing into Monaco: the dirty-guard in PR #735
      // only reads store state (openFiles[i].isDirty), so exercising the
      // guard at the store layer is faithful to the real contract and
      // avoids driving Monaco's DOM-level input pipeline which is slower
      // and has no added coverage here.
      const draftContent = `export const scratch = "IN-PROGRESS-USER-EDIT"\n`
      await orcaPage.evaluate(
        ({ id, content }) => {
          const state = window.__store?.getState()
          if (!state) {
            return
          }
          state.setEditorDraft(id, content)
          state.markFileDirty(id, true)
        },
        { id: fileId!, content: draftContent }
      )

      await expect
        .poll(async () => getOpenFileSummary(orcaPage, fileId!), { timeout: 3_000 })
        .toEqual({ isDirty: true, externalMutation: null, draft: draftContent })

      // External writer stomps on the same path.
      const externalToken = `external-clobber-attempt-${Date.now()}`
      const externalContent = `export const scratch = "${externalToken}"\n`
      writeFileSync(scratchAbs, externalContent)

      // The guard: the draft must survive, the dirty flag must stay, and we
      // must NOT have been marked as tombstoned/renamed. The reload pipeline
      // in PR #735 skips the scheduleDebouncedExternalReload call when any
      // matching openFile is dirty — verifying the draft didn't shift is the
      // strongest store-visible proof that skip happened.
      //
      // Wait long enough to outlast the 75ms debounce + fs event settle, so
      // a regression that *did* reload would have observably clobbered by now.
      await orcaPage.waitForTimeout(500)
      const afterWrite = await getOpenFileSummary(orcaPage, fileId!)
      expect(afterWrite).toEqual({
        isDirty: true,
        externalMutation: null,
        draft: draftContent
      })

      // The load-bearing assertion for PR #735's dirty-guard: Monaco's model
      // must NOT carry the external token. A regression that unconditionally
      // reloaded on external writes would paint the external content over the
      // user's in-progress edit, silently losing their work — exactly the
      // failure mode the guard was added to prevent.
      const monacoContent = await getMonacoContent(orcaPage, scratchAbs)
      expect(monacoContent).not.toContain(externalToken)
    } finally {
      if (existsSync(scratchAbs)) {
        try {
          unlinkSync(scratchAbs)
        } catch {
          /* ignore */
        }
      }
    }
  })

  /**
   * External delete + resurrection. When an external process removes a file
   * that's open in the editor, PR #735's tombstone logic should mark the
   * tab `externalMutation === 'deleted'`. A follow-up create at the same
   * path (e.g. `git checkout`) should clear the tombstone back to `null`
   * so the tab returns to normal. Both halves of this round-trip live in
   * the same spec so a regression that breaks just one side can't hide
   * behind the other passing.
   */
  test('external delete tombstones the tab, resurrection clears it', async ({ orcaPage }) => {
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const worktreePath = await getWorktreePath(orcaPage, worktreeId)
    expect(worktreePath).not.toBeNull()

    // Why a dedicated file: we're about to delete it from disk, so creating
    // it fresh for this test (instead of reusing src/index.ts) avoids
    // leaving the seeded repo in a broken state if cleanup fails and lets
    // tests in the same worker keep depending on the seeded files.
    const scratchRel = 'scratch-external-delete.ts'
    const scratchAbs = path.join(worktreePath!, scratchRel)
    const initialContent = 'export const scratch = "initial"\n'
    writeFileSync(scratchAbs, initialContent)

    try {
      const fileId = await openFileInStore(orcaPage, worktreeId, scratchRel)
      expect(fileId).not.toBeNull()

      // Sanity: clean baseline before we delete.
      await expect
        .poll(
          async () =>
            orcaPage.evaluate(
              (id) =>
                window.__store?.getState().openFiles.find((f) => f.id === id)?.externalMutation ??
                null,
              fileId!
            ),
          { timeout: 3_000 }
        )
        .toBeNull()

      // External delete — a naked unlink with no paired create, so the
      // debounced-tombstone branch should flip the tab to 'deleted'.
      unlinkSync(scratchAbs)

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
            message: 'external delete did not mark the tab as tombstoned'
          }
        )
        .toBe('deleted')

      // Resurrection: same path comes back on disk (e.g. git checkout).
      // PR #735's `setExternalMutation(file.id, null)` in the create/update
      // branch should clear the tombstone.
      const resurrectedContent = `export const scratch = "resurrected-${Date.now()}"\n`
      writeFileSync(scratchAbs, resurrectedContent)

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
            message: 'resurrection did not clear the tombstone'
          }
        )
        .toBeNull()
    } finally {
      // Best-effort cleanup so a mid-test failure doesn't leave the
      // worker-scoped seed repo polluted for later tests.
      if (existsSync(scratchAbs)) {
        try {
          unlinkSync(scratchAbs)
        } catch {
          /* ignore */
        }
      }
    }
  })
})
