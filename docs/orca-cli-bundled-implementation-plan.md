# Orca CLI Bundled Installation Plan

## Scope

Implement the bundled Orca CLI as an app-managed capability:

- no npm-first distribution
- macOS shell-command registration from the app
- Linux package-managed command registration
- Windows installer-managed command registration

This plan is intentionally aligned with the current codebase, especially:

- settings persistence in [src/shared/types.ts](/Users/jinwoohong/orca/workspaces/orca/cli/src/shared/types.ts)
- settings IPC in [src/main/ipc/settings.ts](/Users/jinwoohong/orca/workspaces/orca/cli/src/main/ipc/settings.ts)
- preload bridge in [src/preload/index.ts](/Users/jinwoohong/orca/workspaces/orca/cli/src/preload/index.ts)
- settings UI in [src/renderer/src/components/settings/Settings.tsx](/Users/jinwoohong/orca/workspaces/orca/cli/src/renderer/src/components/settings/Settings.tsx)
- packaging config in [electron-builder.yml](/Users/jinwoohong/orca/workspaces/orca/cli/electron-builder.yml)
- CLI build output in [package.json](/Users/jinwoohong/orca/workspaces/orca/cli/package.json)

## Product Model

The app remains the primary product. The CLI is bundled with the app, but registration is platform-specific.

User flow:

1. macOS:
   - open Settings
   - use the `Command line interface` install flow
   - Orca registers `/usr/local/bin/orca`
2. Linux `.deb` / `.rpm`:
   - install package
   - package registers `/usr/bin/orca`
3. Windows installer builds:
   - install Orca
   - installer registers `<install dir>\\bin` on PATH
4. Settings shows status/help across platforms, and macOS owns install/remove directly.

## Recommended UI Placement

Add a dedicated `CLI` pane to the settings nav instead of burying this under `General`.

Why:

- this is a real product capability, not just a low-level preference
- it needs status and platform-specific instructions
- it may later grow to include diagnostics like `runtime reachable`, `PATH detected`, or `version`

### Renderer Changes

Update [src/renderer/src/components/settings/Settings.tsx](/Users/jinwoohong/orca/workspaces/orca/cli/src/renderer/src/components/settings/Settings.tsx):

- add `selectedPane` value `cli`
- add a nav item labeled `CLI`
- add a new `CliPane` renderer section

Add a new component:

- [src/renderer/src/components/settings/CliPane.tsx](/Users/jinwoohong/orca/workspaces/orca/cli/src/renderer/src/components/settings/CliPane.tsx)

`CliPane` should show:

- toggle: `Command line interface`
- current status:
  - `not installed`
  - `installed`
  - `installed, terminal PATH not yet configured`
  - `error`
- installed command path
- detected target launcher path
- actions:
  - macOS:
    - `Register`
    - `Reinstall`
    - `Remove`
  - Linux/Windows:
    - status/help only in v1 unless local package/installer mutation is explicitly supported
  - `Copy PATH instructions`
  - `Reveal install location`

Use an explicit modal for macOS first-time install confirmation.

## Persisted Settings

Do not add a persisted `cliEnabled` setting in v1.

The CLI install state should be derived from the launcher registration on disk plus the installer/package status.

Why:

- it avoids drift between stored preference and real launcher state
- it keeps the feature operational rather than preference-driven
- it removes migration and sync complexity for little product value

The settings toggle should simply reflect:

- `installed`
- `not installed`

with install/remove actions driven by the installer service.

## Runtime Install State Model

Add a separate derived install state returned from main, not persisted directly as source of truth.

Create a main-process service, for example:

- [src/main/cli/cli-installer.ts](/Users/jinwoohong/orca/workspaces/orca/cli/src/main/cli/cli-installer.ts)

It should expose:

- `getCliInstallStatus()`
- `installCliCommand()`
- `removeCliCommand()`
- `getCliManualInstructions()`

Suggested status shape:

```ts
type CliInstallStatus = {
  installed: boolean
  pathDetected: boolean
  launcherPath: string | null
  targetPath: string | null
  platform: NodeJS.Platform
  shellHint: string | null
  error: string | null
}
```

The app should recompute this at read time from the filesystem and environment.
This status is operational state, not persisted preference state.

## Main-Process Install Logic

Add a new IPC module:

- [src/main/ipc/cli.ts](/Users/jinwoohong/orca/workspaces/orca/cli/src/main/ipc/cli.ts)

Register it from [src/main/ipc/register-core-handlers.ts](/Users/jinwoohong/orca/workspaces/orca/cli/src/main/ipc/register-core-handlers.ts).

Add preload bridge methods in:

- [src/preload/index.ts](/Users/jinwoohong/orca/workspaces/orca/cli/src/preload/index.ts)
- [src/preload/index.d.ts](/Users/jinwoohong/orca/workspaces/orca/cli/src/preload/index.d.ts)

Suggested renderer API:

```ts
window.api.cli.getStatus()
window.api.cli.install()
window.api.cli.remove()
window.api.cli.getManualInstructions()
window.api.cli.revealWrapper()
```

## Launcher Strategy

Do not expose the raw built JS file directly on PATH.

Install a tiny platform-native launcher that targets the bundled CLI client artifact shipped with the app.

The launcher target is not a separate npm package.
The launcher target is the bundled CLI client, which connects to the Orca app runtime.

### macOS

Follow the verified VS Code model.

Package:

- ship a launcher script inside the app bundle

Registration:

- install `/usr/local/bin/orca` as a symlink to the packaged launcher
- prompt for elevation from the app if needed

Behavior:

- the packaged launcher invokes the bundled Orca CLI client
- the CLI client behaves exactly like the existing thin runtime client
- if Orca is not already running, ordinary commands fail clearly and tell the user to run `orca open`

### Linux

For `.deb` / `.rpm`, follow the verified VS Code model.

Package:

- ship a launcher script in the installed app payload
- install `/usr/bin/orca` from the package as a symlink or launcher entry

AppImage nuance:

- install target resolution must survive the mounted AppImage path model
- if AppImage path stability is not good enough for v1, disable CLI installation for AppImage rather than shipping a flaky wrapper target

### Windows

Follow the verified VS Code model as closely as practical.

Package:

- ship `orca.cmd` and related launcher files under `<install dir>\\bin`

Registration:

- let the Windows installer add `<install dir>\\bin` to PATH
- optionally register Windows App Paths for Explorer/address bar launching

For v1, the Orca app itself should not try to mutate PATH after installation on Windows.

## Packaged CLI Layout

This is the most important packaging decision.

Today, [package.json](/Users/jinwoohong/orca/workspaces/orca/cli/package.json) builds the CLI to `out/cli/index.js`, but [electron-builder.yml](/Users/jinwoohong/orca/workspaces/orca/cli/electron-builder.yml) does not yet define a first-class bundled CLI path for packaged builds.

Recommended approach:

1. Keep the existing CLI implementation as a thin runtime client.
2. Package the built CLI artifact and launcher scripts inside the desktop app in stable locations.
3. Register the launcher in platform-native command locations where that is robust.
4. Keep the runtime contract unchanged: the Orca app remains the runtime owner.
5. Add an explicit `orca open` command that launches Orca, waits for the runtime, and fails clearly if startup does not succeed.
6. Make runtime-missing failures explicitly recommend `orca open`.
7. Strengthen `orca status --json` as the readiness preflight primitive for agents.

Why this is better:

- avoids headless packaged-Electron CLI complexity
- keeps the product model honest: the app is the runtime, the CLI is a client
- avoids a separate headless daemon architecture
- preserves the already-implemented local runtime socket design

Packaging rule:

- the bundled CLI client must live at a stable packaged path
- the packaged launcher must live at a stable packaged path
- registration should point to the packaged launcher, not dev-tree paths

## Explicit Open Lifecycle

The bundled CLI should not auto-launch Orca for ordinary commands.

Instead:

- ordinary `orca ...` commands require a healthy runtime
- `orca open` explicitly launches Orca and waits for the runtime

### Launch Handshake

The CLI must not trust an existing `orca-runtime.json` blindly.

Required startup logic:

1. Try connecting to the runtime described by current metadata.
2. If the runtime is healthy, `orca open` can succeed immediately.
3. If metadata is stale or the connection fails, treat the runtime as unavailable.
4. Launch Orca.
5. Wait for fresh runtime metadata with a new healthy `runtimeId` / PID pair.
6. Only proceed once the new runtime is confirmed healthy.

This prevents connecting to stale runtime metadata from a previous app process.

### Single-Instance Rule

`orca open` must be idempotent.

If multiple `orca open` commands start while Orca is closed or still booting:

- they should all target the single eventual Orca app instance
- they should not create competing runtime owners
- they should all wait on the same runtime becoming ready

The CLI should assume the Orca app enforces single-instance behavior and should treat runtime readiness, not process spawn count, as the source of truth.

### Readiness by Command Type

Readiness should be scoped by command type.

For ordinary `repo` and `worktree` commands:

- fail if runtime reachability is missing
- runtime-missing errors should explicitly say to run `orca open`

For ordinary `terminal` commands:

- fail if runtime reachability or live graph readiness is missing
- runtime-missing errors should explicitly say to run `orca open`

For `orca open`:

- waiting for runtime reachability is sufficient
- if you later add `orca open --wait-for-terminals`, that should be a separate contract

For `orca status --json`:

- it should be the primary machine-readable preflight command
- it should distinguish:
  - app not running
  - app starting
  - runtime reachable
  - runtime reachable but live graph not ready

### Timeout Contract

Startup timeout should be explicit.

Recommended v1 behavior:

- default launch timeout: 15 seconds
- one retry connection attempt after fresh metadata appears
- clear failure code when `orca open` launched Orca but runtime never became ready
- `orca open` should be cheap and return quickly when Orca is already running

Suggested failure classes:

- `runtime_unavailable`
- `runtime_open_failed`
- `runtime_open_timeout`
- `runtime_stale_metadata`

## App Path Resolution

Create a helper module, for example:

- [src/main/cli/cli-paths.ts](/Users/jinwoohong/orca/workspaces/orca/cli/src/main/cli/cli-paths.ts)

Responsibilities:

- compute the bundled CLI client path inside the packaged app
- compute the packaged launcher path inside the app
- compute registration target path by platform
- detect whether the Orca-managed registration already exists
- best-effort detect whether the command is likely to be visible from terminal PATH
- produce shell-specific PATH instructions
- launch Orca for `orca open`
- wait for runtime readiness with a bounded timeout

This module should explicitly distinguish:

- dev mode
- packaged mode

Dev mode behavior:

- either disable CLI installation entirely, or
- clearly label it experimental and point wrappers at the dev checkout

Recommended v1 behavior:

- disable install in dev mode
- expose status but show `CLI registration is only available in packaged builds`

That avoids path confusion and broken wrappers during development.

## Install / Remove Operations

In v1, app-driven install/remove is primarily a macOS feature.

Linux package builds and Windows installer builds should prefer package/installer-managed registration, with the Orca app surfacing status and help.

### Install

Main process should:

1. resolve packaged bundled CLI client path
2. resolve packaged launcher path
3. on macOS, resolve `/usr/local/bin/orca`
4. on macOS, install the symlink using the platform-specific flow
5. verify the registered command points to the Orca-managed launcher
6. verify the bundled CLI target exists
7. return refreshed status

### Remove

Main process should:

1. on macOS, resolve `/usr/local/bin/orca`
2. remove only the known Orca-managed registration
3. leave user PATH configuration alone
4. return refreshed status

Do not try to edit shell rc files automatically in v1.

That would add too much platform-specific risk.

## PATH Detection and Instructions

The app should only do best-effort PATH detection.

The running GUI app cannot authoritatively know the PATH of a future interactive shell, especially on macOS where GUI apps often inherit a different environment than terminal shells.

So the rule is:

- install location is deterministic
- PATH detection is advisory only
- manual instructions are always available

The app may detect whether the registration target location is on the current process PATH and report that as a hint, but it must not treat that as authoritative truth.

If not:

- install can still succeed
- status should show `installed, terminal PATH not yet configured`
- renderer should show manual instructions

Suggested manual instructions:

- zsh / bash:
  - shell-specific instructions only when Orca is using a user-level fallback
- fish:
  - shell-specific instructions only when Orca is using a user-level fallback
- Windows:
  - explain that installer registration is expected, or show the Orca bin directory only when Orca is using a user-scoped fallback

These instructions should be generated in main so the renderer stays dumb.

## Safety Rules

1. Only install into user-writable locations.
2. Never overwrite arbitrary existing commands without clear detection.
3. If a launcher registration exists and was not created by Orca, fail with an explicit error.
4. Packaged launcher content or registration target should contain an Orca-managed marker or stable target contract.
5. Remove should only delete Orca-managed registrations.
6. Install location is fixed by platform convention, not chosen from whatever writable PATH entry happens to be present.

This avoids accidentally clobbering a user’s existing `orca` command.

## Suggested Launcher Contents

### macOS / Linux

Orca is intentionally copying the VS Code-style registration model, not necessarily the exact same internal launcher chain.

The important contract is:

- registration points at an Orca-managed launcher
- that launcher points at the bundled Orca CLI client
- the CLI client remains a thin client for a running Orca app
- launcher execution should mirror VS Code's approach: use the packaged Electron executable with `ELECTRON_RUN_AS_NODE=1` and pass the packaged CLI entrypoint

```sh
#!/bin/sh
# Managed by Orca. Reinstall from Orca Settings if this file drifts.
ELECTRON_RUN_AS_NODE=1 "/path/to/Orca" "/path/to/resources/app/out/cli.js" "$@"
```

### Windows

```bat
@echo off
REM Managed by Orca. Reinstall from Orca Settings if this file drifts.
set ELECTRON_RUN_AS_NODE=1
"C:\Path\To\Orca.exe" "C:\Path\To\resources\app\out\cli.js" %*
```

The exact packaged target can vary, but the managed marker or registration target contract should be stable.

## Recommended PR Sequence

### PR 1: Packaged CLI Payload

- package the CLI client artifact in a stable location inside packaged builds
- package launcher scripts in stable locations inside packaged builds
- add packaged-path resolution helpers
- keep the existing Node bin entrypoint for development and testing

Acceptance:

- packaged builds contain a deterministic bundled CLI client path
- `node out/cli/index.js ...` still works in development

### PR 2: Types and Settings Plumbing

- add `cli` preload API shape
- add main IPC skeleton with mocked status
- define the machine-readable `status --json` readiness states

Acceptance:

- renderer can query placeholder CLI status
- `status --json` has stable readiness distinctions

### PR 3: macOS Shell Command Service

- add `cli-paths.ts`
- add `cli-installer.ts`
- add packaged launcher resolution
- support macOS status/install/remove/manual instructions
- packaged-build guard

Acceptance:

- unit tests cover launcher path resolution and registration ownership checks

### PR 4: Renderer Settings UI

- add `CliPane`
- add macOS toggle and modal
- add status/help flows for Linux and Windows
- add success/error/manual instruction states

Acceptance:

- first-time macOS toggle prompts before install
- failed install keeps UI coherent

### PR 5: Linux / Windows Packaging Integration

- Linux package builds register `/usr/bin/orca`
- Windows installer builds register `<install dir>\\bin` on PATH
- Settings pane reflects installer/package status correctly

Acceptance:

- packaged Linux/Windows builds expose the `orca` command without post-install app mutation

### PR 6: Final Validation

Manual validation on:

- macOS packaged app
- Linux packaged app
- Windows packaged app

Check:

- install
- reinstall
- remove
- PATH detected / not detected
- launcher invokes `orca status`
- launcher survives app restart
- ordinary commands fail with a message that points to `orca open`
- `orca open` returns quickly when Orca is already running
- `status --json` distinguishes missing runtime vs starting vs ready
- launcher starts Orca automatically when Orca is closed

## Testing Plan

### Unit Tests

Add tests for:

- launcher path resolution
- launcher ownership marker detection
- install to empty location
- install when registration already exists and is Orca-managed
- install when registration exists but is not Orca-managed
- remove only deletes Orca-managed registration
- PATH detection
- installer/package status detection by platform

### Renderer Tests

Add focused tests for:

- CLI pane state transitions
- macOS toggle + modal flow
- Linux/Windows status rendering
- error rendering

### Manual Tests

In packaged builds:

- macOS: install launcher registration from Settings
- run `orca status`
- run `orca worktree list --json`
- macOS: remove launcher registration from Settings
- Linux/Windows: verify packaged install already exposes `orca`
- verify command no longer resolves

## Pitfalls

1. Dev vs packaged paths will drift if not separated early.
2. Registrations should not target dev-tree assets; they should target the packaged launcher path.
3. AppImage path stability may require special handling.
   If it does not meet the reliability bar, Linux install should ship disabled rather than partially working.
4. GUI PATH detection is advisory, not authoritative.
5. Windows installer integration is more robust than post-install app mutation, but requires packaging work rather than settings-only work.
6. The launcher registration must not silently target an old app bundle after updates.

## Recommendation

The safest v1 is:

- packaged-build only
- platform-native launcher registration
- no automatic shell rc mutation
- no npm package
- explicit install/remove from Settings on macOS
- installer/package registration on Windows and Linux package builds
- packaged bundled CLI client as the launcher target

That is the cleanest implementation that matches the product decision and current Orca architecture.
