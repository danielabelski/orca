import { BrowserWindow, ipcMain } from 'electron'
import * as pty from 'node-pty'

let ptyCounter = 0
const ptyProcesses = new Map<string, pty.IPty>()

export function registerPtyHandlers(mainWindow: BrowserWindow): void {
  // Kill orphaned PTY processes when the renderer reloads
  mainWindow.webContents.on('did-finish-load', () => {
    killAllPty()
  })

  ipcMain.handle('pty:spawn', (_event, args: { cols: number; rows: number; cwd?: string }) => {
    const id = String(++ptyCounter)
    const shellPath = process.env.SHELL || '/bin/zsh'
    const shellArgs = process.platform === 'win32' ? [] : ['-l']

    const ptyProcess = pty.spawn(shellPath, shellArgs, {
      name: 'xterm-256color',
      cols: args.cols,
      rows: args.rows,
      cwd: args.cwd || process.env.HOME || '/',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      } as Record<string, string>
    })

    ptyProcesses.set(id, ptyProcess)

    ptyProcess.onData((data) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:data', { id, data })
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      ptyProcesses.delete(id)
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:exit', { id, code: exitCode })
      }
    })

    return { id }
  })

  ipcMain.on('pty:write', (_event, args: { id: string; data: string }) => {
    const proc = ptyProcesses.get(args.id)
    if (proc) {
      proc.write(args.data)
    }
  })

  ipcMain.handle('pty:resize', (_event, args: { id: string; cols: number; rows: number }) => {
    const proc = ptyProcesses.get(args.id)
    if (proc) {
      proc.resize(args.cols, args.rows)
    }
  })

  ipcMain.handle('pty:kill', (_event, args: { id: string }) => {
    const proc = ptyProcesses.get(args.id)
    if (proc) {
      try {
        proc.kill()
      } catch {
        // Process may already be dead
      }
      ptyProcesses.delete(args.id)
    }
  })
}

/**
 * Kill all PTY processes. Call on app quit.
 */
export function killAllPty(): void {
  for (const [id, proc] of ptyProcesses) {
    proc.kill()
    ptyProcesses.delete(id)
  }
}
