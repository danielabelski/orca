import { useEffect, useState, useCallback } from 'react'
import type { OrcaHooks, Repo, RepoHookSettings } from '../../../shared/types'
import { REPO_COLORS, getDefaultRepoHookSettings } from '../../../shared/constants'
import { useAppStore } from '../store'
import { ScrollArea } from './ui/scroll-area'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Separator } from './ui/separator'
import {
  ArrowLeft,
  FolderOpen,
  Minus,
  Plus,
  SlidersHorizontal,
  SquareTerminal,
  Trash2
} from 'lucide-react'

type HookName = keyof OrcaHooks['scripts']
const DEFAULT_REPO_HOOK_SETTINGS = getDefaultRepoHookSettings()

function Settings(): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const repos = useAppStore((s) => s.repos)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const removeRepo = useAppStore((s) => s.removeRepo)

  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null)
  const [selectedPane, setSelectedPane] = useState<'general' | 'terminal' | 'repo'>('general')
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
  const [repoHooksMap, setRepoHooksMap] = useState<
    Record<string, { hasHooks: boolean; hooks: OrcaHooks | null }>
  >({})
  const [defaultBaseRef, setDefaultBaseRef] = useState('origin/main')
  const [baseRefQuery, setBaseRefQuery] = useState('')
  const [baseRefResults, setBaseRefResults] = useState<string[]>([])
  const [isSearchingBaseRefs, setIsSearchingBaseRefs] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    let stale = false
    const checkHooks = async () => {
      const results = await Promise.all(
        repos.map(async (repo) => {
          try {
            const result = await window.api.hooks.check({ repoId: repo.id })
            return [repo.id, result] as const
          } catch {
            return [repo.id, { hasHooks: false, hooks: null }] as const
          }
        })
      )

      if (!stale) {
        setRepoHooksMap(Object.fromEntries(results))
      }
    }

    if (repos.length > 0) {
      checkHooks()
    } else {
      setRepoHooksMap({})
    }

    return () => {
      stale = true
    }
  }, [repos])

  useEffect(() => {
    let stale = false

    const loadDefaultBaseRef = async (repoId: string) => {
      try {
        const result = await window.api.repos.getBaseRefDefault({ repoId })
        if (stale) return
        setDefaultBaseRef(result)
      } catch {
        if (stale) return
        setDefaultBaseRef('origin/main')
      }
    }

    if (!selectedRepoId) {
      setDefaultBaseRef('origin/main')
      setBaseRefQuery('')
      setBaseRefResults([])
    } else {
      setBaseRefQuery('')
      setBaseRefResults([])
      void loadDefaultBaseRef(selectedRepoId)
    }

    return () => {
      stale = true
    }
  }, [selectedRepoId])

  useEffect(() => {
    if (!selectedRepoId) return

    const trimmedQuery = baseRefQuery.trim()
    if (trimmedQuery.length < 2) {
      setBaseRefResults([])
      setIsSearchingBaseRefs(false)
      return
    }

    let stale = false
    setIsSearchingBaseRefs(true)

    const timer = window.setTimeout(() => {
      void window.api.repos
        .searchBaseRefs({
          repoId: selectedRepoId,
          query: trimmedQuery,
          limit: 20
        })
        .then((results) => {
          if (!stale) {
            setBaseRefResults(results)
          }
        })
        .catch(() => {
          if (!stale) {
            setBaseRefResults([])
          }
        })
        .finally(() => {
          if (!stale) {
            setIsSearchingBaseRefs(false)
          }
        })
    }, 200)

    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [selectedRepoId, baseRefQuery])

  useEffect(() => {
    if (repos.length === 0) {
      setSelectedRepoId(null)
      setSelectedPane('general')
      return
    }

    if (!selectedRepoId || !repos.some((repo) => repo.id === selectedRepoId)) {
      setSelectedRepoId(repos[0].id)
    }
  }, [repos, selectedRepoId])

  const applyTheme = useCallback((theme: 'system' | 'dark' | 'light') => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else if (theme === 'light') {
      root.classList.remove('dark')
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      if (prefersDark) {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }
  }, [])

  const handleBrowseWorkspace = async () => {
    const path = await window.api.repos.pickFolder()
    if (path) {
      updateSettings({ workspaceDir: path })
    }
  }

  const handleRemoveRepo = (repoId: string) => {
    if (confirmingRemove === repoId) {
      removeRepo(repoId)
      setConfirmingRemove(null)
      return
    }

    setConfirmingRemove(repoId)
  }

  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null
  const selectedYamlHooks = selectedRepo ? (repoHooksMap[selectedRepo.id]?.hooks ?? null) : null
  const showGeneralPane = selectedPane === 'general'
  const showTerminalPane = selectedPane === 'terminal'
  const showRepoPane = selectedPane === 'repo' && !!selectedRepo
  const displayedGitUsername = (selectedRepo ?? repos[0])?.gitUsername ?? ''
  const effectiveBaseRef = selectedRepo?.worktreeBaseRef ?? defaultBaseRef

  const updateSelectedRepoHookSettings = (
    repo: Repo,
    updates: Omit<Partial<RepoHookSettings>, 'scripts'> & {
      scripts?: Partial<RepoHookSettings['scripts']>
    }
  ) => {
    const nextSettings: RepoHookSettings = {
      ...DEFAULT_REPO_HOOK_SETTINGS,
      ...repo.hookSettings,
      ...updates,
      scripts: {
        ...DEFAULT_REPO_HOOK_SETTINGS.scripts,
        ...repo.hookSettings?.scripts,
        ...updates.scripts
      }
    }

    updateRepo(repo.id, {
      hookSettings: nextSettings
    })
  }

  if (!settings) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Loading settings...
      </div>
    )
  }

  return (
    <div className="settings-view-shell flex min-h-0 flex-1 overflow-hidden bg-background">
      <aside className="flex w-[260px] shrink-0 flex-col border-r bg-card/40">
        <div className="border-b px-3 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveView('terminal')}
            className="w-full justify-start gap-2 text-muted-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to app
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-3 py-4">
            <div className="space-y-1">
              <button
                onClick={() => setSelectedPane('general')}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  showGeneralPane
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <SlidersHorizontal className="mr-2 size-4" />
                General
              </button>
              <button
                onClick={() => setSelectedPane('terminal')}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  showTerminalPane
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <SquareTerminal className="mr-2 size-4" />
                Terminal
              </button>
            </div>

            <div className="space-y-2">
              <p className="px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Repositories
              </p>

              {repos.length === 0 ? (
                <p className="px-3 text-xs text-muted-foreground">No repositories added yet.</p>
              ) : (
                <div className="space-y-1">
                  {repos.map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => {
                        setSelectedRepoId(repo.id)
                        setSelectedPane('repo')
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        showRepoPane && selectedRepoId === repo.id
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      }`}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: repo.badgeColor }}
                      />
                      <span className="truncate">{repo.displayName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </aside>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-5xl px-8 py-8">
          {showGeneralPane ? (
            <div className="space-y-8">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold">General</h1>
                <p className="text-sm text-muted-foreground">
                  Workspace, naming, and appearance defaults.
                </p>
              </div>

              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Workspace</h2>
                  <p className="text-xs text-muted-foreground">
                    Configure where new worktrees are created.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Workspace Directory</Label>
                  <div className="flex gap-2">
                    <Input
                      value={settings.workspaceDir}
                      onChange={(e) => updateSettings({ workspaceDir: e.target.value })}
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBrowseWorkspace}
                      className="shrink-0 gap-1.5"
                    >
                      <FolderOpen className="size-3.5" />
                      Browse
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Root directory where worktree folders are created.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4 px-1 py-2">
                  <div className="space-y-0.5">
                    <Label className="text-sm">Nest Workspaces</Label>
                    <p className="text-xs text-muted-foreground">
                      Create worktrees inside a repo-named subfolder.
                    </p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={settings.nestWorkspaces}
                    onClick={() =>
                      updateSettings({
                        nestWorkspaces: !settings.nestWorkspaces
                      })
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors ${
                      settings.nestWorkspaces ? 'bg-foreground' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <span
                      className={`pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform ${
                        settings.nestWorkspaces ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </section>

              <Separator />

              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Branch Naming</h2>
                  <p className="text-xs text-muted-foreground">
                    Prefix added to branch names when creating worktrees.
                  </p>
                </div>

                <div className="flex w-fit gap-1 rounded-md border p-1">
                  {(['git-username', 'custom', 'none'] as const).map((option) => (
                    <button
                      key={option}
                      onClick={() => updateSettings({ branchPrefix: option })}
                      className={`rounded-sm px-3 py-1 text-sm transition-colors ${
                        settings.branchPrefix === option
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {option === 'git-username'
                        ? 'Git Username'
                        : option === 'custom'
                          ? 'Custom'
                          : 'None'}
                    </button>
                  ))}
                </div>
                {(settings.branchPrefix === 'custom' ||
                  settings.branchPrefix === 'git-username') && (
                  <Input
                    value={
                      settings.branchPrefix === 'git-username'
                        ? displayedGitUsername
                        : settings.branchPrefixCustom
                    }
                    onChange={(e) => updateSettings({ branchPrefixCustom: e.target.value })}
                    placeholder={
                      settings.branchPrefix === 'git-username'
                        ? 'No git username configured'
                        : 'e.g. feature'
                    }
                    className="max-w-xs"
                    readOnly={settings.branchPrefix === 'git-username'}
                  />
                )}
              </section>

              <Separator />

              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Appearance</h2>
                  <p className="text-xs text-muted-foreground">
                    Choose how Orca looks in the app window.
                  </p>
                </div>

                <div className="flex w-fit gap-1 rounded-md border p-1">
                  {(['system', 'dark', 'light'] as const).map((option) => (
                    <button
                      key={option}
                      onClick={() => {
                        updateSettings({ theme: option })
                        applyTheme(option)
                      }}
                      className={`rounded-sm px-3 py-1 text-sm capitalize transition-colors ${
                        settings.theme === option
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : showTerminalPane ? (
            <div className="space-y-8">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold">Terminal</h1>
                <p className="text-sm text-muted-foreground">
                  Default terminal typography for new panes.
                </p>
              </div>

              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Typography</h2>
                  <p className="text-xs text-muted-foreground">
                    Default terminal typography for new panes.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Font Size</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => {
                        const next = Math.max(10, settings.terminalFontSize - 1)
                        updateSettings({ terminalFontSize: next })
                      }}
                      disabled={settings.terminalFontSize <= 10}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <Input
                      type="number"
                      min={10}
                      max={24}
                      value={settings.terminalFontSize}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10)
                        if (!Number.isNaN(value) && value >= 10 && value <= 24) {
                          updateSettings({ terminalFontSize: value })
                        }
                      }}
                      className="w-16 text-center tabular-nums"
                    />
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => {
                        const next = Math.min(24, settings.terminalFontSize + 1)
                        updateSettings({ terminalFontSize: next })
                      }}
                      disabled={settings.terminalFontSize >= 24}
                    >
                      <Plus className="size-3" />
                    </Button>
                    <span className="text-xs text-muted-foreground">px</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Font Family</Label>
                  <Input
                    value={settings.terminalFontFamily}
                    onChange={(e) => updateSettings({ terminalFontFamily: e.target.value })}
                    placeholder="SF Mono"
                    className="max-w-xs"
                  />
                </div>
              </section>
            </div>
          ) : selectedRepo ? (
            <div className="space-y-8">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: selectedRepo.badgeColor }}
                  />
                  <h1 className="text-2xl font-semibold">{selectedRepo.displayName}</h1>
                </div>
                <p className="font-mono text-xs text-muted-foreground">{selectedRepo.path}</p>
              </div>

              <section className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold">Identity</h2>
                    <p className="text-xs text-muted-foreground">
                      Repo-specific display details for the sidebar and tabs.
                    </p>
                  </div>

                  <Button
                    variant={confirmingRemove === selectedRepo.id ? 'destructive' : 'outline'}
                    size="sm"
                    onClick={() => handleRemoveRepo(selectedRepo.id)}
                    onBlur={() => setConfirmingRemove(null)}
                    className="gap-2"
                  >
                    <Trash2 className="size-3.5" />
                    {confirmingRemove === selectedRepo.id ? 'Confirm Remove' : 'Remove Repo'}
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Display Name</Label>
                  <Input
                    value={selectedRepo.displayName}
                    onChange={(e) =>
                      updateRepo(selectedRepo.id, {
                        displayName: e.target.value
                      })
                    }
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Badge Color</Label>
                  <div className="flex flex-wrap gap-2">
                    {REPO_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => updateRepo(selectedRepo.id, { badgeColor: color })}
                        className={`size-7 rounded-full transition-all ${
                          selectedRepo.badgeColor === color
                            ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                            : 'hover:ring-1 hover:ring-muted-foreground hover:ring-offset-2 hover:ring-offset-background'
                        }`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Default Worktree Base</Label>
                  <div className="rounded-xl border bg-background/80 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {effectiveBaseRef}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {selectedRepo.worktreeBaseRef
                            ? 'Pinned for this repo'
                            : `Following primary branch (${defaultBaseRef})`}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setBaseRefQuery('')
                          setBaseRefResults([])
                          updateRepo(selectedRepo.id, {
                            worktreeBaseRef: undefined
                          })
                        }}
                        disabled={!selectedRepo.worktreeBaseRef}
                      >
                        Use Primary
                      </Button>
                    </div>

                    <div className="mt-4 space-y-2">
                      <Input
                        value={baseRefQuery}
                        onChange={(e) => setBaseRefQuery(e.target.value)}
                        placeholder="Search branches by name..."
                        className="max-w-md"
                      />
                      <p className="text-xs text-muted-foreground">Type at least 2 characters.</p>
                    </div>

                    {isSearchingBaseRefs ? (
                      <p className="mt-3 text-xs text-muted-foreground">Searching branches...</p>
                    ) : null}

                    {!isSearchingBaseRefs && baseRefQuery.trim().length >= 2 ? (
                      baseRefResults.length > 0 ? (
                        <ScrollArea className="mt-3 h-48 rounded-md border">
                          <div className="p-1">
                            {baseRefResults.map((ref) => (
                              <button
                                key={ref}
                                onClick={() => {
                                  setBaseRefQuery(ref)
                                  setBaseRefResults([])
                                  updateRepo(selectedRepo.id, {
                                    worktreeBaseRef: ref
                                  })
                                }}
                                className={`flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 ${
                                  selectedRepo.worktreeBaseRef === ref
                                    ? 'bg-accent text-accent-foreground'
                                    : 'text-foreground'
                                }`}
                              >
                                <span className="truncate">{ref}</span>
                                {selectedRepo.worktreeBaseRef === ref ? (
                                  <span className="text-[10px] uppercase tracking-[0.18em]">
                                    Current
                                  </span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">
                          No matching branches found.
                        </p>
                      )
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    New worktrees default to the repo primary branch unless you pin a different base
                    here.
                  </p>
                </div>
              </section>

              <Separator />

              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Hook Source</h2>
                  <p className="text-xs text-muted-foreground">
                    Auto prefers `orca.yaml` when present, then falls back to the UI script.
                    Override ignores YAML and only uses the UI script.
                  </p>
                </div>

                <div className="flex w-fit gap-1 rounded-xl border p-1">
                  {(['auto', 'override'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => updateSelectedRepoHookSettings(selectedRepo, { mode })}
                      className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        selectedRepo.hookSettings?.mode === mode
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {mode === 'auto' ? 'Use YAML First' : 'Override in UI'}
                    </button>
                  ))}
                </div>

                <div className="rounded-xl border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                  {selectedYamlHooks ? (
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">
                        YAML hooks detected in `orca.yaml`
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(['setup', 'archive'] as HookName[]).map((hookName) =>
                          selectedYamlHooks.scripts[hookName] ? (
                            <span
                              key={hookName}
                              className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300"
                            >
                              {hookName}
                            </span>
                          ) : null
                        )}
                      </div>
                    </div>
                  ) : (
                    <p>No YAML hooks detected for this repo.</p>
                  )}
                </div>
              </section>

              <Separator />

              <section className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Lifecycle Hooks</h2>
                  <p className="text-xs text-muted-foreground">
                    Write scripts directly in the UI. Each repo stores its own setup and archive
                    hook script.
                  </p>
                </div>

                <div className="space-y-4">
                  {(['setup', 'archive'] as HookName[]).map((hookName) => (
                    <HookEditor
                      key={hookName}
                      hookName={hookName}
                      repo={selectedRepo}
                      yamlHooks={selectedYamlHooks}
                      onScriptChange={(script) =>
                        updateSelectedRepoHookSettings(selectedRepo, {
                          scripts: hookName === 'setup' ? { setup: script } : { archive: script }
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="flex min-h-[24rem] items-center justify-center text-sm text-muted-foreground">
              Select a repository to edit its settings.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function HookEditor({
  hookName,
  repo,
  yamlHooks,
  onScriptChange
}: {
  hookName: HookName
  repo: Repo
  yamlHooks: OrcaHooks | null
  onScriptChange: (script: string) => void
}): React.JSX.Element {
  const uiScript = repo.hookSettings?.scripts[hookName] ?? ''
  const yamlScript = yamlHooks?.scripts[hookName]
  const effectiveSource =
    repo.hookSettings?.mode === 'auto' && yamlScript ? 'yaml' : uiScript.trim() ? 'ui' : 'none'

  return (
    <div className="space-y-3 rounded-2xl border bg-background/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h5 className="text-sm font-semibold capitalize">{hookName}</h5>
          <p className="text-xs text-muted-foreground">
            {hookName === 'setup'
              ? 'Runs after a worktree is created.'
              : 'Runs before a worktree is archived.'}
          </p>
        </div>

        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
            effectiveSource === 'yaml'
              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : effectiveSource === 'ui'
                ? 'border border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                : 'border bg-muted text-muted-foreground'
          }`}
        >
          {effectiveSource === 'yaml'
            ? 'Honoring YAML'
            : effectiveSource === 'ui'
              ? 'Using UI'
              : 'Inactive'}
        </span>
      </div>

      {yamlScript && (
        <div className="space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
              YAML Script
            </Label>
            <span className="text-[10px] text-muted-foreground">Read-only from `orca.yaml`</span>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-background/70 p-3 font-mono text-[11px] leading-5 text-foreground">
            {yamlScript}
          </pre>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            UI Script
          </Label>
          <span className="text-[10px] text-muted-foreground">
            {repo.hookSettings?.mode === 'auto' && yamlScript
              ? 'Stored as fallback until you switch to override.'
              : 'Editable script stored with this repo.'}
          </span>
        </div>
        <textarea
          value={uiScript}
          onChange={(e) => onScriptChange(e.target.value)}
          placeholder={
            hookName === 'setup'
              ? 'pnpm install\npnpm generate'
              : 'echo "Cleaning up before archive"'
          }
          spellCheck={false}
          className="min-h-[12rem] w-full resize-y rounded-xl border bg-background px-3 py-3 font-mono text-[12px] leading-5 outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </div>
    </div>
  )
}

export default Settings
