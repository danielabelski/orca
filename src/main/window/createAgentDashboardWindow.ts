import { BrowserWindow, nativeTheme, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'
import devIcon from '../../../resources/icon-dev.png?asset'
import type { Store } from '../persistence'
import { normalizeExternalBrowserUrl } from '../../shared/browser-url'

const DEFAULT_WIDTH = 520
const DEFAULT_HEIGHT = 640

// Why: the detached dashboard is a secondary window that renders just the
// AgentDashboard component. We key its renderer route with a query param so
// the same main.tsx entry decides whether to mount the full app or the
// lightweight dashboard view.
const DASHBOARD_VIEW_PARAM = 'view=agent-dashboard'

let dashboardWindow: BrowserWindow | null = null

function computeDefaultBounds(): { width: number; height: number } {
  try {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    return {
      width: Math.min(DEFAULT_WIDTH, width),
      height: Math.min(DEFAULT_HEIGHT, height)
    }
  } catch {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  }
}

// Why: on some platforms/timings `ready-to-show` never fires (e.g. if the
// renderer hits a runtime error before first paint). Without a fallback the
// window stays hidden forever and the user just sees nothing happen when they
// click the popout button. Force-show after a short grace period.
const READY_TO_SHOW_TIMEOUT_MS = 3000

function isBoundsOnScreen(bounds: {
  x: number
  y: number
  width: number
  height: number
}): boolean {
  try {
    const displays = screen.getAllDisplays()
    return displays.some((d) => {
      const wa = d.workArea
      return (
        bounds.x + bounds.width > wa.x &&
        bounds.x < wa.x + wa.width &&
        bounds.y + bounds.height > wa.y &&
        bounds.y < wa.y + wa.height
      )
    })
  } catch {
    return true
  }
}

export function openAgentDashboardWindow(store: Store | null): BrowserWindow {
  console.log('[dashboard-window] openAgentDashboardWindow invoked')
  // Why: singleton — a second invocation focuses the existing window instead
  // of spawning duplicates. Multiple dashboard windows would subscribe to the
  // same IPC events and compete for the same bounds-persistence slot.
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    console.log('[dashboard-window] focusing existing window')
    if (dashboardWindow.isMinimized()) {
      dashboardWindow.restore()
    }
    dashboardWindow.focus()
    return dashboardWindow
  }

  const rawSavedBounds = store?.getUI().agentDashboardWindowBounds ?? null
  // Why: if the display that hosted the window last time is no longer present
  // (external monitor unplugged), restoring its coordinates would place the
  // window offscreen so it looks like the popout silently failed.
  const savedBounds = rawSavedBounds && isBoundsOnScreen(rawSavedBounds) ? rawSavedBounds : null
  if (rawSavedBounds && !savedBounds) {
    console.log('[dashboard-window] discarding offscreen saved bounds', rawSavedBounds)
  }
  const defaultBounds = computeDefaultBounds()

  const win = new BrowserWindow({
    width: savedBounds?.width ?? defaultBounds.width,
    height: savedBounds?.height ?? defaultBounds.height,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 360,
    minHeight: 360,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    title: 'Agent Dashboard',
    icon: is.dev ? devIcon : icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  let shown = false
  const revealWindow = (reason: string): void => {
    if (shown || win.isDestroyed()) {
      return
    }
    shown = true
    console.log(`[dashboard-window] showing window (reason=${reason})`)
    win.show()
  }
  win.once('ready-to-show', () => revealWindow('ready-to-show'))
  const readyFallback = setTimeout(() => revealWindow('timeout-fallback'), READY_TO_SHOW_TIMEOUT_MS)
  win.webContents.once('did-finish-load', () => {
    console.log('[dashboard-window] did-finish-load')
    revealWindow('did-finish-load')
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[dashboard-window] did-fail-load', { code, description, url })
    revealWindow('did-fail-load')
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[dashboard-window] render-process-gone', details)
  })
  win.webContents.on('console-message', (details) => {
    console.log(
      `[dashboard-window][renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`
    )
  })

  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const saveBounds = (): void => {
    if (boundsTimer) {
      clearTimeout(boundsTimer)
    }
    boundsTimer = setTimeout(() => {
      boundsTimer = null
      if (win.isDestroyed()) {
        return
      }
      store?.updateUI({ agentDashboardWindowBounds: win.getBounds() })
    }, 500)
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  // Why: external links clicked in the dashboard (e.g. a future "open PR"
  // action) must escape into the OS browser, never open as a child window
  // that would inherit the preload bridge.
  win.webContents.setWindowOpenHandler((details) => {
    const externalUrl = normalizeExternalBrowserUrl(details.url)
    if (externalUrl) {
      shell.openExternal(externalUrl)
    }
    return { action: 'deny' }
  })

  win.on('closed', () => {
    if (boundsTimer) {
      clearTimeout(boundsTimer)
      boundsTimer = null
    }
    clearTimeout(readyFallback)
    if (dashboardWindow === win) {
      dashboardWindow = null
    }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const url = `${process.env.ELECTRON_RENDERER_URL}?${DASHBOARD_VIEW_PARAM}`
    console.log('[dashboard-window] loading dev URL', url)
    win.loadURL(url).catch((err) => {
      console.error('[dashboard-window] loadURL failed', err)
    })
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    console.log('[dashboard-window] loading prod file', htmlPath)
    win.loadFile(htmlPath, { search: DASHBOARD_VIEW_PARAM }).catch((err) => {
      console.error('[dashboard-window] loadFile failed', err)
    })
  }

  dashboardWindow = win
  return win
}
