import { useEffect, useRef } from 'react'
import { TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { shellEscapePath } from './pane-helpers'
import { fitAndFocusPanes, fitPanes } from './pane-helpers'
import type { PtyTransport } from './pty-transport'

type UseTerminalPaneGlobalEffectsArgs = {
  tabId: string
  isActive: boolean
  managerRef: React.RefObject<PaneManager | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
  pendingWritesRef: React.RefObject<Map<number, string>>
  isActiveRef: React.RefObject<boolean>
  toggleExpandPane: (paneId: number) => void
}

export function useTerminalPaneGlobalEffects({
  tabId,
  isActive,
  managerRef,
  containerRef,
  paneTransportsRef,
  pendingWritesRef,
  isActiveRef,
  toggleExpandPane
}: UseTerminalPaneGlobalEffectsArgs): void {
  const wasActiveRef = useRef(false)

  useEffect(() => {
    const manager = managerRef.current
    if (!manager) {
      return
    }
    if (isActive) {
      manager.resumeRendering()
      for (const [paneId, pendingBuffer] of pendingWritesRef.current.entries()) {
        if (pendingBuffer.length > 0) {
          const pane = manager.getPanes().find((existingPane) => existingPane.id === paneId)
          if (pane) {
            pane.terminal.write(pendingBuffer)
          }
          pendingWritesRef.current.set(paneId, '')
        }
      }
      requestAnimationFrame(() => fitAndFocusPanes(manager))
    } else if (wasActiveRef.current) {
      manager.suspendRendering()
    }
    wasActiveRef.current = isActive
    isActiveRef.current = isActive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  useEffect(() => {
    const onToggleExpand = (event: Event): void => {
      const detail = (event as CustomEvent<{ tabId?: string }>).detail
      if (!detail?.tabId || detail.tabId !== tabId) {
        return
      }
      const manager = managerRef.current
      if (!manager) {
        return
      }
      const panes = manager.getPanes()
      if (panes.length < 2) {
        return
      }
      const pane = manager.getActivePane() ?? panes[0]
      if (!pane) {
        return
      }
      toggleExpandPane(pane.id)
    }
    window.addEventListener(TOGGLE_TERMINAL_PANE_EXPAND_EVENT, onToggleExpand)
    return () => window.removeEventListener(TOGGLE_TERMINAL_PANE_EXPAND_EVENT, onToggleExpand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  useEffect(() => {
    if (!isActive) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }
    const resizeObserver = new ResizeObserver(() => {
      const manager = managerRef.current
      if (!manager) {
        return
      }
      fitPanes(manager)
    })
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  useEffect(() => {
    return window.api.ui.onFileDrop(({ path, target }) => {
      if (!isActiveRef.current || target !== 'terminal') {
        return
      }
      const manager = managerRef.current
      if (!manager) {
        return
      }
      const pane = manager.getActivePane() ?? manager.getPanes()[0]
      if (!pane) {
        return
      }
      const transport = paneTransportsRef.current.get(pane.id)
      if (!transport) {
        return
      }
      // Why: preload consumes native OS drops before React sees them, so the
      // terminal cannot rely on DOM `drop` events for external files. Reusing
      // the active PTY transport preserves the existing CLI behavior for drag-
      // and-drop path insertion instead of opening those files in the editor.
      // Why: the main process sends one IPC event per dropped file, so
      // appending a trailing space keeps multiple paths separated in the
      // terminal input, matching standard drag-and-drop UX conventions.
      transport.sendInput(`${shellEscapePath(path)} `)
    })
  }, [isActiveRef, managerRef, paneTransportsRef])
}
