# Performance Improvement — Implementation Plan

Branch: `Jinwoo-H/performance-improvement`

---

## Completed (Tier 1)

### Fix 3 — PTY IPC Data Batching
**Files:** `src/main/ipc/pty.ts`
**Change:** Added 8ms flush-window batching for PTY data. Instead of calling `webContents.send('pty:data', ...)` on every `node-pty` onData event, data is accumulated per-PTY in a `Map<string, string>` and flushed once per 8ms interval. Reduces IPC round-trips from hundreds/sec to ~120/sec under high throughput. Interactive latency stays below one frame (16ms).

### Fix 4 — Divider Drag Throttled to rAF
**Files:** `src/renderer/src/lib/pane-manager/pane-divider.ts`
**Change:** Wrapped `refitPanesUnder` calls in `requestAnimationFrame` guard during `onPointerMove`. Previously `fitAddon.fit()` ran on every pointer event (~250Hz), each triggering a full xterm.js reflow (500ms+ with large scrollback). Now capped at 60fps. Cleanup on `onPointerUp` cancels pending rAF and runs one final refit.

### Fix 5 — Startup Parallelization
**Files:** `src/main/index.ts`
**Change:** `openCodeHookService.start()`, `runtimeRpc.start()`, and `openMainWindow()` now run concurrently via `Promise.all` instead of three sequential `await`s. Window creation no longer blocked by server bind operations.

### Fix 6 — Async Persistence Writes
**Files:** `src/main/persistence.ts`, `src/main/persistence.test.ts`
**Change:** Debounced `scheduleSave()` now calls `writeToDiskAsync()` using `fs/promises` (writeFile, rename, mkdir) instead of `writeFileSync`/`renameSync`. Synchronous `writeToDiskSync()` retained only for `flush()` at shutdown. Added `waitForPendingWrite()` for test await support.

### Fix 7 — Parallel Worktree Listing
**Files:** `src/main/ipc/worktrees.ts`
**Change:** `worktrees:listAll` handler now uses `Promise.all(repos.map(...))` instead of sequential `for...of` loop. Total time = slowest repo, not sum of all repos. Each repo's `listRepoWorktrees` spawns `git worktree list` subprocess independently.

### Fix 8 — BrowserManager Reverse Map
**Files:** `src/main/browser/browser-manager.ts`
**Change:** Added `tabIdByWebContentsId` reverse Map maintained in sync with `webContentsIdByTabId`. Replaced two O(N) `[...entries()].find()` scans with O(1) `.get()` lookups. Updated `registerGuest`, `unregisterGuest`, and `unregisterAll` to keep both maps in sync.

### Fix 9 — Context Menu Listener Scoping
**Files:** `src/main/browser/browser-guest-ui.ts`
**Change:** `before-mouse-event` listener is now installed only when a context menu is open (on `context-menu` event) and removed on first `mouseDown` (dismiss). Previously fired for every mouse event on every guest surface.

### Fix 10 — GitHub Cache TTL on Worktree Switch
**Files:** `src/renderer/src/store/slices/github.ts`, `src/renderer/src/store/slices/worktrees.ts`, `src/renderer/src/store/slices/store-cascades.test.ts`
**Change:** Added `refreshGitHubForWorktreeIfStale()` that checks cache age before fetching. `setActiveWorktree` now calls this instead of `refreshGitHubForWorktree` (which always force-refreshes). Eliminates unnecessary GitHub API calls on rapid worktree switching. Force-refresh still available via explicit user action.

### Fix 20 (Tier 2 bonus) — PTY Resize Fire-and-Forget
**Files:** `src/main/ipc/pty.ts`, `src/preload/index.ts`
**Change:** `pty:resize` changed from `ipcMain.handle`/`ipcRenderer.invoke` (round-trip) to `ipcMain.on`/`ipcRenderer.send` (fire-and-forget). Halves IPC traffic for terminal resize events since the renderer never awaited the response anyway.

---

## Completed (Tier 1 — continued)

### Fix 1b — Session Persistence Extracted from React
**Files:** `src/renderer/src/App.tsx`
**Change:** Replaced the session-persistence `useEffect` (which had ~15 Zustand subscriptions as deps) with a single `useAppStore.subscribe()` call that runs outside React's render cycle. The subscriber debounces writes to disk via `window.setTimeout(150ms)`. This removed 12 `useAppStore` subscriptions from App's render cycle (`activeRepoId`, `terminalLayoutsByTabId`, `openFiles`, `activeFileIdByWorktree`, `activeTabTypeByWorktree`, `activeTabIdByWorktree`, `browserTabsByWorktree`, `browserPagesByWorkspace`, `activeBrowserTabIdByWorktree`, `unifiedTabsByWorktree`, `groupsByWorktree`, `activeGroupIdByWorktree`) — none of which ever drove JSX.

### Fix 1a — Consolidated Action Subscriptions
**Files:** `src/renderer/src/App.tsx`
**Change:** Consolidated 19 stable action-ref subscriptions (`toggleSidebar`, `fetchRepos`, `openModal`, `setRightSidebarTab`, etc.) into a single `useShallow` selector returning an `actions` object. Since Zustand actions are referentially stable, the shallow equality check always passes and this subscription never triggers a re-render. All call sites updated to `actions.fetchRepos()`, `actions.toggleSidebar()`, etc.

### Fix 1c — React.memo Barriers for Children
**Files:** `src/renderer/src/components/sidebar/index.tsx`, `src/renderer/src/components/Terminal.tsx`, `src/renderer/src/components/right-sidebar/index.tsx`, `src/renderer/src/components/status-bar/StatusBar.tsx`
**Change:** Wrapped `Sidebar`, `Terminal`, `RightSidebar`, and `StatusBar` in `React.memo`. These components accept no props from App — they read state from the store directly. The memo barrier prevents App's remaining re-renders (from layout state like `sidebarWidth`, `activeView`) from cascading into the full component tree.

### Fix 2 — Terminal.tsx Scoped Subscribe
**Files:** `src/renderer/src/components/Terminal.tsx`
**Change:** The `useAppStore.subscribe()` that destroys orphaned browser webviews now short-circuits with a reference equality check (`state.browserTabsByWorktree === prevBrowserTabs`). Previously fired on every store mutation; now only runs the O(tabs) scan when `browserTabsByWorktree` actually changes.

**Total App.tsx subscription reduction: 53 → 22 (58% fewer)**

---

## Planned — Tier 2

### Fix 11 — Async Git Username/Login
**Files:** `src/main/git/repo.ts`
**Change:** Replace `execSync('gh api user ...')` and `gitExecFileSync` chains in `getGhLogin`, `getGitUsername`, and `getDefaultBaseRef` with their async equivalents. `getDefaultBaseRefAsync` already exists — remove the sync variant and migrate all callers. The `Store.hydrateRepo` call in `getRepos()` is synchronous and uses `getGitUsername` — convert to a lazy-populate pattern where the `gitUsername` field is initially empty and filled by an async hydration pass after construction.

### Fix 12 — Async Hooks File I/O
**Files:** `src/main/hooks.ts`
**Change:** Convert `loadHooks`, `hasHooksFile`, `hasUnrecognizedOrcaYamlKeys`, `readIssueCommand`, `writeIssueCommand`, and `createWorktreeRunnerScript` from `readFileSync`/`writeFileSync`/`mkdirSync`/`gitExecFileSync` to `fs/promises` + `gitExecFileAsync`. Update all callers in `src/main/ipc/worktrees.ts` to await the new async versions.

### Fix 13 — Narrow `useSettings` Selector
**Files:** `src/renderer/src/store/selectors.ts`, all 10 consumers
**Change:** The current `useSettings = () => useAppStore((s) => s.settings)` returns the entire GlobalSettings object (~30 fields). Any setting change re-renders every consumer. Replace with field-specific selectors or use `useShallow` at each call site to select only the fields used by that component:
- `App.tsx` only uses `settings.theme` → `useAppStore((s) => s.settings?.theme)`
- `MonacoEditor.tsx` uses font/tab/theme → `useShallow` for those 3 fields
- `AddWorktreeDialog.tsx` uses one field → direct selector

### Fix 14 — Narrow sortEpoch Bumping
**Files:** `src/renderer/src/store/slices/terminals.ts`
**Change:** `updateTabTitle` currently bumps `sortEpoch` on every title string change for background worktrees (line 354). Title strings change frequently during agent runs (shell prompts, command names). Only bump `sortEpoch` when the agent working/idle status boundary is actually crossed. This requires comparing the old and new title against the agent-status detection logic before deciding to increment.

### Fix 15 — Shared CacheTimer Interval
**Files:** `src/renderer/src/components/sidebar/CacheTimer.tsx`
**Change:** Each `CacheTimer` instance creates its own 1-second `setInterval`. With 20 visible cards this means 20 intervals firing per second, each running a Zustand selector that iterates `Object.keys(s.cacheTimerByKey)`. Replace with a single shared interval at the module level (or in the store slice) that updates a `remainingByWorktreeId` map in one `set()` call. Components subscribe to only their specific worktree's entry.

### Fix 16 — Consolidate Git Status Polling
**Files:** `src/renderer/src/components/right-sidebar/useGitStatusPolling.ts`
**Change:** Three `setInterval(fn, 3000)` calls run simultaneously: git status, fetchWorktrees, and stale conflict poll. The worktree list poll (every 3s) is aggressive — branch changes inside terminals are low-frequency. Consolidate into a single interval:
- Git status poll: keep at 3s (drives diff gutter, status badge)
- Worktree list poll: increase to 15s (only needed when user runs `git checkout` in terminal)
- Stale conflict poll: keep at 3s but only when stale worktrees exist (already gated)

### Fix 17 — React.memo on Heavy Components
**Files:** `SourceControl.tsx`, `EditorPanel.tsx`, `FileExplorer.tsx`, `TabBar.tsx`
**Change:** Wrapped all four in `React.memo`. Combined with the Tier 1 memo barriers on Sidebar/Terminal/RightSidebar/StatusBar, a total of 8 heavy components now prevent parent re-render cascades.

### Fix 18 — Debounce Git Polling on Worktree Switch
**Files:** `src/renderer/src/components/right-sidebar/useGitStatusPolling.ts`
**Change:** Replaced the immediate `void fetchStatus()` and `void fetchWorktrees(activeRepoId)` calls with 150ms `setTimeout` debounces. The interval polling continues as before. Rapid worktree switching now only fires one git status + one git worktree list subprocess instead of N.

### Fix 19 — Cache FileExplorer dirCache Per Worktree
**Files:** `src/renderer/src/components/right-sidebar/useFileExplorerTree.ts`
**Change:** `dirCache` is local `useState` — reset on every worktree switch. Cache the directory tree per worktree in a `useRef<Map<string, DirCache>>()` at the hook level. On switch, restore from cache instantly (with a background revalidation fetch). This makes repeated worktree switches O(1) for the file explorer.

### Fix 21 — Local PTY Flow Control
**Files:** `src/main/providers/local-pty-provider.ts`, `src/renderer/src/components/terminal-pane/pty-dispatcher.ts`
**Change:** Wire up the already-defined `PTY_FLOW_HIGH_WATERMARK` (100KB) and `PTY_FLOW_LOW_WATERMARK` (5KB) constants. Track pending bytes per PTY in the renderer's `EagerPtyBuffer`. When pending exceeds high watermark, send an IPC message to pause the node-pty stream. Resume when acknowledged down to low watermark. The `acknowledgeDataEvent` channel is already plumbed — just needs implementation.

### Fix 22 — Narrow BrowserPane Selector
**Files:** `src/renderer/src/components/browser-pane/BrowserPane.tsx`
**Change:** Line 312: `useAppStore((s) => s.browserPagesByWorkspace)` subscribes to the entire map. Any tab's navigation re-renders all BrowserPane instances. Narrow to: `useAppStore((s) => s.browserPagesByWorkspace[browserTab.id] ?? EMPTY_BROWSER_PAGES)`.

### Fix 23 — Index-Based findPage/findWorkspace
**Files:** `src/renderer/src/store/slices/browser.ts`
**Change:** `findWorkspace` and `findPage` (lines 221-240) use `Object.values().flat().find()` on every navigation event. Accept `worktreeId`/`workspaceId` as a hint parameter and do direct key access: `browserTabsByWorktree[worktreeId]?.find(...)` instead of flattening across all worktrees.

### Fix 24 — Throttle Download Progress
**Files:** `src/main/browser/browser-manager.ts`
**Change:** `download.item.on('updated', ...)` fires at full Chromium frequency. Add per-download throttle timer — only call `sendDownloadProgress` at most once per 250ms. Clear throttle timer on download done/cancel.

### Fix 25 — Parallelize detectConflictOperation with git status
**Files:** `src/main/git/status.ts`
**Change:** `getStatus()` now kicks off both `detectConflictOperation()` and `git status` concurrently. The conflict detection promise is started first and awaited before the status result, preserving error semantics while overlapping I/O.

### Fix 26 — Parallelize getBranchCompare
**Files:** `src/main/git/status.ts`
**Change:** `loadBranchChanges` and `countAheadCommits` now run via `Promise.all` instead of sequentially. These are independent git subprocess calls.

### Fix 27 — Async addWorktree
**Files:** `src/main/git/worktree.ts`, `src/main/ipc/worktree-remote.ts`, `src/main/runtime/orca-runtime.ts`
**Change:** Converted `addWorktree` from synchronous (`gitExecFileSync`) to async (`gitExecFileAsync`). This was the last major sync git operation on the main thread — 4-5 sequential subprocess calls that blocked the event loop during worktree creation. Updated callers and all 7 tests.

---

## Benchmark Validation Results (2026-04-14)

Ran 6 targeted benchmarks to validate optimization claims. Full scripts in `benchmarks/`.

| Fix | What was measured | Result | Verdict |
|-----|-------------------|--------|---------|
| 3 — PTY Batching | IPC calls/sec: unbatched vs 8ms window | 5000→125 calls/sec (98% reduction) | **Validated — high impact** |
| 5/7 — Parallelization | Sequential vs parallel subprocess at N=5 | 119ms→46ms (2.6x, 73ms saved) | **Validated — high impact** |
| 6 — Async I/O | Main-thread blocking: sync vs fire-and-forget | 439µs→21µs per write (21x less blocking) | **Validated — high impact** |
| 1 — Zustand Subs | Selector cost: 53 subs vs 18 subs | 2.61µs→1.59µs per mutation (1.6x) | **Validated — moderate** (real win is cascade prevention via React.memo) |
| 8 — Reverse Map | entries().find() vs Map.get() at N=10 | 409ns→1ns (479x) but 0.04ms/sec total | **Deprioritize** — micro-optimization |
| 23 — flat().find() | Object.values().flat().find() vs direct at 50 tabs | 1958ns→62ns (31x) but 0.02ms/sec total | **Deprioritize** — micro-optimization |

### Deprioritized based on benchmarks

The following fixes are technically correct but save <0.1ms/sec at realistic load. Moved to "nice to have":
- Fix 8 (Reverse Map) — already implemented, keep as-is
- Fix 14 (sortEpoch) — per-mutation overhead is negligible
- Fix 15 (CacheTimer shared interval) — 20 intervals/sec is fine for modern JS engines
- Fix 22 (BrowserPane selector) — sub-microsecond per render
- Fix 23 (findPage/findWorkspace) — 0.02ms/sec at 10 nav/sec
- Fix 24 (Download progress throttle) — infrequent event
- Fix 26 (getBranchCompare parallel) — implemented anyway since it was a one-liner

---

## Key Themes

1. **Zustand subscription granularity** — Fixes 1, 2, 13, 14, 17, 22 all reduce the blast radius of state changes on React re-renders.

2. **Synchronous I/O on main thread** — Fixes 6, 11, 12, 27 convert blocking filesystem and git operations to async.

3. **Unthrottled high-frequency events** — Fixes 3, 4, 9, 15, 20, 24 cap event processing to reasonable rates.

4. **Sequential → parallel** — Fixes 5, 7, 25, 26 run independent async operations concurrently.

5. **Aggressive polling** — Fixes 16, 18 consolidate and debounce polling intervals.
