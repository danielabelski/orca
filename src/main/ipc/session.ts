import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { WorkspaceSessionState } from '../../shared/types'

function broadcastSessionUpdate(sender: Electron.WebContents | null): void {
  // Why: the detached agent-dashboard window mounts its own renderer and needs
  // to observe tabs/terminal title changes written by the main window. Echo the
  // new session state to every other window so the dashboard view stays live.
  // We skip the origin WebContents so the writer does not pay the cost of
  // re-hydrating its own update.
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) {
      continue
    }
    if (sender && win.webContents.id === sender.id) {
      continue
    }
    win.webContents.send('session:updated')
  }
}

export function registerSessionHandlers(store: Store): void {
  ipcMain.handle('session:get', () => {
    return store.getWorkspaceSession()
  })

  ipcMain.handle('session:set', (event, args: WorkspaceSessionState) => {
    store.setWorkspaceSession(args)
    broadcastSessionUpdate(event.sender)
  })

  // Synchronous variant for the renderer's beforeunload handler.
  // sendSync blocks the renderer until this returns, guaranteeing the
  // data (including terminal scrollback buffers) is persisted to disk
  // before the window closes — regardless of before-quit ordering.
  ipcMain.on('session:set-sync', (event, args: WorkspaceSessionState) => {
    store.setWorkspaceSession(args)
    store.flush()
    event.returnValue = true
    broadcastSessionUpdate(event.sender)
  })
}
