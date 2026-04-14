# Orca Performance Audit

Audit date: 2026-04-13
Branch: `Jinwoo-H/performance-improvement`

---

## Tier 1 — High Impact, Low Complexity

| # | Area | Issue | File(s) | Status |
|---|------|-------|---------|--------|
| 1 | Renderer | `App.tsx` has 53 separate Zustand subscriptions — nearly every state change re-renders the root and cascades through the entire tree | `src/renderer/src/App.tsx:40-180` | DONE (53→22 subs, memo barriers on 4 children) |
| 2 | Renderer | `Terminal.tsx` has unscoped `useAppStore.subscribe()` — fires on every store mutation, does O(worktrees×tabs) scan each time | `src/renderer/src/components/Terminal.tsx:645-659` | DONE |
| 3 | Terminal | No IPC batching — every PTY data chunk is a separate `webContents.send` call, hundreds/sec under load | `src/main/ipc/pty.ts:173-177` | DONE |
| 4 | Terminal | Divider drag calls `fitAddon.fit()` on every `pointermove` pixel — xterm reflow can take 500ms+ with large scrollback | `src/renderer/src/lib/pane-manager/pane-divider.ts:90-119` | DONE |
| 5 | Main | Startup blocks: `openCodeHookService.start()` and `runtimeRpc.start()` awaited sequentially before window opens | `src/main/index.ts:131-168` | DONE |
| 6 | Main | `persistence.ts` uses `readFileSync`/`writeFileSync`/`renameSync` on the main thread — blocks during startup and every 300ms save | `src/main/persistence.ts:59-125` | DONE |
| 7 | Worktree | `worktrees:listAll` iterates repos sequentially with `await` — total time = sum of all repos instead of max | `src/main/ipc/worktrees.ts:53-84` | DONE |
| 8 | Browser | Reverse Map scan O(N) on every mouse/load/permission event in `BrowserManager` | `src/main/browser/browser-manager.ts:91-96` | DONE |
| 9 | Browser | `before-mouse-event` listener fires for ALL mouse events on ALL guests, even background ones | `src/main/browser/browser-guest-ui.ts:78-93` | DONE |
| 10 | Worktree | `refreshGitHubForWorktree` bypasses 5-min cache TTL on every worktree switch — fires GitHub API calls on rapid tab switching | `src/renderer/src/store/slices/worktrees.ts:467-489` | DONE |

---

## Tier 2 — Medium Impact

| # | Area | Issue | File(s) | Status |
|---|------|-------|---------|--------|
| 11 | Main | `git/repo.ts`: `execSync('gh api user ...')` and chains of 5 sync git processes block main thread | `src/main/git/repo.ts:87-138` | TODO |
| 12 | Main | `hooks.ts`: `readFileSync`/`writeFileSync`/`mkdirSync`/`gitExecFileSync` in IPC handlers | `src/main/hooks.ts:113-416` | TODO |
| 13 | Renderer | `useSettings` returns entire `GlobalSettings` (~30+ fields) — any setting change re-renders all consumers | `src/renderer/src/store/selectors.ts` | TODO |
| 14 | Renderer | Tab title changes bump `sortEpoch` for ALL worktrees → triggers WorktreeList re-sort on every PTY title event | `src/renderer/src/store/slices/terminals.ts:325` | TODO |
| 15 | Renderer | `CacheTimer`: one `setInterval` per mounted card (20 cards = 20 intervals/sec), each with O(n) selector work | `src/renderer/src/components/sidebar/CacheTimer.tsx:28-48` | TODO |
| 16 | Renderer | Three simultaneous 3-second polling intervals per active worktree (git status, worktrees, stale conflict) | `src/renderer/src/components/right-sidebar/useGitStatusPolling.ts` | TODO |
| 17 | Renderer | 6 components missing `React.memo`: `SourceControl`, `RightSidebar`, `EditorPanel`, `ChecksPanel`, `FileExplorer`, `TabBar` | Various files in `src/renderer/src/components/` | DONE (8 components wrapped) |
| 18 | Worktree | Git polling fires immediately on every worktree switch (burst of `git status` + `git worktree list`) | `src/renderer/src/components/right-sidebar/useGitStatusPolling.ts:69-103` | REVERTED (150ms debounce caused visible flash on switch) |
| 19 | Worktree | `FileExplorer` `dirCache` discarded on every worktree switch — re-fetches entire tree from scratch | `src/renderer/src/components/right-sidebar/useFileExplorerTree.ts:27,81-96` | TODO |
| 20 | Terminal | `pty:resize` uses `ipcRenderer.invoke` (round-trip) instead of fire-and-forget `send` | `src/preload/index.ts:203-205` | DONE |
| 21 | Terminal | Flow control watermarks defined but never enforced for local PTYs — unbounded output floods renderer | `src/main/providers/local-pty-provider.ts:330-332` | TODO |
| 22 | Browser | `BrowserPane` subscribes to entire `browserPagesByWorkspace` map — any tab's navigation re-renders all panes | `src/renderer/src/components/browser-pane/BrowserPane.tsx:312` | TODO |
| 23 | Browser | `findPage`/`findWorkspace` do O(N) `Object.values().flat().find()` scans on every navigation event | `src/renderer/src/store/slices/browser.ts:221-240` | TODO |
| 24 | Browser | Download progress IPC fires at full Chromium frequency (many/sec) | `src/main/browser/browser-manager.ts:421-430` | TODO |
| 25 | Main | `detectConflictOperation` runs 4 `existsSync` + `readFile` on every 3s poll before git status | `src/main/git/status.ts:236-265` | DONE |
| 26 | Main | `getBranchCompare`: `loadBranchChanges` and `countAheadCommits` run sequentially | `src/main/git/status.ts:374-375` | DONE |
| 27 | Main | `addWorktree` calls 4-5 synchronous git processes from IPC handler | `src/main/git/worktree.ts:116-157` | DONE |

---

## Tier 3 — Lower Impact / Architectural

| # | Area | Issue | File(s) | Status |
|---|------|-------|---------|--------|
| 28 | Terminal | SSH relay `FrameDecoder` uses `Buffer.concat` on every chunk (quadratic copy) | `src/relay/protocol.ts:84` | TODO |
| 29 | Terminal | SSH relay replay buffer uses string concatenation (quadratic allocation) | `src/relay/pty-handler.ts:68-72` | TODO |
| 30 | Terminal | `extractLastOscTitle` regex runs on every PTY chunk with no fast-path bail | `src/shared/agent-detection.ts:23-39` | TODO |
| 31 | Terminal | Binary search calls `serialize()` up to 16× at shutdown | `src/renderer/src/components/terminal-pane/TerminalPane.tsx:579-596` | TODO |
| 32 | Browser | `capturePage()` captures full viewport then crops — should pass rect directly | `src/main/browser/browser-grab-screenshot.ts:36` | TODO |
| 33 | Browser | Parked webviews retain full 100vw×100vh compositor surfaces | `src/renderer/src/components/browser-pane/BrowserPane.tsx:94-107` | TODO |
| 34 | Browser | `onBeforeSendHeaders` intercepts every HTTPS request even when UA override unused | `src/main/browser/browser-session-registry.ts:126-137` | TODO |
| 35 | Main | `setBackgroundThrottling(false)` wastes CPU when window is minimized | `src/main/window/createMainWindow.ts:97` | TODO |
| 36 | Main | `warmSystemFontFamilies()` competes with startup I/O | `src/main/system-fonts.ts:30-32` | TODO |
| 37 | Renderer | Session persistence effect has 15 deps — fires on every tab title change | `src/renderer/src/App.tsx:239-283` | TODO |
| 38 | Renderer | Per-card `fetchPRForBranch` on mount — 30 worktrees = 30 simultaneous IPC calls | `src/renderer/src/components/sidebar/WorktreeCard.tsx:128-132` | TODO |
| 39 | Renderer | Synchronous full `monaco-editor` import blocks EditorPanel chunk evaluation | `src/renderer/src/components/editor/EditorPanel.tsx:7` | TODO |
| 40 | Worktree | `removeWorktree` runs `git worktree list` twice (pre and post removal) | `src/main/git/worktree.ts:163-208` | TODO |
| 41 | Worktree | `worktrees:list` can trigger duplicate `git worktree list` when cache is dirty | `src/main/ipc/worktrees.ts:86-116` | TODO |
| 42 | Renderer | SSH targets initialized sequentially in a `for...await` loop | `src/renderer/src/hooks/useIpcEvents.ts:232-252` | TODO |

---

## Key Themes

1. **Zustand subscription granularity** — `App.tsx` subscribes to 53 slices, `Terminal.tsx` subscribes to everything, `useSettings` returns the full object. Almost any state change cascades through the entire tree.

2. **Synchronous I/O on the main thread** — `persistence.ts`, `hooks.ts`, `git/repo.ts`, and `git/worktree.ts` use `readFileSync`/`writeFileSync`/`execSync` in startup and IPC handler paths.

3. **Unthrottled high-frequency events** — PTY data (no IPC batching), divider drag (fit on every pixel), download progress (no throttle), `before-mouse-event` (all mouse events on all guests), CacheTimer (20 intervals/sec).

4. **Sequential operations that could be parallel** — Startup server binds, repo iteration in `listAll`, git ref probing, `loadBranchChanges`/`countAheadCommits`, SSH target init.

5. **Aggressive polling** — Three 3-second intervals per worktree, per-card 1-second cache timers, per-card 5-minute issue polling, 250ms error-page detection.
