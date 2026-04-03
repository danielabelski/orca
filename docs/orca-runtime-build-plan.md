# Orca Runtime Build Plan

## Goal

Turn the converged runtime-layer design into an implementation plan that can be landed incrementally in this repo without drifting from the current Electron main/renderer split.

This plan covers the shared runtime needed for:

- CLI connection to a running Orca app
- runtime-owned selector resolution
- live terminal discovery
- handle-based terminal reads and writes
- `worktree ps`

It does not cover the full end-user `orca` CLI binary implementation. The focus here is the editor/runtime side that the future CLI will talk to.

Related docs:

- [orca-runtime-layer-design.md](./orca-runtime-layer-design.md)
- [orca-cli-v1-spec.md](./orca-cli-v1-spec.md)
- [orca-cli-command-surface.md](./orca-cli-command-surface.md)

## Validated Current State

This build plan is grounded in the current codebase, not an abstract target:

- Main process app boot:
  - [src/main/index.ts](../src/main/index.ts)
- Window-scoped service attachment:
  - [src/main/window/attach-main-window-services.ts](../src/main/window/attach-main-window-services.ts)
- Current PTY ownership and reload behavior:
  - [src/main/ipc/pty.ts](../src/main/ipc/pty.ts)
- Current preload bridge:
  - [src/preload/index.ts](../src/preload/index.ts)
- Current persisted state file and `userData` location:
  - [src/main/persistence.ts](../src/main/persistence.ts)
- Current session and tab/layout persistence:
  - [src/main/ipc/session.ts](../src/main/ipc/session.ts)
  - [src/shared/types.ts](../src/shared/types.ts)
- Current renderer lifecycle seams:
  - [src/renderer/src/hooks/useIpcEvents.ts](../src/renderer/src/hooks/useIpcEvents.ts)
  - [src/renderer/src/store/slices/terminals.ts](../src/renderer/src/store/slices/terminals.ts)
  - [src/renderer/src/components/terminal-pane/use-terminal-pane-lifecycle.ts](../src/renderer/src/components/terminal-pane/use-terminal-pane-lifecycle.ts)
  - [src/renderer/src/components/terminal-pane/pty-connection.ts](../src/renderer/src/components/terminal-pane/pty-connection.ts)

Important validated constraints:

- PTYs are main-owned and keyed only by `ptyId`.
- PTY data/exit are currently forwarded to one `mainWindow.webContents`.
- Renderer leaf state is not a canonical persisted model today.
- Hidden panes can accumulate deferred output in `pendingWritesRef`, so v1 cannot promise a truthful visible-screen snapshot.
- Core IPC handlers are registered before any window exists, while repo/worktree/PTY handlers are attached per window.

## Implementation Principles

1. Keep the first landing main-process owned.
   The runtime is a control plane, not renderer state with extra plumbing.

2. Use full-graph sync, not many fine-grained renderer IPC messages.
   The current renderer lifecycle is too distributed for a granular protocol to stay honest.

3. Make v1 reads tail-buffer-first.
   Do not promise a renderer-derived screen state until Orca can actually maintain one for hidden panes too.

4. Fail closed during reload or graph loss.
   If the runtime does not have an authoritative renderer graph, live terminal operations must reject.

5. Keep the first module split small.
   Start with one runtime service and one IPC entrypoint. Split later only if the implementation earns it.

## Deliverables

The runtime build should produce:

- a main-process runtime service
- a local-only runtime metadata file in Orca `userData`
- a local RPC transport for future CLI requests
- a renderer-side graph collector and sync publisher
- PTY event ingestion into the runtime service
- runtime-owned selector resolution
- runtime-owned terminal handles
- runtime-backed `terminal list`, `terminal show`, `terminal read`, `terminal send`
- runtime-backed `worktree ps`

## Concrete File Plan

### New files

- `src/main/runtime/orca-runtime.ts`
  Main runtime service, registry, selector resolution, handle issuance, tail buffers, and command methods.

- `src/main/ipc/runtime.ts`
  Internal Electron IPC registration for renderer-to-main runtime sync and for renderer/runtime status queries during development.

- `src/main/runtime/runtime-rpc.ts`
  Local socket or named-pipe server and request routing. Keep transport code out of generic Electron IPC registration.

- `src/main/runtime/runtime-metadata.ts`
  Read/write runtime metadata file in `app.getPath('userData')`.

- `src/renderer/src/runtime/sync-runtime-graph.ts`
  Single collector/helper that computes the full tab and leaf graph and publishes it to main.

### Existing files to modify

- `src/main/index.ts`
  Create runtime service early, start the local RPC transport, and stop it on quit.

- `src/main/window/attach-main-window-services.ts`
  Attach runtime window registration alongside repo/worktree/PTY services.

- `src/main/ipc/register-core-handlers.ts`
  Register runtime IPC handlers with the same lifetime as other core handlers.

- `src/main/ipc/pty.ts`
  Emit PTY spawn/data/exit/kill events into the runtime service.

- `src/preload/index.ts`
  Expose renderer-internal runtime sync/status bridge methods.

- `src/renderer/src/App.tsx`
  Start runtime graph publishing after session hydration and stop it on unload.

- `src/renderer/src/store/slices/terminals.ts`
  Schedule graph sync after tab creation, closure, title changes, PTY attachment changes, and active-tab changes.

- `src/renderer/src/components/terminal-pane/use-terminal-pane-lifecycle.ts`
  Schedule graph sync on pane create/close, active pane changes, and layout changes.

- `src/renderer/src/components/terminal-pane/pty-connection.ts`
  Schedule graph sync on PTY spawn and PTY detach.

## Runtime Metadata File

Add a second small file next to `orca-data.json` in `userData`.

Suggested path:

- `<userData>/orca-runtime.json`

Suggested contents:

```json
{
  "runtimeId": "rt_123",
  "pid": 12345,
  "transport": {
    "kind": "unix",
    "endpoint": "/path/to/socket"
  },
  "authToken": "random-secret",
  "startedAt": 1760000000000
}
```

Rules:

- rewrite atomically, same as persistence
- delete on clean shutdown if possible
- tolerate stale file on boot by checking `pid`

Why:

- the CLI needs a deterministic local bootstrap path
- this must stay separate from `orca-data.json` because it is live runtime metadata, not durable application state

## Local RPC Envelope

The CLI transport should not talk Electron IPC directly. The runtime needs a local RPC boundary that survives future editor changes.

Suggested request envelope:

```ts
type RuntimeRpcRequest = {
  id: string
  authToken: string
  method: string
  params?: unknown
}
```

Suggested response envelope:

```ts
type RuntimeRpcResponse =
  | {
      id: string
      ok: true
      result: unknown
      _meta: {
        runtimeId: string
      }
    }
  | {
      id: string
      ok: false
      error: {
        code: string
        message: string
        data?: unknown
      }
      _meta: {
        runtimeId: string
      }
    }
```

Initial methods to route through the runtime service:

- `status.get`
- `selector.resolveRepo`
- `selector.resolveWorktree`
- `terminal.list`
- `terminal.show`
- `terminal.read`
- `terminal.send`
- `worktree.ps`

## Internal Electron IPC Contract

This is editor-runtime plumbing, not the public CLI contract.

### Renderer -> Main

Register in `src/main/ipc/runtime.ts`:

- `runtime:syncWindowGraph`
- `runtime:getStatus`

Suggested `runtime:syncWindowGraph` payload:

```ts
type RuntimeSyncWindowGraph = {
  windowId: number
  tabs: Array<{
    tabId: string
    worktreeId: string
    title: string | null
    activeLeafId: string | null
    layout: TerminalPaneLayoutNode | null
  }>
  leaves: Array<{
    tabId: string
    worktreeId: string
    leafId: string
    paneRuntimeId: number
    ptyId: string | null
  }>
}
```

Suggested `runtime:getStatus` response:

```ts
type RuntimeStatus = {
  runtimeId: string
  graphStatus: 'ready' | 'reloading' | 'unavailable'
  authoritativeWindowId: number | null
  rendererGraphEpoch: number
}
```

Why only these two now:

- the design intentionally avoids a large family of fragile `registerX/updateY/removeZ` messages
- the collector helper should own payload construction in one place

## Runtime Service API

The first service can be a single class with methods like:

```ts
class OrcaRuntimeService {
  start(): Promise<void>
  stop(): Promise<void>

  markRendererReloading(windowId: number): void
  syncWindowGraph(graph: RuntimeSyncWindowGraph): void

  onPtySpawned(event: RuntimePtySpawned): void
  onPtyData(event: RuntimePtyData): void
  onPtyExit(event: RuntimePtyExit): void
  onPtyKilled(event: RuntimePtyKilled): void

  getStatus(): RuntimeStatus
  resolveRepo(selector: string): ResolvedRepo
  resolveWorktree(selector: string): ResolvedWorktree

  listTerminals(input: ListTerminalsInput): ListTerminalsResult
  showTerminal(input: ShowTerminalInput): ShowTerminalResult
  readTerminal(input: ReadTerminalInput): ReadTerminalResult
  sendTerminal(input: SendTerminalInput): SendTerminalResult
  worktreePs(input: WorktreePsInput): WorktreePsResult
}
```

Internal state should include:

- `runtimeId`
- `graphStatus`
- `authoritativeWindowId`
- `rendererGraphEpoch`
- tab registry
- leaf registry
- handle registry
- PTY tail buffers
- preview cache

## Renderer Graph Collector

Do not let store slices and pane lifecycle code each build their own partial graph payloads.

`src/renderer/src/runtime/sync-runtime-graph.ts` should expose something like:

```ts
type ScheduleRuntimeGraphSync = () => void

export function createRuntimeGraphSyncController(): {
  scheduleSync: ScheduleRuntimeGraphSync
  flushSync: () => Promise<void>
  stop: () => void
}
```

Responsibilities:

- read authoritative tab/layout data from the store
- inspect live pane manager state only where necessary to map `leafId -> paneRuntimeId -> ptyId`
- debounce bursts of lifecycle changes into one sync
- publish `runtime:syncWindowGraph`

Callers in lifecycle code should only do:

- `scheduleRuntimeGraphSync()`

They should not hand-build graph payloads.

Why:

- this avoids a second ad hoc terminal state model spreading through the renderer
- a single collector is the simplest way to keep the graph publication logic maintainable

## PTY Integration Changes

`src/main/ipc/pty.ts` currently owns:

- PTY spawn
- PTY write
- PTY resize
- PTY kill
- PTY data forwarding
- PTY exit forwarding

Add runtime callbacks without changing ownership:

- on spawn, call `runtime.onPtySpawned({ ptyId, loadGeneration })`
- on data, call `runtime.onPtyData({ ptyId, data, at })`
- on exit, call `runtime.onPtyExit({ ptyId, exitCode, at })`
- on kill, call `runtime.onPtyKilled({ ptyId, at })`

Do not move PTY process ownership into the runtime service in the first pass.

Why:

- PTY ownership already works
- the runtime needs an index and command layer, not a second process manager

## Selector Resolution

Implement selector resolution in the runtime service, not the future CLI frontend.

Selector forms to support now:

- `id:<repoId>`
- `path:<repoPath>`
- `id:<worktreeId>`
- `path:<worktreePath>`
- `branch:<branch>`
- `issue:<number>`

Rules:

- tagged selectors are preferred
- bare values are allowed only where the CLI spec permits them
- ambiguity returns a structured error with candidates

Why this belongs in runtime:

- selector semantics are part of the public contract
- the editor, CLI, and future integrations must not resolve targets differently

## Terminal Handle Strategy

Issue handles only from runtime discovery results.

Handle issuance should happen in:

- `terminal.list`
- optionally selector-scoped summary results that mention live terminals

Handle validation must reject when:

- `runtimeId` changed
- `rendererGraphEpoch` changed incompatibly
- leaf missing
- `ptyId` changed
- `ptyGeneration` changed

Stale-handle errors should include:

- `runtimeId`
- error code
- optional rediscovery hint scoped to the same worktree or leaf

Do not auto-refresh handles inside the runtime service.

## `terminal read` v1 Contract

The implementation must match the current repo reality:

- return tail-buffer-based output only
- do not imply visible-screen truth
- include truncation metadata

Suggested response shape:

```ts
type TerminalReadResult = {
  terminal: {
    handle: string
    worktreeId: string
    tabId: string
    leafId: string
    connected: boolean
    writable: boolean
    lastOutputAt: number | null
    preview: string
    tail: string[]
    truncated: boolean
  }
}
```

Visible-screen reads can be added later behind an explicit richer mode.

## `terminal send` v1 Contract

`terminal send` should route to the existing main-owned PTY write path, but only after runtime validation.

Minimum send operations:

- send text
- send text plus trailing newline
- send control-C

Gate on:

- `graphStatus === 'ready'`
- leaf exists in current graph
- `ptyId != null`
- `connected === true`
- `writable === true`

Reject rather than guessing.

## `worktree ps` v1 Contract

Back this from:

- persisted worktree metadata from `Store`
- live terminal counts from the runtime registry
- PTY connectivity
- last output timestamps
- preview cache

Do not infer fuzzy states like “running”, “waiting”, or “idle” in v1.

Suggested summary fields:

- `worktreeId`
- `repoId`
- `path`
- `branch`
- `linkedIssue`
- `isUnread`
- `liveTerminalCount`
- `hasAttachedPty`
- `lastOutputAt`
- `preview`

## Rollout Plan

### PR 1: Runtime skeleton and metadata

Files:

- add `src/main/runtime/orca-runtime.ts`
- add `src/main/runtime/runtime-metadata.ts`
- modify [src/main/index.ts](../src/main/index.ts)

Deliver:

- `runtimeId`
- `graphStatus`
- `authoritativeWindowId`
- metadata file write/delete

Acceptance:

- app starts normally
- metadata file is written on startup
- metadata file contains valid `runtimeId` and `pid`
- metadata file is removed or replaced correctly on restart

### PR 2: Local RPC transport

Files:

- add `src/main/runtime/runtime-rpc.ts`
- wire into [src/main/index.ts](../src/main/index.ts)

Deliver:

- local socket or named-pipe listener
- auth token validation
- `status.get`

Acceptance:

- a small local client can connect and get `status`
- invalid auth token is rejected
- stale metadata file does not break restart

### PR 3: Renderer graph sync

Files:

- add `src/main/ipc/runtime.ts`
- add `src/renderer/src/runtime/sync-runtime-graph.ts`
- modify [src/preload/index.ts](../src/preload/index.ts)
- modify [src/renderer/src/App.tsx](../src/renderer/src/App.tsx)
- modify [src/renderer/src/store/slices/terminals.ts](../src/renderer/src/store/slices/terminals.ts)
- modify [src/renderer/src/components/terminal-pane/use-terminal-pane-lifecycle.ts](../src/renderer/src/components/terminal-pane/use-terminal-pane-lifecycle.ts)
- modify [src/renderer/src/components/terminal-pane/pty-connection.ts](../src/renderer/src/components/terminal-pane/pty-connection.ts)

Deliver:

- `runtime:syncWindowGraph`
- single renderer graph collector
- one authoritative window

Acceptance:

- graph sync occurs after tab/pane creation and PTY spawn
- graph reload transitions `graphStatus` through `reloading` to `ready`
- a second publishing window is rejected or leaves the graph unavailable

### PR 4: PTY ingestion and terminal discovery

Files:

- modify [src/main/ipc/pty.ts](../src/main/ipc/pty.ts)
- modify `src/main/runtime/orca-runtime.ts`

Deliver:

- PTY spawn/data/exit/kill ingestion
- preview generation
- selector resolution
- handle issuance
- `terminal.list`
- `terminal.show`

Acceptance:

- runtime sees PTY activity without renderer scraping
- terminal list returns handles plus stable metadata
- handle validation rejects stale targets after remap or reload

### PR 5: Reads and writes

Files:

- modify `src/main/runtime/orca-runtime.ts`
- modify `src/main/runtime/runtime-rpc.ts`

Deliver:

- `terminal.read`
- `terminal.send`
- reload-aware rejection

Acceptance:

- `terminal.read` returns bounded tail output
- `terminal.send` writes only to validated targets
- live operations reject while `graphStatus != ready`

### PR 6: `worktree ps`

Files:

- modify `src/main/runtime/orca-runtime.ts`
- modify `src/main/runtime/runtime-rpc.ts`

Deliver:

- runtime-backed `worktree.ps`

Acceptance:

- summary reflects live terminals and persisted metadata
- no fuzzy inferred states are exposed

## Test Plan

### Main-process unit tests

Add:

- `src/main/runtime/orca-runtime.test.ts`
- `src/main/runtime/runtime-metadata.test.ts`
- `src/main/runtime/runtime-rpc.test.ts`

Cover:

- runtime metadata lifecycle
- selector resolution and ambiguity errors
- handle issuance and stale-handle rejection
- graphStatus transitions
- PTY tail buffering and truncation
- `worktree ps` aggregation

### IPC integration tests

Add:

- `src/main/ipc/runtime.test.ts`

Cover:

- `runtime:syncWindowGraph`
- single authoritative window enforcement
- `runtime:getStatus`

### Regression checks in existing tests

Watch:

- [src/main/ipc/register-core-handlers.test.ts](../src/main/ipc/register-core-handlers.test.ts)
- [src/main/ipc/worktrees.test.ts](../src/main/ipc/worktrees.test.ts)
- [src/main/ipc/worktree-logic.test.ts](../src/main/ipc/worktree-logic.test.ts)

### Manual validation

Validate in a dev app:

1. Start Orca and create a worktree with a terminal tab.
2. Split the terminal into multiple panes.
3. Confirm runtime graph sync updates after split, focus change, and pane close.
4. Trigger a renderer reload and confirm:
   - `graphStatus` becomes `reloading`
   - live terminal operations reject
   - handles become stale
5. Confirm hidden-pane output still shows up in tail-buffer-based `terminal.read`.

## Risks And Mitigations

### Risk: graph sync spreads across too many renderer call sites

Mitigation:

- enforce one collector helper
- lifecycle code only schedules sync

### Risk: runtime claims too much about terminal screen state

Mitigation:

- keep v1 read model tail-only
- defer visible-screen snapshots

### Risk: reload races produce ghost terminals

Mitigation:

- explicit `graphStatus`
- fail closed while graph unavailable
- authoritative-window rule

### Risk: handle churn becomes noisy for agents

Mitigation:

- only invalidate on real remaps
- return rediscovery hints in stale-handle errors

## Recommendation

Implement this in six PR-sized slices, with PR 1 through PR 4 treated as the hard dependency chain.

The most important discipline is this:

- do not let renderer lifecycle code invent its own runtime payloads
- do not let the future CLI frontend own selector semantics
- do not over-promise terminal read fidelity before Orca can truly maintain it

If those constraints hold, the runtime will stay aligned with the CLI design instead of drifting into another editor-only abstraction.
