# Worktree Setup Command Design

## Problem

Issue [#238](https://github.com/stablyai/orca/issues/238) asks for two behaviors:

1. let a repo point to a setup script
2. let the user decide whether that setup should run during worktree creation

Orca already has a partial implementation:

- repo-level `setup` hooks exist today
- hooks can come from `orca.yaml` or repo settings UI
- the setup hook already runs in the new worktree after creation

What is missing is the product model:

- the create-worktree flow does not surface setup at all
- users cannot make a per-create decision
- the current UX frames setup as a generic lifecycle hook instead of a first-class workspace setup step
- setup failures are not visible enough to be actionable

## Research Summary

Broader developer tooling suggests a stronger design than a simple "run hook or not" toggle.

Conductor models setup as a repo-level command that runs in the new workspace and exposes workspace env vars. It also supports repo-committed configuration. That is the closest direct precedent.

Remote-dev tools such as Codespaces, dev containers, and Gitpod separate environment setup from app start:

- one-time or infrequent setup commands install dependencies and prepare the workspace
- interactive commands start services later
- expensive setup work should be explicit, repeatable, and ideally idempotent

Engineering blog guidance around `bin/setup` and setup scripts is consistent:

- provide one obvious command
- make it safe to rerun
- keep it readable
- use it to prepare the environment, not to hide unrelated workflow logic

## Goals

- Make worktree setup explicit in Orca.
- Preserve the existing hook plumbing instead of inventing a second execution system.
- Let the user decide whether setup runs for each new worktree.
- Keep repo-committed configuration possible.
- Improve compatibility with Conductor-style setup commands where it is low-cost and safe.
- Set a clearer product boundary between "prepare this worktree" and "run my app."

## Non-Goals

- Adding a full task runner or process manager UI
- Supporting multiple named setup phases in v1
- Parsing multiple repo config formats with complicated precedence rules
- Replacing the existing archive hook model
- Automatically starting long-running dev servers as part of worktree creation

## Design Principles

- Reuse the existing hook pipeline.
- Treat setup as a repo-level setup command, not as a path-only script field.
- Put the user decision in the create-worktree flow.
- Make the default policy configurable per repo.
- Require setup commands to be safe to rerun.
- Prefer cross-platform command guidance over shell-specific examples.
- Make failure visible enough that the user can recover without guessing.

## Terminology

This feature should be framed in the product as a `Setup Command` or `Setup Command`, not just a generic hook.

Why:

- "hook" is implementation language
- "setup" better communicates that the command prepares a fresh worktree
- it aligns better with established patterns like `bin/setup`, devcontainer lifecycle commands, and Gitpod init tasks

Internally, the existing `setup` hook plumbing can remain.

## Current State In Orca

Relevant code:

- [src/main/hooks.ts](../src/main/hooks.ts)
- [src/main/ipc/worktrees.ts](../src/main/ipc/worktrees.ts)
- [src/renderer/src/components/sidebar/AddWorktreeDialog.tsx](../src/renderer/src/components/sidebar/AddWorktreeDialog.tsx)
- [src/renderer/src/components/settings/RepositoryPane.tsx](../src/renderer/src/components/settings/RepositoryPane.tsx)
- [src/renderer/src/components/settings/HookEditor.tsx](../src/renderer/src/components/settings/HookEditor.tsx)
- [src/shared/types.ts](../src/shared/types.ts)

Behavior today:

- `getEffectiveHooks(repo)` resolves `setup` from `orca.yaml` or UI settings
- `runHook('setup', worktreePath, repo)` executes the command in the new worktree
- `worktrees:create` always runs setup when an effective setup hook exists
- the create-worktree dialog has no setup visibility or opt-out
- setup result visibility is limited to internal logging

Important nuance:

The backend already supports command strings, which means the configured setup may invoke:

- a package manager script like `pnpm worktree:setup`
- a Node entrypoint like `node scripts/setup-worktree.mjs`
- a repo-local shell script like `bash scripts/setup-worktree.sh`
- inline shell commands

So the main missing feature is not command execution support. It is product framing, policy, and UX.

## What The Ecosystem Suggests

## 1. Keep Setup As A Command String

Conductor, dev containers, and common setup patterns all center on a command to run, not a special "script path" object.

This is the right model because it supports:

- package scripts
- Node entrypoints
- shell commands
- wrappers that dispatch differently per platform

Adding a `setupScriptPath` field would be less flexible and would bias the feature toward shell-only implementations.

## 2. Separate Setup From App Start

The strongest cross-product pattern is lifecycle separation:

- setup prepares the environment
- start commands run interactive services later

For Orca v1, the setup/setup command should be explicitly scoped to worktree preparation tasks such as:

- install dependencies
- copy ignored env files
- initialize submodules
- run one-time codegen
- seed local config for that worktree

It should not be positioned as the place to:

- launch long-running servers
- start watch processes
- open ports
- manage ongoing background services

That guidance should appear in the design and product copy even if Orca does not enforce it technically.

## 3. Defaults Should Be Policy, Not Just Boolean State

The initial design proposed a boolean repo default. The broader research suggests a better model:

```ts
type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'
```

Why:

- some repos should always prompt because setup is expensive or conditional
- some repos almost always want setup
- some repos rarely need setup, but the action should remain visible

This matches the issue better than a hidden boolean because it preserves user intent at the moment of creation.

## 4. Output Visibility Matters

A toast-only model is too weak.

Setup commands fail for predictable reasons:

- missing env files
- package manager auth issues
- version mismatches
- broken scripts

The user needs a place to inspect the output. V1 does not need a full job dashboard, but it should preserve enough output to debug failures.

## Proposed Product UX

## 1. Repository Settings

Keep the current hook system, but surface setup as a first-class setup concept.

Recommended changes:

- relabel the `setup` section to `Setup Command`
- keep `archive` under lifecycle hooks
- add a repo-level `When creating a worktree` policy control with:
  - `Ask every time`
  - `Run by default`
  - `Skip by default`
- add guidance that setup commands should be safe to rerun

Recommended helper text:

- `Runs in the new worktree after creation to prepare the environment. Prefer an idempotent command such as "pnpm worktree:setup" or "node scripts/setup-worktree.mjs". Avoid starting long-running dev servers here.`

Why:

- this makes the feature discoverable
- it nudges teams toward reliable command shapes
- it aligns with cross-platform support

## 2. Create Worktree Dialog

When an effective setup command exists for the selected repo, show a setup section:

- label: `Setup`
- checkbox: `Run setup command after creation`
- supporting text: show whether the command comes from `orca.yaml` or UI settings
- preview: show a truncated first line or command summary

Initial checkbox value and dialog behavior comes from the repo policy:

- `ask` means the dialog must require an explicit choice:
  - radio/select choice: `Run setup now` or `Skip for now`
  - no implicit default submit path
  - the create action stays disabled until the user chooses one
- `run-by-default` means the checkbox is checked. (If triggered via a "Quick Create" flow like a command palette, it may bypass the dialog entirely).
- `skip-by-default` means the checkbox is unchecked.

Why:

- the issue explicitly wants user choice
- expensive setup work should be visible at creation time
- `ask` should mean a real decision, not an unchecked box that silently turns into skip

## 3. Setup Result Visibility (Open A Terminal And Run It)

V1 should run setup in a normal integrated terminal for the new worktree, not as a hidden background task. Because the configured setup command might be a multiline script from `orca.yaml`, it cannot simply be pasted into an interactive terminal (doing so breaks idempotency if an early line fails, as the shell will continue executing subsequent lines).

**Execution Strategy (Generated Runner Script):**

1. The Main Process generates a temporary executable script file inside the worktree (`.git/orca/setup-runner.sh` for macOS/Linux, or `.git/orca/setup-runner.cmd` for Windows).
2. The Main Process writes the resolved multiline setup command into this script. For bash/zsh, prepend `set -e` so failures halt execution immediately.
3. After the worktree is created, if setup is enabled, Orca opens and focuses a terminal for that worktree.
4. Orca starts the generated script in that terminal (e.g., `bash .git/orca/setup-runner.sh` or `cmd.exe /c .git\\orca\\setup-runner.cmd`).
5. Success, failure, and interactive prompts (like SSH keys) are handled directly in the terminal safely.

**Post-Execution UX:**

- the terminal remains a normal, fully interactive shell
- when the command finishes, the user is back at the shell prompt in that same terminal
- the user can inspect output, press `Up Arrow` to retry, or run whatever they want next

Non-goal:

- a background jobs system
- durable setup-session recovery across reloads
- custom log persistence or special transcript storage

## Proposed Data Model

Do not add `setupScriptPath`.

Keep the setup command as a string and add a run policy:

```ts
type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'

type RepoHookSettings = {
  mode: 'auto' | 'override'
  setupRunPolicy?: SetupRunPolicy // Defaults to 'run-by-default' if undefined
  scripts: {
    setup: string
    archive: string
  }
}
```

Rationale:

- the command model already solves "point to a script" and more
- policy is the missing product state
- `setupRunPolicy` being optional ensures backward compatibility with existing configs (migrating gracefully by defaulting to `run-by-default`)

## Proposed IPC/API Changes

Extend the create-worktree request:

```ts
type CreateWorktreeArgs = {
  repoId: string
  name: string
  baseBranch?: string
  setupDecision?: 'inherit' | 'run' | 'skip'
}
```

And update the return type to provide the generated runner script and environment payload:

```ts
type CreateWorktreeResult = {
  // ... existing fields
  setup?: {
    runnerScriptPath: string
    envVars: Record<string, string>
  }
}
```

Update `pty:spawn` in `src/main/ipc/pty.ts` to accept custom environment variables so the setup terminal can receive its context:

```ts
// Existing: ipcMain.handle('pty:spawn', (_event, args: { cols: number; rows: number; cwd?: string })
// New:
ipcMain.handle('pty:spawn', (_event, args: { cols: number; rows: number; cwd?: string, env?: Record<string, string> })
```

Behavior:

- `run` always runs setup when an effective setup command exists
- `skip` always skips setup
- `inherit` delegates resolution to the backend using repo policy
- if the resolved policy is `ask` and the caller sends `inherit` (or omits the field), the backend rejects the request with an explicit error such as `Setup decision required for this repository`

Why:

- the backend must own policy enforcement so non-dialog callers cannot accidentally bypass `ask` or `skip-by-default`
- a tri-state decision keeps compatibility for existing callers while still allowing the backend to reject ambiguous creates when the repo requires a choice

## Proposed Execution Rules

## 1. Setup Resolution

Continue using `getEffectiveHooks(repo)` for command resolution.

That means setup may still come from:

- `orca.yaml`
- UI override
- UI fallback in auto mode

## 2. Create Flow

`worktrees:create` should:

1. create the git worktree exactly as it does today
2. persist worktree metadata
3. resolve whether this create operation should run setup by combining `setupDecision` with the repo's `setupRunPolicy`
4. if setup should run, generate a temporary runner script (e.g., `.git/orca/setup-runner.sh`) containing the resolved command.
5. return the created worktree plus the path to the generated setup script and the env vars to inject into the PTY.

Crucially, **the backend owns the policy decision and script generation, but the renderer owns opening the terminal and starting the visible terminal command**.

Requirements for execution:

- **Terminal-First:** Setup must run in a visible terminal, not through `runHook()` and not as a hidden background exec.
- **Safe Execution:** The Renderer must pass the generated runner script and environment variables to the new PTY, not raw multiline text.
- **Simple Ownership:** Orca should use the existing terminal flow. Open a terminal for the worktree, then start the setup command there.
- **Best-Effort:** If the renderer reloads before or during setup, Orca does not need to recover or resume that setup run. The user can rerun it manually.
- **Interactivity:** The user is NOT blocked from interacting with the workspace. They can browse code while the terminal runs the setup in plain view.
- **No Rollback:** Setup failure must not roll back worktree creation (the git operation already succeeded).

Why:

- environment preparation is best-effort workspace setupping, not git correctness
- a terminal-first approach avoids the complexity of background process management
- using the existing terminal ownership model is much simpler than inventing setup-session infrastructure

### Terminal Behavior

Required behavior:

- after a successful create with setup enabled, Orca automatically switches focus to the new worktree and opens its terminal panel
- Orca starts the generated runner script in that terminal with the appropriate environment variables injected
- when the command exits, the terminal remains available as a normal shell
- Orca does not guarantee that an in-flight setup survives reloads or terminal closure

Why:

- this solves the actual user problem, "show me the setup and let me interact with it"
- it avoids building a second PTY lifecycle just for setup
- if setup is interrupted, retrying in a terminal is straightforward

## 3. Idempotency Requirement

The product should document a strong expectation that setup commands are idempotent.

That means rerunning the command should be safe and should not corrupt the worktree.

Examples of acceptable behavior:

- reinstall or verify dependencies
- overwrite generated files deterministically
- copy missing env templates without deleting user-edited files

Examples of risky behavior Orca should discourage in docs and copy:

- unconditional destructive deletes
- long-running foreground servers
- one-off mutations that fail or duplicate state on rerun

Why:

- users may create multiple worktrees
- users may retry after failure
- policy defaults may cause setup to run frequently

## 4. Environment Variables

Orca already provides:

- `ORCA_ROOT_PATH`
- `ORCA_WORKTREE_PATH`
- `CONDUCTOR_ROOT_PATH`
- `GHOSTX_ROOT_PATH`

These existing variables should be passed to the setup command PTY to ensure scripts have the context they need.

## 5. Execution Environment (PTY)

Shell scripts can hang indefinitely if they accidentally prompt for user input (e.g., auth prompts, `read -p`).

By executing the setup command in an integrated terminal instead of a hidden background process:

- the user can see and respond to interactive prompts natively.
- the user has full control to cancel hanging scripts via standard terminal controls (`Ctrl+C`).
- familiar, colorized output is preserved.

## Repo-Committed Config Format

For v1, keep `orca.yaml` as the repo-committed config surface.

Example:

```yaml
scripts:
  setup: |
    pnpm install
    node scripts/setup-worktree.mjs
```

or:

```yaml
scripts:
  setup: |
    node scripts/setup-worktree.mjs
```

Do not add `conductor.json` parsing in this issue.

Why:

- Orca already has `orca.yaml`
- loading both config files introduces precedence ambiguity
- env compatibility gives most of the practical value

## Cross-Platform Guidance

This feature must remain compatible with macOS, Linux, and Windows.

Recommended command examples:

- `pnpm worktree:setup`
- `npm run worktree:setup`
- `node scripts/setup-worktree.mjs`

Avoid recommending only:

- `./scripts/setup-worktree.sh`

Why:

- shell-script-only examples are weaker on Windows
- package scripts and Node entrypoints are easier to keep portable

## Edge Cases

## 1. No Setup Command Configured

- create-worktree dialog shows no setup section
- create flow behaves as it does today without setup execution

## 2. Repo Changes While Dialog Is Open

- the selected repo’s effective setup state controls setup section visibility
- if the repo selection changes and the new repo has no setup command, hide the section
- if the source changes between YAML and UI fallback, update the source label accordingly

## 3. Expensive Or Conditional Setup

- `ask` policy keeps the choice explicit
- `skip-by-default` covers repos where setup is uncommon but still available

## 4. Setup Failure

- worktree stays created
- failure is surfaced to the user
- the user can inspect output
- no automatic deletion or rollback

## 5. Re-Run After Creation / Recovery

Because setups can fail due to transient issues (e.g., missing `.env`, VPN drops), recovery is straightforward because the user is left in a normal terminal.

- The user can simply press `Up Arrow` and `Enter` in the terminal to retry the setup command.
- We can include a "Rerun Setup" action in the Worktree context menu later as a convenient shortcut that opens a terminal for that worktree and runs the same command again.
- This leverages the idempotency requirement to give developers an easy escape hatch when setup fails.

## 6. UI State During Creation

- Git cloning takes time. During creation, the "Create" button in the dialog should show a loading spinner.
- Once creation is successful, if setup is enabled, Orca should automatically switch focus to the new worktree and immediately open its terminal to surface the setup run.

## 8. Security & Unverified Repositories

- Automatically running setup scripts is a vector for arbitrary code execution if a user clones an untrusted repository.
- Because Orca relies on standard git cloning, if the user explicitly clicks `Run setup now`, they are opting in. However, the `run-by-default` policy must be carefully considered if Orca ever adds features to auto-clone arbitrary public repos. For v1 (managing existing trusted work repositories), defaulting to `run-by-default` is acceptable, but the UI must always display the preview of the command being run.

## Alternatives Considered

## 1. Background Execution with Log Tailing

Rejected.

Reasons:

- running shell scripts in the background is fragile (hidden SSH prompts cause hanging).
- building robust cross-platform process cancellation is difficult.
- tailing text logs in Electron requires additional IPC streaming overhead.
- "preventing interaction" while a 5-minute setup runs creates a hostile UX. A terminal-first approach solves all of these cleanly.

## 2. Add A Dedicated `setupScriptPath` Field

Rejected.

Reasons:

- current command-string model already supports script paths
- a path-only field biases the feature toward shell-specific usage
- command strings cover package scripts, Node entrypoints, wrappers, and inline commands with one model

## 2. Use A Boolean Default

Rejected in favor of a policy enum.

Reasons:

- a boolean cannot express "always prompt"
- issue #238 is fundamentally about user choice at creation time
- policy better matches real repo variation

## 3. Always Auto-Run Setup Like Conductor

Rejected.

Reasons:

- the issue explicitly asks for user choice
- setup commands can be slow, conditional, or side-effectful

## 4. Parse `conductor.json`

Rejected for this issue.

Reasons:

- increases config precedence complexity
- not required to solve the feature request
- environment compatibility provides most of the reuse value

## Implementation Plan

## Main Process

Files:

- [src/shared/types.ts](../src/shared/types.ts)
- [src/main/hooks.ts](../src/main/hooks.ts)
- [src/main/ipc/worktrees.ts](../src/main/ipc/worktrees.ts)
- [src/main/ipc/pty.ts](../src/main/ipc/pty.ts)

Changes:

- add `SetupRunPolicy`
- add `setupRunPolicy?: SetupRunPolicy` to `RepoHookSettings`
- extend `worktrees:create` args with `setupDecision?: 'inherit' | 'run' | 'skip'`
- resolve effective setup behavior in `worktrees:create`, including rejecting ambiguous creates when policy is `ask`
- if setup should run, generate a temporary runner script file (e.g. `.git/orca/setup-runner.sh`) containing the resolved command with `set -e`
- return the created worktree, the generated script path, and the injected environment variables in the result payload
- update `pty:spawn` to accept custom `env` overrides
- keep hidden `runHook()` execution for archive, but do not use it for visible setup execution

## Renderer

Files:

- [src/preload/index.d.ts](../src/preload/index.d.ts)
- [src/preload/index.ts](../src/preload/index.ts)
- [src/renderer/src/store/slices/worktrees.ts](../src/renderer/src/store/slices/worktrees.ts)
- [src/renderer/src/components/sidebar/AddWorktreeDialog.tsx](../src/renderer/src/components/sidebar/AddWorktreeDialog.tsx)
- [src/renderer/src/components/settings/RepositoryPane.tsx](../src/renderer/src/components/settings/RepositoryPane.tsx)
- [src/renderer/src/components/settings/HookEditor.tsx](../src/renderer/src/components/settings/HookEditor.tsx)

Changes:

- thread `setupDecision` through preload and store
- show policy-driven setup controls in `AddWorktreeDialog` with a loading state during creation
- for `ask`, require an explicit `Run setup now` vs `Skip for now` choice before enabling create
- for `run-by-default` and `skip-by-default`, initialize the checkbox from repo policy
- expose setup policy in repository settings
- update settings copy to emphasize setup scope and idempotency
- on successful worktree creation, automatically switch focus to the new worktree
- if setup is enabled, open a terminal for the new worktree, pass the returned custom environment variables to the PTY, and start the generated runner script

## Tests

Add or extend tests for:

- `worktrees:create` skips setup when `setupDecision` is `skip`
- `worktrees:create` generates a runner script and returns path when `setupDecision` is `run`
- `worktrees:create` resolves `inherit` via repo policy
- `worktrees:create` rejects ambiguous `inherit` calls when repo policy is `ask`
- create-worktree dialog shows setup controls only when effective setup exists
- dialog requires an explicit choice when repo policy is `ask`
- dialog uses repo policy for initial state when policy is `run-by-default` or `skip-by-default`
- renderer opens a terminal and starts setup when create returns with setup enabled
- output is visible in the terminal after setup failure

## Recommendation

Implement this as an extension of the current hook system, but tighten the product model:

- frame setup as a worktree setup command
- keep the command as a string
- use a repo-level run policy enum instead of a boolean default
- keep explicit per-create user choice in the dialog, and enforce `ask` in the backend instead of trusting the renderer
- **execute the setup command via a generated runner script in a normal integrated terminal** so multiline commands execute safely, and prompts, cancellation, and output are visible
- explicitly pass standard Orca context variables (`ORCA_WORKTREE_PATH`, etc.) directly into the PTY environment
- keep v1 best-effort, if the terminal is closed or the renderer reloads, the user can rerun setup manually
- document setup as idempotent environment preparation, not app startup

## Sources

- [Conductor environment variables](https://docs.conductor.build/tips/conductor-env)
- [Conductor workspaces and branches](https://docs.conductor.build/tips/workspaces-and-branches)
- [Conductor using monorepos](https://docs.conductor.build/tips/using-monorepos)
- [GitHub Codespaces: Introduction to dev containers](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers)
- [GitHub Codespaces: Configuring prebuilds](https://docs.github.com/en/codespaces/prebuilding-your-codespaces/configuring-prebuilds)
- [containers.dev supporting tools and prebuild patterns](https://containers.dev/supporting.html)
- [containers.dev prebuild guide](https://containers.dev/guide/prebuild)
- [Gitpod tasks](https://ona.com/docs/classic/user/configure/workspaces/tasks)
- [thoughtbot: Use `bin/setup` to simplify development environment setup](https://thoughtbot.com/blog/bin-setup)
- [thoughtbot: Laptop setup for an awesome development environment](https://thoughtbot.com/blog/laptop-setup-for-an-awesome-development-environment)
- [Chris Blunt: Simplifying local environment setup with `bin/setup`](https://www.chrisblunt.com/rails-simplifying-local-environment-setup/)
- [Mesi Rendon: Working environment setupper](https://mesirendon.com/articles/working-environment-setuper/)
- [Nathan Onn: Git worktrees and setup friction in multi-agent workflows](https://www.nathanonn.com/how-i-vibe-code-with-3-ai-agents-using-git-worktrees-without-breaking-anything/)
