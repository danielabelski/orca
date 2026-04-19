/* eslint-disable max-lines -- Why: cross-group drag support requires shared
 * sortable-ID mapping, drop-indicator state, and dual DnD-context switching to
 * live alongside the existing tab-bar ordering logic. Splitting into separate
 * files would fragment the rendering pipeline these pieces must coordinate. */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { FilePlus, Globe, Plus, TerminalSquare } from 'lucide-react'
import type {
  BrowserTab as BrowserTabState,
  TabContentType,
  TerminalTab,
  WorkspaceVisibleTabType
} from '../../../../shared/types'
import { useAppStore } from '../../store'
import { buildStatusMap } from '../right-sidebar/status-display'
import type { OpenFile } from '../../store/slices/editor'
import SortableTab from './SortableTab'
import EditorFileTab from './EditorFileTab'
import BrowserTab, { getBrowserTabLabel } from './BrowserTab'
import { reconcileTabOrder } from './reconcile-order'
import type { DropIndicator } from './drop-indicator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { getEditorDisplayLabel } from '../editor/editor-labels'
import {
  buildGroupDropId,
  buildSharedSortableId,
  useCrossGroupDragState,
  useIsCrossGroupDndPresent
} from '../tab-group/CrossGroupDragContext'

const isMac = navigator.userAgent.includes('Mac')
const NEW_TERMINAL_SHORTCUT = isMac ? '⌘T' : 'Ctrl+T'
const NEW_BROWSER_SHORTCUT = isMac ? '⌘⇧B' : 'Ctrl+Shift+B'
// Why: main moved the New Markdown shortcut to ⌘⇧M to avoid clashing with the
// OS-level "new window" chord. Keep that binding even as cross-group DnD lands.
const NEW_FILE_SHORTCUT = isMac ? '⌘⇧M' : 'Ctrl+Shift+M'

type TabBarProps = {
  tabs: TerminalTab[]
  activeTabId: string | null
  worktreeId: string
  expandedPaneByTabId: Record<string, boolean>
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onCloseOthers: (tabId: string) => void
  onCloseToRight: (tabId: string) => void
  onReorder: (worktreeId: string, order: string[]) => void
  onNewTerminalTab: () => void
  onNewBrowserTab: () => void
  onNewFileTab?: () => void
  onSetCustomTitle: (tabId: string, title: string | null) => void
  onSetTabColor: (tabId: string, color: string | null) => void
  onTogglePaneExpand: (tabId: string) => void
  editorFiles?: (OpenFile & { tabId?: string })[]
  browserTabs?: BrowserTabState[]
  activeFileId?: string | null
  activeBrowserTabId?: string | null
  activeTabType?: WorkspaceVisibleTabType
  onActivateFile?: (fileId: string) => void
  onCloseFile?: (fileId: string) => void
  onActivateBrowserTab?: (tabId: string) => void
  onCloseBrowserTab?: (tabId: string) => void
  onCloseAllFiles?: () => void
  onPinFile?: (fileId: string, tabId?: string) => void
  tabBarOrder?: string[]
  groupId?: string
  unifiedTabIdByVisibleId?: Record<string, string>
  onCreateSplitGroup?: (
    direction: 'left' | 'right' | 'up' | 'down',
    sourceVisibleTabId?: string
  ) => void
}

type TabItem =
  | {
      type: 'terminal'
      visibleId: string
      unifiedTabId: string
      sortableId: string
      data: TerminalTab
    }
  | {
      type: 'editor'
      visibleId: string
      unifiedTabId: string
      sortableId: string
      data: OpenFile & { tabId?: string }
    }
  | {
      type: 'browser'
      visibleId: string
      unifiedTabId: string
      sortableId: string
      data: BrowserTabState
    }

function getEditorDragContentType(
  file: OpenFile & { tabId?: string }
): 'editor' | 'diff' | 'conflict-review' {
  return file.mode === 'diff'
    ? 'diff'
    : file.mode === 'conflict-review'
      ? 'conflict-review'
      : 'editor'
}

function TabBarInner({
  tabs,
  activeTabId,
  worktreeId,
  expandedPaneByTabId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onReorder,
  onNewTerminalTab,
  onNewBrowserTab,
  onNewFileTab,
  onSetCustomTitle,
  onSetTabColor,
  onTogglePaneExpand,
  editorFiles,
  browserTabs,
  activeFileId,
  activeBrowserTabId,
  activeTabType,
  onActivateFile,
  onCloseFile,
  onActivateBrowserTab,
  onCloseBrowserTab,
  onCloseAllFiles,
  onPinFile,
  tabBarOrder,
  groupId,
  unifiedTabIdByVisibleId,
  onCreateSplitGroup
}: TabBarProps): React.JSX.Element {
  const isSharedDnd = useIsCrossGroupDndPresent() && Boolean(groupId)
  const dragState = useCrossGroupDragState()
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    })
  )
  const { setNodeRef: setGroupDropNodeRef } = useDroppable({
    id: buildGroupDropId(groupId ?? `legacy-${worktreeId}`),
    disabled: !isSharedDnd
  })

  const gitStatusByWorktree = useAppStore((s) => s.gitStatusByWorktree)
  const statusByRelativePath = useMemo(
    () => buildStatusMap(gitStatusByWorktree[worktreeId] ?? []),
    [worktreeId, gitStatusByWorktree]
  )

  const terminalMap = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs])
  const editorMap = useMemo(
    () => new Map((editorFiles ?? []).map((f) => [f.tabId ?? f.id, f])),
    [editorFiles]
  )
  const browserMap = useMemo(
    () => new Map((browserTabs ?? []).map((t) => [t.id, t])),
    [browserTabs]
  )

  const terminalIds = useMemo(() => tabs.map((t) => t.id), [tabs])
  const editorFileIds = useMemo(() => editorFiles?.map((f) => f.tabId ?? f.id) ?? [], [editorFiles])
  const browserTabIds = useMemo(() => browserTabs?.map((tab) => tab.id) ?? [], [browserTabs])

  // Build the unified ordered list, reconciling stored order with current items
  const orderedItems = useMemo(() => {
    const ids = reconcileTabOrder(tabBarOrder, terminalIds, editorFileIds, browserTabIds)
    const items: TabItem[] = []
    for (const id of ids) {
      const terminal = terminalMap.get(id)
      if (terminal) {
        items.push({
          type: 'terminal',
          visibleId: id,
          unifiedTabId: unifiedTabIdByVisibleId?.[id] ?? id,
          sortableId: isSharedDnd && groupId ? buildSharedSortableId(groupId, id) : id,
          data: terminal
        })
        continue
      }
      const file = editorMap.get(id)
      if (file) {
        items.push({
          type: 'editor',
          visibleId: id,
          unifiedTabId: unifiedTabIdByVisibleId?.[id] ?? file.tabId ?? file.id,
          sortableId: isSharedDnd && groupId ? buildSharedSortableId(groupId, id) : id,
          data: file
        })
        continue
      }
      const browserTab = browserMap.get(id)
      if (browserTab) {
        items.push({
          type: 'browser',
          visibleId: id,
          unifiedTabId: unifiedTabIdByVisibleId?.[id] ?? id,
          sortableId: isSharedDnd && groupId ? buildSharedSortableId(groupId, id) : id,
          data: browserTab
        })
      }
    }
    return items
  }, [
    browserMap,
    browserTabIds,
    editorFileIds,
    editorMap,
    groupId,
    isSharedDnd,
    tabBarOrder,
    terminalIds,
    terminalMap,
    unifiedTabIdByVisibleId
  ])

  const sortableIds = useMemo(() => orderedItems.map((item) => item.sortableId), [orderedItems])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) {
        return
      }

      const oldIndex = sortableIds.indexOf(active.id as string)
      const newIndex = sortableIds.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) {
        return
      }

      const newOrder = arrayMove(sortableIds, oldIndex, newIndex)
      onReorder(worktreeId, newOrder)
    },
    [sortableIds, worktreeId, onReorder]
  )

  // Why: VS Code marks both adjacent tabs at the insertion point — the left
  // tab gets a right-edge indicator and the right tab gets a left-edge
  // indicator — so the two pseudo-elements form one continuous vertical line
  // between them. This mirrors that pattern for visual clarity.
  const dropIndicatorByVisibleId = useMemo(() => {
    const indicators = new Map<string, DropIndicator>()
    if (
      !isSharedDnd ||
      dragState.activeTab == null ||
      dragState.overGroupId !== groupId ||
      dragState.overTabBarIndex == null ||
      orderedItems.length === 0
    ) {
      return indicators
    }

    const insertionIndex = Math.max(0, Math.min(dragState.overTabBarIndex, orderedItems.length))
    if (insertionIndex > 0) {
      indicators.set(orderedItems[insertionIndex - 1]!.visibleId, 'right')
    }
    if (insertionIndex < orderedItems.length) {
      indicators.set(orderedItems[insertionIndex]!.visibleId, 'left')
    }
    return indicators
  }, [
    dragState.activeTab,
    dragState.overGroupId,
    dragState.overTabBarIndex,
    groupId,
    isSharedDnd,
    orderedItems
  ])

  const focusTerminalTabSurface = useCallback((tabId: string) => {
    // Why: creating a terminal from the "+" menu is a two-step focus race:
    // React must first mount the new TerminalPane/xterm, then Radix closes the
    // menu. Even after suppressing trigger focus restore, the terminal's hidden
    // textarea may not exist until the next paint. Double-rAF waits for that
    // commit so the new tab, not the "+" button, ends up owning keyboard focus.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scoped = document.querySelector(
          `[data-terminal-tab-id="${tabId}"] .xterm-helper-textarea`
        ) as HTMLElement | null
        if (scoped) {
          scoped.focus()
          return
        }
        const fallback = document.querySelector('.xterm-helper-textarea') as HTMLElement | null
        fallback?.focus()
      })
    })
  }, [])

  // Horizontal wheel scrolling for the tab strip
  const tabStripRef = useRef<HTMLDivElement>(null)
  // Why: auto-scroll-to-end bookkeeping from main. `prevStripLenRef` tracks the
  // previous strip length per worktree so we only auto-scroll when a tab was
  // genuinely added (not on worktree switches); `stickToEndRef` captures the
  // "user is parked at the right edge" state so label-width growth (e.g.
  // "Terminal 5" → branch name) keeps the close button visible.
  const prevStripLenRef = useRef<{ worktreeId: string; len: number } | null>(null)
  const stickToEndRef = useRef(false)

  useEffect(() => {
    const el = tabStripRef.current
    if (!el) {
      return
    }
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const el = tabStripRef.current
    if (!el) {
      return
    }
    const isAtEnd = (): boolean => {
      const max = Math.max(0, el.scrollWidth - el.clientWidth)
      return el.scrollLeft >= max - 2
    }
    const onScroll = (): void => {
      // Only keep sticking while the user hasn't intentionally scrolled away.
      stickToEndRef.current = isAtEnd()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // Seed based on initial position.
    onScroll()

    const ro = new ResizeObserver(() => {
      // If the user is pinned to the right edge, keep it pinned even as tab
      // labels (e.g. \"Terminal 5\" → branch name) expand and change scrollWidth.
      if (!stickToEndRef.current) {
        return
      }
      el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
    })
    ro.observe(el)

    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  // Why: new and reopened tabs are appended to the right; without this the strip
  // keeps its scroll offset and the active tab can sit off-screen until the user
  // drags the tab bar horizontally.
  useLayoutEffect(() => {
    const strip = tabStripRef.current
    const len = orderedItems.length
    const prev = prevStripLenRef.current
    if (!strip) {
      prevStripLenRef.current = { worktreeId, len }
      return
    }
    if (!prev || prev.worktreeId !== worktreeId) {
      prevStripLenRef.current = { worktreeId, len }
      return
    }
    // If the user is pinned to the right edge, keep the close button visible
    // even when tab labels change length (e.g. "Terminal 5" → branch name).
    // Why: label changes don't necessarily change the strip element's own size,
    // so ResizeObserver won't fire; this effect runs on rerenders instead.
    if (stickToEndRef.current) {
      const scrollToEnd = (): void => {
        const el = tabStripRef.current
        if (!el) {
          return
        }
        el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
      }
      scrollToEnd()
      requestAnimationFrame(scrollToEnd)
    }
    if (len > prev.len) {
      const scrollToEnd = (): void => {
        const el = tabStripRef.current
        if (!el) {
          return
        }
        el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
        stickToEndRef.current = true
      }
      scrollToEnd()
      requestAnimationFrame(scrollToEnd)
    }
    prevStripLenRef.current = { worktreeId, len }
  }, [orderedItems, worktreeId])

  // Why: composed ref. `useDroppable` needs the DOM node so the group's drop
  // target registers with dnd-kit, while the wheel / ResizeObserver / auto-
  // scroll-to-end effects above read `tabStripRef.current` directly. Writing to
  // both from a single callback ref keeps main's scroll behavior working under
  // THEIRS' cross-group drag abstractions without duplicating the node.
  const setTabStripNode = useCallback(
    (node: HTMLDivElement | null) => {
      tabStripRef.current = node
      setGroupDropNodeRef(node)
    },
    [setGroupDropNodeRef]
  )

  const getDragData = useCallback(
    <TContentType extends TabContentType>(
      item: TabItem,
      contentType: TContentType,
      label: string
    ):
      | {
          sourceGroupId: string
          unifiedTabId: string
          visibleId: string
          contentType: TContentType
          worktreeId: string
          label: string
        }
      | undefined => {
      if (!isSharedDnd || !groupId) {
        return undefined
      }
      return {
        sourceGroupId: groupId,
        unifiedTabId: item.unifiedTabId,
        visibleId: item.visibleId,
        contentType,
        worktreeId,
        label
      }
    },
    [groupId, isSharedDnd, worktreeId]
  )

  const tabStrip = (
    <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
      {/* Why: no-drag lets tab interactions work inside the titlebar's drag
          region. The outer container inherits drag so empty space after the
          "+" button remains window-draggable. */}
      <div
        ref={setTabStripNode}
        className="terminal-tab-strip flex flex-1 min-w-0 items-stretch overflow-x-auto overflow-y-hidden"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {orderedItems.map((item, index) => {
          const dropIndicator = dropIndicatorByVisibleId.get(item.visibleId) ?? null
          if (item.type === 'terminal') {
            return (
              <SortableTab
                key={item.visibleId}
                tab={item.data}
                groupId={groupId}
                unifiedTabId={item.unifiedTabId}
                sortableId={item.sortableId}
                dragData={getDragData(item, 'terminal', item.data.customTitle ?? item.data.title)}
                dropIndicator={dropIndicator}
                sharedDragMode={isSharedDnd}
                tabCount={tabs.length}
                hasTabsToRight={index < orderedItems.length - 1}
                isActive={activeTabType === 'terminal' && item.visibleId === activeTabId}
                isExpanded={expandedPaneByTabId[item.visibleId] === true}
                onActivate={onActivate}
                onClose={onClose}
                onCloseOthers={onCloseOthers}
                onCloseToRight={onCloseToRight}
                onSetCustomTitle={onSetCustomTitle}
                onSetTabColor={onSetTabColor}
                onToggleExpand={onTogglePaneExpand}
                onSplitGroup={(direction, sourceVisibleTabId) =>
                  onCreateSplitGroup?.(direction, sourceVisibleTabId)
                }
              />
            )
          }
          if (item.type === 'browser') {
            return (
              <BrowserTab
                key={item.visibleId}
                tab={item.data}
                groupId={groupId}
                unifiedTabId={item.unifiedTabId}
                sortableId={item.sortableId}
                dragData={getDragData(item, 'browser', getBrowserTabLabel(item.data))}
                dropIndicator={dropIndicator}
                sharedDragMode={isSharedDnd}
                isActive={activeTabType === 'browser' && activeBrowserTabId === item.visibleId}
                hasTabsToRight={index < orderedItems.length - 1}
                onActivate={() => onActivateBrowserTab?.(item.visibleId)}
                onClose={() => onCloseBrowserTab?.(item.visibleId)}
                onCloseToRight={() => onCloseToRight(item.visibleId)}
                onSplitGroup={(direction, sourceVisibleTabId) =>
                  onCreateSplitGroup?.(direction, sourceVisibleTabId)
                }
              />
            )
          }
          return (
            <EditorFileTab
              key={item.visibleId}
              file={item.data}
              groupId={groupId}
              unifiedTabId={item.unifiedTabId}
              sortableId={item.sortableId}
              dragData={getDragData(
                item,
                getEditorDragContentType(item.data),
                getEditorDisplayLabel(item.data)
              )}
              dropIndicator={dropIndicator}
              sharedDragMode={isSharedDnd}
              isActive={activeTabType === 'editor' && activeFileId === item.visibleId}
              hasTabsToRight={index < orderedItems.length - 1}
              statusByRelativePath={statusByRelativePath}
              onActivate={() => onActivateFile?.(item.visibleId)}
              onClose={() => onCloseFile?.(item.visibleId)}
              onCloseToRight={() => onCloseToRight(item.visibleId)}
              onCloseAll={() => onCloseAllFiles?.()}
              onPin={() => onPinFile?.(item.data.id, item.data.tabId)}
              onSplitGroup={(direction, sourceVisibleTabId) =>
                onCreateSplitGroup?.(direction, sourceVisibleTabId)
              }
            />
          )
        })}
      </div>
    </SortableContext>
  )

  return (
    <div
      className="flex items-stretch h-full overflow-hidden flex-1 min-w-0"
      // Why: only drops aimed at the top tab/session strip should open files in
      // Orca's editor. Terminal-pane drops need to keep inserting file paths
      // into the active coding CLI, so preload routes native OS drops based on
      // this explicit surface marker instead of treating the whole app as an
      // editor drop zone.
      data-native-file-drop-target="editor"
    >
      {isSharedDnd ? (
        tabStrip
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          {tabStrip}
        </DndContext>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="ml-2 my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title="New tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="min-w-[11rem] rounded-[11px] border-border/80 p-1 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
          onCloseAutoFocus={(e) => {
            // Why: selecting "New Terminal" activates a freshly-mounted xterm on
            // the next frame. Radix's default focus restore sends focus back to
            // the "+" trigger after close, which steals it from the new tab and
            // makes the terminal look unfocused until the user clicks again.
            e.preventDefault()
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              onNewTerminalTab()
              const newActiveTabId = useAppStore.getState().activeTabId
              if (newActiveTabId) {
                focusTerminalTabSurface(newActiveTabId)
              }
            }}
            className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
          >
            <TerminalSquare className="size-4 text-muted-foreground" />
            New Terminal
            <DropdownMenuShortcut>{NEW_TERMINAL_SHORTCUT}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onNewBrowserTab}
            className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
          >
            <Globe className="size-4 text-muted-foreground" />
            New Browser Tab
            <DropdownMenuShortcut>{NEW_BROWSER_SHORTCUT}</DropdownMenuShortcut>
          </DropdownMenuItem>
          {onNewFileTab && (
            <DropdownMenuItem
              onSelect={onNewFileTab}
              className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
            >
              <FilePlus className="size-4 text-muted-foreground" />
              New Markdown
              <DropdownMenuShortcut>{NEW_FILE_SHORTCUT}</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default React.memo(TabBarInner)
