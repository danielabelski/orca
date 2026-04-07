import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'
import { reconcileTabOrder } from '../tab-bar/reconcile-order'

export type UnifiedTerminalItem = {
  type: 'terminal' | 'editor'
  id: string
}

type UseTerminalTabsResult = ReturnType<typeof useTerminalTabsInner>

export function useTerminalTabs(): UseTerminalTabsResult {
  return useTerminalTabsInner()
}

function useTerminalTabsInner() {
  const {
    activeWorktreeId,
    activeView,
    worktreesByRepo,
    tabsByWorktree,
    activeTabId,
    createTab,
    closeTab,
    setActiveTab,
    tabBarOrderByWorktree,
    setTabBarOrder,
    setActiveWorktree,
    setTabCustomTitle,
    setTabColor,
    consumeSuppressedPtyExit,
    expandedPaneByTabId,
    workspaceSessionReady,
    openFiles,
    activeFileId,
    activeTabType,
    setActiveTabType,
    setActiveFile,
    closeAllFiles
  } = useAppStore(
    useShallow((s) => ({
      activeWorktreeId: s.activeWorktreeId,
      activeView: s.activeView,
      worktreesByRepo: s.worktreesByRepo,
      tabsByWorktree: s.tabsByWorktree,
      activeTabId: s.activeTabId,
      createTab: s.createTab,
      closeTab: s.closeTab,
      setActiveTab: s.setActiveTab,
      tabBarOrderByWorktree: s.tabBarOrderByWorktree,
      setTabBarOrder: s.setTabBarOrder,
      setActiveWorktree: s.setActiveWorktree,
      setTabCustomTitle: s.setTabCustomTitle,
      setTabColor: s.setTabColor,
      consumeSuppressedPtyExit: s.consumeSuppressedPtyExit,
      expandedPaneByTabId: s.expandedPaneByTabId,
      workspaceSessionReady: s.workspaceSessionReady,
      openFiles: s.openFiles,
      activeFileId: s.activeFileId,
      activeTabType: s.activeTabType,
      setActiveTabType: s.setActiveTabType,
      setActiveFile: s.setActiveFile,
      closeAllFiles: s.closeAllFiles
    }))
  )

  const tabs = activeWorktreeId ? (tabsByWorktree[activeWorktreeId] ?? []) : []
  const allWorktrees = Object.values(worktreesByRepo).flat()
  const worktreeFiles = activeWorktreeId
    ? openFiles.filter((file) => file.worktreeId === activeWorktreeId)
    : []
  const totalTabs = tabs.length + worktreeFiles.length
  const tabBarOrder = activeWorktreeId ? tabBarOrderByWorktree[activeWorktreeId] : undefined

  const unifiedTabs = useMemo<UnifiedTerminalItem[]>(() => {
    const terminalIds = tabs.map((t) => t.id)
    const terminalIdSet = new Set(terminalIds)
    const orderedIds = reconcileTabOrder(
      tabBarOrder,
      terminalIds,
      worktreeFiles.map((f) => f.id)
    )
    return orderedIds.map((id) => ({
      type: (terminalIdSet.has(id) ? 'terminal' : 'editor') as 'terminal' | 'editor',
      id
    }))
  }, [tabs, worktreeFiles, tabBarOrder])

  const [mountedWorktreeIds, setMountedWorktreeIds] = useState<string[]>([])
  const [initialTabCreationGuard, setInitialTabCreationGuard] = useState<string | null>(null)
  const prevActiveWorktreeIdRef = useRef(activeWorktreeId)
  const prevAllWorktreesRef = useRef(allWorktrees)

  // Why: synchronize the keep-alive worktree set during render to avoid a
  // one-frame flash where a newly-activated terminal pane is unmounted.
  if (
    activeWorktreeId !== prevActiveWorktreeIdRef.current ||
    allWorktrees !== prevAllWorktreesRef.current
  ) {
    prevActiveWorktreeIdRef.current = activeWorktreeId
    prevAllWorktreesRef.current = allWorktrees
    setMountedWorktreeIds((current) => {
      const allWorktreeIds = new Set(allWorktrees.map((worktree) => worktree.id))
      const next = current.filter((id) => allWorktreeIds.has(id))
      if (activeWorktreeId && !next.includes(activeWorktreeId)) {
        next.push(activeWorktreeId)
      }
      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current
      }
      return next
    })
  }

  const mountedWorktrees = allWorktrees.filter((worktree) =>
    mountedWorktreeIds.includes(worktree.id)
  )

  useEffect(() => {
    if (tabs.length === 0) {
      return
    }
    if (activeTabId && tabs.some((tab) => tab.id === activeTabId)) {
      return
    }
    setActiveTab(tabs[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabs is derived from tabsByWorktree which is stable via useShallow
  }, [activeTabId, setActiveTab, tabsByWorktree, activeWorktreeId])

  useEffect(() => {
    if (!workspaceSessionReady) {
      return
    }
    if (!activeWorktreeId) {
      setInitialTabCreationGuard(null)
      return
    }
    // Why: skip auto-creation if terminal tabs already exist, or if editor files
    // are open for this worktree. The user may have intentionally closed all
    // terminal tabs while keeping editors open — auto-spawning a terminal would
    // be disruptive.
    if (tabs.length > 0 || worktreeFiles.length > 0) {
      if (initialTabCreationGuard === activeWorktreeId) {
        setInitialTabCreationGuard(null)
      }
      return
    }
    if (initialTabCreationGuard === activeWorktreeId) {
      return
    }

    setInitialTabCreationGuard(activeWorktreeId)
    createTab(activeWorktreeId)
  }, [
    activeWorktreeId,
    createTab,
    initialTabCreationGuard,
    tabs.length,
    worktreeFiles.length,
    workspaceSessionReady
  ])

  const handleNewTab = useCallback(() => {
    if (!activeWorktreeId) {
      return
    }
    const newTab = createTab(activeWorktreeId)
    setActiveTabType('terminal')
    // Why: persist the tab bar order with the new terminal at the end of the
    // current visual order. Without this, reconcileTabOrder falls back to
    // terminals-first when tabBarOrderByWorktree is unset, causing a new
    // terminal to jump to index 0 instead of appending after editor tabs.
    const state = useAppStore.getState()
    const termIds = (state.tabsByWorktree[activeWorktreeId] ?? []).map((t) => t.id)
    const editorIds = state.openFiles
      .filter((f) => f.worktreeId === activeWorktreeId)
      .map((f) => f.id)
    const base = reconcileTabOrder(
      state.tabBarOrderByWorktree[activeWorktreeId],
      termIds,
      editorIds
    )
    // The new tab is already in base via termIds; move it to the end
    const order = base.filter((id) => id !== newTab.id)
    order.push(newTab.id)
    setTabBarOrder(activeWorktreeId, order)
  }, [activeWorktreeId, createTab, setActiveTabType, setTabBarOrder])

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const state = useAppStore.getState()
      const owningWorktreeEntry = Object.entries(state.tabsByWorktree).find(([, worktreeTabs]) =>
        worktreeTabs.some((tab) => tab.id === tabId)
      )
      const owningWorktreeId = owningWorktreeEntry?.[0] ?? null

      if (!owningWorktreeId) {
        return
      }

      const currentTabs = state.tabsByWorktree[owningWorktreeId] ?? []
      if (currentTabs.length <= 1) {
        closeTab(tabId)
        if (state.activeWorktreeId === owningWorktreeId) {
          // Why: only deactivate the worktree when no tabs of any kind remain.
          // Editor files are a separate tab type; closing the last terminal tab
          // should switch to the editor view instead of tearing down the workspace.
          const worktreeFile = state.openFiles.find((f) => f.worktreeId === owningWorktreeId)
          if (worktreeFile) {
            setActiveFile(worktreeFile.id)
            setActiveTabType('editor')
          } else {
            setActiveWorktree(null)
          }
        }
        return
      }

      if (state.activeWorktreeId === owningWorktreeId && tabId === state.activeTabId) {
        const currentIndex = currentTabs.findIndex((tab) => tab.id === tabId)
        const nextTab = currentTabs[currentIndex + 1] ?? currentTabs[currentIndex - 1]
        if (nextTab) {
          setActiveTab(nextTab.id)
        }
      }

      closeTab(tabId)
    },
    [closeTab, setActiveTab, setActiveFile, setActiveTabType, setActiveWorktree]
  )

  const handlePtyExit = useCallback(
    (tabId: string, ptyId: string) => {
      if (consumeSuppressedPtyExit(ptyId)) {
        return
      }
      handleCloseTab(tabId)
    },
    [consumeSuppressedPtyExit, handleCloseTab]
  )

  const handleCloseOthers = useCallback(
    (tabId: string) => {
      if (!activeWorktreeId) {
        return
      }

      const currentTabs = useAppStore.getState().tabsByWorktree[activeWorktreeId] ?? []
      setActiveTab(tabId)
      for (const tab of currentTabs) {
        if (tab.id !== tabId) {
          closeTab(tab.id)
        }
      }
    },
    [activeWorktreeId, closeTab, setActiveTab]
  )

  const handleCloseTabsToRight = useCallback(
    (tabId: string) => {
      if (!activeWorktreeId) {
        return
      }

      const state = useAppStore.getState()
      const currentTerminalTabs = state.tabsByWorktree[activeWorktreeId] ?? []
      const currentEditorFiles = state.openFiles.filter((f) => f.worktreeId === activeWorktreeId)
      const terminalIds = currentTerminalTabs.map((t) => t.id)
      const terminalIdSet = new Set(terminalIds)
      const orderedIds = reconcileTabOrder(
        state.tabBarOrderByWorktree[activeWorktreeId],
        terminalIds,
        currentEditorFiles.map((f) => f.id)
      )

      const index = orderedIds.indexOf(tabId)
      if (index === -1) {
        return
      }
      const rightIds = orderedIds.slice(index + 1)
      for (const id of rightIds) {
        if (terminalIdSet.has(id)) {
          closeTab(id)
        } else {
          useAppStore.getState().closeFile(id)
        }
      }
    },
    [activeWorktreeId, closeTab]
  )

  const handleActivateTab = useCallback(
    (tabId: string) => {
      setActiveTab(tabId)
      setActiveTabType('terminal')
    },
    [setActiveTab, setActiveTabType]
  )

  const handleActivateFile = useCallback(
    (fileId: string) => {
      setActiveFile(fileId)
      setActiveTabType('editor')
    },
    [setActiveFile, setActiveTabType]
  )

  const handleTogglePaneExpand = useCallback(
    (tabId: string) => {
      setActiveTab(tabId)
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent(TOGGLE_TERMINAL_PANE_EXPAND_EVENT, {
            detail: { tabId }
          })
        )
      })
    },
    [setActiveTab]
  )

  return {
    activeWorktreeId,
    activeView,
    tabsByWorktree,
    tabs,
    mountedWorktrees,
    worktreeFiles,
    totalTabs,
    unifiedTabs,
    activeTabId,
    activeFileId,
    activeTabType,
    expandedPaneByTabId,
    tabBarOrder,
    setTabBarOrder,
    setTabCustomTitle,
    setTabColor,
    closeAllFiles,
    handleNewTab,
    handleCloseTab,
    handlePtyExit,
    handleCloseOthers,
    handleCloseTabsToRight,
    handleActivateTab,
    handleActivateFile,
    handleTogglePaneExpand
  }
}
