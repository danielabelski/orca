# Orca CLI Terminal Token Efficiency

## Goal

Design Orca terminal commands so agents can inspect and control live Orca terminals through a running Orca editor without wasting tokens or targeting the wrong live terminal.

This document focuses on:

- how terminal discovery should work
- how selectors differ from runtime handles
- how split terminal tabs should be exposed
- how much output should be returned by default
- how to keep terminal reads safe and token-efficient

## Current Architecture Constraints

- Orca worktree existence comes from Git.
- Orca metadata and workspace session state are persisted separately.
- Live PTYs are owned by the running Electron main process.
- Terminal tabs can contain multiple split panes in a Ghostty-style layout.
- Pane identity is runtime-scoped and must not be treated as a durable public resource.

Because PTYs live inside the running Orca app, the CLI must act as a client of the editor runtime, not as an independent terminal manager.

## Main Correction From Review

The earlier design overexposed `pane` as if it were a stable first-class resource.

That is not safe enough for a public automation contract.

The public model should instead be:

- use a selector to discover the worktree or terminal you want
- Orca returns a runtime handle for the live terminal target
- use that handle for repeated `show`, `read`, `send`, and `wait` operations

Internally, Orca can still reason in terms of tabs and panes.

## Selectors And Runtime Handles

### Selector

A selector identifies an object at command time.

Recommended explicit forms:

- worktree selector:
  - `id:<worktree-id>`
  - `path:<absolute-path>`
  - `branch:<branch-name>`
  - `issue:<number>`

Resolution rules:

1. Explicit tagged selectors always win.
2. Bare values are convenience syntax only.
3. Ambiguous bare selectors must fail with a structured error.
4. Orca must not silently pick one matching object when several match.

Selectors are for discovery.

### Runtime handle

A runtime handle is an opaque identifier returned by Orca for a live terminal target.

Why this is required:

- pane identity is not durable
- active focus can change
- scripts need a stable target for the lifetime of the current Orca runtime

Handle contract:

- a handle is scoped to a specific Orca `runtimeId`
- every handle-bearing response must include that `runtimeId`
- runtime restart or reload may invalidate all prior handles
- stale-handle errors should include the current `runtimeId` when known

Example flow:

```bash
orca terminal list --worktree id:repo_1::/repo/.worktrees/feature-foo --json
```

Returns:

```json
{
  "_meta": {
    "runtimeId": "runtime_abc123"
  },
  "terminals": [
    {
      "handle": "term_7f9c2a",
      "title": "claude",
      "status": "waiting_for_input",
      "worktree": "feature/my-branch"
    }
  ]
}
```

Then:

```bash
orca terminal read --terminal term_7f9c2a --json
orca terminal send --terminal term_7f9c2a --text "continue"
orca terminal wait --terminal term_7f9c2a --for input
```

## Public Terminal Model

The public CLI should be terminal-first.

Recommended public commands:

- `orca terminal list --worktree <selector>`
- `orca terminal show --terminal <handle>`
- `orca terminal read --terminal <handle>`
- `orca terminal send --terminal <handle> --text <text>`
- `orca terminal send --terminal <handle> --enter`
- `orca terminal send --terminal <handle> --interrupt`
- `orca terminal wait --terminal <handle> --for <input|idle|output|exit>`

Tabs and panes are still relevant, but they should mostly appear as inspected structure inside terminal discovery output, not as the primary automation contract.

## Split Tabs

Ghostty-style split tabs still need to be represented because a single terminal tab may contain multiple live execution surfaces.

The public contract should expose:

- terminal handles as the primary list items
- tab/layout context as secondary metadata

Example `terminal list --worktree ... --json`:

```json
{
  "_meta": {
    "runtimeId": "runtime_abc123"
  },
  "worktree": {
    "selector": "feature/my-branch"
  },
  "terminals": [
    {
      "handle": "term_a1",
      "title": "shell",
      "status": "running",
      "worktree": "feature/my-branch",
      "tabId": "tab-1",
      "tabTitle": "Claude Code",
      "leafId": "leaf-1",
      "preview": "pnpm test\nwatching for changes..."
    },
    {
      "handle": "term_a2",
      "title": "claude",
      "status": "waiting_for_input",
      "worktree": "feature/my-branch",
      "tabId": "tab-1",
      "tabTitle": "Claude Code",
      "leafId": "leaf-2",
      "preview": "I updated the parser. Do you want me to run the test suite?"
    },
    {
      "handle": "term_a3",
      "title": "logs",
      "status": "running",
      "worktree": "feature/my-branch",
      "tabId": "tab-1",
      "tabTitle": "Claude Code",
      "leafId": "leaf-3",
      "preview": "GET /health 200\nGET /api/tasks 200"
    }
  ],
  "layout": [
    {
      "tabId": "tab-1",
      "activeLeafId": "leaf-2",
      "layout": {
        "type": "split",
        "direction": "vertical",
        "first": { "type": "leaf", "leafId": "leaf-1" },
        "second": {
          "type": "split",
          "direction": "horizontal",
          "first": { "type": "leaf", "leafId": "leaf-2" },
          "second": { "type": "leaf", "leafId": "leaf-3" }
        }
      }
    }
  ]
}
```

This gives the agent enough context to choose the right terminal handle without pretending the underlying pane identity is durable.

## Safety Rules

### 1. Handle-first for repeated live interaction

Once discovery returns a handle, repeated reads and writes should use the handle, not re-resolve `active` on every command.

Why:

- `active` can change
- terminal focus is a UI concept and can race with automation

### 2. Stale handles must fail explicitly

If a handle is no longer valid, Orca must return a structured stale-handle error.

Example:

```json
{
  "_meta": {
    "runtimeId": "runtime_new456"
  },
  "error": {
    "code": "terminal_handle_stale",
    "message": "The terminal handle is no longer valid for the current Orca runtime.",
    "retryable": true
  }
}
```

Why:

- silent retargeting is dangerous
- retrying discovery is safer than guessing

### 3. Avoid implicit retargeting

If the resolved terminal no longer exists, Orca must not silently switch to another live terminal with a similar title.

Why:

- agents may send input to the wrong process

## Read Model

The read path should copy the successful pattern used in `agent-slack`:

- summary first
- deeper read only on demand
- hard caps on text volume
- omit empty fields

### `terminal list`

Purpose:

- cheap discovery
- compact orchestration context
- return handles

Should include:

- tab title
- active leaf info
- terminal handles
- short preview per live terminal
- status per live terminal

### `terminal show`

Purpose:

- inspect one live terminal target by handle

Should include:

- handle
- title
- status
- cwd if known
- last output time
- last input time
- short preview only
- tab/layout context if useful

It should not include a full screen snapshot or long tail output.

### `terminal read`

Purpose:

- return bounded readable content for exactly one live terminal handle

Recommended fields:

- `handle`
- `status`
- `tail`
- `truncated`
- `nextCursor` when deeper history exists

It should not duplicate all of the descriptive metadata from `terminal show` unless needed for correctness.

### `terminal wait`

Purpose:

- avoid brittle polling loops

Supported waits:

- `input`
- `idle`
- `output`
- `exit`

This is critical for agent workflows because `read` plus `send` alone is too awkward.

## Token Budget Strategy

### Default `terminal list` budget

Return:

- layout context
- per-terminal status
- a short preview for each live handle

Recommended preview budget:

- 5 to 10 recent non-empty lines per terminal
- hard cap of 300 to 500 characters per terminal

Why:

- enough to choose the correct live handle
- cheap enough for many-worktree orchestration

### Default `terminal read` budget

Return:

- recent tail
- status metadata

Recommended caps:

- `tail`: 80 to 150 lines
- also enforce a total char cap

### Explicit expansion

For deeper history:

- require explicit pagination or a cursor
- expose truncation clearly
- enforce hard response caps regardless of requested size

## Why This Is Better Than Pane-First Reads

If the public API is pane-first:

- scripts will be tempted to cache pane IDs
- runtime churn can invalidate them
- commands become verbose and brittle

If the public API is terminal-handle-first:

- discovery stays selector-friendly
- repeated reads and writes are short
- safety improves because the handle is explicit and session-scoped

## Recommended Internal Model

Internally, Orca should still track:

- tab layout
- active leaf
- pane/leaf-level terminal state
- PTY ownership

But the CLI contract should project those internals into:

- selector-based discovery
- handle-based live interaction

To support efficient reads, Orca should maintain:

- a normalized visible screen snapshot
- a bounded recent-output ring buffer
- machine-readable terminal status metadata

This is preferable to scraping the rendered terminal DOM.

## Machine Contract Requirements

### JSON output

When `--json` is used:

- stdout must contain exactly one JSON object
- no extra human text in stdout
- stderr is reserved for failure diagnostics

### Response metadata

Every terminal response should include minimal metadata:

```json
{
  "_meta": {
    "runtimeId": "runtime_abc123",
    "requestId": "req_123",
    "truncated": false
  }
}
```

### Structured errors

Use machine-readable error codes such as:

- `terminal_handle_stale`
- `terminal_not_found`
- `worktree_not_found`
- `orca_not_running`
- `selector_ambiguous`
- `selector_not_found`

## Recommended Agent Workflow

1. `orca worktree ps --json`
2. Choose a worktree by selector.
3. `orca terminal list --worktree <selector> --json`
4. Pick the desired terminal handle.
5. `orca terminal read --terminal <handle> --json`
6. `orca terminal send --terminal <handle> ...`
7. `orca terminal wait --terminal <handle> --for input`
8. Re-read the same handle as needed.

This is cheaper, safer, and more automation-friendly than repeatedly passing `--worktree --tab --pane`.

## Recommendation

The terminal CLI should be:

- selector-first for discovery
- handle-first for repeated live interaction
- compact by default
- strict about stale-handle errors
- explicit about truncation and pagination

That gives agents enough context to manage live Orca sessions while keeping token costs and targeting risk under control.
