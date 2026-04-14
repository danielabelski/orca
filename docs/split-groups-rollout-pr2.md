# Split Groups PR 2: Terminal Lifecycle Hardening

This branch lands the terminal ownership and remount safety work required
before split groups can be exposed.

Scope:
- preserve PTYs across remounts
- fix pending-spawn dedupe paths
- fix split-pane PTY ownership
- keep visible-but-unfocused panes rendering correctly

What Is Actually Hooked Up In This PR:
- the existing terminal path uses the new PTY attach/detach/remount behavior
- split panes inside a terminal tab get distinct PTY ownership
- visible terminal panes continue rendering even when another pane or group has focus

What Is Not Hooked Up Yet:
- no split-group layout is rendered
- `Terminal.tsx` still uses the legacy single-surface host path
- no worktree restore/activation changes land here

Non-goals:
- no split-group UI rollout
- no worktree activation fallback changes
