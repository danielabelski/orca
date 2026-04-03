# Orca CLI Command Surface Evaluation

## Purpose

Define an agent-friendly `orca` CLI for a running Orca editor.

This document is intentionally narrower than the full editor feature set. It focuses on the command surface that materially improves an agent's ability to:

- manage repos and worktrees
- inspect and drive live terminals
- read and edit files
- inspect source control state

It does not attempt to mirror every editor affordance.

## Design Constraint

The CLI connects to a running Orca editor and operates on the same runtime and persisted state.

That means:

- the editor remains the live owner of PTYs and terminal panes
- the CLI is another control surface over the same Orca runtime
- CLI mutations must be reflected in the editor

## Main Correction From Review

The earlier design was too faithful to Orca's internal UI model.

The public CLI should not primarily expose:

- `tab`
- `pane`
- `dir`
- `path`
- UI-only controls such as badge color or tab cosmetics

Those are useful internal implementation concepts, but they are not the right public center of gravity for an agent-facing CLI.

The public CLI should instead be organized around:

- `repo`
- `worktree`
- `terminal`
- `file`
- `git`
- `gh`
- `status`

Secondary surfaces:

- `search`
- `settings`

## Selectors And Handles

The CLI should distinguish between two targeting mechanisms.

### Selector

A selector is a human-meaningful way to identify an Orca object at command time.

Selectors should support explicit tagged forms first.

Recommended explicit forms:

- repo selector:
  - `id:<repo-id>`
  - `path:<absolute-path>`
  - `name:<display-name>`
- worktree selector:
  - `id:<worktree-id>`
  - `path:<absolute-path>`
  - `branch:<branch-name>`
  - `issue:<number>`

Bare values may be accepted as a convenience syntax, but only as a fallback.

Resolution rules:

1. Explicit tagged selectors always win.
2. Bare values are resolved against a command-specific fallback order.
3. If a bare selector matches more than one object, the command must fail with a structured ambiguity error.
4. The CLI must never silently choose one of several matching objects.

Selectors are for discovery and ad hoc targeting, not for repeated live terminal interaction.

### Handle

A handle is a runtime-issued opaque identifier for a live terminal target.

Why this matters:

- pane identity is runtime-scoped, not durable
- a script should not cache renderer-local pane IDs and assume they survive runtime churn
- a handle lets Orca point subsequent read/write commands at the exact live terminal target that was previously discovered

Handle rules:

- handles are scoped to a specific Orca `runtimeId`
- every handle-bearing response must include that `runtimeId`
- any Orca runtime restart or reload may invalidate existing handles
- stale handles must fail explicitly rather than being silently retargeted

Handles are for machine use in follow-up terminal commands.

Recommended agent flow:

1. Use selectors to find a worktree or terminal.
2. Orca returns a runtime handle for the live terminal target.
3. Use that handle for repeated `read`, `send`, and `wait` commands.

## Product Surfaces In The Current Codebase

The codebase already exposes these major capabilities through the running app:

- repos
- worktrees
- worktree metadata
- terminal tabs and split panes
- filesystem reads and writes
- text search
- git status and diffs
- GitHub integration
- settings and session persistence

Primary references:

- [../README.md](../README.md)
- [../src/preload/index.d.ts](../src/preload/index.d.ts)
- [../src/shared/types.ts](../src/shared/types.ts)
- [../src/main/ipc/repos.ts](../src/main/ipc/repos.ts)
- [../src/main/ipc/worktrees.ts](../src/main/ipc/worktrees.ts)
- [../src/main/ipc/pty.ts](../src/main/ipc/pty.ts)
- [../src/main/ipc/filesystem.ts](../src/main/ipc/filesystem.ts)
- [../src/main/ipc/github.ts](../src/main/ipc/github.ts)

## Tier 1: Must Support

These are the commands that matter most for agent orchestration.

### 1. Runtime status and connection

Because the CLI only works against a running Orca editor, the runtime state must be explicit.

Recommended CLI:

- `orca status`
- `orca doctor`

`orca status` should answer:

- whether a compatible Orca runtime is running
- the current `runtimeId`
- which workspace session is active
- runtime version
- whether the CLI can issue live terminal commands

### 2. Repo discovery and setup

Current editor features:

- add repo
- remove repo
- inspect repo configuration
- set default worktree base ref

Recommended CLI:

- `orca repo list`
- `orca repo add --path <path>`
- `orca repo remove --repo <selector>`
- `orca repo show --repo <selector>`
- `orca repo set-base-ref --repo <selector> --ref <base-ref>`
- `orca repo search-refs --repo <selector> --query <text>`

Why this matters:

- worktree orchestration starts with repo selection
- agents often know a repo path rather than an Orca repo id

### 3. Worktree lifecycle

Current editor features:

- list worktrees
- create worktree
- delete worktree
- update worktree metadata
- shutdown worktree terminals

Relevant code:

- [../src/main/ipc/worktrees.ts](../src/main/ipc/worktrees.ts)
- [../src/renderer/src/components/sidebar/AddWorktreeDialog.tsx](../src/renderer/src/components/sidebar/AddWorktreeDialog.tsx)
- [../src/renderer/src/components/sidebar/WorktreeContextMenu.tsx](../src/renderer/src/components/sidebar/WorktreeContextMenu.tsx)

Recommended CLI:

- `orca worktree list [--repo <selector>]`
- `orca worktree ps`
- `orca worktree show --worktree <selector>`
- `orca worktree create --repo <selector> --name <name> [--base-ref <ref>] [--issue <n|url>] [--comment <text>]`
- `orca worktree set --worktree <selector> [--display-name <name>] [--issue <n|url>] [--comment <text>]`
- `orca worktree rm --worktree <selector> [--force]`

`orca worktree ps` should be a compact orchestration view for many-worktree operation.

It should answer, in one call:

- which worktrees exist
- repo and branch
- whether each has live terminals
- linked issue or PR
- a compact activity/status field

Why this matters:

- agents managing many worktrees need a cheap orchestration summary
- `list` and `show` alone force too many round-trips

### 4. Terminal discovery and control

This is the most important CLI surface after worktree lifecycle.

Public CLI should be terminal-first.

Tabs and panes still exist internally, but the primary live automation surface should be `terminal`, with runtime handles as the stable contract for repeated reads and writes.

Recommended CLI:

- `orca terminal list --worktree <selector>`
- `orca terminal show --terminal <handle>`
- `orca terminal read --terminal <handle>`
- `orca terminal send --terminal <handle> --text <text>`
- `orca terminal send --terminal <handle> --enter`
- `orca terminal send --terminal <handle> --interrupt`
- `orca terminal wait --terminal <handle> --for <input|idle|output|exit>`
- `orca terminal stop --worktree <selector>`

Discovery commands should return:

- human-meaningful metadata
- layout context where relevant
- a runtime handle for each live terminal target

`terminal show` vs `terminal read`:

- `terminal show` is metadata-first and cheap. It should return identity, status, timestamps, and at most a short preview.
- `terminal read` is content-first and bounded. In focused v1 it should return recent tail lines and truncation metadata without pretending Orca has a truthful visible-screen snapshot.

The command surface should not require:

- `--worktree --tab --pane` on every loop iteration

That is acceptable for debugging, but too verbose and brittle for normal automation.

### 5. File operations

Current editor features:

- list files
- read files
- write files
- create file
- create directory
- rename path
- delete path
- file stat

Recommended CLI:

- `orca file ls --worktree <selector> [--path <dir>]`
- `orca file read --worktree <selector> --path <path>`
- `orca file write --worktree <selector> --path <path> --stdin`
- `orca file create --worktree <selector> --path <path>`
- `orca file mkdir --worktree <selector> --path <path>`
- `orca file rename --worktree <selector> --from <old> --to <new>`
- `orca file rm --worktree <selector> --path <path>`
- `orca file stat --worktree <selector> --path <path>`

Why this matters:

- a separate `dir` or `path` noun is unnecessarily fragmented
- `file` is a clearer public namespace for agents

### 6. Search

Current editor features:

- worktree text search
- file listing for quick-open

Recommended CLI:

- `orca search text --worktree <selector> --query <text> [--regex] [--case-sensitive] [--whole-word] [--include <glob>] [--exclude <glob>] [--max-results <n>]`
- `orca search files --worktree <selector> [--query <text>]`

Why this matters:

- search is one of the fastest ways for an agent to build context

### 7. Source control inspection and basic actions

Current editor features:

- git status
- conflict operation detection
- stage
- unstage
- discard
- per-file diff
- branch compare against base ref

Recommended CLI:

- `orca git status --worktree <selector>`
- `orca git conflict-operation --worktree <selector>`
- `orca git diff --worktree <selector> --path <file> [--staged]`
- `orca git stage --worktree <selector> --path <file>`
- `orca git unstage --worktree <selector> --path <file>`
- `orca git discard --worktree <selector> --path <file>`
- `orca git branch-compare --worktree <selector> [--base-ref <ref>]`

Why this matters:

- these are already grounded in the backend
- they complement shell usage without requiring the agent to run raw git for common cases

## Tier 2: Useful But Secondary

### 8. GitHub convenience wrappers

Current editor features:

- PR discovery for branch
- issue lookup
- list issues
- PR checks
- PR merge

Recommended CLI:

- `orca gh pr --worktree <selector>`
- `orca gh issue --repo <selector> --issue <number>`
- `orca gh issues --repo <selector> [--limit <n>]`
- `orca gh checks --worktree <selector>`
- `orca gh pr merge --worktree <selector> [--method <squash|merge|rebase>]`

Why this is secondary:

- agents can still use `gh` directly
- these are convenience wrappers over repo/worktree context Orca already knows

### 9. Operational settings

Recommended CLI:

- `orca settings get`
- `orca settings set --workspace-dir <path>`
- `orca settings set --nest-workspaces <true|false>`
- `orca settings set --branch-prefix <git-username|custom|none>`
- `orca settings set --branch-prefix-custom <prefix>`

These matter because they affect worktree creation behavior.

### 10. Worktree inbox-style metadata

These features exist in the editor, but they are secondary to the core orchestration surface.

Recommended CLI:

- `orca worktree mark-read --worktree <selector>`
- `orca worktree mark-unread --worktree <selector>`

Why this is secondary:

- useful for triage and inbox-style workflows
- not part of the minimum viable agent orchestration loop

## Tier 3: Defer For Now

These either mirror UI structure too closely or are not yet grounded cleanly enough in the current runtime.

### Defer

- `tab new`
- `tab close`
- `pane split`
- `pane close`
- tab reordering
- tab colors
- badge color editing
- other renderer-local organization controls

Why:

- these imply ownership boundaries the current backend does not yet expose cleanly
- several depend on renderer-managed lifecycle rather than a shared runtime service

## Global Command Contract Requirements

The CLI needs a strict machine contract, not just illustrative examples.

### JSON

Every command used by agents should support `--json`.

When `--json` is used:

- stdout must contain exactly one JSON object
- no progress logs or human commentary may be mixed into stdout
- stderr may contain human-readable diagnostics only when the command fails

### Structured errors

Error responses should be machine-readable.

Example shape:

```json
{
  "error": {
    "code": "terminal_handle_stale",
    "message": "The terminal handle is no longer valid for the current Orca runtime.",
    "retryable": true
  }
}
```

Structured selector failures should use dedicated error codes such as:

- `selector_ambiguous`
- `selector_not_found`

### Metadata

Responses should include minimal metadata for automation.

Example:

```json
{
  "_meta": {
    "orcaVersion": "1.0.0",
    "runtimeId": "runtime_abc123",
    "requestId": "req_123"
  }
}
```

### Pagination and truncation

List and read responses should expose:

- whether output was truncated
- cursor or pagination token if more data exists

## Minimal Viable CLI

The minimum command surface that makes Orca genuinely useful to another agent is:

- `status`
- `repo list`
- `repo add`
- `worktree list`
- `worktree ps`
- `worktree show`
- `worktree create`
- `worktree set`
- `worktree rm`
- `terminal list`
- `terminal show`
- `terminal read`
- `terminal send`
- `terminal wait`
- `terminal stop`
- `file ls`
- `file read`
- `file write`
- `search text`
- `git status`
- `git diff`
- `git stage`
- `git unstage`
- `git discard`

This is enough to:

- create a worktree for an issue
- inspect and reply to a live coding-agent terminal
- read and edit workspace files
- inspect and manipulate source control state

## Recommendation

The CLI should be task-oriented and selector-friendly.

Internally, Orca can still be modeled in terms of repos, worktrees, tabs, and panes.

But the public contract should optimize for:

- minimal discovery friction
- safe live-terminal targeting
- compact machine-readable output
- a small v1 surface that is actually grounded in the current runtime
