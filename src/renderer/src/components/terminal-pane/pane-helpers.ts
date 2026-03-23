import type { PaneManager } from '@/lib/pane-manager/pane-manager'

export function fitPanes(manager: PaneManager): void {
  for (const pane of manager.getPanes()) {
    try {
      pane.fitAddon.fit()
    } catch {
      /* ignore */
    }
  }
}

export function focusActivePane(manager: PaneManager): void {
  const panes = manager.getPanes()
  const activePane = manager.getActivePane() ?? panes[0]
  activePane?.terminal.focus()
}

export function fitAndFocusPanes(manager: PaneManager): void {
  fitPanes(manager)
  focusActivePane(manager)
}

export function shellEscapePath(path: string): string {
  if (/^[a-zA-Z0-9_./@:-]+$/.test(path)) {
    return path
  }
  return `'${path.replace(/'/g, "'\\''")}'`
}
