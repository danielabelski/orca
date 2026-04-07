import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'

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

  // Build unified tab list respecting stored tab bar order
  const unifiedTabs = useMemo<UnifiedTerminalItem[]>(() => {
    const terminalIdSet = new Set(tabs.map((t) => t.id))
    const editorIdSet = new Set(worktreeFiles.map((f) => f.id))
    const validIds = new Set([...terminalIdSet, ...editorIdSet])
    const orderedIds: string[] = (tabBarOrder ?? []).filter((id) => validIds.has(id))
    const inOrder = new Set(orderedIds)
    for (const t of tabs) {
      if (!inOrder.has(t.id)) {
        orderedIds.push(t.id)
      }
    }
    for (const f of worktreeFiles) {
      if (!inOrder.has(f.id)) {
        orderedIds.push(f.id)
      }
    }
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
    if (tabs.length > 0) {
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
  }, [activeWorktreeId, createTab, initialTabCreationGuard, tabs.length, workspaceSessionReady])

  const handleNewTab = useCallback(() => {
    if (!activeWorktreeId) {
      return
    }
    createTab(activeWorktreeId)
  }, [activeWorktreeId, createTab])

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
          setActiveWorktree(null)
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
    [closeTab, setActiveTab, setActiveWorktree]
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
      const terminalIdSet = new Set(currentTerminalTabs.map((t) => t.id))
      const editorIdSet = new Set(currentEditorFiles.map((f) => f.id))
      const storedOrder = state.tabBarOrderByWorktree[activeWorktreeId]

      // Build unified order (same reconciliation as TabBar)
      const validIds = new Set([...terminalIdSet, ...editorIdSet])
      const orderedIds: string[] = (storedOrder ?? []).filter((id) => validIds.has(id))
      const inOrder = new Set(orderedIds)
      for (const t of currentTerminalTabs) {
        if (!inOrder.has(t.id)) {
          orderedIds.push(t.id)
        }
      }
      for (const f of currentEditorFiles) {
        if (!inOrder.has(f.id)) {
          orderedIds.push(f.id)
        }
      }

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
