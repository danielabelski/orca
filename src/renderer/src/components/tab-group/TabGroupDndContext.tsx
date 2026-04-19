import { useCallback, useMemo, useRef, useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { FileCode, Globe, TerminalSquare } from 'lucide-react'
import type { Tab } from '../../../../shared/types'
import { useAppStore } from '../../store'
import {
  buildSharedSortableId,
  CrossGroupDndContextPresent,
  CrossGroupDragStateContext,
  parseGroupDropId,
  parseSharedSortableId,
  type CrossGroupDragState,
  type TabDragData
} from './CrossGroupDragContext'

type GroupVisibleTab = {
  unifiedTabId: string
  visibleId: string
}

function pointInRect(point: { x: number; y: number }, rect?: ClientRect | null): boolean {
  if (!rect) {
    return false
  }
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  )
}

function makeCollision(containerId: string, args: Parameters<CollisionDetection>[0]): Collision[] {
  const container = args.droppableContainers.find(
    (candidate) => String(candidate.id) === containerId
  )
  return container ? [{ id: container.id, data: { droppableContainer: container, value: 1 } }] : []
}

function toVisibleTabId(tab: Tab): string {
  return tab.contentType === 'terminal' || tab.contentType === 'browser' ? tab.entityId : tab.id
}

function computeInsertionIndex(
  orderedTabs: GroupVisibleTab[],
  overVisibleId: string,
  pointerX: number | null,
  hoveredRect?: ClientRect | null
): number | null {
  const hoveredIndex = orderedTabs.findIndex((item) => item.visibleId === overVisibleId)
  if (hoveredIndex === -1) {
    return null
  }
  if (pointerX == null || !hoveredRect) {
    return hoveredIndex
  }
  const midpoint = hoveredRect.left + hoveredRect.width / 2
  return hoveredIndex + (pointerX >= midpoint ? 1 : 0)
}

// Why: when the pointer is in the tab-bar container but not directly over a
// sortable item (e.g. empty space after the last tab), we still need a usable
// insertion index. This scans all sortable rects for the group and picks the
// closest tab by horizontal distance, then uses pointer-vs-midpoint to decide
// whether to insert before or after it.
function computeInsertionFromPointer(
  orderedTabs: GroupVisibleTab[],
  pointer: { x: number; y: number } | null,
  rects: Map<string, ClientRect | undefined>,
  groupId: string
): number | null {
  if (!pointer || orderedTabs.length === 0) {
    return null
  }

  let bestIndex = -1
  let bestDistance = Infinity

  for (let i = 0; i < orderedTabs.length; i++) {
    const sortableId = buildSharedSortableId(groupId, orderedTabs[i]!.visibleId)
    const rect = rects.get(sortableId)
    if (!rect) {
      continue
    }
    const midpoint = rect.left + rect.width / 2
    const distance = Math.abs(pointer.x - midpoint)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i
    }
  }

  if (bestIndex === -1) {
    return orderedTabs.length
  }

  const sortableId = buildSharedSortableId(groupId, orderedTabs[bestIndex]!.visibleId)
  const rect = rects.get(sortableId)
  if (!rect) {
    return bestIndex
  }

  const midpoint = rect.left + rect.width / 2
  return bestIndex + (pointer.x >= midpoint ? 1 : 0)
}

function applyInsertionIndex(
  currentOrder: string[],
  tabId: string,
  insertionIndex: number
): string[] | null {
  const currentIndex = currentOrder.indexOf(tabId)
  if (currentIndex === -1) {
    return null
  }

  const nextOrder = currentOrder.filter((candidate) => candidate !== tabId)
  const adjustedInsertionIndex = currentIndex < insertionIndex ? insertionIndex - 1 : insertionIndex
  const clampedInsertionIndex = Math.max(0, Math.min(adjustedInsertionIndex, nextOrder.length))
  nextOrder.splice(clampedInsertionIndex, 0, tabId)

  return nextOrder.every((candidate, index) => candidate === currentOrder[index]) ? null : nextOrder
}

const EMPTY_DRAG_STATE: CrossGroupDragState = {
  activeTab: null,
  overGroupId: null,
  overTabBarIndex: null
}

export default function TabGroupDndContext({
  worktreeId,
  children
}: {
  worktreeId: string
  children: React.ReactNode
}): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    })
  )
  const reorderUnifiedTabs = useAppStore((state) => state.reorderUnifiedTabs)
  const moveUnifiedTabToGroup = useAppStore((state) => state.moveUnifiedTabToGroup)
  const closeEmptyGroup = useAppStore((state) => state.closeEmptyGroup)
  const groups = useAppStore((state) => state.groupsByWorktree[worktreeId] ?? [])
  const unifiedTabs = useAppStore((state) => state.unifiedTabsByWorktree[worktreeId] ?? [])
  const [dragState, setDragState] = useState<CrossGroupDragState>(EMPTY_DRAG_STATE)
  const dragStateRef = useRef(dragState)
  dragStateRef.current = dragState
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const droppableRectsRef = useRef<Map<string, ClientRect | undefined>>(new Map())

  const groupVisibleOrder = useMemo(() => {
    const tabsById = new Map(unifiedTabs.map((tab) => [tab.id, tab]))
    return new Map(
      groups.map((group) => [
        group.id,
        group.tabOrder
          .map((tabId) => tabsById.get(tabId))
          .filter((tab): tab is Tab => tab !== undefined)
          .map((tab) => ({
            unifiedTabId: tab.id,
            visibleId: toVisibleTabId(tab)
          }))
      ])
    )
  }, [groups, unifiedTabs])

  const maybeCloseEmptySourceGroup = useCallback(
    (sourceGroupId: string) => {
      const state = useAppStore.getState()
      const nextGroups = state.groupsByWorktree[worktreeId] ?? []
      const sourceGroup = nextGroups.find((group) => group.id === sourceGroupId)
      if (!sourceGroup || sourceGroup.tabOrder.length > 0 || nextGroups.length <= 1) {
        return
      }
      closeEmptyGroup(worktreeId, sourceGroupId)
    },
    [closeEmptyGroup, worktreeId]
  )

  // Why: collision detection is fully pointer-based instead of using
  // closestCenter. With DragOverlay the active element stays at its original
  // position (hidden), so closestCenter measures distance from the ORIGINAL
  // tab position — not the cursor — which returns the wrong sortable.
  // Pointer-based hit testing returns whichever droppable the cursor is
  // actually over, or the tab-bar container for empty-space hits.
  const collisionDetection = useCallback<CollisionDetection>(
    (args: Parameters<CollisionDetection>[0]) => {
      if (args.pointerCoordinates) {
        pointerRef.current = args.pointerCoordinates
      }
      droppableRectsRef.current = new Map(
        args.droppableContainers.map((container) => [
          String(container.id),
          args.droppableRects.get(container.id) ?? args.droppableRects.get(String(container.id))
        ])
      )

      if (!args.pointerCoordinates) {
        return closestCenter(args)
      }

      const pointer = args.pointerCoordinates
      const getRect = (id: string | number) =>
        args.droppableRects.get(id) ?? args.droppableRects.get(String(id))

      // 1. Check if pointer is directly over a sortable tab element
      const sortableHit = args.droppableContainers.find((container) => {
        if (!parseSharedSortableId(String(container.id))) {
          return false
        }
        return pointInRect(pointer, getRect(container.id))
      })
      if (sortableHit) {
        return makeCollision(String(sortableHit.id), args)
      }

      // 2. Check if pointer is in a tab-bar container (empty space after tabs)
      const tabBarHit = args.droppableContainers.find((container) => {
        if (!parseGroupDropId(String(container.id))) {
          return false
        }
        return pointInRect(pointer, getRect(container.id))
      })
      if (tabBarHit) {
        return makeCollision(String(tabBarHit.id), args)
      }

      return []
    },
    []
  )

  const clearDragState = useCallback(() => {
    pointerRef.current = null
    setDragState(EMPTY_DRAG_STATE)
  }, [])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const activeTab = event.active.data.current as TabDragData | undefined
      if (!activeTab) {
        clearDragState()
        return
      }
      setDragState({
        activeTab,
        overGroupId: activeTab.sourceGroupId,
        overTabBarIndex: null
      })
    },
    [clearDragState]
  )

  // Why: onDragOver only fires when the "over" element changes (e.g. moving
  // from tab A to tab B). But the left/right insertion point within a single
  // tab depends on the pointer crossing that tab's midpoint — which does NOT
  // change the over element. Recomputing on every move keeps the indicator
  // tracking the cursor in real time.
  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const translatedRect = event.active.rect.current.translated
      if (!translatedRect) {
        return
      }
      const pointer = {
        x: translatedRect.left + translatedRect.width / 2,
        y: translatedRect.top + translatedRect.height / 2
      }
      pointerRef.current = pointer

      setDragState((current) => {
        if (!current.activeTab || !current.overGroupId) {
          return current
        }
        const orderedTabs = groupVisibleOrder.get(current.overGroupId) ?? []
        const newIndex =
          computeInsertionFromPointer(
            orderedTabs,
            pointer,
            droppableRectsRef.current,
            current.overGroupId
          ) ?? orderedTabs.length
        if (newIndex === current.overTabBarIndex) {
          return current
        }
        return { ...current, overTabBarIndex: newIndex }
      })
    },
    [groupVisibleOrder]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const activeTab = event.active.data.current as TabDragData | undefined
      if (!activeTab || !event.over) {
        setDragState((current) =>
          current.activeTab
            ? {
                activeTab: current.activeTab,
                overGroupId: null,
                overTabBarIndex: null
              }
            : EMPTY_DRAG_STATE
        )
        return
      }

      const overId = String(event.over.id)
      const sortableTarget = parseSharedSortableId(overId)
      if (sortableTarget) {
        const orderedTabs = groupVisibleOrder.get(sortableTarget.groupId) ?? []
        const insertionIndex = computeInsertionIndex(
          orderedTabs,
          sortableTarget.visibleId,
          pointerRef.current?.x ?? null,
          droppableRectsRef.current.get(overId)
        )
        setDragState({
          activeTab,
          overGroupId: sortableTarget.groupId,
          overTabBarIndex: insertionIndex
        })
        return
      }

      const groupDropTarget = parseGroupDropId(overId)
      if (groupDropTarget) {
        const orderedTabs = groupVisibleOrder.get(groupDropTarget.groupId) ?? []
        const insertionIndex = computeInsertionFromPointer(
          orderedTabs,
          pointerRef.current,
          droppableRectsRef.current,
          groupDropTarget.groupId
        )
        setDragState({
          activeTab,
          overGroupId: groupDropTarget.groupId,
          overTabBarIndex: insertionIndex ?? orderedTabs.length
        })
        return
      }

      clearDragState()
    },
    [clearDragState, groupVisibleOrder]
  )

  const handleDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      clearDragState()
    },
    [clearDragState]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeTab = event.active.data.current as TabDragData | undefined
      const currentDragState = dragStateRef.current
      clearDragState()

      if (!activeTab || !event.over || !currentDragState.overGroupId) {
        return
      }

      const targetGroupId = currentDragState.overGroupId

      if (currentDragState.overTabBarIndex !== null) {
        if (activeTab.sourceGroupId === targetGroupId) {
          const currentOrder =
            groupVisibleOrder.get(targetGroupId)?.map((item) => item.unifiedTabId) ?? []
          const nextOrder = applyInsertionIndex(
            currentOrder,
            activeTab.unifiedTabId,
            currentDragState.overTabBarIndex
          )
          if (nextOrder) {
            reorderUnifiedTabs(targetGroupId, nextOrder)
          }
          return
        }

        moveUnifiedTabToGroup(activeTab.unifiedTabId, targetGroupId, {
          index: currentDragState.overTabBarIndex,
          activate: true
        })
        maybeCloseEmptySourceGroup(activeTab.sourceGroupId)
      }
    },
    [
      clearDragState,
      groupVisibleOrder,
      maybeCloseEmptySourceGroup,
      moveUnifiedTabToGroup,
      reorderUnifiedTabs
    ]
  )

  const overlayIcon = (() => {
    if (!dragState.activeTab) {
      return null
    }
    if (dragState.activeTab.contentType === 'terminal') {
      return <TerminalSquare className="size-3.5 shrink-0" />
    }
    if (dragState.activeTab.contentType === 'browser') {
      return <Globe className="size-3.5 shrink-0" />
    }
    return <FileCode className="size-3.5 shrink-0" />
  })()

  return (
    <CrossGroupDndContextPresent.Provider value={true}>
      <CrossGroupDragStateContext.Provider value={dragState}>
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {children}
          <DragOverlay>
            {dragState.activeTab ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-card/95 px-3 py-1.5 text-sm shadow-lg">
                {overlayIcon}
                <span className="max-w-[240px] truncate">{dragState.activeTab.label}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </CrossGroupDragStateContext.Provider>
    </CrossGroupDndContextPresent.Provider>
  )
}
