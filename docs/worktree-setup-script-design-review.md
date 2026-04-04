╔══════════════════════════════════════════════════════════════════╗
║ DESIGN REVIEW ║
╠══════════════════════════════════════════════════════════════════╣
║ Document: docs/worktree-setup-script-design.md ║
║ Reviewer: Gemini CLI (First Principles Design Review) ║
╠══════════════════════════════════════════════════════════════════╣
║ VERDICT: 🟢 PROCEED WITH CAUTION (Design Updated) ║
╚══════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════
PHASE A: DESIGN CHALLENGE
═══════════════════════════════════════════════════════════

## Premise & Problem Assessment

The problem diagnosis is highly accurate. Implicit execution of setup scripts creates a hostile UX when things fail (e.g., missing auth, uninstalled dependencies). Exposing this as an explicit, terminal-first user choice directly addresses Issue #238.

## Alternative Approaches Considered

### Alternative 1: Dedicated Background Log Panel

- **Approach**: Run the setup script as a background process (using `node-pty` but not interactive) and stream output to a read-only UI panel in Orca.
- **How it works**: Uses a similar `exec` execution context as today, but surfaces logs.
- **Why it might be better**: Guarantees execution semantics (`set -e` equivalent) and prevents the user from accidentally typing into the terminal mid-setup and messing up the command.
- **Tradeoff**: Cannot handle interactive prompts (e.g., SSH keys, 2FA, package manager choices), which is the primary reason the design rejected background execution.
- **Effort**: 1.5x (Requires building a log viewer UI).
- **Risk**: Hanging setups due to hidden auth prompts.

### Alternative 2: Generated Runner Script (Recommended)

- **Approach**: Main process generates a temporary executable script (e.g., `.orca-setup.sh` or `.orca-setup.cmd`) containing the setup commands wrapped in strict error handling (`set -e`). It then spawns the PTY and injects `source .orca-setup.sh`.
- **How it works**: The terminal remains interactive, but the execution of multiline commands is handled safely by the script runner.
- **Why it might be better**: Fixes the catastrophic failure containment issue of pasting multiline commands into an interactive terminal (see Phase B).
- **Tradeoff**: Requires writing temporary files and platform-specific wrappers.
- **Effort**: 1.2x.
- **Risk**: Edge cases in path resolution or permissions for the temporary script.

### Recommendation

The proposed **Terminal-First** design is fundamentally the right approach for visibility and interactivity. However, the execution model is **💡 BETTER ALTERNATIVE EXISTS**: You must adopt Alternative 2 (Generated Runner Script) to safely execute multiline commands in an interactive shell.

## UX & User Journey Issues

### Interaction State Coverage

| Flow            | Loading | Empty | Error | Success | Partial | Notes                                                                                             |
| --------------- | ------- | ----- | ----- | ------- | ------- | ------------------------------------------------------------------------------------------------- |
| Create Worktree | ❌      | ✅    | ✅    | ✅      | ✅      | What does the UI show between clicking "Create" and the terminal opening? Git cloning takes time. |

### UX Findings

| Issue                   | Severity | User Impact                                                                                                                                | Suggested Fix                                                                                    |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Context Switching       | P2       | If user creates Worktree A, but clicks Worktree B while Git clone is running, the terminal might steal focus or open in the wrong context. | Define focus-stealing rules: Does the newly created worktree auto-focus when creation completes? |
| Terminal Identification | P3       | User has multiple terminals open. They don't know which one is running the setup script.                                                   | Give the setup PTY a specific title or header (e.g., `[Orca Setup]`).                            |

## Architectural Fit

```text
[UI Dialog] -> IPC: worktrees:create(repoId, ..., setupDecision)
                             |
                     [Main Process] -> Git Clone
                             |
                     Returns: { worktree, shouldRunSetup, envVars }
                             |
[Renderer updates UI] <------+
                             |
[Renderer opens PTY]  <------+ (Needs to pass envVars to PTY but cannot!)
                             |
                     [PTY runs setup script]
```

### Data Flow (4 paths)

```text
Happy path:    [User clicks create] → [Main creates worktree] → [Renderer opens PTY] → [Setup runs]
Nil/missing:   [User selects skip] → [Main creates worktree] → [Returns shouldRunSetup=false] → [No terminal]
Empty:         [No setup config] → [Dialog hides setup section] → [Normal create]
Upstream error: [Git clone fails] → [Main returns error] → 💥 [UI shows error toast, setup never runs]
```

| Issue   | Severity | Example                                                 | Why                                                                       | Evidence                          |
| ------- | -------- | ------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| API Gap | P0       | Renderer needs to pass `ORCA_WORKTREE_PATH` to the PTY. | The `pty:spawn` IPC handler does not accept custom environment variables. | `src/main/ipc/pty.ts` lines 65-72 |

═══════════════════════════════════════════════════════════
PHASE B: DESIGN AUDIT
═══════════════════════════════════════════════════════════

## Critical Blockers (P0/P1 - Must Fix Before Implementation)

| Blocker                           | Severity | Example                                                                                                              | Why                                                                                                                                                                                                              | Evidence                                                                      |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **PTY Env Injection API**         | P0       | The design states: "These existing variables should be passed to the setup command PTY". The renderer opens the PTY. | `pty:spawn` hardcodes `process.env`. The requested feature cannot be built without modifying this IPC handler to accept `env?: Record<string, string>`.                                                          | `src/main/ipc/pty.ts`                                                         |
| **Multiline Failure Containment** | P0       | `orca.yaml` contains: `pnpm install \n pnpm build`.                                                                  | Pasting multiline text into an interactive bash/zsh prompt executes line by line. If `pnpm install` fails, the shell will STILL execute `pnpm build`. This violates idempotency and can corrupt the environment. | Standard bash/zsh interactive behavior vs script behavior (lack of `set -e`). |
| **Hanging Script Cancellation**   | P1       | Setup command hangs. User presses `Ctrl+C`.                                                                          | If the command was injected as multiline text, `Ctrl+C` only cancels the _currently executing line_, not the rest of the buffered text. The script will plow forward.                                            | Standard interactive shell buffer behavior.                                   |
| **PTY Race Conditions**           | P1       | Injecting commands via `pty.write()` on startup.                                                                     | Depending on the shell (e.g., heavy `.zshrc`), writing to the PTY immediately after spawn can result in dropped characters or execution before the prompt is ready.                                              | Known `node-pty` limitation.                                                  |

## Unverified Assumptions

| Assumption             | Evidence Required                                                       | Severity | Example                                          | Why                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------- | -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| PTY Execution Strategy | A proven mechanism to execute arbitrary strings in `node-pty` robustly. | P0       | "Orca starts the setup command in that terminal" | Doing this reliably across Windows (cmd/pwsh) and Mac (bash/zsh) is notoriously difficult without wrapper scripts. |

## Hidden Complexity

| Hidden Issue  | Why It Will Surface       | Severity | Example                                                                                                                                                                  | Evidence                                                                             |
| ------------- | ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| UI State Sync | The `setupDecision` logic | P2       | The dialog needs to resolve `getEffectiveHooks()` to know if the `Setup` section should appear, meaning the Renderer needs real-time access to the resolved repo policy. | `worktree-setup-script-design.md` -> Edge Cases -> Repo Changes While Dialog Is Open |

═══════════════════════════════════════════════════════════
QUESTIONS FOR THE AUTHOR
═══════════════════════════════════════════════════════════

1. **How exactly will the Renderer execute the string in the PTY?**
   → What we need: A concrete execution strategy (e.g., wrapper script, `\r` injection) that mitigates the P0 multiline failure containment issue and race conditions.

2. **How will `ORCA_WORKTREE_PATH` reach the PTY?**
   → What we need: Explicit mention of updating `pty:spawn` in `src/main/ipc/pty.ts` to accept an `env` override payload.

3. **What happens in the UI during the "creating..." phase?**
   → What we need: A definition of the UI state between clicking the dialog and the terminal opening. If the user clicks away to another worktree, does the terminal open in the background, or does it force-switch them back?
