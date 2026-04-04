import { useState } from 'react'
import type { OrcaHooks, Repo, RepoHookSettings, SetupRunPolicy } from '../../../../shared/types'
import { REPO_COLORS } from '../../../../shared/constants'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { Trash2 } from 'lucide-react'
import { DEFAULT_REPO_HOOK_SETTINGS } from './SettingsConstants'
import { BaseRefPicker } from './BaseRefPicker'
import { RepositoryHooksSection } from './RepositoryHooksSection'

type RepositoryPaneProps = {
  repo: Repo
  yamlHooks: OrcaHooks | null
  hasHooksFile: boolean
  updateRepo: (repoId: string, updates: Partial<Repo>) => void
  removeRepo: (repoId: string) => void
}

export function RepositoryPane({
  repo,
  yamlHooks,
  hasHooksFile,
  updateRepo,
  removeRepo
}: RepositoryPaneProps): React.JSX.Element {
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null)
  const [copiedTemplate, setCopiedTemplate] = useState(false)

  const handleRemoveRepo = (repoId: string) => {
    if (confirmingRemove === repoId) {
      removeRepo(repoId)
      setConfirmingRemove(null)
      return
    }

    setConfirmingRemove(repoId)
  }

  const updateSelectedRepoHookSettings = (
    updates: Partial<Pick<RepoHookSettings, 'setupRunPolicy'>>
  ) => {
    // Why: persisted repos may still carry legacy UI hook fields from the old dual-source
    // design. We preserve them when saving so existing local state stays loadable, but the
    // product now treats `orca.yaml` as the only supported hook definition surface.
    const nextSettings: RepoHookSettings = {
      ...DEFAULT_REPO_HOOK_SETTINGS,
      ...repo.hookSettings,
      ...updates
    }

    updateRepo(repo.id, {
      hookSettings: nextSettings
    })
  }

  const handleCopyTemplate = async () => {
    // Why: the missing-`orca.yaml` state is a migration aid, so copying the shared-template
    // snippet should be one click rather than forcing users to reconstruct the expected shape.
    await window.api.ui.writeClipboardText(`scripts:
  setup: |
    pnpm worktree:setup
  archive: |
    echo "Cleaning up before archive"`)
    setCopiedTemplate(true)
    window.setTimeout(() => setCopiedTemplate(false), 1500)
  }

  const handleClearLegacyHooks = () => {
    // Why: legacy repo-local commands are still honored as a compatibility fallback.
    // Keep them visible and removable here so the settings surface matches runtime behavior.
    updateRepo(repo.id, {
      hookSettings: {
        ...DEFAULT_REPO_HOOK_SETTINGS,
        ...repo.hookSettings,
        scripts: {
          ...DEFAULT_REPO_HOOK_SETTINGS.scripts,
          setup: '',
          archive: ''
        }
      }
    })
  }

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Identity</h2>
            <p className="text-xs text-muted-foreground">
              Repo-specific display details for the sidebar and tabs.
            </p>
          </div>

          <Button
            variant={confirmingRemove === repo.id ? 'destructive' : 'outline'}
            size="sm"
            onClick={() => handleRemoveRepo(repo.id)}
            onBlur={() => setConfirmingRemove(null)}
            className="gap-2"
          >
            <Trash2 className="size-3.5" />
            {confirmingRemove === repo.id ? 'Confirm Remove' : 'Remove Repo'}
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Display Name</Label>
          <Input
            value={repo.displayName}
            onChange={(e) =>
              updateRepo(repo.id, {
                displayName: e.target.value
              })
            }
            className="h-9 text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label>Badge Color</Label>
          <div className="flex flex-wrap gap-2">
            {REPO_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => updateRepo(repo.id, { badgeColor: color })}
                className={`size-7 rounded-full transition-all ${
                  repo.badgeColor === color
                    ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                    : 'hover:ring-1 hover:ring-muted-foreground hover:ring-offset-2 hover:ring-offset-background'
                }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Label>Default Worktree Base</Label>
          <BaseRefPicker
            repoId={repo.id}
            currentBaseRef={repo.worktreeBaseRef}
            onSelect={(ref) => updateRepo(repo.id, { worktreeBaseRef: ref })}
            onUsePrimary={() => updateRepo(repo.id, { worktreeBaseRef: undefined })}
          />
        </div>
      </section>

      <Separator />

      <RepositoryHooksSection
        repo={repo}
        yamlHooks={yamlHooks}
        hasHooksFile={hasHooksFile}
        copiedTemplate={copiedTemplate}
        onCopyTemplate={() => void handleCopyTemplate()}
        onClearLegacyHooks={handleClearLegacyHooks}
        onUpdateSetupRunPolicy={(policy) =>
          updateSelectedRepoHookSettings({ setupRunPolicy: policy as SetupRunPolicy })
        }
      />
    </div>
  )
}
