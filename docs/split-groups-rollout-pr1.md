# Split Groups PR 1: Model Foundations

This branch is reserved for the behavior-neutral tab-group model groundwork.

Scope:
- add persisted tab-group layout state
- add active-group persistence and hydration
- extract tab-group helpers/controller shape
- keep the existing visible worktree render path unchanged

Non-goals:
- no split-group UI rollout
- no terminal PTY lifecycle changes
- no worktree activation changes

