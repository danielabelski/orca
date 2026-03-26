import React from 'react'
import { Download, FolderPlus, Settings, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

const SidebarToolbar = React.memo(function SidebarToolbar() {
  const addRepo = useAppStore((s) => s.addRepo)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const updateStatus = useAppStore((s) => s.updateStatus)
  const dismissedUpdateVersion = useAppStore((s) => s.dismissedUpdateVersion)
  const dismissUpdate = useAppStore((s) => s.dismissUpdate)

  const updateVersion = 'version' in updateStatus ? updateStatus.version : null
  const showUpdateBanner =
    (updateStatus.state === 'downloaded' ||
      updateStatus.state === 'available' ||
      updateStatus.state === 'downloading') &&
    updateVersion !== dismissedUpdateVersion

  return (
    <div className="mt-auto shrink-0">
      {showUpdateBanner && (
        <button
          onClick={() => {
            if (updateStatus.state === 'downloaded') {
              window.api.updater.quitAndInstall()
            } else if (updateStatus.state === 'available') {
              window.api.updater.download()
            }
          }}
          disabled={updateStatus.state === 'downloading'}
          className="group flex items-center gap-1.5 w-full px-2 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default border-t border-sidebar-border bg-primary/10"
        >
          <Download className="size-3.5 shrink-0" />
          {updateStatus.state === 'downloaded' ? (
            <span>Restart now (update)</span>
          ) : updateStatus.state === 'downloading' ? (
            <span>
              Downloading <span className="font-semibold">v{updateVersion}</span>…{' '}
              {updateStatus.percent}%
            </span>
          ) : (
            <span>
              Update <span className="font-semibold">v{updateStatus.version}</span> available
              — Install
            </span>
          )}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              dismissUpdate()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                dismissUpdate()
              }
            }}
            className="ml-auto shrink-0 p-0.5 rounded text-primary/40 hover:text-primary hover:bg-primary/20 opacity-0 group-hover:opacity-100 transition-all"
            title="Dismiss"
          >
            <X className="size-3" />
          </span>
        </button>
      )}
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-sidebar-border">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => addRepo()}
              className="gap-1.5 text-muted-foreground"
            >
              <FolderPlus className="size-3.5" />
              <span className="text-[11px]">Add Repo</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            Open folder picker to add a repo
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setActiveView('settings')}
              className="text-muted-foreground"
            >
              <Settings className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            Settings
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
})

export default SidebarToolbar
