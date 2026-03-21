import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'
import type { UpdateStatus } from '../shared/types'

let mainWindowRef: BrowserWindow | null = null
let currentStatus: UpdateStatus = { state: 'idle' }

function sendStatus(status: UpdateStatus): void {
  currentStatus = status
  mainWindowRef?.webContents.send('updater:status', status)
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

export function checkForUpdates(): void {
  if (!app.isPackaged || is.dev) {
    sendStatus({ state: 'not-available' })
    return
  }
  sendStatus({ state: 'checking' })
  autoUpdater.checkForUpdates().catch((err) => {
    sendStatus({ state: 'error', message: String(err?.message ?? err) })
  })
}

/** Menu-triggered check that shows native dialogs for feedback */
export function checkForUpdatesFromMenu(): void {
  if (!app.isPackaged || is.dev) {
    dialog.showMessageBox({ type: 'info', message: 'You\u2019re on the latest version.' })
    return
  }

  sendStatus({ state: 'checking' })

  const onAvailable = (): void => {
    cleanup()
  }
  const onNotAvailable = (): void => {
    cleanup()
    dialog.showMessageBox({ type: 'info', message: 'You\u2019re on the latest version.' })
  }
  const onError = (err: Error): void => {
    cleanup()
    dialog.showMessageBox({
      type: 'error',
      title: 'Update Error',
      message: 'Could not check for updates.',
      detail: err?.message
    })
  }

  function cleanup(): void {
    autoUpdater.off('update-available', onAvailable)
    autoUpdater.off('update-not-available', onNotAvailable)
    autoUpdater.off('error', onError)
  }

  autoUpdater.once('update-available', onAvailable)
  autoUpdater.once('update-not-available', onNotAvailable)
  autoUpdater.once('error', onError)

  autoUpdater.checkForUpdates().catch((err) => {
    sendStatus({ state: 'error', message: String(err?.message ?? err) })
    cleanup()
    dialog.showMessageBox({
      type: 'error',
      title: 'Update Error',
      message: 'Could not check for updates.',
      detail: String(err?.message ?? err)
    })
  })
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  if (!app.isPackaged && !is.dev) return
  if (is.dev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Use allowPrerelease to bypass broken /releases/latest endpoint (returns 406)
  // and instead parse the version directly from the atom feed which works reliably.
  // This is safe since we don't publish prerelease versions.
  autoUpdater.allowPrerelease = true

  autoUpdater.on('checking-for-update', () => {
    sendStatus({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    sendStatus({ state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    sendStatus({ state: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({ state: 'downloading', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ state: 'downloaded', version: info.version })
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded. Restart to install.`,
        buttons: ['Restart Now', 'Later']
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
  })

  autoUpdater.on('error', (err) => {
    sendStatus({ state: 'error', message: err?.message ?? 'Unknown error' })
  })

  autoUpdater.checkForUpdatesAndNotify()
}
