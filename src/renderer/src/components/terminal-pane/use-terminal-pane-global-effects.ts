import { useEffect, useRef } from 'react'
import { TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import { fitAndFocusPanes, fitPanes, shellEscapePath } from './pane-helpers'

type UseTerminalPaneGlobalEffectsArgs = {
  tabId: string
  isActive: boolean
  managerRef: React.RefObject<PaneManager | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  pendingWritesRef: React.RefObject<Map<number, string>>
  paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
  isActiveRef: React.RefObject<boolean>
  toggleExpandPane: (paneId: number) => void
}

export function useTerminalPaneGlobalEffects({
  tabId,
  isActive,
  managerRef,
  containerRef,
  pendingWritesRef,
  paneTransportsRef,
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
    if (!isActive) {
      return
    }
    return window.api.ui.onFileDrop(({ path: filePath }) => {
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
      transport.sendInput(shellEscapePath(filePath))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])
}
