import { app, BrowserWindow, ipcMain, webContents as electronWebContents } from 'electron'
import type { Store } from '../persistence'
import type { PersistedUIState } from '../../shared/types'
import { openAgentDashboardWindow } from '../window/createAgentDashboardWindow'

export function registerUIHandlers(store: Store, mainWebContentsId: number | null = null): void {
  ipcMain.handle('ui:get', () => {
    return store.getUI()
  })

  ipcMain.handle('ui:set', (_event, args: Partial<PersistedUIState>) => {
    store.updateUI(args)
  })

  ipcMain.handle('ui:openAgentDashboard', () => {
    console.log('[ui] ui:openAgentDashboard handler invoked')
    try {
      openAgentDashboardWindow(store)
    } catch (error) {
      console.error('[ui] openAgentDashboardWindow threw', error)
      throw error
    }
  })

  // Why: the detached dashboard window has its own renderer store, so simply
  // calling setActiveWorktree there does not switch the user's view in the
  // main window. Route the request through main so the main window's
  // renderer receives the existing ui:activateWorktree event — the same path
  // used by CLI-created worktrees and notification clicks.
  ipcMain.handle(
    'ui:requestActivateWorktree',
    (_event, args: { repoId: string; worktreeId: string }) => {
      if (mainWebContentsId == null) {
        return
      }
      const wc = electronWebContents.fromId(mainWebContentsId)
      if (!wc || wc.isDestroyed()) {
        return
      }
      const main = BrowserWindow.fromWebContents(wc)
      if (!main || main.isDestroyed()) {
        return
      }
      if (process.platform === 'darwin') {
        app.focus({ steal: true })
      }
      if (main.isMinimized()) {
        main.restore()
      }
      main.focus()
      wc.send('ui:activateWorktree', {
        repoId: args.repoId,
        worktreeId: args.worktreeId
      })
    }
  )
}
